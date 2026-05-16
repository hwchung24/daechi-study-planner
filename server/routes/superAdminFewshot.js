"use strict";

/**
 * @param {import("express").Express} app
 * @param {Record<string, unknown>} deps
 */
function registerSuperAdminFewshotRoutes(app, deps) {
  const {
    authMiddleware,
    superAdminMiddleware,
    ensureCoachFewshotAdminSchema,
    listCoachModesMeta,
    listCoachFewshotDashboard,
    getCoachSignalStats,
    listCoachFewshotHistory,
    setCoachFewshotSelected,
    setCoachLogBlacklisted,
    resetCoachFewshotForMode,
    runCoachFewshotRefresh,
    addManualCoachFewshotExample,
    COACH_MODES
  } = deps;

  async function withSchema(_req, res, next) {
    try {
      await ensureCoachFewshotAdminSchema();
      next();
    } catch (e) {
      console.error("ensureCoachFewshotAdminSchema error", e);
      res.status(500).json({ error: "Few-shot 스키마 준비에 실패했습니다." });
    }
  }

  app.get(
    "/api/super-admin/fewshot/modes",
    authMiddleware,
    superAdminMiddleware,
    withSchema,
    (_req, res) => {
      res.json({ modes: listCoachModesMeta() });
    }
  );

  app.get(
    "/api/super-admin/fewshot/dashboard",
    authMiddleware,
    superAdminMiddleware,
    withSchema,
    async (req, res) => {
      try {
        const coachMode = String(req.query.coachMode || "learning");
        if (!COACH_MODES.includes(coachMode)) {
          return res.status(400).json({ error: "유효하지 않은 coachMode입니다." });
        }
        const [dashboard, stats, history] = await Promise.all([
          listCoachFewshotDashboard(coachMode),
          getCoachSignalStats(coachMode),
          listCoachFewshotHistory(coachMode, 30)
        ]);
        res.json({ dashboard, stats, history });
      } catch (e) {
        console.error("/api/super-admin/fewshot/dashboard error", e);
        const msg = String(e?.message || "");
        const hint =
          msg.includes("coach_response_log") && msg.includes("does not exist")
            ? "coach_response_log 테이블이 없습니다. 서버를 재시작하거나 server에서 node migrate.js 를 실행해 주세요."
            : "Few-shot 현황을 불러오지 못했습니다.";
        res.status(500).json({ error: hint, detail: msg.slice(0, 200) });
      }
    }
  );

  app.get(
    "/api/super-admin/fewshot/stats",
    authMiddleware,
    superAdminMiddleware,
    withSchema,
    async (req, res) => {
      try {
        const coachMode = req.query.coachMode
          ? String(req.query.coachMode)
          : null;
        const stats = await getCoachSignalStats(coachMode);
        res.json(stats);
      } catch (e) {
        console.error("/api/super-admin/fewshot/stats error", e);
        res.status(500).json({ error: "신호 통계를 불러오지 못했습니다." });
      }
    }
  );

  app.get(
    "/api/super-admin/fewshot/history",
    authMiddleware,
    superAdminMiddleware,
    withSchema,
    async (req, res) => {
      try {
        const coachMode = req.query.coachMode
          ? String(req.query.coachMode)
          : null;
        const limit = Number(req.query.limit || 50);
        const history = await listCoachFewshotHistory(coachMode, limit);
        res.json({ history });
      } catch (e) {
        console.error("/api/super-admin/fewshot/history error", e);
        res.status(500).json({ error: "이력을 불러오지 못했습니다." });
      }
    }
  );

  app.post(
    "/api/super-admin/fewshot/select",
    authMiddleware,
    superAdminMiddleware,
    withSchema,
    async (req, res) => {
      try {
        const logId = Number((req.body || {}).logId || 0);
        if (!logId) return res.status(400).json({ error: "logId가 필요합니다." });
        const result = await setCoachFewshotSelected(
          logId,
          true,
          req.superAdminMe.email
        );
        if (!result.ok) return res.status(400).json({ error: result.error });
        const dashboard = await listCoachFewshotDashboard(result.coachMode);
        res.json({ ok: true, dashboard });
      } catch (e) {
        console.error("/api/super-admin/fewshot/select error", e);
        res.status(500).json({ error: "Few-shot 선정에 실패했습니다." });
      }
    }
  );

  app.post(
    "/api/super-admin/fewshot/deselect",
    authMiddleware,
    superAdminMiddleware,
    withSchema,
    async (req, res) => {
      try {
        const logId = Number((req.body || {}).logId || 0);
        if (!logId) return res.status(400).json({ error: "logId가 필요합니다." });
        const result = await setCoachFewshotSelected(
          logId,
          false,
          req.superAdminMe.email
        );
        if (!result.ok) return res.status(400).json({ error: result.error });
        const dashboard = await listCoachFewshotDashboard(result.coachMode);
        res.json({ ok: true, dashboard });
      } catch (e) {
        console.error("/api/super-admin/fewshot/deselect error", e);
        res.status(500).json({ error: "Few-shot 해제에 실패했습니다." });
      }
    }
  );

  app.post(
    "/api/super-admin/fewshot/blacklist",
    authMiddleware,
    superAdminMiddleware,
    withSchema,
    async (req, res) => {
      try {
        const logId = Number((req.body || {}).logId || 0);
        if (!logId) return res.status(400).json({ error: "logId가 필요합니다." });
        const result = await setCoachLogBlacklisted(
          logId,
          true,
          req.superAdminMe.email
        );
        if (!result.ok) return res.status(400).json({ error: result.error });
        const dashboard = await listCoachFewshotDashboard(result.coachMode);
        res.json({ ok: true, dashboard });
      } catch (e) {
        console.error("/api/super-admin/fewshot/blacklist error", e);
        res.status(500).json({ error: "블랙리스트 처리에 실패했습니다." });
      }
    }
  );

  app.post(
    "/api/super-admin/fewshot/unblacklist",
    authMiddleware,
    superAdminMiddleware,
    withSchema,
    async (req, res) => {
      try {
        const logId = Number((req.body || {}).logId || 0);
        if (!logId) return res.status(400).json({ error: "logId가 필요합니다." });
        const result = await setCoachLogBlacklisted(
          logId,
          false,
          req.superAdminMe.email
        );
        if (!result.ok) return res.status(400).json({ error: result.error });
        const dashboard = await listCoachFewshotDashboard(result.coachMode);
        res.json({ ok: true, dashboard });
      } catch (e) {
        console.error("/api/super-admin/fewshot/unblacklist error", e);
        res.status(500).json({ error: "블랙리스트 해제에 실패했습니다." });
      }
    }
  );

  app.post(
    "/api/super-admin/fewshot/refresh",
    authMiddleware,
    superAdminMiddleware,
    withSchema,
    async (req, res) => {
      try {
        const coachMode = String((req.body || {}).coachMode || "");
        if (!COACH_MODES.includes(coachMode)) {
          return res.status(400).json({ error: "coachMode가 필요합니다." });
        }
        await runCoachFewshotRefresh(coachMode, req.superAdminMe.email);
        const dashboard = await listCoachFewshotDashboard(coachMode);
        res.json({ ok: true, dashboard });
      } catch (e) {
        console.error("/api/super-admin/fewshot/refresh error", e);
        res.status(500).json({ error: "Few-shot 갱신에 실패했습니다." });
      }
    }
  );

  app.post(
    "/api/super-admin/fewshot/reset",
    authMiddleware,
    superAdminMiddleware,
    withSchema,
    async (req, res) => {
      try {
        const coachMode = String((req.body || {}).coachMode || "");
        if (!COACH_MODES.includes(coachMode)) {
          return res.status(400).json({ error: "coachMode가 필요합니다." });
        }
        await resetCoachFewshotForMode(coachMode, req.superAdminMe.email);
        const dashboard = await listCoachFewshotDashboard(coachMode);
        res.json({ ok: true, dashboard });
      } catch (e) {
        console.error("/api/super-admin/fewshot/reset error", e);
        res.status(500).json({ error: "Few-shot 초기화에 실패했습니다." });
      }
    }
  );

  app.post(
    "/api/super-admin/fewshot/add",
    authMiddleware,
    superAdminMiddleware,
    withSchema,
    async (req, res) => {
      try {
        const body = req.body || {};
        const result = await addManualCoachFewshotExample(
          {
            coachMode: body.coachMode,
            userType: body.userType,
            userMessage: body.userMessage,
            aiResponse: body.aiResponse,
            contextSnapshot: body.contextSnapshot,
            selectAsFewshot: body.selectAsFewshot !== false
          },
          req.superAdminMe.email
        );
        if (!result.ok) return res.status(400).json({ error: result.error });
        const dashboard = await listCoachFewshotDashboard(result.coachMode);
        res.json({ ok: true, logId: result.logId, dashboard });
      } catch (e) {
        console.error("/api/super-admin/fewshot/add error", e);
        res.status(500).json({ error: "예시 추가에 실패했습니다." });
      }
    }
  );
}

module.exports = { registerSuperAdminFewshotRoutes };
