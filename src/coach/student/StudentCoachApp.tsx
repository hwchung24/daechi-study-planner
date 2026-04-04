import React, { useEffect, useMemo, useState } from "react";
import { Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { motion } from "framer-motion";
import { demoDailyLogs, demoStudents } from "../demoData";
import { buildWeeklyInsight } from "../ai/insight-engine";
import { useCoachStore } from "../state/useCoachStore";
import type { NextAction } from "../types";
import { Card, EmptyState, RiskBadge, SectionHeader, StatPill } from "../ui/components";
import { API_BASE } from "../../lib/apiBase";

export type StudentTabKey = "home" | "coach";

function ActionChecklist({ actions }: { actions: NextAction[] }) {
  const done = useCoachStore(s => s.completedActionIds);
  const toggle = useCoachStore(s => s.toggleActionDone);
  return (
    <div className="coach-action-list">
      {actions.map(a => {
        const checked = Boolean(done[a.id]);
        return (
          <button
            key={a.id}
            type="button"
            className={"coach-action" + (checked ? " is-done" : "")}
            onClick={() => toggle(a.id)}
          >
            <span className={"coach-action__check" + (checked ? " on" : "")} aria-hidden />
            <div className="coach-action__content">
              <div className="coach-action__title">{a.title}</div>
              {a.detail && <div className="coach-action__detail">{a.detail}</div>}
            </div>
            {a.tag && <span className="coach-tag">{a.tag}</span>}
          </button>
        );
      })}
    </div>
  );
}

function PatternCard(props: {
  title: string;
  severity: string;
  explanation: string;
  recommendation: string;
}) {
  return (
    <Card className="coach-pattern">
      <div className="coach-pattern__top">
        <div className="coach-pattern__title">{props.title}</div>
        <span className={"coach-badge " + (props.severity === "높음" ? "coach-badge--danger" : props.severity === "보통" ? "coach-badge--warn" : "coach-badge--ok")}>
          {props.severity}
        </span>
      </div>
      <div className="coach-pattern__body">{props.explanation}</div>
      <div className="coach-pattern__rec">
        <span className="coach-pattern__rec-label">추천</span>
        <span className="coach-pattern__rec-text">{props.recommendation}</span>
      </div>
    </Card>
  );
}

function useCoachApiToken() {
  const [token, setToken] = useState("");
  useEffect(() => {
    try {
      setToken(String(localStorage.getItem("daechi_planner_token") || ""));
    } catch {
      setToken("");
    }
  }, []);
  return token;
}

type RemoteCoachState = {
  snapshot?: {
    profile?: {
      name?: string;
      schoolLevel?: string | null;
      grade?: number | null;
      goal?: string;
      targetSubjects?: string[];
    };
    heroNarrative?: string;
    metrics?: {
      sleepHours?: number | null;
      steps?: number | null;
      stress?: number | null;
      mealsRegularity?: number | null;
      concentration?: number | null;
      studyMinutes?: number | null;
      planCompletionRate?: number | null;
    };
    nextActions?: string[];
  };
};

type LocalStudentProfile = {
  avatarUrl?: string;
  goal?: string;
};

function HomeTabConnected() {
  const token = useCoachApiToken();
  const activeStudentId = useCoachStore(s => s.activeStudentId);
  const student = useMemo(
    () => demoStudents.find(s => s.id === activeStudentId) || demoStudents[0],
    [activeStudentId]
  );
  const [remote, setRemote] = useState<RemoteCoachState | null>(null);
  const [localProfile, setLocalProfile] = useState<LocalStudentProfile | null>(null);
  const [editOpen, setEditOpen] = useState(false);
  const [avatarInput, setAvatarInput] = useState("");
  const [goalInput, setGoalInput] = useState("");

  useEffect(() => {
    if (!token) return;
    fetch(`${API_BASE}/api/student/coach/state`, {
      headers: { Authorization: `Bearer ${token}` }
    })
      .then(r => (r.ok ? r.json() : Promise.reject(new Error("coach state fetch failed"))))
      .then(data => setRemote(data))
      .catch(() => setRemote(null));
  }, [token]);

  useEffect(() => {
    try {
      const raw = localStorage.getItem("daechi_student_profile_custom");
      if (!raw) return;
      const parsed = JSON.parse(raw) as LocalStudentProfile;
      setLocalProfile(parsed);
    } catch {
      setLocalProfile(null);
    }
  }, []);

  const saveLocalProfile = () => {
    const next: LocalStudentProfile = {
      avatarUrl: avatarInput.trim() || undefined,
      goal: goalInput.trim() || undefined
    };
    setLocalProfile(next);
    try {
      localStorage.setItem("daechi_student_profile_custom", JSON.stringify(next));
    } catch {
      // ignore
    }
    setEditOpen(false);
  };

  const insight = useMemo(() => buildWeeklyInsight(student.id, demoDailyLogs), [student.id]);

  const remoteActions = (remote?.snapshot?.nextActions || []).map((title, idx) => ({
    id: `remote_action_${idx}`,
    title,
    detail: "",
    tag: "집중" as const
  }));

  const heroNarrative = remote?.snapshot?.heroNarrative || insight.heroNarrative;
  const profile = remote?.snapshot?.profile;

  const displayName = profile?.name || student.name;
  const rawSchoolLevel = profile?.schoolLevel || student.schoolLevel;
  const displaySchoolLevel =
    rawSchoolLevel === "고" ? "고등학교" : rawSchoolLevel === "중" ? "중학교" : rawSchoolLevel;
  const displayGrade = profile?.grade ?? student.grade;
  const displayGoal = localProfile?.goal || profile?.goal || student.goal;
  const avatarUrl = localProfile?.avatarUrl;

  const weeklyCharts: Array<{
    key: string;
    title: string;
    dataKey: "sleepHours" | "stressScore" | "concentration" | "studyMinutes" | "planCompletionRate";
    color: string;
    yDomain: [number, number];
    tooltipLabel: string;
    valueFormatter?: (value: number) => string;
  }> = [
    {
      key: "sleep",
      title: "이번 주 수면 패턴",
      dataKey: "sleepHours",
      color: "var(--accent-strong)",
      yDomain: [0, 10],
      tooltipLabel: "수면 시간",
      valueFormatter: v => `${v.toFixed(1)}시간`
    },
    {
      key: "stress",
      title: "이번 주 스트레스 점수",
      dataKey: "stressScore",
      color: "var(--accent-soft)",
      yDomain: [1, 5],
      tooltipLabel: "스트레스 점수",
      valueFormatter: v => `${v.toFixed(1)}/5`
    },
    {
      key: "concentration",
      title: "이번 주 학습 집중도",
      dataKey: "concentration",
      color: "var(--accent-strong)",
      yDomain: [0, 100],
      tooltipLabel: "집중도",
      valueFormatter: v => `${Math.round(v)}%`
    },
    {
      key: "studyMinutes",
      title: "이번 주 공부 시간",
      dataKey: "studyMinutes",
      color: "#4f46e5",
      yDomain: [0, Math.max(240, Math.max(...insight.metrics7d.map(m => m.studyMinutes)) || 0)],
      tooltipLabel: "공부 시간(분)",
      valueFormatter: v => `${Math.round(v)}분`
    },
    {
      key: "planCompletionRate",
      title: "이번 주 목표 달성률",
      dataKey: "planCompletionRate",
      color: "#16a34a",
      yDomain: [0, 100],
      tooltipLabel: "목표 달성률",
      valueFormatter: v => `${Math.round(v)}%`
    }
  ];

  return (
    <div className="coach-page">
      <Card className="coach-card coach-card--padded coach-profile-card">
        <div className="coach-profile-card__main">
          <div className="coach-profile-card__avatar-wrap">
            {avatarUrl ? (
              <div
                className="coach-profile-card__avatar coach-profile-card__avatar--image"
                style={{ backgroundImage: `url(${avatarUrl})` }}
              />
            ) : (
              <div className="coach-profile-card__avatar">
                <span>{(displayName || "S").charAt(0).toUpperCase()}</span>
              </div>
            )}
          </div>
          <div className="coach-profile-card__info">
            <div className="coach-profile-card__name-row">
              <span className="coach-profile-card__name">{displayName}</span>
              {displaySchoolLevel != null && displayGrade != null && (
                <span className="coach-profile-card__grade-pill">
                  {displaySchoolLevel} {displayGrade}학년
                </span>
              )}
            </div>
            <div className="coach-profile-card__goal">
              {displayGoal ? `목표 · ${displayGoal}` : "아직 목표를 설정하지 않았어요."}
            </div>
          </div>
        </div>
        <button
          type="button"
          className="coach-ghost-btn"
          style={{ marginTop: 10, width: "100%" }}
          onClick={() => {
            window.location.hash = "#/settings";
          }}
        >
          설정으로 이동
        </button>
        <button
          type="button"
          className="coach-ghost-btn"
          style={{ marginTop: 6, width: "100%" }}
          onClick={() => {
            setAvatarInput(avatarUrl || "");
            setGoalInput(displayGoal || "");
            setEditOpen(true);
          }}
        >
          프로필 편집
        </button>
      </Card>

      <Card className="coach-card coach-card--padded coach-home-insight-card">
        <div className="coach-home-insight-card__top">
          <span className="coach-home-insight-card__eyebrow">AI 분석 결과</span>
          <RiskBadge level={insight.riskLevel} />
        </div>
        <div className="coach-home-insight-card__title">
          {profile?.name || student.name}님을 위한 한 줄 요약
        </div>
        <p className="coach-home-insight-card__body">{heroNarrative}</p>
        <button
          type="button"
          className="coach-primary-btn coach-home-insight-card__cta"
          onClick={() => {
            const el = document.getElementById("coach-actions");
            el?.scrollIntoView({ behavior: "smooth", block: "start" });
          }}
        >
          추천 행동 보기
        </button>
      </Card>

      <Card className="coach-card coach-card--padded">
        <SectionHeader title="이번 주 리듬" right={<StatPill label="리스크" value={insight.riskLevel} />} />
        <div
          className="coach-rhythm-scroll"
          style={{
            display: "flex",
            overflowX: "auto",
            gap: 12,
            paddingBottom: 6,
            marginTop: 4
          }}
          aria-label="이번 주 리듬 상세 그래프"
        >
          {weeklyCharts.map(chart => (
            <div
              key={chart.key}
              className="coach-rhythm-scroll__item"
              style={{
                flex: "0 0 auto",
                minWidth: 260
              }}
            >
              <div className="coach-rhythm-scroll__title" style={{ fontSize: 14, fontWeight: 600, marginBottom: 6 }}>
                {chart.title}
              </div>
              <div className="coach-chart">
                <ResponsiveContainer width="100%" height={160}>
                  <LineChart data={insight.metrics7d}>
                    <XAxis dataKey="date" tick={{ fontSize: 11 }} tickFormatter={d => String(d).slice(5)} />
                    <YAxis tick={{ fontSize: 11 }} width={34} domain={chart.yDomain} />
                    <Tooltip
                      contentStyle={{
                        borderRadius: 12,
                        border: "1px solid rgba(148,163,184,0.35)",
                        boxShadow: "0 10px 30px rgba(15,23,42,0.10)"
                      }}
                      labelFormatter={l => `날짜 ${String(l).slice(5)}`}
                      formatter={(v: any) => {
                        const num = typeof v === "number" ? v : Number(v);
                        const label = chart.tooltipLabel;
                        if (chart.valueFormatter) {
                          return [chart.valueFormatter(num), label];
                        }
                        return [v, label];
                      }}
                    />
                    <Line type="monotone" dataKey={chart.dataKey} stroke={chart.color} strokeWidth={3} dot={false} />
                  </LineChart>
                </ResponsiveContainer>
              </div>
            </div>
          ))}
        </div>
      </Card>

      <div className="coach-stack">
        <SectionHeader title="감지된 패턴" />
        <div className="coach-pattern-grid">
          {insight.patterns.slice(0, 6).map(p => (
            <PatternCard
              key={p.key}
              title={p.title}
              severity={p.severity}
              explanation={p.explanation}
              recommendation={p.recommendation}
            />
          ))}
        </div>
      </div>

      <div className="coach-stack" id="coach-actions">
        <SectionHeader
          title="AI 추천 다음 행동"
        />
        {(remoteActions.length > 0 ? remoteActions : insight.nextActions).length ? (
          <ActionChecklist actions={remoteActions.length > 0 ? remoteActions : insight.nextActions} />
        ) : (
          <EmptyState title="추천 행동이 없습니다." />
        )}
      </div>

      <div
        className={"dday-modal" + (editOpen ? " dday-modal--open" : "")}
        onClick={() => setEditOpen(false)}
      >
        <div className="dday-modal-inner" onClick={e => e.stopPropagation()}>
          <div className="dday-modal-header">
            <span className="dday-modal-title">프로필 편집</span>
          </div>
          <div className="dday-modal-body">
            <div className="field">
              <label className="field-label">프로필 사진</label>
              <input
                className="field-input"
                placeholder="이미지 URL 붙여넣기"
                value={avatarInput.startsWith("data:") ? "" : avatarInput}
                onChange={e => setAvatarInput(e.target.value)}
              />
              {avatarInput.startsWith("data:") && (
                <p className="settings-hint" style={{ marginTop: 6 }}>
                  선택한 사진이 적용돼요. URL을 입력하면 그쪽이 우선해요.
                </p>
              )}
              <label className="coach-profile-file-label">
                <input
                  type="file"
                  accept="image/*"
                  className="coach-profile-file-input"
                  onChange={e => {
                    const f = e.target.files?.[0];
                    if (!f) return;
                    const reader = new FileReader();
                    reader.onload = () => {
                      setAvatarInput(String(reader.result || ""));
                    };
                    reader.readAsDataURL(f);
                    e.target.value = "";
                  }}
                />
                갤러리에서 사진 선택
              </label>
              <p className="settings-hint" style={{ marginTop: 6 }}>
                URL을 붙이거나, 기기에서 사진을 고를 수 있어요.
              </p>
            </div>
            <div className="field" style={{ marginTop: 10 }}>
              <label className="field-label">나의 목표</label>
              <input
                className="field-input"
                placeholder="예: 중간고사 상위 10% 안에 들기"
                value={goalInput}
                onChange={e => setGoalInput(e.target.value)}
              />
            </div>
          </div>
          <div className="dday-modal-footer">
            <button type="button" className="modal-secondary" onClick={() => setEditOpen(false)}>
              취소
            </button>
            <button type="button" className="modal-primary" onClick={saveLocalProfile}>
              저장
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

function CoachChatTabConnected() {
  const token = useCoachApiToken();

  const messages = useCoachStore(s => s.messages);
  const addMessage = useCoachStore(s => s.addMessage);
  const [draft, setDraft] = useState("");
  const [typing, setTyping] = useState(false);
  const [coachAiMode, setCoachAiMode] = useState<"unknown" | "live" | "template">("unknown");

  const send = async (text: string) => {
    const trimmed = text.trim();
    if (!trimmed || typing) return;
    addMessage({ id: `u_${Date.now()}`, role: "user", createdAt: Date.now(), text: trimmed });
    setDraft("");
    setTyping(true);
    try {
      if (!token) throw new Error("로그인이 필요합니다.");
      const res = await fetch(`${API_BASE}/api/student/coach/chat`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`
        },
        body: JSON.stringify({ message: trimmed })
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(String(data?.error || "코치 응답을 받지 못했습니다."));
      setCoachAiMode(data.usedOpenAi ? "live" : "template");
      addMessage({
        id: `c_${Date.now()}`,
        role: "coach",
        createdAt: Date.now(),
        text: String(data.reply || "")
      });
    } catch (e) {
      const msg =
        e instanceof Error
          ? e.message
          : "네트워크 또는 서버 오류입니다. API 서버와 OPENAI_API_KEY 설정을 확인해 주세요.";
      addMessage({
        id: `c_${Date.now()}`,
        role: "coach",
        createdAt: Date.now(),
        text: msg
      });
    } finally {
      setTyping(false);
    }
    requestAnimationFrame(() => {
      const el = document.getElementById("coach-chat-bottom");
      el?.scrollIntoView({ behavior: "smooth", block: "end" });
    });
  };

  const starters = [
    "오늘 집중이 안 된 이유가 뭐야?",
    "내일은 뭘 먼저 하면 좋을까?",
    "왜 계획은 세우는데 실행이 안 될까?",
    "시험 전에는 루틴을 어떻게 유지해?"
  ];

  return (
    <div className="coach-page coach-page--chat">
      {coachAiMode === "template" && (
        <p className="coach-muted" style={{ padding: "0 4px 10px", fontSize: 13, lineHeight: 1.45 }}>
          GPT 연결 없이 규칙 기반 답변입니다. 실제 GPT를 쓰려면 서버 폴더의{" "}
          <code style={{ fontSize: 12 }}>.env</code>에{" "}
          <code style={{ fontSize: 12 }}>OPENAI_API_KEY</code>를 넣고 서버를 다시 실행하세요.
        </p>
      )}
      <div className="coach-chat">
        {messages.map(m => (
          <div key={m.id} className={"coach-bubble-row " + (m.role === "user" ? "is-user" : "is-coach")}>
            {m.role === "coach" && <span className="coach-avatar">AI</span>}
            <motion.div
              className={"coach-bubble " + (m.role === "user" ? "coach-bubble--user" : "coach-bubble--coach")}
              initial={{ opacity: 0, y: 6 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.18 }}
            >
              {m.text.split("\n").map((line, idx) => (
                <div key={idx} className="coach-bubble__line">
                  {line || "\u00A0"}
                </div>
              ))}
            </motion.div>
          </div>
        ))}
        {typing && (
          <div className="coach-bubble-row is-coach">
            <span className="coach-avatar">AI</span>
            <div className="coach-bubble coach-bubble--coach">
              <span className="coach-typing">
                <span className="dot" />
                <span className="dot" />
                <span className="dot" />
              </span>
            </div>
          </div>
        )}
        <div id="coach-chat-bottom" />
      </div>

      <div className="coach-chat-starters" aria-label="추천 질문">
        {starters.map(s => (
          <button key={s} type="button" className="coach-starter" onClick={() => send(s)}>
            {s}
          </button>
        ))}
      </div>

      <div className="coach-chat-input">
        <input
          className="coach-chat-text"
          value={draft}
          onChange={e => setDraft(e.target.value)}
          onKeyDown={e => {
            if (e.key === "Enter") send(draft);
          }}
        />
        <button
          type="button"
          className="coach-primary-btn coach-primary-btn--sm"
          onClick={() => send(draft)}
          disabled={typing}
          aria-label="메시지 보내기"
          title="보내기"
        >
          <span aria-hidden>➤</span>
        </button>
      </div>
    </div>
  );
}

export function StudentCoachApp(props: {
  tab: StudentTabKey;
}) {
  const T = useMemo(() => {
    const map: Record<StudentTabKey, React.ReactNode> = {
      home: <HomeTabConnected />,
      coach: <CoachChatTabConnected />
    };
    return map[props.tab] || map.home;
  }, [props.tab]);

  return (
    <div className="coach-shell">
      {T}
    </div>
  );
}

