import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Card, SectionHeader } from "../../coach/ui/components";
import { useEffectiveBearer } from "../../lib/useEffectiveBearer";
import { useModalReveal } from "../../lib/useModalReveal";
import { DAECHI_LINKS_UPDATED_EVENT } from "../../lib/linkEvents";
import ko from "../../coach/fallbacks/ko.json";
import { tpl } from "../../coach/fallbacks/tpl";

const coachPreviewFb = ko.parentCoachPreview;
const coachSettingsFb = ko.parentCoachSettings;
import type {
  ParentCoachCustomization,
  ParentStudentRow
} from "../../types/parent";

type ParentLinkRow = {
  id: number;
  student_email: string;
  student_id: number;
  created_at: string;
};

type LocalParentProfile = {
  intro?: string;
};

type ParentAlarmSettings = {
  reportAlerts: boolean;
  studentLinkAlerts: boolean;
  studyRoomAlerts: boolean;
  messageAlerts: boolean;
  requestAlerts: boolean;
};

const PARENT_PROFILE_LS_KEY = "daechi_parent_profile_custom";

const DEFAULT_PARENT_ALARM_SETTINGS: ParentAlarmSettings = {
  reportAlerts: true,
  studentLinkAlerts: true,
  studyRoomAlerts: true,
  messageAlerts: true,
  requestAlerts: true
};
const DEFAULT_PARENT_COACH_CUSTOMIZATION: ParentCoachCustomization = {
  persona: "다정하지만 기준이 분명한 학습 코치",
  tone: "따뜻하고 또렷한 존댓말로, 공감 뒤에 바로 실행 행동을 제시한다.",
  controlIntensity: 3,
  focusRules:
    "해야 할 일을 작게 쪼개 바로 시작하게 돕고, 미루는 핑계는 부드럽지만 분명하게 바로잡는다.",
  updatedAt: null
};

function buildParentAlarmSettingsKey(email: string | null) {
  const normalized = String(email || "").trim().toLowerCase() || "anonymous";
  return `daechi_parent_alarm_settings:${normalized}`;
}

function readParentAlarmSettings(key: string) {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return DEFAULT_PARENT_ALARM_SETTINGS;
    return {
      ...DEFAULT_PARENT_ALARM_SETTINGS,
      ...(JSON.parse(raw) as Partial<ParentAlarmSettings>)
    };
  } catch {
    return DEFAULT_PARENT_ALARM_SETTINGS;
  }
}

function writeParentAlarmSettings(key: string, value: ParentAlarmSettings) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // ignore
  }
}

function accountPhoneDigitsComparable(value: string) {
  return String(value || "").replace(/\D/g, "");
}

function clampControlIntensity(value: number) {
  return Math.min(5, Math.max(1, Math.round(value || 3)));
}

function controlIntensityLabel(value: number) {
  const level = clampControlIntensity(value);
  if (level <= 1) return "매우 부드럽게";
  if (level === 2) return "부드럽게";
  if (level === 3) return "균형 있게";
  if (level === 4) return "단호하게";
  return "매우 단호하게";
}

function controlIntensitySliderFillPct(value: number) {
  const level = clampControlIntensity(value);
  const pct = ((level - 1) / 4) * 100;
  return `${pct}%`;
}

function ParentCoachSettingsField(props: {
  id: string;
  label: string;
  guide: string;
  example: string;
  rows: number;
  value: string;
  onChange: (value: string) => void;
}) {
  return (
    <div className="field parent-coach-settings__field">
      <label className="field-label" htmlFor={props.id}>
        {props.label}
      </label>
      <p className="parent-coach-settings__guide">{props.guide}</p>
      <p className="parent-coach-settings__example">{props.example}</p>
      <textarea
        id={props.id}
        className="field-input parent-coach-settings__input"
        rows={props.rows}
        value={props.value}
        onChange={e => props.onChange(e.target.value)}
      />
    </div>
  );
}

export function ParentProfilePage(props: {
  authToken: string | null;
  apiBase: string;
  userEmail: string | null;
  parentLinkEmail: string;
  setParentLinkEmail: (v: string) => void;
  parentWaitingOnStudent: ParentLinkRow[];
  parentWaitingOnMe: ParentLinkRow[];
  parentStudents: ParentStudentRow[];
  setParentWaitingOnStudent: (rows: ParentLinkRow[]) => void;
  setParentWaitingOnMe: (rows: ParentLinkRow[]) => void;
  setParentStudents: React.Dispatch<React.SetStateAction<ParentStudentRow[]>>;
  setParentStudentId: (id: number | null) => void;
  hapticWarning: () => void;
  hapticSuccess: () => void;
  onLogoutPress: () => void;
  onWithdrawPress: () => void;
  onUserEmailUpdated: (email: string) => void;
}) {
  const {
    apiBase,
    userEmail,
    parentLinkEmail,
    setParentLinkEmail,
    parentWaitingOnStudent,
    parentWaitingOnMe,
    parentStudents,
    setParentWaitingOnStudent,
    setParentWaitingOnMe,
    setParentStudents,
    setParentStudentId,
    hapticWarning,
    hapticSuccess,
    onLogoutPress,
    onWithdrawPress,
    onUserEmailUpdated
  } = props;
  const token = useEffectiveBearer(props.authToken);
  const alarmSettingsKey = useMemo(
    () => buildParentAlarmSettingsKey(userEmail),
    [userEmail]
  );
  const [localProfile, setLocalProfile] = useState<LocalParentProfile | null>(() => {
    try {
      const raw = localStorage.getItem(PARENT_PROFILE_LS_KEY);
      return raw ? (JSON.parse(raw) as LocalParentProfile) : null;
    } catch {
      return null;
    }
  });
  const [editOpen, setEditOpen] = useState(false);
  const [introInput, setIntroInput] = useState("");
  const [accountEditOpen, setAccountEditOpen] = useState(false);
  const [alarmSettingsModalOpen, setAlarmSettingsModalOpen] = useState(false);
  const [studentManagementModalOpen, setStudentManagementModalOpen] = useState(false);
  const [coachSettingsModalOpen, setCoachSettingsModalOpen] = useState(false);
  const [coachPreviewText, setCoachPreviewText] = useState(coachPreviewFb.sampleSoft);
  const [accountEmail, setAccountEmail] = useState("");
  const [accountPhone, setAccountPhone] = useState("");
  const [accountPhoneLoading, setAccountPhoneLoading] = useState(false);
  const [accountPhoneOtpCode, setAccountPhoneOtpCode] = useState("");
  const [accountPhoneVerifyToken, setAccountPhoneVerifyToken] = useState("");
  const [accountPhoneCodeSending, setAccountPhoneCodeSending] = useState(false);
  const [accountPhoneVerifySending, setAccountPhoneVerifySending] = useState(false);
  const [accountPhoneOtpHint, setAccountPhoneOtpHint] = useState("");
  const accountPhoneBaselineRef = useRef("");
  const [accountNewPw, setAccountNewPw] = useState("");
  const [accountNewPw2, setAccountNewPw2] = useState("");
  const [accountCurrentPw, setAccountCurrentPw] = useState("");
  const [accountSaving, setAccountSaving] = useState(false);
  const [accountError, setAccountError] = useState("");
  const [alarmSettings, setAlarmSettings] = useState<ParentAlarmSettings>(() =>
    readParentAlarmSettings(alarmSettingsKey)
  );
  const [coachCustomization, setCoachCustomization] = useState<ParentCoachCustomization>(
    DEFAULT_PARENT_COACH_CUSTOMIZATION
  );
  const [coachCustomizationLoading, setCoachCustomizationLoading] = useState(false);
  const [coachCustomizationSaving, setCoachCustomizationSaving] = useState(false);
  const [coachCustomizationMessage, setCoachCustomizationMessage] = useState("");
  const [parentLinkFeedback, setParentLinkFeedback] = useState("");
  const [unlinkingStudentId, setUnlinkingStudentId] = useState<number | null>(null);
  const [unlinkConfirmStudentId, setUnlinkConfirmStudentId] = useState<number | null>(null);

  const enabledAlarmCount = useMemo(() => {
    let count = 0;
    if (alarmSettings.reportAlerts) count += 1;
    if (alarmSettings.studentLinkAlerts) count += 1;
    if (alarmSettings.studyRoomAlerts) count += 1;
    if (alarmSettings.messageAlerts) count += 1;
    if (alarmSettings.requestAlerts) count += 1;
    return count;
  }, [alarmSettings]);

  const alarmSettingsSummary = enabledAlarmCount
    ? `${enabledAlarmCount}개 켜짐`
    : "모두 꺼짐";

  const studentManagementSummary = parentStudents.length > 0
    ? "연결됨"
    : parentWaitingOnStudent.length > 0 || parentWaitingOnMe.length > 0
      ? "요청 진행 중"
      : "미연결";

  const coachSettingsSummary = useMemo(() => {
    const isCustomized =
      coachCustomization.persona !== DEFAULT_PARENT_COACH_CUSTOMIZATION.persona ||
      coachCustomization.tone !== DEFAULT_PARENT_COACH_CUSTOMIZATION.tone ||
      coachCustomization.focusRules !== DEFAULT_PARENT_COACH_CUSTOMIZATION.focusRules ||
      clampControlIntensity(coachCustomization.controlIntensity) !==
        DEFAULT_PARENT_COACH_CUSTOMIZATION.controlIntensity;
    return isCustomized ? "맞춤형" : "기본";
  }, [coachCustomization]);

  const accountModalReveal = useModalReveal(accountEditOpen);
  const alarmSettingsModalReveal = useModalReveal(alarmSettingsModalOpen);
  const studentManagementModalReveal = useModalReveal(studentManagementModalOpen);
  const coachSettingsModalReveal = useModalReveal(coachSettingsModalOpen);
  const coachPreviewMeta = useMemo(
    () =>
      tpl(coachSettingsFb.previewMetaTpl, {
        label: controlIntensityLabel(coachCustomization.controlIntensity)
      }),
    [coachCustomization.controlIntensity]
  );

  useEffect(() => {
    if (!coachSettingsModalOpen) return;
    const timer = window.setTimeout(() => {
      const intensity = clampControlIntensity(coachCustomization.controlIntensity);
      const sample =
        intensity <= 2
          ? coachPreviewFb.sampleSoft
          : intensity >= 4
            ? coachPreviewFb.sampleFirm
            : coachPreviewFb.sampleWarm;
      setCoachPreviewText(sample);
    }, 350);
    return () => window.clearTimeout(timer);
  }, [
    coachSettingsModalOpen,
    coachCustomization.controlIntensity,
    coachCustomization.persona,
    coachCustomization.tone
  ]);
  const profileEditModalReveal = useModalReveal(editOpen);

  useEffect(() => {
    setAlarmSettings(readParentAlarmSettings(alarmSettingsKey));
  }, [alarmSettingsKey]);

  useEffect(() => {
    if (!token) return;
    let cancelled = false;
    void (async () => {
      try {
        const res = await fetch(`${apiBase}/api/parent/alarm-settings`, {
          headers: {
            Authorization: `Bearer ${token}`
          },
          cache: "no-store"
        });
        const data = (await res.json().catch(() => ({}))) as {
          settings?: Partial<ParentAlarmSettings>;
        };
        if (!res.ok || cancelled || !data.settings) return;
        const next: ParentAlarmSettings = {
          reportAlerts:
            data.settings.reportAlerts == null
              ? DEFAULT_PARENT_ALARM_SETTINGS.reportAlerts
              : Boolean(data.settings.reportAlerts),
          studentLinkAlerts:
            data.settings.studentLinkAlerts == null
              ? DEFAULT_PARENT_ALARM_SETTINGS.studentLinkAlerts
              : Boolean(data.settings.studentLinkAlerts),
          studyRoomAlerts:
            data.settings.studyRoomAlerts == null
              ? DEFAULT_PARENT_ALARM_SETTINGS.studyRoomAlerts
              : Boolean(data.settings.studyRoomAlerts),
          messageAlerts:
            data.settings.messageAlerts == null
              ? DEFAULT_PARENT_ALARM_SETTINGS.messageAlerts
              : Boolean(data.settings.messageAlerts),
          requestAlerts:
            data.settings.requestAlerts == null
              ? DEFAULT_PARENT_ALARM_SETTINGS.requestAlerts
              : Boolean(data.settings.requestAlerts)
        };
        setAlarmSettings(next);
        writeParentAlarmSettings(alarmSettingsKey, next);
      } catch {
        // keep cached value
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [alarmSettingsKey, apiBase, token]);

  useEffect(() => {
    if (!token) {
      setCoachCustomization(DEFAULT_PARENT_COACH_CUSTOMIZATION);
      setCoachCustomizationLoading(false);
      setCoachCustomizationMessage("");
      return;
    }

    let cancelled = false;
    setCoachCustomizationLoading(true);
    void (async () => {
      try {
        const res = await fetch(`${apiBase}/api/parent/coach-customization`, {
          headers: {
            Authorization: `Bearer ${token}`
          }
        });
        const data = (await res.json().catch(() => ({}))) as {
          customization?: Partial<ParentCoachCustomization>;
          error?: string;
        };
        if (!res.ok) {
          throw new Error(String(data.error || "AI 코치 설정을 불러오지 못했습니다."));
        }
        if (cancelled) return;
        setCoachCustomization({
          ...DEFAULT_PARENT_COACH_CUSTOMIZATION,
          ...data.customization,
          controlIntensity: clampControlIntensity(
            Number(data.customization?.controlIntensity ?? 3)
          )
        });
        setCoachCustomizationMessage("");
      } catch (error) {
        if (cancelled) return;
        setCoachCustomizationMessage(
          error instanceof Error && error.message
            ? error.message
            : "AI 코치 설정을 불러오지 못했습니다."
        );
      } finally {
        if (!cancelled) {
          setCoachCustomizationLoading(false);
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [apiBase, token]);

  const displayName = useMemo(() => {
    const email = String(userEmail || "").trim();
    if (!email) return "학부모";
    const localPart = email.split("@")[0]?.trim();
    return localPart || "학부모";
  }, [userEmail]);
  const introText =
    localProfile?.intro ||
    (parentStudents.length > 0
      ? `${parentStudents.length}명의 학생과 학습 루틴을 함께 보고 있어요.`
      : "아직 연결된 학생이 없어요.");

  const persistLocalProfile = (next: LocalParentProfile) => {
    setLocalProfile(next);
    try {
      localStorage.setItem(PARENT_PROFILE_LS_KEY, JSON.stringify(next));
    } catch {
      // ignore
    }
  };

  const persistAlarmSettings = useCallback(
    async (next: ParentAlarmSettings) => {
      if (!token) return;
      try {
        await fetch(`${apiBase}/api/parent/alarm-settings`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${token}`
          },
          body: JSON.stringify(next)
        });
      } catch {
        // keep local state even if remote sync fails
      }
    },
    [apiBase, token]
  );

  const toggleAlarmSetting = (key: keyof ParentAlarmSettings) => {
    setAlarmSettings(prev => {
      const next = {
        ...prev,
        [key]: !prev[key]
      };
      writeParentAlarmSettings(alarmSettingsKey, next);
      void persistAlarmSettings(next);
      return next;
    });
  };

  const refreshLinkRequests = useCallback(async () => {
    if (!props.authToken) return;
    const lr = await fetch(`${apiBase}/api/parent/link-requests`, {
      headers: {
        Authorization: `Bearer ${props.authToken}`
      }
    });
    if (!lr.ok) return;
    const data = await lr.json();
    setParentWaitingOnStudent(data.waitingOnStudent || []);
    setParentWaitingOnMe(data.waitingOnMe || []);
  }, [apiBase, props.authToken, setParentWaitingOnMe, setParentWaitingOnStudent]);

  const refreshStudents = useCallback(async () => {
    if (!props.authToken) return;
    const st = await fetch(`${apiBase}/api/parent/students`, {
      headers: {
        Authorization: `Bearer ${props.authToken}`
      }
    });
    if (!st.ok) return;
    const data = await st.json();
    const next = data.students || [];
    setParentStudents(next);
    setParentStudentId(next.length > 0 ? next[0].id : null);
  }, [apiBase, props.authToken, setParentStudentId, setParentStudents]);

  useEffect(() => {
    const onLinksUpdated = () => {
      void refreshLinkRequests();
      void refreshStudents();
    };
    window.addEventListener(DAECHI_LINKS_UPDATED_EVENT, onLinksUpdated);
    return () => {
      window.removeEventListener(DAECHI_LINKS_UPDATED_EVENT, onLinksUpdated);
    };
  }, [refreshLinkRequests, refreshStudents]);

  const openAccountEdit = useCallback(async () => {
    setAccountEmail((userEmail || "").trim());
    setAccountNewPw("");
    setAccountNewPw2("");
    setAccountCurrentPw("");
    setAccountError("");
    setAccountPhoneOtpCode("");
    setAccountPhoneVerifyToken("");
    setAccountPhoneOtpHint("");
    setAccountPhone("");
    accountPhoneBaselineRef.current = "";
    setAccountEditOpen(true);
    if (!token) return;
    setAccountPhoneLoading(true);
    try {
      const res = await fetch(`${apiBase}/api/me`, {
        headers: { Authorization: `Bearer ${token}` },
        cache: "no-store"
      });
      const data = (await res.json().catch(() => ({}))) as {
        parentPhone?: string | null;
      };
      if (res.ok) {
        const p = data.parentPhone != null ? String(data.parentPhone) : "";
        setAccountPhone(p);
        accountPhoneBaselineRef.current = p;
      }
    } finally {
      setAccountPhoneLoading(false);
    }
  }, [apiBase, token, userEmail]);

  const openAlarmSettingsModal = () => {
    setAlarmSettingsModalOpen(true);
  };

  const closeAlarmSettingsModal = () => {
    alarmSettingsModalReveal.beginClose(() => setAlarmSettingsModalOpen(false));
  };

  const openStudentManagementModal = () => {
    setStudentManagementModalOpen(true);
  };

  const closeStudentManagementModal = () => {
    studentManagementModalReveal.beginClose(() => {
      setStudentManagementModalOpen(false);
      setUnlinkConfirmStudentId(null);
    });
  };

  const requestStudentUnlink = useCallback(
    async (studentId: number) => {
      if (!token) return;
      setUnlinkingStudentId(studentId);
      try {
        const res = await fetch(`${apiBase}/api/link/unlink`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${token}`
          },
          body: JSON.stringify({ studentId })
        });
        const data = (await res.json().catch(() => ({}))) as { error?: string };
        if (!res.ok) {
          setParentLinkFeedback(String(data.error || "연결 끊기 요청에 실패했습니다."));
          hapticWarning();
          return;
        }
        setParentLinkFeedback("학생에게 연결 끊기 요청을 보냈습니다.");
        setUnlinkConfirmStudentId(null);
        hapticSuccess();
      } catch {
        setParentLinkFeedback("네트워크 오류로 요청을 보내지 못했습니다.");
        hapticWarning();
      } finally {
        setUnlinkingStudentId(null);
      }
    },
    [apiBase, hapticSuccess, hapticWarning, token]
  );

  const openCoachSettingsModal = () => {
    setCoachSettingsModalOpen(true);
  };

  const closeCoachSettingsModal = () => {
    coachSettingsModalReveal.beginClose(() => setCoachSettingsModalOpen(false));
  };

  const showAccountPhoneOtpFlow = useMemo(() => {
    if (accountPhoneLoading) return false;
    const cur = accountPhoneDigitsComparable(accountPhone.trim());
    const base = accountPhoneDigitsComparable(accountPhoneBaselineRef.current);
    return cur.length > 0 && cur !== base;
  }, [accountPhone, accountPhoneLoading]);

  const sendAccountPhoneCode = async () => {
    if (!token) return;
    const phone = accountPhone.trim();
    const d = accountPhoneDigitsComparable(phone);
    if (d.length < 10 || d.length > 11) {
      setAccountError("휴대폰 번호를 확인해 주세요.");
      hapticWarning();
      return;
    }
    setAccountError("");
    setAccountPhoneOtpHint("");
    setAccountPhoneCodeSending(true);
    try {
      const res = await fetch(`${apiBase}/api/parent/account/send-phone-code`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`
        },
        body: JSON.stringify({ phone })
      });
      const data = (await res.json().catch(() => ({}))) as { error?: string };
      if (!res.ok) {
        setAccountError(String(data.error || "인증번호를 보내지 못했습니다."));
        hapticWarning();
        return;
      }
      setAccountPhoneVerifyToken("");
      setAccountPhoneOtpHint("인증번호를 문자로 보냈어요.");
      hapticSuccess();
    } catch (e: unknown) {
      setAccountError(
        e instanceof Error && e.message
          ? e.message
          : "네트워크 오류입니다. 인터넷 연결을 확인해 주세요."
      );
      hapticWarning();
    } finally {
      setAccountPhoneCodeSending(false);
    }
  };

  const verifyAccountPhoneCode = async () => {
    if (!token) return;
    const phone = accountPhone.trim();
    const code = accountPhoneOtpCode.trim();
    if (!/^\d{6}$/.test(code)) {
      setAccountError("인증번호 6자리를 입력해 주세요.");
      hapticWarning();
      return;
    }
    setAccountError("");
    setAccountPhoneVerifySending(true);
    try {
      const res = await fetch(`${apiBase}/api/parent/account/verify-phone-code`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`
        },
        body: JSON.stringify({ phone, code })
      });
      const data = (await res.json().catch(() => ({}))) as {
        error?: string;
        phoneVerifyToken?: string;
      };
      if (!res.ok || !data.phoneVerifyToken) {
        setAccountError(String(data.error || "인증에 실패했습니다."));
        setAccountPhoneVerifyToken("");
        hapticWarning();
        return;
      }
      setAccountPhoneVerifyToken(String(data.phoneVerifyToken));
      setAccountPhoneOtpHint("휴대폰 인증이 완료됐어요.");
      hapticSuccess();
    } catch (e: unknown) {
      setAccountError(
        e instanceof Error && e.message
          ? e.message
          : "네트워크 오류입니다. 인터넷 연결을 확인해 주세요."
      );
      setAccountPhoneVerifyToken("");
      hapticWarning();
    } finally {
      setAccountPhoneVerifySending(false);
    }
  };

  const saveAccount = async () => {
    setAccountError("");
    const email = accountEmail.trim().toLowerCase();
    if (!email) {
      setAccountError("이메일을 입력해 주세요.");
      return;
    }
    const phoneTrim = accountPhone.trim();
    if (phoneTrim.length > 0) {
      const d = accountPhoneDigitsComparable(phoneTrim);
      if (d.length < 10 || d.length > 11) {
        setAccountError("휴대폰 번호를 확인해 주세요.");
        return;
      }
    }
    if (accountNewPw !== accountNewPw2) {
      setAccountError("새 비밀번호가 일치하지 않습니다.");
      return;
    }
    const emailChanged = email !== String(userEmail || "").trim().toLowerCase();
    const passwordChanged = accountNewPw.length > 0;
    const phoneDigits = accountPhoneDigitsComparable(phoneTrim);
    const baselineDigits = accountPhoneDigitsComparable(accountPhoneBaselineRef.current);
    const phoneChanged = phoneDigits !== baselineDigits;
    if (phoneTrim.length > 0 && phoneChanged && !accountPhoneVerifyToken) {
      setAccountError("휴대폰 인증을 완료해 주세요.");
      return;
    }
    if ((emailChanged || passwordChanged || phoneChanged) && !accountCurrentPw) {
      setAccountError(
        "이메일·휴대폰·비밀번호를 바꿀 때는 현재 비밀번호를 입력해 주세요."
      );
      return;
    }
    if (passwordChanged && accountNewPw.length < 4) {
      setAccountError("새 비밀번호는 4자 이상이어야 합니다.");
      return;
    }
    if (!token) return;
    setAccountSaving(true);
    try {
      const body: Record<string, string> = {
        email,
        phone: phoneTrim,
        currentPassword: accountCurrentPw
      };
      if (passwordChanged) body.newPassword = accountNewPw;
      if (phoneTrim.length > 0 && phoneChanged && accountPhoneVerifyToken) {
        body.phoneVerifyToken = accountPhoneVerifyToken;
      }
      const res = await fetch(`${apiBase}/api/account`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`
        },
        body: JSON.stringify(body)
      });
      const raw = await res.text();
      let data: {
        error?: string;
        user?: { email?: string; parentPhone?: string | null };
      } = {};
      try {
        if (raw) data = JSON.parse(raw) as typeof data;
      } catch {
        // ignore non-json response
      }
      if (!res.ok) {
        const msg =
          String(data.error || "").trim() ||
          (raw && raw.length < 400
            ? `서버 응답 ${res.status}: ${raw.replace(/<[^>]+>/g, " ").slice(0, 200)}`
            : `저장에 실패했습니다. (${res.status})`);
        setAccountError(msg);
        hapticWarning();
        return;
      }
      if (data.user?.email) {
        onUserEmailUpdated(String(data.user.email));
      }
      if (data.user && Object.prototype.hasOwnProperty.call(data.user, "parentPhone")) {
        const next =
          data.user.parentPhone != null ? String(data.user.parentPhone) : "";
        setAccountPhone(next);
        accountPhoneBaselineRef.current = next;
      }
      hapticSuccess();
      accountModalReveal.beginClose(() => {
        setAccountEditOpen(false);
        setAccountNewPw("");
        setAccountNewPw2("");
        setAccountCurrentPw("");
        setAccountPhoneOtpCode("");
        setAccountPhoneVerifyToken("");
        setAccountPhoneOtpHint("");
      });
    } catch (e: unknown) {
      setAccountError(
        e instanceof Error && e.message
          ? e.message
          : "네트워크 오류입니다. 인터넷 연결을 확인해 주세요."
      );
      hapticWarning();
    } finally {
      setAccountSaving(false);
    }
  };

  const saveLocalProfile = () => {
    const next: LocalParentProfile = {
      ...(localProfile || {}),
      intro: introInput.trim() || undefined
    };
    persistLocalProfile(next);
    profileEditModalReveal.beginClose(() => setEditOpen(false));
  };

  const saveCoachCustomization = async () => {
    if (!token) return;
    setCoachCustomizationSaving(true);
    setCoachCustomizationMessage("");
    try {
      const res = await fetch(`${apiBase}/api/parent/coach-customization`, {
        method: "PUT",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`
        },
        body: JSON.stringify({
          persona: coachCustomization.persona,
          tone: coachCustomization.tone,
          controlIntensity: clampControlIntensity(coachCustomization.controlIntensity),
          focusRules: coachCustomization.focusRules
        })
      });
      const data = (await res.json().catch(() => ({}))) as {
        customization?: Partial<ParentCoachCustomization>;
        error?: string;
      };
      if (!res.ok) {
        throw new Error(String(data.error || "AI 코치 설정 저장에 실패했습니다."));
      }
      setCoachCustomization({
        ...DEFAULT_PARENT_COACH_CUSTOMIZATION,
        ...data.customization,
        controlIntensity: clampControlIntensity(
          Number(data.customization?.controlIntensity ?? coachCustomization.controlIntensity)
        )
      });
      setCoachCustomizationMessage("저장한 설정이 연결된 학생들의 AI 코치에 반영됩니다.");
      hapticSuccess();
    } catch (error) {
      setCoachCustomizationMessage(
        error instanceof Error && error.message
          ? error.message
          : "AI 코치 설정 저장 중 오류가 발생했습니다."
      );
      hapticWarning();
    } finally {
      setCoachCustomizationSaving(false);
    }
  };

  return (
    <>
      <div className="student-profile-page section">
        <Card className="coach-card coach-card--padded coach-profile-card">
          <div className="coach-profile-card__main">
            <div className="coach-profile-card__info">
              <div className="coach-profile-card__content">
                <div className="coach-profile-card__name-row">
                  <span className="coach-profile-card__name">{displayName}</span>
                </div>
                <div className="coach-profile-card__goal">
                  {introText ? `소개 · ${introText}` : "아직 소개를 설정하지 않았어요."}
                </div>
              </div>
              <button
                type="button"
                className="coach-primary-btn coach-profile-card__action"
                onClick={() => {
                  setIntroInput(localProfile?.intro || "");
                  setEditOpen(true);
                }}
              >
                프로필 편집
              </button>
            </div>
          </div>
        </Card>

        <Card className="coach-card coach-card--padded student-profile-settings-card">
          <SectionHeader title="설정" />
          <div className="student-profile-settings-list">
            <button type="button" className="settings-item" onClick={() => void openAccountEdit()}>
              <span className="settings-label">이메일 · 비밀번호 · 휴대폰</span>
              <span className="settings-value">수정</span>
            </button>
            <button
              type="button"
              className="settings-item"
              onClick={openAlarmSettingsModal}
            >
              <span className="settings-label">알람 설정</span>
              <span className="settings-value">{alarmSettingsSummary}</span>
            </button>
            <button
              type="button"
              className="settings-item"
              onClick={openCoachSettingsModal}
            >
              <span className="settings-label">코치 설정</span>
              <span className="settings-value">{coachSettingsSummary}</span>
            </button>
            <button
              type="button"
              className="settings-item"
              onClick={openStudentManagementModal}
            >
              <span className="settings-label">학생 설정</span>
              <span className="settings-value">{studentManagementSummary}</span>
            </button>
            <button
              type="button"
              className="settings-item"
              onClick={() => {
                hapticWarning();
                onLogoutPress();
              }}
            >
              <span className="settings-label">로그아웃</span>
              <span className="settings-value">계정 전환</span>
            </button>
          </div>
        </Card>

        <Card className="coach-card coach-card--padded student-profile-danger-card">
          <div className="student-profile-danger-card__header">
            <span className="student-profile-danger-card__badge" aria-hidden>
              !
            </span>
            <div>
              <h2 className="student-profile-danger-card__title">회원 탈퇴</h2>
              <p className="student-profile-danger-card__desc">
                탈퇴하면 연결된 학생·리포트·설정을 복구할 수 없습니다. 진행 전에 꼭 확인해
                주세요.
              </p>
            </div>
          </div>
          <button
            type="button"
            className="student-profile-danger-btn student-profile-danger-btn--emphasis"
            onClick={() => {
              hapticWarning();
              onWithdrawPress();
            }}
          >
            회원 탈퇴하기
          </button>
        </Card>
      </div>

      <div
        className={"dday-modal" + (accountModalReveal.revealed ? " dday-modal--open" : "")}
        onClick={() => accountModalReveal.beginClose(() => setAccountEditOpen(false))}
      >
        <div className="dday-modal-inner" onClick={e => e.stopPropagation()}>
          <div className="dday-modal-header">
            <span className="dday-modal-title">계정 정보</span>
          </div>
          <div className="dday-modal-body">
            <div className="field">
              <label className="field-label" htmlFor="parent-account-email">
                이메일
              </label>
              <input
                id="parent-account-email"
                className="field-input"
                type="email"
                inputMode="email"
                autoCapitalize="none"
                value={accountEmail}
                onChange={e => setAccountEmail(e.target.value)}
                autoComplete="email"
              />
            </div>
            <div className="field" style={{ marginTop: 10 }}>
              <label className="field-label" htmlFor="parent-account-phone">
                휴대폰 번호
              </label>
              <input
                id="parent-account-phone"
                className="field-input"
                type="tel"
                inputMode="tel"
                autoCapitalize="none"
                value={accountPhone}
                onChange={e => {
                  setAccountPhone(e.target.value);
                  setAccountPhoneVerifyToken("");
                  setAccountPhoneOtpCode("");
                  setAccountPhoneOtpHint("");
                }}
                autoComplete="tel"
                placeholder="01012345678"
                disabled={accountPhoneLoading}
              />
              {accountPhoneLoading ? (
                <p className="settings-hint" style={{ marginTop: 6, marginBottom: 0 }}>
                  번호를 불러오는 중…
                </p>
              ) : null}
              {showAccountPhoneOtpFlow ? (
                <div style={{ marginTop: 10 }}>
                  <button
                    type="button"
                    className="coach-primary-btn"
                    style={{ width: "100%", marginBottom: 8 }}
                    onClick={() => void sendAccountPhoneCode()}
                    disabled={accountPhoneCodeSending || accountPhoneVerifySending}
                  >
                    {accountPhoneCodeSending ? "보내는 중…" : "인증번호 받기"}
                  </button>
                  <label className="field-label" htmlFor="parent-account-phone-otp">
                    인증번호 (6자리)
                  </label>
                  <input
                    id="parent-account-phone-otp"
                    className="field-input"
                    type="text"
                    inputMode="numeric"
                    autoComplete="one-time-code"
                    maxLength={6}
                    value={accountPhoneOtpCode}
                    onChange={e => {
                      const v = e.target.value.replace(/\D/g, "").slice(0, 6);
                      setAccountPhoneOtpCode(v);
                      if (accountPhoneVerifyToken) setAccountPhoneVerifyToken("");
                      if (accountPhoneOtpHint.includes("완료")) setAccountPhoneOtpHint("");
                    }}
                    placeholder="123456"
                    disabled={accountPhoneVerifySending}
                  />
                  <button
                    type="button"
                    className="modal-secondary"
                    style={{ width: "100%", marginTop: 8 }}
                    onClick={() => void verifyAccountPhoneCode()}
                    disabled={
                      accountPhoneVerifySending ||
                      accountPhoneOtpCode.trim().length !== 6
                    }
                  >
                    {accountPhoneVerifySending ? "확인 중…" : "인증 확인"}
                  </button>
                </div>
              ) : null}
              {accountPhoneOtpHint ? (
                <p className="settings-hint" style={{ marginTop: 8, marginBottom: 0 }}>
                  {accountPhoneOtpHint}
                </p>
              ) : null}
            </div>
            <div className="field" style={{ marginTop: 10 }}>
              <label className="field-label" htmlFor="parent-account-new-pw">
                새 비밀번호
              </label>
              <input
                id="parent-account-new-pw"
                className="field-input"
                type="password"
                value={accountNewPw}
                onChange={e => setAccountNewPw(e.target.value)}
                autoComplete="new-password"
                placeholder="변경하지 않으면 비워 두세요"
              />
            </div>
            <div className="field" style={{ marginTop: 10 }}>
              <label className="field-label" htmlFor="parent-account-new-pw2">
                새 비밀번호 확인
              </label>
              <input
                id="parent-account-new-pw2"
                className="field-input"
                type="password"
                value={accountNewPw2}
                onChange={e => setAccountNewPw2(e.target.value)}
                autoComplete="new-password"
              />
            </div>
            <div className="field" style={{ marginTop: 10 }}>
              <label className="field-label" htmlFor="parent-account-current-pw">
                현재 비밀번호
              </label>
              <input
                id="parent-account-current-pw"
                className="field-input"
                type="password"
                value={accountCurrentPw}
                onChange={e => setAccountCurrentPw(e.target.value)}
                autoComplete="current-password"
                placeholder="이메일·휴대폰·비밀번호 변경 시 필요"
              />
            </div>
            {accountError ? (
              <p className="settings-hint" style={{ marginTop: 10 }}>
                {accountError}
              </p>
            ) : null}
          </div>
          <div className="dday-modal-footer">
            <button
              type="button"
              className="modal-secondary"
              onClick={() => accountModalReveal.beginClose(() => setAccountEditOpen(false))}
              disabled={
                accountSaving ||
                accountPhoneLoading ||
                accountPhoneCodeSending ||
                accountPhoneVerifySending
              }
            >
              취소
            </button>
            <button
              type="button"
              className="modal-primary"
              onClick={() => void saveAccount()}
              disabled={
                accountSaving ||
                accountPhoneLoading ||
                accountPhoneCodeSending ||
                accountPhoneVerifySending
              }
            >
              {accountSaving ? "저장 중…" : "저장"}
            </button>
          </div>
        </div>
      </div>

      <div
        className={
          "dday-modal" + (alarmSettingsModalReveal.revealed ? " dday-modal--open" : "")
        }
        onClick={closeAlarmSettingsModal}
      >
        <div className="dday-modal-inner" onClick={e => e.stopPropagation()}>
          <div className="dday-modal-header">
            <span className="dday-modal-title">알림 관리</span>
          </div>
          <div className="dday-modal-body">
            <p className="settings-hint" style={{ margin: 0, lineHeight: 1.5 }}>
              받고 싶은 알림만 켜 둘 수 있어요.
            </p>
            <div className="student-profile-settings-list student-profile-alarm-list">
              <div className="settings-item settings-item--stack student-profile-alarm-item">
                <span className="student-profile-alarm-item__body">
                  <span className="student-profile-alarm-item__label">리포트 알림</span>
                  <span className="student-profile-alarm-item__copy">
                    일일 AI 리포트가 나오면 알려줘요.
                  </span>
                </span>
                <button
                  type="button"
                  className={
                    "student-profile-alarm-item__toggle student-profile-alarm-item__toggle-button" +
                    (alarmSettings.reportAlerts
                      ? " student-profile-alarm-item__toggle--on"
                      : " student-profile-alarm-item__toggle--off")
                  }
                  onClick={() => toggleAlarmSetting("reportAlerts")}
                  aria-pressed={alarmSettings.reportAlerts}
                >
                  {alarmSettings.reportAlerts ? "켜짐" : "꺼짐"}
                </button>
              </div>
              <div className="settings-item settings-item--stack student-profile-alarm-item">
                <span className="student-profile-alarm-item__body">
                  <span className="student-profile-alarm-item__label">학생 연결 알림</span>
                  <span className="student-profile-alarm-item__copy">
                    연결 요청, 승인, 거절, 해제 알림이 와요.
                  </span>
                </span>
                <button
                  type="button"
                  className={
                    "student-profile-alarm-item__toggle student-profile-alarm-item__toggle-button" +
                    (alarmSettings.studentLinkAlerts
                      ? " student-profile-alarm-item__toggle--on"
                      : " student-profile-alarm-item__toggle--off")
                  }
                  onClick={() => toggleAlarmSetting("studentLinkAlerts")}
                  aria-pressed={alarmSettings.studentLinkAlerts}
                >
                  {alarmSettings.studentLinkAlerts ? "켜짐" : "꺼짐"}
                </button>
              </div>
              <div className="settings-item settings-item--stack student-profile-alarm-item">
                <span className="student-profile-alarm-item__body">
                  <span className="student-profile-alarm-item__label">독서실 출입 알림</span>
                  <span className="student-profile-alarm-item__copy">
                    학생 체크인과 체크아웃 때 알려줘요.
                  </span>
                </span>
                <button
                  type="button"
                  className={
                    "student-profile-alarm-item__toggle student-profile-alarm-item__toggle-button" +
                    (alarmSettings.studyRoomAlerts
                      ? " student-profile-alarm-item__toggle--on"
                      : " student-profile-alarm-item__toggle--off")
                  }
                  onClick={() => toggleAlarmSetting("studyRoomAlerts")}
                  aria-pressed={alarmSettings.studyRoomAlerts}
                >
                  {alarmSettings.studyRoomAlerts ? "켜짐" : "꺼짐"}
                </button>
              </div>
              <div className="settings-item settings-item--stack student-profile-alarm-item">
                <span className="student-profile-alarm-item__body">
                  <span className="student-profile-alarm-item__label">학생 메시지 알림</span>
                  <span className="student-profile-alarm-item__copy">
                    학생 채팅 새 메시지가 오면 알려줘요.
                  </span>
                </span>
                <button
                  type="button"
                  className={
                    "student-profile-alarm-item__toggle student-profile-alarm-item__toggle-button" +
                    (alarmSettings.messageAlerts
                      ? " student-profile-alarm-item__toggle--on"
                      : " student-profile-alarm-item__toggle--off")
                  }
                  onClick={() => toggleAlarmSetting("messageAlerts")}
                  aria-pressed={alarmSettings.messageAlerts}
                >
                  {alarmSettings.messageAlerts ? "켜짐" : "꺼짐"}
                </button>
              </div>
              <div className="settings-item settings-item--stack student-profile-alarm-item">
                <span className="student-profile-alarm-item__body">
                  <span className="student-profile-alarm-item__label">요청 알림</span>
                  <span className="student-profile-alarm-item__copy">
                    계획 수정이나 앱 허용 요청이 오면 알려줘요.
                  </span>
                </span>
                <button
                  type="button"
                  className={
                    "student-profile-alarm-item__toggle student-profile-alarm-item__toggle-button" +
                    (alarmSettings.requestAlerts
                      ? " student-profile-alarm-item__toggle--on"
                      : " student-profile-alarm-item__toggle--off")
                  }
                  onClick={() => toggleAlarmSetting("requestAlerts")}
                  aria-pressed={alarmSettings.requestAlerts}
                >
                  {alarmSettings.requestAlerts ? "켜짐" : "꺼짐"}
                </button>
              </div>
            </div>
          </div>
          <div className="dday-modal-footer">
            <button type="button" className="modal-primary" onClick={closeAlarmSettingsModal}>
              닫기
            </button>
          </div>
        </div>
      </div>

      <div
        className={
          "dday-modal" + (studentManagementModalReveal.revealed ? " dday-modal--open" : "")
        }
        onClick={closeStudentManagementModal}
      >
        <div className="dday-modal-inner" onClick={e => e.stopPropagation()}>
          <div className="dday-modal-header">
            <span className="dday-modal-title">학생 설정</span>
          </div>
          <div className="dday-modal-body">
            <p className="settings-hint" style={{ margin: 0, lineHeight: 1.5 }}>
              연결된 학생 확인, 새 연결 요청, 승인 대기 상태를 여기서 관리할 수 있어요.
            </p>
            {parentStudents.length > 0 && (
              <div className="student-profile-link-status student-profile-link-status--first">
                <div className="student-profile-schedule-stack">
                  <div className="student-profile-schedule-panel">
                    {parentStudents.map(student => (
                      <div key={student.id} className="student-profile-schedule-item">
                        <div className="student-profile-schedule-item__body">
                          <div className="student-profile-schedule-item__title">{student.email}</div>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            )}
            <div className="field" style={{ marginTop: 12 }}>
              <label className="field-label" htmlFor="parent-student-email">
                학생 이메일
              </label>
              <input
                id="parent-student-email"
                className="field-input"
                value={parentLinkEmail}
                onChange={e => setParentLinkEmail(e.target.value)}
              />
            </div>
            <button
              type="button"
              className="coach-primary-btn"
              style={{ marginTop: 10 }}
              onClick={async () => {
                if (!props.authToken) return;
                const studentEmail = parentLinkEmail.trim();
                if (!studentEmail) {
                  setParentLinkFeedback("학생 이메일을 입력해 주세요.");
                  hapticWarning();
                  return;
                }
                try {
                  const res = await fetch(`${apiBase}/api/parent/link-request`, {
                    method: "POST",
                    headers: {
                      "Content-Type": "application/json",
                      Authorization: `Bearer ${props.authToken}`
                    },
                    body: JSON.stringify({ studentEmail })
                  });
                  const data = (await res.json().catch(() => ({}))) as { error?: string };
                  if (!res.ok) {
                    setParentLinkFeedback(
                      String(data.error || "연결 요청을 보내지 못했습니다.")
                    );
                    hapticWarning();
                    return;
                  }
                  setParentLinkEmail("");
                  setParentLinkFeedback("학생에게 연결 요청을 보냈어요.");
                  await refreshLinkRequests();
                  hapticSuccess();
                } catch {
                  setParentLinkFeedback("네트워크 오류로 연결 요청을 보내지 못했습니다.");
                  hapticWarning();
                }
              }}
            >
              연결 요청 보내기
            </button>
            {parentLinkFeedback ? (
              <p className="settings-hint" style={{ marginTop: 10 }}>
                {parentLinkFeedback}
              </p>
            ) : null}
            {parentWaitingOnStudent.length > 0 && (
              <div className="student-profile-link-status">
                <span className="student-profile-link-status__title">학생 승인 대기</span>
                {parentWaitingOnStudent.map(row => (
                  <span key={row.id} className="student-profile-link-status__hint">
                    {row.student_email}
                  </span>
                ))}
              </div>
            )}
            {parentWaitingOnMe.length > 0 && (
              <div className="student-profile-link-status student-profile-link-status--requests">
                <span className="student-profile-link-status__title">학생 연결 요청</span>
                {parentWaitingOnMe.map(row => (
                  <div key={row.id} className="student-profile-link-request-row">
                    <span className="student-profile-link-status__hint">{row.student_email}</span>
                    <div className="student-profile-link-request-row__actions">
                      <button
                        type="button"
                        className="progress-footer-btn"
                        onClick={async () => {
                          if (!props.authToken) return;
                          const res = await fetch(`${apiBase}/api/parent/link-confirm`, {
                            method: "POST",
                            headers: {
                              "Content-Type": "application/json",
                              Authorization: `Bearer ${props.authToken}`
                            },
                            body: JSON.stringify({ requestId: row.id })
                          });
                          if (!res.ok) return;
                          await refreshLinkRequests();
                          await refreshStudents();
                        }}
                      >
                        승인 — 이 학생과 연결
                      </button>
                      <button
                        type="button"
                        className="progress-footer-btn"
                        onClick={async () => {
                          if (!props.authToken) return;
                          await fetch(`${apiBase}/api/link/reject`, {
                            method: "POST",
                            headers: {
                              "Content-Type": "application/json",
                              Authorization: `Bearer ${props.authToken}`
                            },
                            body: JSON.stringify({ requestId: row.id })
                          });
                          await refreshLinkRequests();
                        }}
                      >
                        거절
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}
            {parentStudents.length > 0 ? (
              <section
                className="student-profile-danger-zone"
                aria-labelledby="parent-student-unlink-danger-title"
              >
                <h3 id="parent-student-unlink-danger-title" className="student-profile-danger-zone__title">
                  연결 끊기
                </h3>
                <p className="student-profile-danger-zone__hint">
                  연결을 끊으면 학습·리포트 연동이 중단됩니다. 학생이 요청을 수락해야 최종
                  해제됩니다.
                </p>
                <ul className="student-profile-danger-zone__list">
                  {parentStudents.map(student => (
                    <li key={student.id} className="student-profile-danger-zone__item">
                      <span className="student-profile-danger-zone__email">{student.email}</span>
                      {unlinkConfirmStudentId === student.id ? (
                        <div className="student-profile-danger-zone__confirm">
                          <p className="student-profile-danger-zone__confirm-text">
                            {student.email}와(과)의 연결을 끊을까요?
                          </p>
                          <div className="student-profile-danger-zone__confirm-actions">
                            <button
                              type="button"
                              className="student-profile-danger-btn student-profile-danger-btn--ghost"
                              disabled={unlinkingStudentId === student.id}
                              onClick={() => setUnlinkConfirmStudentId(null)}
                            >
                              취소
                            </button>
                            <button
                              type="button"
                              className="student-profile-danger-btn"
                              disabled={unlinkingStudentId === student.id}
                              onClick={() => void requestStudentUnlink(student.id)}
                            >
                              {unlinkingStudentId === student.id
                                ? "요청 중…"
                                : "연결 끊기 요청"}
                            </button>
                          </div>
                        </div>
                      ) : (
                        <button
                          type="button"
                          className="student-profile-danger-btn"
                          disabled={unlinkingStudentId != null}
                          onClick={() => {
                            hapticWarning();
                            setUnlinkConfirmStudentId(student.id);
                            setParentLinkFeedback("");
                          }}
                        >
                          연결 끊기
                        </button>
                      )}
                    </li>
                  ))}
                </ul>
              </section>
            ) : null}
          </div>
          <div className="dday-modal-footer">
            <button
              type="button"
              className="modal-primary"
              onClick={closeStudentManagementModal}
            >
              닫기
            </button>
          </div>
        </div>
      </div>

      <div
        className={
          "dday-modal" + (coachSettingsModalReveal.revealed ? " dday-modal--open" : "")
        }
        onClick={closeCoachSettingsModal}
      >
        <div
          className="dday-modal-inner parent-coach-settings-modal"
          onClick={e => e.stopPropagation()}
        >
          <div className="dday-modal-header">
            <span className="dday-modal-title">코치 설정</span>
          </div>
          <div className="dday-modal-body parent-coach-settings">
            <p className="parent-coach-settings__intro">{coachSettingsFb.modalIntro}</p>

            <section
              className="parent-coach-settings__preview-panel"
              aria-labelledby="parent-coach-preview-title"
              aria-live="polite"
            >
              <div className="parent-coach-settings__preview-head">
                <span className="parent-coach-settings__preview-eyebrow">
                  {coachSettingsFb.previewEyebrow}
                </span>
                <h3 id="parent-coach-preview-title" className="parent-coach-settings__preview-title">
                  {coachSettingsFb.previewTitle}
                </h3>
                <p className="parent-coach-settings__preview-meta">{coachPreviewMeta}</p>
              </div>
              <div className="coach-bubble coach-bubble--coach parent-coach-settings__preview-bubble">
                {coachPreviewText}
              </div>
              <p className="parent-coach-settings__preview-note">{coachSettingsFb.previewNote}</p>
            </section>

            <div className="parent-coach-settings__fields">
              <ParentCoachSettingsField
                id="parent-coach-persona"
                label="AI 코치 페르소나"
                guide={coachSettingsFb.personaGuide}
                example={coachSettingsFb.personaExample}
                rows={3}
                value={coachCustomization.persona}
                onChange={persona =>
                  setCoachCustomization(prev => ({ ...prev, persona }))
                }
              />
              <ParentCoachSettingsField
                id="parent-coach-tone"
                label="말투와 화법"
                guide={coachSettingsFb.toneGuide}
                example={coachSettingsFb.toneExample}
                rows={3}
                value={coachCustomization.tone}
                onChange={tone => setCoachCustomization(prev => ({ ...prev, tone }))}
              />
              <div className="field parent-coach-settings__field">
                <label className="field-label" htmlFor="parent-coach-control-intensity">
                  통제 강도
                </label>
                <p className="parent-coach-settings__guide">{coachSettingsFb.controlGuide}</p>
                <p className="parent-coach-settings__example">{coachSettingsFb.controlExample}</p>
                <div className="record-slider-row parent-profile-control-slider-row parent-coach-settings__slider">
                <div className="record-slider-pill">
                  <div
                    className="record-slider-pill__fill"
                    style={{
                      width: controlIntensitySliderFillPct(
                        coachCustomization.controlIntensity
                      )
                    }}
                  />
                  <input
                    id="parent-coach-control-intensity"
                    className="record-slider-pill__input"
                    type="range"
                    min={1}
                    max={5}
                    step={1}
                    value={clampControlIntensity(coachCustomization.controlIntensity)}
                    onChange={e =>
                      setCoachCustomization(prev => ({
                        ...prev,
                        controlIntensity: clampControlIntensity(Number(e.target.value))
                      }))
                    }
                    aria-valuetext={`${clampControlIntensity(
                      coachCustomization.controlIntensity
                    )}/5 ${controlIntensityLabel(
                      coachCustomization.controlIntensity
                    )}`}
                  />
                </div>
                <span className="record-slider-value parent-profile-control-slider-value">
                  {clampControlIntensity(coachCustomization.controlIntensity)}/5 ·{" "}
                  {controlIntensityLabel(coachCustomization.controlIntensity)}
                </span>
                </div>
              </div>
              <ParentCoachSettingsField
                id="parent-coach-focus-rules"
                label="특히 강조할 원칙"
                guide={coachSettingsFb.focusRulesGuide}
                example={coachSettingsFb.focusRulesExample}
                rows={4}
                value={coachCustomization.focusRules}
                onChange={focusRules =>
                  setCoachCustomization(prev => ({ ...prev, focusRules }))
                }
              />
            </div>
            {coachCustomizationMessage ? (
              <p className="parent-coach-settings__message" role="status">
                {coachCustomizationMessage}
              </p>
            ) : null}
          </div>
          <div className="dday-modal-footer">
            <button
              type="button"
              className="modal-secondary"
              onClick={closeCoachSettingsModal}
            >
              닫기
            </button>
            <button
              type="button"
              className="modal-primary"
              disabled={coachCustomizationSaving || coachCustomizationLoading}
              onClick={() => {
                void saveCoachCustomization();
              }}
            >
              {coachCustomizationSaving
                ? "저장 중…"
                : coachCustomizationLoading
                  ? "불러오는 중…"
                  : "AI 코치 설정 저장"}
            </button>
          </div>
        </div>
      </div>

      <div
        className={"dday-modal" + (profileEditModalReveal.revealed ? " dday-modal--open" : "")}
        onClick={() => profileEditModalReveal.beginClose(() => setEditOpen(false))}
      >
        <div className="dday-modal-inner" onClick={e => e.stopPropagation()}>
          <div className="dday-modal-header">
            <span className="dday-modal-title">프로필 편집</span>
          </div>
          <div className="dday-modal-body">
            <div className="field">
              <label className="field-label">한 줄 소개</label>
              <input
                className="field-input"
                value={introInput}
                onChange={e => setIntroInput(e.target.value)}
              />
            </div>
          </div>
          <div className="dday-modal-footer">
            <button
              type="button"
              className="modal-secondary"
              onClick={() => profileEditModalReveal.beginClose(() => setEditOpen(false))}
            >
              취소
            </button>
            <button type="button" className="modal-primary" onClick={saveLocalProfile}>
              저장
            </button>
          </div>
        </div>
      </div>

    </>
  );
}