import React from "react";
import { TabTransitionPanel } from "../PageTransition";
import { setAppPath } from "../../lib/appNavigation";
import { getWeekRangeLabel } from "../../lib/weekDates";
import type { ParentLockStatus } from "../../types/lockStatus";
import { ParentProfilePage } from "./ParentProfilePage";

export type ParentTabKey = "report" | "profile";

type ParentLinkRow = {
  id: number;
  student_email: string;
  student_id: number;
  created_at: string;
};

type ParentAiDaily = {
  summary_text: string;
  report_date: string;
  model: string;
  created_at: string;
};

export function ParentLegacyView(props: {
  apiBase: string;
  authToken: string | null;
  meRole: string | null;
  userEmail: string | null;
  parentTab: ParentTabKey;
  parentLinkEmail: string;
  setParentLinkEmail: (v: string) => void;
  parentWaitingOnStudent: ParentLinkRow[];
  parentWaitingOnMe: ParentLinkRow[];
  parentStudents: Array<{ id: number; email: string }>;
  parentStudentId: number | null;
  setParentStudentId: (id: number | null) => void;
  parentWeekOffset: number;
  setParentWeekOffset: React.Dispatch<React.SetStateAction<number>>;
  parentReport: unknown;
  parentAiDaily: ParentAiDaily | null;
  parentPlannerEnabled: boolean;
  setParentPlannerEnabled: (v: boolean) => void;
  parentPlannerTime: string;
  setParentPlannerTime: (v: string) => void;
  parentPlannerSaving: boolean;
  setParentPlannerSaving: (v: boolean) => void;
  parentPlannerMessage: string;
  setParentPlannerMessage: (v: string) => void;
  parentLockStatus: ParentLockStatus | null;
  setParentLockStatus: React.Dispatch<
    React.SetStateAction<ParentLockStatus | null>
  >;
  setParentTab: (t: ParentTabKey) => void;
  setParentWaitingOnStudent: (rows: ParentLinkRow[]) => void;
  setParentWaitingOnMe: (rows: ParentLinkRow[]) => void;
  setParentStudents: React.Dispatch<
    React.SetStateAction<Array<{ id: number; email: string }>>
  >;
  setParentAiDaily: (v: ParentAiDaily | null) => void;
  hapticSelection: () => void;
  hapticWarning: () => void;
  hapticSuccess: () => void;
  onLogoutPress: () => void;
  onWithdrawPress: () => void;
  onUserEmailUpdated: (email: string) => void;
}) {
  const {
    apiBase,
    authToken,
    meRole,
    userEmail,
    parentTab,
    parentLinkEmail,
    setParentLinkEmail,
    parentWaitingOnStudent,
    parentWaitingOnMe,
    parentStudents,
    parentStudentId,
    setParentStudentId,
    parentWeekOffset,
    setParentWeekOffset,
    parentReport,
    parentAiDaily,
    parentPlannerEnabled,
    setParentPlannerEnabled,
    parentPlannerTime,
    setParentPlannerTime,
    parentPlannerSaving,
    setParentPlannerSaving,
    parentPlannerMessage,
    setParentPlannerMessage,
    parentLockStatus,
    setParentLockStatus,
    setParentTab,
    setParentWaitingOnStudent,
    setParentWaitingOnMe,
    setParentStudents,
    setParentAiDaily,
    hapticSelection,
    hapticWarning,
    hapticSuccess,
    onLogoutPress,
    onWithdrawPress,
    onUserEmailUpdated
  } = props;

  if (meRole !== "parent") {
    return (
      <section className="section">
        <div className="section-header">
          <h2 className="section-title">학부모</h2>
        </div>
      </section>
    );
  }

  const report = parentReport as {
    stats?: {
      totalStudyMinutes?: number;
      focusDistribution?: {
        best: number;
        good: number;
        ok: number;
        bad: number;
      };
    };
    summaryLines?: string[];
  } | null;

  return (
    <>
      <TabTransitionPanel tabKey={parentTab} className="parent-tab-transition">
      {parentTab === "profile" && (
        <ParentProfilePage
          authToken={authToken}
          apiBase={apiBase}
          userEmail={userEmail}
          parentLinkEmail={parentLinkEmail}
          setParentLinkEmail={setParentLinkEmail}
          parentWaitingOnStudent={parentWaitingOnStudent}
          parentWaitingOnMe={parentWaitingOnMe}
          parentStudents={parentStudents}
          setParentWaitingOnStudent={setParentWaitingOnStudent}
          setParentWaitingOnMe={setParentWaitingOnMe}
          setParentStudents={setParentStudents}
          setParentStudentId={setParentStudentId}
          hapticWarning={hapticWarning}
          hapticSuccess={hapticSuccess}
          onLogoutPress={onLogoutPress}
          onWithdrawPress={onWithdrawPress}
          onUserEmailUpdated={onUserEmailUpdated}
        />
      )}

      {parentTab === "report" && (
        <section className="section">
          <div className="section-header">
            <h2 className="section-title">주간 · AI 리포트</h2>
          </div>

          <div className="week-switch">
            <button
              className="week-switch-btn week-switch-prev"
              onClick={() => setParentWeekOffset(v => v + 1)}
            >
              이전주
            </button>
            <div className="week-switch-center">
              <span className="week-switch-label">
                {getWeekRangeLabel(parentWeekOffset)}
              </span>
              <span className="week-switch-underline" />
            </div>
            <button
              className="week-switch-btn week-switch-next"
              onClick={() => setParentWeekOffset(v => v - 1)}
            >
              다음주
            </button>
          </div>

          {parentStudents.length === 0 && (
            <div style={{ marginTop: 14 }}>
              <button
                type="button"
                className="progress-footer-btn"
                onClick={() => {
                  hapticSelection();
                  setParentTab("profile");
                  setAppPath("#/parent");
                }}
              >
                학생 연결
              </button>
            </div>
          )}

          {parentStudents.length > 0 && (
            <div className="settings-list" style={{ marginTop: 14 }}>
              <div className="settings-item" style={{ cursor: "default" }}>
                <span className="settings-label">연결된 자녀</span>
                <span className="settings-value">
                  <select
                    value={parentStudentId ?? ""}
                    onChange={e => setParentStudentId(Number(e.target.value))}
                    style={{
                      fontSize: 14,
                      padding: "6px 8px",
                      borderRadius: 10,
                      border: "1px solid var(--stroke)",
                      background: "transparent"
                    }}
                  >
                    {parentStudents.map(s => (
                      <option key={s.id} value={s.id}>
                        {s.email}
                      </option>
                    ))}
                  </select>
                </span>
              </div>
            </div>
          )}

          {parentStudents.length > 0 && parentStudentId && (
            <div style={{ marginTop: 14 }}>
              <div className="section-header">
                <h3 className="section-title" style={{ fontSize: 16 }}>
                  계획표 작성 시간 설정
                </h3>
              </div>
              <div className="progress-card" style={{ marginBottom: 12 }}>
                <div
                  className="settings-item"
                  style={{ cursor: "default", padding: 0, borderBottom: "none" }}
                >
                  <span className="settings-label">강제 작성 활성화</span>
                  <label style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
                    <input
                      type="checkbox"
                      checked={parentPlannerEnabled}
                      onChange={e => setParentPlannerEnabled(e.target.checked)}
                    />
                    <span className="settings-value">
                      {parentPlannerEnabled ? "켜짐" : "꺼짐"}
                    </span>
                  </label>
                </div>
                <div
                  className="settings-item"
                  style={{ cursor: "default", padding: "10px 0 0", borderBottom: "none" }}
                >
                  <span className="settings-label">자녀가 계획표를 쓰는 시각</span>
                  <input
                    type="time"
                    className="field-input"
                    value={parentPlannerTime}
                    onChange={e => setParentPlannerTime(e.target.value || "21:00")}
                    style={{ maxWidth: 150, padding: "7px 10px" }}
                  />
                </div>
                <button
                  type="button"
                  className="progress-footer-btn"
                  style={{ marginTop: 10 }}
                  disabled={parentPlannerSaving}
                  onClick={async () => {
                    if (!authToken || !parentStudentId) return;
                    setParentPlannerSaving(true);
                    setParentPlannerMessage("");
                    try {
                      const res = await fetch(`${apiBase}/api/parent/planner-rule`, {
                        method: "PUT",
                        headers: {
                          "Content-Type": "application/json",
                          Authorization: `Bearer ${authToken}`
                        },
                        body: JSON.stringify({
                          studentId: parentStudentId,
                          enabled: parentPlannerEnabled,
                          lockTime: parentPlannerTime
                        })
                      });
                      const data = await res.json().catch(() => ({}));
                      if (!res.ok) {
                        setParentPlannerMessage(
                          (data as { error?: string }).error ||
                            "시간 설정 저장에 실패했습니다."
                        );
                        return;
                      }
                      setParentLockStatus(
                        (data as { lockStatus?: ParentLockStatus }).lockStatus || null
                      );
                      setParentPlannerMessage("설정이 저장되었습니다.");
                    } catch {
                      setParentPlannerMessage("서버와 통신 중 오류가 발생했습니다.");
                    } finally {
                      setParentPlannerSaving(false);
                    }
                  }}
                >
                  {parentPlannerSaving ? "저장 중..." : "시간 설정 저장"}
                </button>
                {parentPlannerMessage && (
                  <p className="settings-hint" style={{ marginTop: 8 }}>
                    {parentPlannerMessage}
                  </p>
                )}
                {parentLockStatus && (
                  <div style={{ marginTop: 10 }}>
                    <p className="settings-hint">
                      현재 상태: {parentLockStatus.locked ? "잠김" : "열림"}
                    </p>
                    <p className="settings-hint">
                      마지막 변경:{" "}
                      {parentLockStatus.session?.unlocked_at ||
                        parentLockStatus.session?.locked_at ||
                        "아직 없음"}
                    </p>
                    <div style={{ display: "flex", gap: 8, marginTop: 8 }}>
                      <button
                        type="button"
                        className="progress-footer-btn"
                        onClick={async () => {
                          if (!authToken || !parentStudentId) return;
                          const res = await fetch(`${apiBase}/api/parent/lock-now`, {
                            method: "POST",
                            headers: {
                              "Content-Type": "application/json",
                              Authorization: `Bearer ${authToken}`
                            },
                            body: JSON.stringify({ studentId: parentStudentId })
                          });
                          const data = await res.json().catch(() => ({}));
                          if (!res.ok) {
                            setParentPlannerMessage(
                              (data as { error?: string }).error ||
                                "수동 잠금에 실패했습니다."
                            );
                            return;
                          }
                          setParentLockStatus(
                            (data as { lockStatus?: ParentLockStatus }).lockStatus || null
                          );
                          setParentPlannerMessage("학생 기기를 잠금 상태로 전환했습니다.");
                        }}
                      >
                        지금 잠그기
                      </button>
                      <button
                        type="button"
                        className="progress-footer-btn"
                        onClick={async () => {
                          if (!authToken || !parentStudentId) return;
                          const res = await fetch(`${apiBase}/api/parent/unlock-now`, {
                            method: "POST",
                            headers: {
                              "Content-Type": "application/json",
                              Authorization: `Bearer ${authToken}`
                            },
                            body: JSON.stringify({ studentId: parentStudentId })
                          });
                          const data = await res.json().catch(() => ({}));
                          if (!res.ok) {
                            setParentPlannerMessage(
                              (data as { error?: string }).error ||
                                "수동 해제에 실패했습니다."
                            );
                            return;
                          }
                          setParentLockStatus(
                            (data as { lockStatus?: ParentLockStatus }).lockStatus || null
                          );
                          setParentPlannerMessage("학생 기기 잠금을 해제했습니다.");
                        }}
                      >
                        지금 해제
                      </button>
                    </div>
                  </div>
                )}
              </div>

              <div className="section-header">
                <h3 className="section-title" style={{ fontSize: 16 }}>
                  AI 일일 리포트
                </h3>
              </div>
              {parentAiDaily ? (
                <div className="progress-card">
                  <div className="progress-meta-row">
                    <span
                      className="progress-meta"
                      style={{ whiteSpace: "pre-wrap", lineHeight: 1.5 }}
                    >
                      {parentAiDaily.summary_text}
                    </span>
                  </div>
                </div>
              ) : null}
              <button
                type="button"
                className="progress-footer-btn"
                style={{ marginTop: 10 }}
                onClick={async () => {
                  if (!authToken || !parentStudentId) return;
                  try {
                    const res = await fetch(
                      `${apiBase}/api/parent/ai-daily-report/refresh`,
                      {
                        method: "POST",
                        headers: {
                          "Content-Type": "application/json",
                          Authorization: `Bearer ${authToken}`
                        },
                        body: JSON.stringify({
                          studentId: parentStudentId
                        })
                      }
                    );
                    if (!res.ok) return;
                    const data = await res.json();
                    if (data.report) {
                      setParentAiDaily({
                        summary_text: data.report.summary_text,
                        report_date: String(data.report.report_date),
                        model: data.report.model,
                        created_at: String(data.report.created_at)
                      });
                    }
                  } catch {
                    // ignore
                  }
                }}
              >
                지금 리포트 생성하기
              </button>
            </div>
          )}

          <div style={{ marginTop: 14 }}>
            {!report ? null : (
              <div className="progress-card">
                <div className="progress-row">
                  <span className="progress-label">총 학습 시간</span>
                  <span className="progress-value">
                    {Math.floor((report.stats?.totalStudyMinutes || 0) / 60)}
                    {"시간 "}
                    {(report.stats?.totalStudyMinutes || 0) % 60}
                    {"분"}
                  </span>
                </div>
                <div className="progress-meta-row" style={{ marginTop: 10 }}>
                  <span className="progress-meta">
                    {report.summaryLines?.length
                      ? report.summaryLines.join(" ")
                      : ""}
                  </span>
                </div>
                {report.stats?.focusDistribution && (
                  <div className="progress-meta-row" style={{ marginTop: 10 }}>
                    <span className="progress-meta">
                      집중도 분포 ◎/○/△/✕: {report.stats.focusDistribution.best}/
                      {report.stats.focusDistribution.good}/
                      {report.stats.focusDistribution.ok}/
                      {report.stats.focusDistribution.bad}
                    </span>
                  </div>
                )}
              </div>
            )}
          </div>
        </section>
      )}
      </TabTransitionPanel>
    </>
  );
}
