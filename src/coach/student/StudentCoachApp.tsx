import React, { useEffect, useMemo, useState } from "react";
import { Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { motion } from "framer-motion";
import { demoDailyLogs, demoStudents } from "../demoData";
import { buildWeeklyInsight } from "../ai/insight-engine";
import { useCoachStore } from "../state/useCoachStore";
import type { NextAction } from "../types";
import { generateCoachReply } from "../ai/chat-engine";
import { Card, EmptyState, GradientHeroCard, MetricCard, RiskBadge, SectionHeader, StatPill } from "../ui/components";
import { API_BASE } from "../../lib/apiBase";
import { formatMinutes } from "../utils/format";

export type StudentTabKey = "home" | "coach";

function toneFromScore(score: number, goodAtOrAbove: number, warnBelow: number) {
  if (score >= goodAtOrAbove) return "good" as const;
  if (score <= warnBelow) return "warn" as const;
  return "neutral" as const;
}

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

function HomeTabConnected() {
  const token = useCoachApiToken();
  const activeStudentId = useCoachStore(s => s.activeStudentId);
  const student = useMemo(
    () => demoStudents.find(s => s.id === activeStudentId) || demoStudents[0],
    [activeStudentId]
  );
  const [remote, setRemote] = useState<RemoteCoachState | null>(null);

  useEffect(() => {
    if (!token) return;
    fetch(`${API_BASE}/api/student/coach/state`, {
      headers: { Authorization: `Bearer ${token}` }
    })
      .then(r => (r.ok ? r.json() : Promise.reject(new Error("coach state fetch failed"))))
      .then(data => setRemote(data))
      .catch(() => setRemote(null));
  }, [token]);

  const logs = useMemo(
    () => demoDailyLogs.filter(l => l.studentId === student.id).slice(-7),
    [student.id]
  );
  const insight = useMemo(() => buildWeeklyInsight(student.id, demoDailyLogs), [student.id]);
  const last = logs[logs.length - 1];

  const remoteMetrics = remote?.snapshot?.metrics;
  const remoteActions = (remote?.snapshot?.nextActions || []).map((title, idx) => ({
    id: `remote_action_${idx}`,
    title,
    detail: "",
    tag: "집중" as const
  }));

  const metrics: Array<{
    title: string;
    value: string;
    hint?: string;
    tone?: "neutral" | "good" | "warn";
  }> = [
    {
      title: "수면 패턴",
      value:
        Number(remoteMetrics?.sleepHours || 0) > 0
          ? `${Number(remoteMetrics?.sleepHours).toFixed(1)}시간`
          : last
            ? `${last.sleepHours.toFixed(1)}시간`
            : "-",
      tone:
        Number(remoteMetrics?.sleepHours || 0) > 0
          ? toneFromScore(Number(remoteMetrics?.sleepHours), 7.0, 5.9)
          : last
            ? toneFromScore(last.sleepHours, 7.0, 5.9)
            : ("neutral" as const)
    },
    {
      title: "스트레스 지수",
      value:
        Number(remoteMetrics?.stress || 0) > 0
          ? `${Number(remoteMetrics?.stress).toFixed(1)}/5`
          : last
            ? `${last.stressScore}/5`
            : "-",
      tone:
        Number(remoteMetrics?.stress || 0) > 0
          ? Number(remoteMetrics?.stress) >= 4
            ? ("warn" as const)
            : ("neutral" as const)
          : last
            ? last.stressScore >= 4
              ? ("warn" as const)
              : ("neutral" as const)
            : ("neutral" as const)
    },
    {
      title: "학습 집중도",
      value:
        Number(remoteMetrics?.concentration || 0) > 0
          ? `${Number(remoteMetrics?.concentration).toFixed(1)}/5`
          : last
            ? `${last.concentrationScore}/5`
            : "-",
      tone:
        Number(remoteMetrics?.concentration || 0) > 0
          ? toneFromScore(Number(remoteMetrics?.concentration), 4, 2)
          : last
            ? toneFromScore(last.concentrationScore, 4, 2)
            : ("neutral" as const)
    },
    {
      title: "총 공부 시간",
      value:
        Number(remoteMetrics?.studyMinutes || 0) > 0
          ? formatMinutes(Number(remoteMetrics?.studyMinutes))
          : last
            ? formatMinutes(last.totalStudyMinutes)
            : "-",
      tone: "neutral"
    },
    {
      title: "목표 달성률",
      value:
        Number(remoteMetrics?.planCompletionRate || 0) > 0
          ? `${Math.round(Number(remoteMetrics?.planCompletionRate))}%`
          : last
            ? `${last.planCompletionRate}%`
            : "-",
      tone:
        Number(remoteMetrics?.planCompletionRate || 0) > 0
          ? toneFromScore(Number(remoteMetrics?.planCompletionRate), 75, 55)
          : last
            ? toneFromScore(last.planCompletionRate, 75, 55)
            : ("neutral" as const)
    }
  ];

  const heroNarrative = remote?.snapshot?.heroNarrative || insight.heroNarrative;
  const profile = remote?.snapshot?.profile;

  return (
    <div className="coach-page">
      <Card className="coach-card coach-card--padded" style={{ marginBottom: 14 }}>
        <SectionHeader title="프로필" />
        <div className="coach-profile">
          <div className="coach-profile__name">{profile?.name || student.name}</div>
          <div className="coach-profile__meta">
            {profile?.schoolLevel || student.schoolLevel}
            {profile?.grade || student.grade} · 목표: {profile?.goal || student.goal}
          </div>
          <div className="coach-profile__chips">
            {(profile?.targetSubjects && profile.targetSubjects.length > 0 ? profile.targetSubjects : student.targetSubjects).map(s => (
              <span key={s} className="coach-chip">
                {s}
              </span>
            ))}
          </div>
        </div>
        <button
          type="button"
          className="coach-ghost-btn"
          style={{ marginTop: 12, width: "100%" }}
          onClick={() => {
            window.location.hash = "#/settings";
          }}
        >
          설정으로 이동
        </button>
      </Card>

      <GradientHeroCard
        eyebrow="AI 분석 결과"
        title={`${profile?.name || student.name}님, 오늘의 핵심`}
        body={heroNarrative}
        ctaLabel="시작"
        onCta={() => {
          const el = document.getElementById("coach-actions");
          el?.scrollIntoView({ behavior: "smooth", block: "start" });
        }}
        badge={<RiskBadge level={insight.riskLevel} />}
      />

      <div className="coach-horizontal-cards" aria-label="학생홈 지표 카드">
        {metrics.map(m => (
          <div key={m.title} className="coach-horizontal-cards__item">
            <MetricCard title={m.title} value={m.value} hint={m.hint} tone={m.tone} />
          </div>
        ))}
      </div>

      <Card className="coach-card coach-card--padded">
        <SectionHeader title="이번 주 리듬" right={<StatPill label="리스크" value={insight.riskLevel} />} />
        <div className="coach-chart">
          <ResponsiveContainer width="100%" height={160}>
            <LineChart data={insight.metrics7d}>
              <XAxis dataKey="date" tick={{ fontSize: 11 }} tickFormatter={d => String(d).slice(5)} />
              <YAxis tick={{ fontSize: 11 }} width={34} domain={[0, 100]} />
              <Tooltip
                contentStyle={{
                  borderRadius: 12,
                  border: "1px solid rgba(148,163,184,0.35)",
                  boxShadow: "0 10px 30px rgba(15,23,42,0.10)"
                }}
                labelFormatter={l => `날짜 ${String(l).slice(5)}`}
                formatter={(v: any, k: any) => [v, k === "concentration" ? "집중(%)" : k]}
              />
              <Line type="monotone" dataKey="concentration" stroke="var(--accent-strong)" strokeWidth={3} dot={false} />
            </LineChart>
          </ResponsiveContainer>
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
    </div>
  );
}

function CoachChatTabConnected() {
  const token = useCoachApiToken();
  const activeStudentId = useCoachStore(s => s.activeStudentId);
  const student = demoStudents.find(s => s.id === activeStudentId) || demoStudents[0];
  const insight = useMemo(() => buildWeeklyInsight(student.id, demoDailyLogs), [student.id]);
  const logs7d = useMemo(() => demoDailyLogs.filter(l => l.studentId === student.id).slice(-7), [student.id]);

  const messages = useCoachStore(s => s.messages);
  const addMessage = useCoachStore(s => s.addMessage);
  const resetChat = useCoachStore(s => s.resetChat);
  const [draft, setDraft] = useState("");
  const [typing, setTyping] = useState(false);

  const send = async (text: string) => {
    const trimmed = text.trim();
    if (!trimmed || typing) return;
    addMessage({ id: `u_${Date.now()}`, role: "user", createdAt: Date.now(), text: trimmed });
    setDraft("");
    setTyping(true);
    try {
      if (!token) throw new Error("no token");
      const res = await fetch(`${API_BASE}/api/student/coach/chat`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`
        },
        body: JSON.stringify({ message: trimmed })
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error || "chat failed");
      addMessage({
        id: `c_${Date.now()}`,
        role: "coach",
        createdAt: Date.now(),
        text: String(data.reply || "")
      });
    } catch {
      await new Promise(r => setTimeout(r, 520));
      addMessage(generateCoachReply({ student, insight, logs7d, userText: trimmed }));
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
      <div className="coach-chat-header">
        <div className="coach-chat-header__title">AI 코치</div>
        <button type="button" className="coach-ghost-btn" onClick={resetChat}>
          대화 초기화
        </button>
      </div>

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

