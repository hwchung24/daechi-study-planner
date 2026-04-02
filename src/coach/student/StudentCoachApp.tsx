import React, { useMemo, useState } from "react";
import { Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { motion } from "framer-motion";
import { demoDailyLogs, demoStudents } from "../demoData";
import { buildWeeklyInsight } from "../ai/insight-engine";
import { useCoachStore } from "../state/useCoachStore";
import type { NextAction } from "../types";
import { generateCoachReply } from "../ai/chat-engine";
import { Card, EmptyState, GradientHeroCard, MetricCard, RiskBadge, SectionHeader, StatPill } from "../ui/components";
import { CoachIcons } from "../ui/icons";

export type StudentTabKey = "home" | "coach" | "profile" | "log";

function formatMinutes(n: number) {
  const h = Math.floor(n / 60);
  const m = n % 60;
  if (h <= 0) return `${m}분`;
  return `${h}시간 ${m}분`;
}

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

function HomeTab() {
  const activeStudentId = useCoachStore(s => s.activeStudentId);
  const student = useMemo(
    () => demoStudents.find(s => s.id === activeStudentId) || demoStudents[0],
    [activeStudentId]
  );
  const logs = useMemo(
    () => demoDailyLogs.filter(l => l.studentId === student.id).slice(-7),
    [student.id]
  );
  const insight = useMemo(() => buildWeeklyInsight(student.id, demoDailyLogs), [student.id]);
  const last = logs[logs.length - 1];

  const metrics: Array<{
    title: string;
    value: string;
    hint?: string;
    tone?: "neutral" | "good" | "warn";
  }> = [
    {
      title: "수면 패턴",
      value: last ? `${last.sleepHours.toFixed(1)}시간` : "-",
      tone: last ? toneFromScore(last.sleepHours, 7.0, 5.9) : ("neutral" as const)
    },
    {
      title: "활동량",
      value: last ? `${Math.round(last.steps / 100) / 10}k` : "-",
      hint: "걸음 수",
      tone: last ? toneFromScore(last.steps, 5500, 2800) : ("neutral" as const)
    },
    {
      title: "스트레스 지수",
      value: last ? `${last.stressScore}/5` : "-",
      tone: last ? (last.stressScore >= 4 ? ("warn" as const) : ("neutral" as const)) : ("neutral" as const)
    },
    {
      title: "식사 규칙성",
      value: last ? `${last.mealsRegularity}/5` : "-",
      tone: last ? toneFromScore(last.mealsRegularity, 4, 2) : ("neutral" as const)
    },
    {
      title: "학습 집중도",
      value: last ? `${last.concentrationScore}/5` : "-",
      tone: last ? toneFromScore(last.concentrationScore, 4, 2) : ("neutral" as const)
    },
    { title: "총 공부 시간", value: last ? formatMinutes(last.totalStudyMinutes) : "-", tone: "neutral" },
    {
      title: "목표 달성률",
      value: last ? `${last.planCompletionRate}%` : "-",
      tone: last ? toneFromScore(last.planCompletionRate, 75, 55) : ("neutral" as const)
    }
  ];

  return (
    <div className="coach-page">
      <GradientHeroCard
        eyebrow="AI 분석 결과"
        title={`${student.name}님, 오늘의 핵심`}
        body={insight.heroNarrative}
        ctaLabel="맞춤 솔루션 시작하기"
        onCta={() => {
          const el = document.getElementById("coach-actions");
          el?.scrollIntoView({ behavior: "smooth", block: "start" });
        }}
        badge={<RiskBadge level={insight.riskLevel} />}
      />

      <div className="coach-grid">
        {metrics.map(m => (
          <MetricCard key={m.title} title={m.title} value={m.value} hint={m.hint} tone={m.tone} />
        ))}
      </div>

      <Card className="coach-card coach-card--padded">
        <SectionHeader title="이번 주 리듬" subtitle={insight.summarySentence} right={<StatPill label="리스크" value={insight.riskLevel} />} />
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
              <Line
                type="monotone"
                dataKey="concentration"
                stroke="var(--accent-strong)"
                strokeWidth={3}
                dot={false}
              />
            </LineChart>
          </ResponsiveContainer>
        </div>
      </Card>

      <div className="coach-stack">
        <SectionHeader title="감지된 패턴" subtitle="지금은 ‘의지’보다 ‘구조’가 먼저입니다." />
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
          subtitle="오늘은 ‘무엇을 더 할까’보다, ‘무엇부터 시작할까’가 더 중요해요."
        />
        {insight.nextActions.length ? (
          <ActionChecklist actions={insight.nextActions} />
        ) : (
          <EmptyState
            title="추천 행동을 만들 데이터가 더 필요해요."
            body="일일 기록을 2~3일만 쌓아도 정확도가 올라갑니다."
          />
        )}
      </div>

      <Card className="coach-card coach-card--padded" style={{ marginTop: 14 }}>
        <SectionHeader title="오늘의 작은 규칙" subtitle="지켜야 할 건 1개면 충분합니다." />
        <div className="coach-rule">
          <span className="coach-rule__dot" aria-hidden />
          <div className="coach-rule__text">
            <div className="coach-strong">첫 블록은 25분만</div>
            <div className="coach-muted">
              오늘은 ‘장시간 유지’가 아니라 ‘시작 성공률’이 목표예요.
            </div>
          </div>
        </div>
      </Card>
    </div>
  );
}

function LogTab() {
  // MVP: 실제 저장은 기존 앱 DB/서버와 섞이지 않도록, 데모 입력 UI만 제공
  const [sleep, setSleep] = useState("6.5");
  const [stress, setStress] = useState("3");
  const [conc, setConc] = useState("3");
  const [memo, setMemo] = useState("");
  return (
    <div className="coach-page">
      <SectionHeader title="일일 기록" subtitle="정확한 분석은 작은 기록에서 시작됩니다." />
      <Card className="coach-card coach-card--padded">
        <div className="coach-form">
          <label className="coach-label">수면 시간(시간)</label>
          <input className="coach-input" inputMode="decimal" value={sleep} onChange={e => setSleep(e.target.value)} />
          <label className="coach-label">스트레스(1~5)</label>
          <input className="coach-input" inputMode="numeric" value={stress} onChange={e => setStress(e.target.value)} />
          <label className="coach-label">집중도(1~5)</label>
          <input className="coach-input" inputMode="numeric" value={conc} onChange={e => setConc(e.target.value)} />
          <label className="coach-label">회고 메모</label>
          <textarea className="coach-textarea" value={memo} onChange={e => setMemo(e.target.value)} placeholder="예: 시작이 늦어서 계획이 밀림…" />
          <button type="button" className="coach-primary-btn" onClick={() => alert("데모 MVP에서는 기존 서버/DB와 분리되어 있어 저장은 생략했어요.")}>
            오늘 기록 저장(데모)
          </button>
        </div>
      </Card>
    </div>
  );
}

function CoachChatTab() {
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
    // 타이핑 느낌만 (실제 API 없을 때)
    await new Promise(r => setTimeout(r, 520));
    addMessage(generateCoachReply({ student, insight, logs7d, userText: trimmed }));
    setTyping(false);
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
          placeholder="예: 오늘 집중이 안 된 이유가 뭐야?"
          value={draft}
          onChange={e => setDraft(e.target.value)}
          onKeyDown={e => {
            if (e.key === "Enter") send(draft);
          }}
        />
        <button type="button" className="coach-primary-btn coach-primary-btn--sm" onClick={() => send(draft)} disabled={typing}>
          보내기
        </button>
      </div>
    </div>
  );
}

function ProfileTab() {
  const activeStudentId = useCoachStore(s => s.activeStudentId);
  const setActiveStudentId = useCoachStore(s => s.setActiveStudentId);
  const student = demoStudents.find(s => s.id === activeStudentId) || demoStudents[0];

  return (
    <div className="coach-page">
      <SectionHeader title="프로필" subtitle="데모 MVP에서는 인물 전환으로 다양한 케이스를 확인할 수 있어요." />
      <Card className="coach-card coach-card--padded">
        <div className="coach-profile">
          <div className="coach-profile__name">{student.name}</div>
          <div className="coach-profile__meta">
            {student.schoolLevel}
            {student.grade} · 목표: {student.goal}
          </div>
          <div className="coach-profile__chips">
            {student.targetSubjects.map(s => (
              <span key={s} className="coach-chip">
                {s}
              </span>
            ))}
          </div>
        </div>
      </Card>

      <div className="coach-stack" style={{ marginTop: 12 }}>
        <SectionHeader title="데모 인물" subtitle="학생 케이스를 바꾸면 인사이트/코치 답변이 달라집니다." />
        <div className="coach-persona-grid">
          {demoStudents.map(s => (
            <button
              key={s.id}
              type="button"
              className={"coach-persona" + (s.id === student.id ? " is-active" : "")}
              onClick={() => setActiveStudentId(s.id)}
            >
              <div className="coach-persona__name">{s.name}</div>
              <div className="coach-persona__meta">
                {s.schoolLevel}
                {s.grade} · 약점: {s.weakSubjects.join(", ")}
              </div>
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}

export function StudentCoachApp(props: {
  tab: StudentTabKey;
  onTabChange: (t: StudentTabKey) => void;
}) {
  const T = useMemo(() => {
    const map: Record<StudentTabKey, React.ReactNode> = {
      home: <HomeTab />,
      coach: <CoachChatTab />,
      profile: <ProfileTab />,
      log: <LogTab />
    };
    return map[props.tab] || map.home;
  }, [props.tab]);

  const tabs: Array<{ key: StudentTabKey; label: string; icon: any }> = [
    { key: "home", label: "홈", icon: CoachIcons.Home },
    { key: "coach", label: "코치", icon: CoachIcons.Coach },
    { key: "profile", label: "프로필", icon: CoachIcons.Profile }
  ];

  return (
    <div className="coach-shell">
      {T}
      <nav className="bottom-nav" aria-label="학생 하단 내비게이션">
        {tabs.map(t => {
          const Icon = t.icon;
          const active = t.key === props.tab;
          return (
            <button
              key={t.key}
              type="button"
              className={"nav-item" + (active ? " nav-item-active" : "")}
              onClick={() => props.onTabChange(t.key)}
            >
              <span className="nav-icon" aria-hidden="true">
                <Icon size={16} />
              </span>
              <span className="nav-label">{t.label}</span>
            </button>
          );
        })}
      </nav>

      <button
        type="button"
        className="coach-fab"
        aria-label="일일 기록"
        onClick={() => props.onTabChange("log")}
      >
        <CoachIcons.Log size={18} />
        기록
      </button>
    </div>
  );
}

