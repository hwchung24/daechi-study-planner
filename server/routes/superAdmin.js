"use strict";

const { isSuperAdminEmail } = require("../superAdminAuth");
const { registerSuperAdminFewshotRoutes } = require("./superAdminFewshot");
const {
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
} = require("../feedback/coachFewshotAdmin");

/**
 * @param {import("express").Express} app
 * @param {Record<string, unknown>} deps
 */
function registerSuperAdminRoutes(app, deps) {
  const {
    authMiddleware,
    getMe,
    listAllUsersForSuperAdmin,
    listAllParentStudentLinksForSuperAdmin,
    listPendingParentStudentLinkRequestsForSuperAdmin,
    createStudentNotification,
    createParentNotification,
    sendPushToUser
  } = deps;

  async function superAdminMiddleware(req, res, next) {
    try {
      const me = await getMe(req.userId);
      if (!me || !isSuperAdminEmail(me.email)) {
        return res.status(403).json({ error: "총괄 관리자 권한이 없습니다." });
      }
      req.superAdminMe = me;
      next();
    } catch (e) {
      console.error("superAdminMiddleware error", e);
      res.status(500).json({ error: "권한 확인에 실패했습니다." });
    }
  }

  app.get("/api/super-admin/access", authMiddleware, superAdminMiddleware, (req, res) => {
    res.json({ ok: true, email: req.superAdminMe.email });
  });

  app.get("/api/super-admin/overview", authMiddleware, superAdminMiddleware, async (req, res) => {
    try {
      const [users, links, pendingLinks] = await Promise.all([
        listAllUsersForSuperAdmin(),
        listAllParentStudentLinksForSuperAdmin(),
        listPendingParentStudentLinkRequestsForSuperAdmin()
      ]);
      res.json({ users, links, pendingLinks });
    } catch (e) {
      console.error("/api/super-admin/overview error", e);
      res.status(500).json({ error: "사용자 목록을 불러오지 못했습니다." });
    }
  });

  app.post("/api/super-admin/notify", authMiddleware, superAdminMiddleware, async (req, res) => {
    try {
      const userId = Number((req.body || {}).userId || 0);
      const title = String((req.body || {}).title || "").trim();
      const body = String((req.body || {}).body || "").trim();
      const sendPush = (req.body || {}).sendPush !== false;

      if (!userId) {
        return res.status(400).json({ error: "userId가 필요합니다." });
      }
      if (!title) {
        return res.status(400).json({ error: "알림 제목을 입력해 주세요." });
      }

      const target = await getMe(userId);
      if (!target) {
        return res.status(404).json({ error: "사용자를 찾을 수 없습니다." });
      }

      const notification =
        target.role === "parent"
          ? await createParentNotification(userId, title, body || null)
          : await createStudentNotification(userId, title, body || null);

      if (sendPush) {
        await sendPushToUser(userId, { title, body: body || title }).catch(() => {});
      }

      res.json({
        ok: true,
        notification: notification
          ? {
              id: notification.id,
              created_at: notification.created_at
            }
          : null
      });
    } catch (e) {
      console.error("/api/super-admin/notify error", e);
      res.status(500).json({ error: "알림 전송에 실패했습니다." });
    }
  });

  registerSuperAdminFewshotRoutes(app, {
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
  });
}

module.exports = { registerSuperAdminRoutes };
