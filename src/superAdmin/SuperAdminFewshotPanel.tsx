import React, { useCallback, useEffect, useState } from "react";
import {
  TrendingUp,
  TrendingDown,
  Minus,
  RefreshCw,
  RotateCcw,
  Ban,
  Plus,
  ChevronDown,
  ChevronUp
} from "lucide-react";

type CoachLog = {
  id: number;
  sessionId: string;
  userType: string;
  coachMode: string;
  userMessage: string;
  aiResponse: string;
  contextSnapshot: Record<string, unknown> | null;
  signal: string | null;
  signalReason: string | null;
  isFewshot: boolean;
  isBlacklisted: boolean;
  fewshotSelectedAt: string | null;
  createdAt: string | null;
};

type ModeStat = {
  coachMode: string;
  modeLabel: string;
  total: number;
  positive: number;
  negative: number;
  neutral: number;
  unscored: number;
  positivePct: number;
  negativePct: number;
  neutralPct: number;
  positiveTrend: { thisWeek: number; prevWeek: number; delta: number };
  negativeTrend: { thisWeek: number; prevWeek: number; delta: number };
};

type HistoryRow = {
  id: number;
  logId: number | null;
  coachMode: string;
  modeLabel: string;
  action: string;
  detail: string | null;
  adminEmail: string | null;
  createdAt: string | null;
  userMessagePreview: string | null;
};

type CoachModeMeta = {
  coachMode: string;
  modeLabel: string;
  promptInjected: boolean;
};

type DashboardPayload = {
  coachMode: string;
  modeLabel: string;
  promptInjected: boolean;
  maxFewshot: number;
  activeFewshots: CoachLog[];
  positivePool: CoachLog[];
  blacklisted: CoachLog[];
};

function formatDt(iso: string | null) {
  if (!iso) return "—";
  try {
    return new Intl.DateTimeFormat("ko-KR", {
      timeZone: "Asia/Seoul",
      month: "short",
      day: "numeric",
      hour: "numeric",
      minute: "2-digit"
    }).format(new Date(iso));
  } catch {
    return iso.slice(0, 16);
  }
}

function contextSummary(ctx: Record<string, unknown> | null) {
  if (!ctx || typeof ctx !== "object") return null;
  const parts: string[] = [];
  if (ctx.sleepHours != null) parts.push(`수면 ${ctx.sleepHours}시간`);
  if (ctx.stressScore != null) parts.push(`스트레스 ${ctx.stressScore}/10`);
  if (ctx.concentrationPercent != null) parts.push(`집중 ${ctx.concentrationPercent}%`);
  if (ctx.planCompletionRate != null) parts.push(`계획 ${ctx.planCompletionRate}%`);
  return parts.length ? parts.join(", ") : null;
}

function TrendBadge(props: { delta: number; label: string }) {
  if (props.delta > 0) {
    return (
      <span className="super-admin-fewshot__trend super-admin-fewshot__trend--up">
        <TrendingUp size={14} /> {props.label} +{props.delta}
      </span>
    );
  }
  if (props.delta < 0) {
    return (
      <span className="super-admin-fewshot__trend super-admin-fewshot__trend--down">
        <TrendingDown size={14} /> {props.label} {props.delta}
      </span>
    );
  }
  return (
    <span className="super-admin-fewshot__trend">
      <Minus size={14} /> {props.label} 변동 없음
    </span>
  );
}

function LogCard(props: {
  log: CoachLog;
  variant: "active" | "pool" | "blacklist";
  busy: boolean;
  onSelect?: () => void;
  onDeselect?: () => void;
  onBlacklist?: () => void;
  onUnblacklist?: () => void;
}) {
  const [open, setOpen] = useState(false);
  const ctx = contextSummary(props.log.contextSnapshot);

  return (
    <article className={`super-admin-fewshot__log super-admin-fewshot__log--${props.variant}`}>
      <div className="super-admin-fewshot__log-head">
        <div>
          <span className="super-admin-fewshot__log-id">#{props.log.id}</span>
          {props.log.signal ? (
            <span className={`super-admin-fewshot__signal super-admin-fewshot__signal--${props.log.signal}`}>
              {props.log.signal}
            </span>
          ) : (
            <span className="super-admin-fewshot__signal">미평가</span>
          )}
          {props.log.fewshotSelectedAt ? (
            <span className="super-admin-fewshot__meta">
              선정 {formatDt(props.log.fewshotSelectedAt)}
            </span>
          ) : null}
        </div>
        <div className="super-admin-fewshot__log-actions">
          {props.variant === "active" && props.onDeselect ? (
            <button type="button" disabled={props.busy} onClick={props.onDeselect}>
              제거
            </button>
          ) : null}
          {props.variant === "pool" && props.onSelect ? (
            <button type="button" disabled={props.busy} onClick={props.onSelect}>
              few-shot 추가
            </button>
          ) : null}
          {props.variant !== "blacklist" && props.onBlacklist ? (
            <button type="button" disabled={props.busy} onClick={props.onBlacklist}>
              <Ban size={14} /> 블랙리스트
            </button>
          ) : null}
          {props.variant === "blacklist" && props.onUnblacklist ? (
            <button type="button" disabled={props.busy} onClick={props.onUnblacklist}>
              해제
            </button>
          ) : null}
          <button
            type="button"
            className="super-admin-fewshot__expand"
            onClick={() => setOpen(v => !v)}
            aria-expanded={open}
          >
            {open ? <ChevronUp size={16} /> : <ChevronDown size={16} />}
          </button>
        </div>
      </div>
      <p className="super-admin-fewshot__preview">
        <strong>질문:</strong> {props.log.userMessage.slice(0, 160)}
        {props.log.userMessage.length > 160 ? "…" : ""}
      </p>
      {props.log.signalReason ? (
        <p className="super-admin-fewshot__reason">신호: {props.log.signalReason}</p>
      ) : null}
      {open ? (
        <div className="super-admin-fewshot__full">
          {ctx ? <p><strong>상황:</strong> {ctx}</p> : null}
          <p><strong>학생 질문</strong></p>
          <pre>{props.log.userMessage}</pre>
          <p><strong>AI 답변</strong></p>
          <pre>{props.log.aiResponse}</pre>
          <p className="super-admin-fewshot__meta">
            기록 {formatDt(props.log.createdAt)} · {props.log.userType} · {props.log.sessionId}
          </p>
        </div>
      ) : null}
    </article>
  );
}

export function SuperAdminFewshotPanel(props: {
  apiBase: string;
  authToken: string;
}) {
  const [modes, setModes] = useState<CoachModeMeta[]>([]);
  const [coachMode, setCoachMode] = useState("learning");
  const [dashboard, setDashboard] = useState<DashboardPayload | null>(null);
  const [modeStats, setModeStats] = useState<ModeStat | null>(null);
  const [keywords, setKeywords] = useState<{ signal: string; reason: string; count: number }[]>([]);
  const [history, setHistory] = useState<HistoryRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [actionMsg, setActionMsg] = useState("");

  const [addOpen, setAddOpen] = useState(false);
  const [addUserMsg, setAddUserMsg] = useState("");
  const [addAiMsg, setAddAiMsg] = useState("");

  const authHeaders = {
    Authorization: `Bearer ${props.authToken}`,
    "Content-Type": "application/json"
  };

  const loadModes = useCallback(async () => {
    const res = await fetch(`${props.apiBase}/api/super-admin/fewshot/modes`, {
      headers: { Authorization: `Bearer ${props.authToken}` }
    });
    if (!res.ok) throw new Error("모드 목록을 불러오지 못했습니다.");
    const data = await res.json();
    setModes(data.modes || []);
  }, [props.apiBase, props.authToken]);

  const loadDashboard = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const res = await fetch(
        `${props.apiBase}/api/super-admin/fewshot/dashboard?coachMode=${encodeURIComponent(coachMode)}`,
        { headers: { Authorization: `Bearer ${props.authToken}` } }
      );
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || "Few-shot 현황을 불러오지 못했습니다.");
      }
      const data = await res.json();
      setDashboard(
        data.dashboard ?? {
          coachMode,
          modeLabel: coachMode,
          promptInjected: coachMode === "learning" || coachMode === "suneung",
          maxFewshot: 3,
          activeFewshots: [],
          positivePool: [],
          blacklisted: []
        }
      );
      const stat = (data.stats?.modes || []).find(
        (m: ModeStat) => m.coachMode === coachMode
      );
      setModeStats(stat || null);
      setKeywords(data.stats?.keywords || []);
      setHistory(data.history || []);
    } catch (e) {
      setError(e instanceof Error ? e.message : "불러오기 실패");
    } finally {
      setLoading(false);
    }
  }, [props.apiBase, props.authToken, coachMode]);

  useEffect(() => {
    void loadModes().catch(() => {});
  }, [loadModes]);

  useEffect(() => {
    void loadDashboard();
  }, [loadDashboard]);

  const postAction = async (path: string, body: Record<string, unknown>) => {
    setBusy(true);
    setActionMsg("");
    try {
      const res = await fetch(`${props.apiBase}${path}`, {
        method: "POST",
        headers: authHeaders,
        body: JSON.stringify(body)
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || "요청에 실패했습니다.");
      if (data.dashboard) setDashboard(data.dashboard);
      setActionMsg("반영되었습니다.");
      const histRes = await fetch(
        `${props.apiBase}/api/super-admin/fewshot/history?coachMode=${encodeURIComponent(coachMode)}&limit=30`,
        { headers: { Authorization: `Bearer ${props.authToken}` } }
      );
      if (histRes.ok) {
        const histData = await histRes.json();
        setHistory(histData.history || []);
      }
    } catch (e) {
      setActionMsg(e instanceof Error ? e.message : "실패");
    } finally {
      setBusy(false);
    }
  };

  const selectedMode = modes.find(m => m.coachMode === coachMode);

  return (
    <div className="super-admin-fewshot">
      <div className="super-admin-fewshot__mode-bar">
        <label>
          모드
          <select value={coachMode} onChange={e => setCoachMode(e.target.value)}>
            {modes.map(m => (
              <option key={m.coachMode} value={m.coachMode}>
                {m.modeLabel}
                {m.promptInjected ? "" : " (프롬프트 미주입)"}
              </option>
            ))}
          </select>
        </label>
        {selectedMode && !selectedMode.promptInjected ? (
          <p className="super-admin-fewshot__hint">
            이 모드는 DB에 few-shot이 쌓이지만, 현재 프롬프트에는 학습·수능만 주입됩니다.
          </p>
        ) : null}
        <div className="super-admin-fewshot__mode-actions">
          <button
            type="button"
            disabled={busy}
            onClick={() => void postAction("/api/super-admin/fewshot/refresh", { coachMode })}
          >
            <RefreshCw size={14} /> 자동 선정 실행
          </button>
          <button
            type="button"
            disabled={busy}
            onClick={() => {
              if (!window.confirm(`${dashboard?.modeLabel || coachMode} few-shot을 모두 초기화할까요?`)) {
                return;
              }
              void postAction("/api/super-admin/fewshot/reset", { coachMode });
            }}
          >
            <RotateCcw size={14} /> 전체 초기화
          </button>
          <button type="button" onClick={() => setAddOpen(v => !v)}>
            <Plus size={14} /> 예시 수동 추가
          </button>
        </div>
      </div>

      {actionMsg ? <p className="super-admin-fewshot__action-msg">{actionMsg}</p> : null}
      {error ? (
        <p className="super-admin-fewshot__error">
          {error}
          <br />
          <span className="super-admin-fewshot__meta">
            데이터가 0건이면 오류가 아니라 「선정된 예시가 없습니다」로 표시됩니다. 위 메시지는
            DB·권한·서버 오류일 때입니다.
          </span>
        </p>
      ) : null}
      {loading ? <p className="super-admin-fewshot__loading">불러오는 중…</p> : null}

      {addOpen ? (
        <div className="super-admin-fewshot__add-form">
          <label>
            학생 질문
            <textarea value={addUserMsg} onChange={e => setAddUserMsg(e.target.value)} rows={3} />
          </label>
          <label>
            AI 답변
            <textarea value={addAiMsg} onChange={e => setAddAiMsg(e.target.value)} rows={5} />
          </label>
          <button
            type="button"
            disabled={busy}
            onClick={() =>
              void postAction("/api/super-admin/fewshot/add", {
                coachMode,
                userMessage: addUserMsg,
                aiResponse: addAiMsg,
                selectAsFewshot: true
              }).then(() => {
                setAddUserMsg("");
                setAddAiMsg("");
              })
            }
          >
            추가 후 few-shot 선정
          </button>
        </div>
      ) : null}

      {modeStats ? (
        <section className="super-admin-fewshot__stats">
          <h2>신호 통계</h2>
          <div className="super-admin-fewshot__stat-grid">
            <div className="super-admin-fewshot__stat-card">
              <span className="super-admin-fewshot__stat-label">긍정</span>
              <strong>{modeStats.positivePct}%</strong>
              <span>{modeStats.positive}건</span>
            </div>
            <div className="super-admin-fewshot__stat-card">
              <span className="super-admin-fewshot__stat-label">부정</span>
              <strong>{modeStats.negativePct}%</strong>
              <span>{modeStats.negative}건</span>
            </div>
            <div className="super-admin-fewshot__stat-card">
              <span className="super-admin-fewshot__stat-label">중립</span>
              <strong>{modeStats.neutralPct}%</strong>
              <span>{modeStats.neutral}건</span>
            </div>
            <div className="super-admin-fewshot__stat-card">
              <span className="super-admin-fewshot__stat-label">미평가</span>
              <strong>—</strong>
              <span>{modeStats.unscored}건</span>
            </div>
          </div>
          <div className="super-admin-fewshot__trends">
            <TrendBadge delta={modeStats.positiveTrend.delta} label="긍정(주간)" />
            <TrendBadge delta={modeStats.negativeTrend.delta} label="부정(주간)" />
            <span className="super-admin-fewshot__meta">
              이번 주 긍정 {modeStats.positiveTrend.thisWeek} · 지난 주{" "}
              {modeStats.positiveTrend.prevWeek}
            </span>
          </div>
          {keywords.length > 0 ? (
            <div className="super-admin-fewshot__keywords">
              <h3>판별 키워드</h3>
              <ul>
                {keywords.slice(0, 12).map((k, i) => (
                  <li key={`${k.reason}-${i}`}>
                    <span className={`super-admin-fewshot__signal super-admin-fewshot__signal--${k.signal}`}>
                      {k.signal}
                    </span>
                    {k.reason} ({k.count})
                  </li>
                ))}
              </ul>
            </div>
          ) : null}
        </section>
      ) : null}

      {dashboard ? (
        <>
          <section className="super-admin-fewshot__section">
            <h2>
              현재 few-shot ({dashboard.activeFewshots.length}/{dashboard.maxFewshot})
            </h2>
            {dashboard.activeFewshots.length === 0 ? (
              <p className="super-admin-fewshot__empty">선정된 예시가 없습니다.</p>
            ) : (
              dashboard.activeFewshots.map(log => (
                <LogCard
                  key={log.id}
                  log={log}
                  variant="active"
                  busy={busy}
                  onDeselect={() =>
                    void postAction("/api/super-admin/fewshot/deselect", { logId: log.id })
                  }
                  onBlacklist={() =>
                    void postAction("/api/super-admin/fewshot/blacklist", { logId: log.id })
                  }
                />
              ))
            )}
          </section>

          <section className="super-admin-fewshot__section">
            <h2>긍정 풀 (수동 추가 후보)</h2>
            {dashboard.positivePool.length === 0 ? (
              <p className="super-admin-fewshot__empty">후보가 없습니다.</p>
            ) : (
              dashboard.positivePool.map(log => (
                <LogCard
                  key={log.id}
                  log={log}
                  variant="pool"
                  busy={busy}
                  onSelect={() =>
                    void postAction("/api/super-admin/fewshot/select", { logId: log.id })
                  }
                  onBlacklist={() =>
                    void postAction("/api/super-admin/fewshot/blacklist", { logId: log.id })
                  }
                />
              ))
            )}
          </section>

          <section className="super-admin-fewshot__section">
            <h2>블랙리스트</h2>
            {dashboard.blacklisted.length === 0 ? (
              <p className="super-admin-fewshot__empty">없음</p>
            ) : (
              dashboard.blacklisted.map(log => (
                <LogCard
                  key={log.id}
                  log={log}
                  variant="blacklist"
                  busy={busy}
                  onUnblacklist={() =>
                    void postAction("/api/super-admin/fewshot/unblacklist", { logId: log.id })
                  }
                />
              ))
            )}
          </section>
        </>
      ) : null}

      <section className="super-admin-fewshot__section">
        <h2>교체·관리 이력</h2>
        {history.length === 0 ? (
          <p className="super-admin-fewshot__empty">이력이 없습니다.</p>
        ) : (
          <ul className="super-admin-fewshot__history">
            {history.map(row => (
              <li key={row.id}>
                <span className="super-admin-fewshot__history-action">{row.action}</span>
                <span>{formatDt(row.createdAt)}</span>
                {row.detail ? <span> — {row.detail}</span> : null}
                {row.userMessagePreview ? (
                  <span className="super-admin-fewshot__history-preview">
                    {row.userMessagePreview}
                  </span>
                ) : null}
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
