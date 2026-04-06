import React, { useMemo } from "react";
import { TabTransitionPanel } from "../../components/PageTransition";
import { Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { demoDailyLogs, demoParents, demoStudents } from "../demoData";
import { buildWeeklyInsight } from "../ai/insight-engine";
import { buildParentGuide } from "../ai/parent-guide";
import { setAppPath } from "../../lib/appNavigation";
import { useCoachStore } from "../state/useCoachStore";
import type { DailyLog } from "../types";
import { Card, EmptyState, GradientHeroCard, MetricCard, RiskBadge, SectionHeader, StatPill } from "../ui/components";
import { formatMinutes } from "../utils/format";

export type ParentTabKey = "home" | "timeline" | "guide" | "profile";

function buildTimeline(logs7d: DailyLog[]) {
  const last = logs7d[logs7d.length - 1];
  if (!last) return [];
  return [
    { id: "t1", title: "수학 문제풀이 진행", detail: `총 공부 ${formatMinutes(last.totalStudyMinutes)}` },
    { id: "t2", title: "영어 복습", detail: last.planCompletionRate < 60 ? "복습 타이밍이 밀릴 수 있어요." : "루틴이 잘 유지되고 있어요." },
    { id: "t3", title: "집중 흐름", detail: last.concentrationScore <= 2 ? "집중이 떨어진 날이에요. 환경 조정이 필요해요." : "큰 흔들림이 없어요." }
  ];
}

function ParentHome() {
  const activeStudentId = useCoachStore(s => s.activeStudentId);
  const student = demoStudents.find(s => s.id === activeStudentId) || demoStudents[0];
  const insight = useMemo(() => buildWeeklyInsight(student.id, demoDailyLogs), [student.id]);
  const logs7d = useMemo(() => demoDailyLogs.filter(l => l.studentId === student.id).slice(-7), [student.id]);
  const guide = useMemo(() => buildParentGuide(insight, logs7d), [insight, logs7d]);
  const last = logs7d[logs7d.length - 1];

  const metrics = [
    { title: "오늘의 집중 과목", value: student.targetSubjects[0] || "—" },
    { title: "개입 필요도", value: guide.urgency, hint: guide.intervention },
    { title: "이번 주 목표 달성률", value: last ? `${last.planCompletionRate}%` : "—" },
    { title: "최근 집중 흐름", value: last ? `${last.concentrationScore}/5` : "—" }
  ];

  return (
    <div className="coach-page">
      <GradientHeroCard
        eyebrow="학부모 리포트"
        title="잔소리 대신 도움의 타이밍을 알려드립니다"
        body={`${student.name}의 이번 주 리스크는 ‘${insight.riskLevel}’입니다. 지금은 ${guide.intervention}이 가장 효과적이에요.`}
        ctaLabel="대화 가이드 보기"
        onCta={() => {
          setAppPath("#/parent/guide");
        }}
        badge={<RiskBadge level={insight.riskLevel} />}
      />

      <div className="coach-grid">
        {metrics.map(m => (
          <MetricCard key={m.title} title={m.title} value={m.value} hint={m.hint} />
        ))}
      </div>

      <Card className="coach-card coach-card--padded">
        <SectionHeader
          title="이번 주 집중 흐름"
          subtitle={insight.summarySentence}
          right={<StatPill label="개입" value={guide.intervention} />}
        />
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
                formatter={(v: any, k: any) => [v, k === "concentration" ? "집중도" : k]}
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

      <Card className="coach-card coach-card--padded" style={{ marginTop: 12 }}>
        <SectionHeader title="AI 학부모 가이드" subtitle={guide.headline} />
        <div className="coach-guide-lines">
          {guide.guidanceLines.slice(0, 3).map((l, i) => (
            <div key={i} className="coach-guide-line">
              <span className="coach-guide-dot" aria-hidden />
              <span className="coach-muted">{l}</span>
            </div>
          ))}
        </div>
      </Card>
    </div>
  );
}

function TimelineTab() {
  const activeStudentId = useCoachStore(s => s.activeStudentId);
  const student = demoStudents.find(s => s.id === activeStudentId) || demoStudents[0];
  const logs7d = useMemo(() => demoDailyLogs.filter(l => l.studentId === student.id).slice(-7), [student.id]);
  const items = buildTimeline(logs7d);
  return (
    <div className="coach-page">
      <SectionHeader title="학습 타임라인" subtitle={`${student.name}의 최근 흐름을 한 눈에 정리합니다.`} />
      {items.length ? (
        <div className="coach-timeline">
          {items.map(it => (
            <Card key={it.id} className="coach-card coach-card--padded coach-timeline-item">
              <div className="coach-strong">{it.title}</div>
              <div className="coach-muted" style={{ marginTop: 6 }}>
                {it.detail}
              </div>
            </Card>
          ))}
        </div>
      ) : (
        <EmptyState title="타임라인 데이터가 아직 없어요." body="학생의 기록이 쌓이면 자동으로 생성됩니다." />
      )}
    </div>
  );
}

function GuideTab() {
  const activeStudentId = useCoachStore(s => s.activeStudentId);
  const student = demoStudents.find(s => s.id === activeStudentId) || demoStudents[0];
  const insight = useMemo(() => buildWeeklyInsight(student.id, demoDailyLogs), [student.id]);
  const logs7d = useMemo(() => demoDailyLogs.filter(l => l.studentId === student.id).slice(-7), [student.id]);
  const guide = useMemo(() => buildParentGuide(insight, logs7d), [insight, logs7d]);

  return (
    <div className="coach-page">
      <SectionHeader title="대화 가이드" subtitle="말 한마디의 타이밍이, 루틴을 살립니다." right={<RiskBadge level={guide.urgency} />} />
      <Card className="coach-card coach-card--padded">
        <div className="coach-strong">추천 개입: {guide.intervention}</div>
        <div className="coach-muted" style={{ marginTop: 8 }}>
          {guide.headline}
        </div>
        <div className="coach-divider" />
        <div className="coach-guide-lines">
          {guide.guidanceLines.map((l, i) => (
            <div key={i} className="coach-guide-line">
              <span className="coach-guide-dot" aria-hidden />
              <span className="coach-muted">{l}</span>
            </div>
          ))}
        </div>
      </Card>

      <Card className="coach-card coach-card--padded" style={{ marginTop: 12 }}>
        <SectionHeader title="바로 쓸 수 있는 문장" subtitle="짧고 구체적인 말이 가장 효과적입니다." />
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
      </Card>
    </div>
  );
}

function ProfileTab() {
  const activeStudentId = useCoachStore(s => s.activeStudentId);

  const parent = demoParents[0];
  const student = demoStudents.find(s => s.id === activeStudentId) || demoStudents[0];

  return (
    <div className="coach-page">
      <SectionHeader title="학부모 프로필" subtitle="연결된 학생 정보를 확인할 수 있어요." />
      <Card className="coach-card coach-card--padded">
        <div className="coach-profile">
          <div className="coach-profile__name">{parent.name} ({parent.relationship})</div>
          <div className="coach-profile__meta">연결된 자녀: {student.name}</div>
        </div>
      </Card>
    </div>
  );
}

export function ParentCoachApp(props: {
  tab: ParentTabKey;
}) {
  const view = useMemo(() => {
    const map: Record<ParentTabKey, React.ReactNode> = {
      home: <ParentHome />,
      timeline: <TimelineTab />,
      guide: <GuideTab />,
      profile: <ProfileTab />
    };
    return map[props.tab] || map.home;
  }, [props.tab]);

  return (
    <div className="coach-shell">
      <TabTransitionPanel tabKey={props.tab} className="coach-shell__tab-panel">
        {view}
      </TabTransitionPanel>
    </div>
  );
}

