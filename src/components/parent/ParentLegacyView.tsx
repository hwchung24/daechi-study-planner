import React from "react";
import { TabTransitionPanel } from "../PageTransition";
import { setAppPath } from "../../lib/appNavigation";
import { getWeekRangeLabel } from "../../lib/weekDates";
import type { ParentLockStatus } from "../../types/lockStatus";
import type { ParentStudentRow } from "../../types/parent";

import { ParentProfilePage } from "./ParentProfilePage";
import { buildAdminGuide } from "../../coach/ai/parent-guide";
import { buildWeeklyInsight } from "../../coach/ai/insight-engine";
import { demoDailyLogs, demoStudents } from "../../coach/demoData";

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
  parentStudents: ParentStudentRow[];
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
    React.SetStateAction<ParentStudentRow[]>
  >;
  setParentAiDaily: (v: ParentAiDaily | null) => void;
  onSelectManagedStudent: (id: number) => void;
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
    onSelectManagedStudent,
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
          <h2 className="section-title">관리자</h2>
        </div>
      </section>
    );
  }

  // 홈(리포트)용 학생/insight/guide 생성
  const student = parentStudentId
    ? demoStudents.find(s => s.id === parentStudentId) || demoStudents[0]
    : demoStudents[0];
  const logs7d = demoDailyLogs.filter(l => l.studentId === student.id).slice(-7);
  const insight = buildWeeklyInsight(student.id, demoDailyLogs);
  const guide = buildAdminGuide(insight, logs7d);

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

      {parentTab === "report" && false && (
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
                <span className="settings-label">연결된 학생</span>
                <span className="settings-value">
                  <select
                    value={parentStudentId ?? ""}
                    onChange={e => onSelectManagedStudent(Number(e.target.value))}
                    style={{
                      fontSize: "var(--font-size-medium)",
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
                <h3 className="section-title" style={{ fontSize: "var(--font-size-large)" }}>
                  계획표 작성 시간 설정
                </h3>
              </div>
              <div className="progress-card parent-planner-card">
                <div className="settings-item">
                  <span className="settings-label">강제 작성 활성화</span>
                  <label className="settings-value" style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
                    <input
                      type="checkbox"
                      checked={parentPlannerEnabled}
                      onChange={e => setParentPlannerEnabled(e.target.checked)}
                    />
                    <span style={{ marginLeft: 4 }}>
                      {parentPlannerEnabled ? "켜짐" : "꺼짐"}
                    </span>
                  </label>
                </div>
                <div className="settings-item">
                  <span className="settings-label">학생이 계획표를 쓰는 시각</span>
                  <input
                    type="time"
                    className="field-input parent-planner-time-input"
                    value={parentPlannerTime}
                    onChange={e => setParentPlannerTime(e.target.value || "21:00")}
                  />
                </div>
                <div className="settings-item" style={{ borderBottom: "none", paddingTop: 0 }}>
                  <button
                    type="button"
                    className="modal-primary"
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
                </div>
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
                    {/* 지금 잠그기/지금 해제 버튼 제거됨 */}
                  </div>
                )}
              </div>

              <div className="section-header">
                <h3 className="section-title" style={{ fontSize: "var(--font-size-large)" }}>
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
              <>
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
                {/* 바로 쓸 수 있는 문장 카드 추가 */}
                {guide && guide.suggestedPhrases && guide.suggestedPhrases.length > 0 && (
                  <div className="coach-card coach-card--padded" style={{ marginTop: 12 }}>
                    <div className="coach-section-header">
                      <div className="coach-section-header__left">
                        <h2 className="coach-section-title">바로 쓸 수 있는 문장</h2>
                        <p className="coach-section-subtitle">짧고 구체적인 말이 가장 효과적입니다.</p>
                      </div>
                    </div>
                    <div className="coach-phrases">
                      {guide.suggestedPhrases.map((p, i) => (
                        <button
                          key={i}
                          type="button"
                          className="coach-phrase"
                          onClick={() => {
                            try {
                              navigator.clipboard.writeText(p);
                              alert("문장을 복사했어요.");
                            } catch {
                              alert(p);
                            }
                          }}
                        >
                          {p}
                          <span className="coach-phrase__hint">탭해서 복사</span>
                        </button>
                      ))}
                    </div>
                  </div>
                )}
              </>
            )}
          </div>
        </section>
      )}
      </TabTransitionPanel>
    </>
  );
}
