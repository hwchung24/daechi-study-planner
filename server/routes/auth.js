"use strict";

const PARENT_SIGNUP_PHONE_JWT_PURPOSE = "parent_signup_phone";

/**
 * @param {import("express").Express} app
 * @param {Record<string, unknown>} deps
 */
function registerAuthRoutes(app, deps) {
  const {
    authLimiter,
    crypto,
    jwt,
    bcrypt,
    JWT_SECRET,
    normalizeKoreanPhone,
    isValidKoreanMobilePhone,
    isSolapiSmsConfigured,
    sendSolapiSms,
    parentPhoneNormalizedExists,
    assertParentSignupPhoneResendCooldown,
    upsertParentSignupPhoneOtp,
    deleteParentSignupPhoneOtp,
    verifyParentSignupPhoneOtp,
    findUserByEmail,
    createUser,
    setParentPhoneForUser,
    upsertStudentCoachProfile,
    linkDeviceToUserBySerial,
    minPasswordLength,
    isReasonableEmail,
    isStudentWebApiEnforcementEnabled,
    assertStudentNativeClientHeader,
    isLikelySerial,
    attachDeviceByCookieIfPresent
  } = deps;

  function verifyParentSignupPhoneJwt(tokenRaw, expectedPhoneNormalized) {
    if (!JWT_SECRET) return false;
    try {
      const decoded = jwt.verify(String(tokenRaw || "").trim(), JWT_SECRET, {
        algorithms: ["HS256"]
      });
      if (decoded.purpose !== PARENT_SIGNUP_PHONE_JWT_PURPOSE) return false;
      return String(decoded.phone || "") === expectedPhoneNormalized;
    } catch {
      return false;
    }
  }

  app.post("/auth/parent/signup/send-phone-code", authLimiter, async (req, res) => {
    try {
      const phoneNormalized = normalizeKoreanPhone((req.body || {}).phone);
      if (!isValidKoreanMobilePhone(phoneNormalized)) {
        return res.status(400).json({ error: "휴대폰 번호를 올바르게 입력해 주세요." });
      }
      if (await parentPhoneNormalizedExists(phoneNormalized)) {
        return res.status(400).json({ error: "이미 가입에 사용된 번호입니다." });
      }
      const cooldown = await assertParentSignupPhoneResendCooldown(phoneNormalized, 45 * 1000);
      if (!cooldown.ok) {
        return res.status(429).json({ error: cooldown.error });
      }
      const code = String(crypto.randomInt(100000, 1000000));
      const devNoSms =
        process.env.NODE_ENV !== "production" &&
        String(process.env.PARENT_SIGNUP_DEV_NO_SMS || "").toLowerCase() === "true";
      if (!devNoSms && !isSolapiSmsConfigured()) {
        return res.status(503).json({
          error: "문자 인증이 설정되지 않았습니다. 관리자에게 문의해 주세요."
        });
      }
      await upsertParentSignupPhoneOtp(phoneNormalized, code);
      try {
        if (devNoSms) {
          if (String(process.env.PARENT_SIGNUP_DEV_PRINT_OTP || "").toLowerCase() === "true") {
            console.info("[dev] parent signup OTP", phoneNormalized, code);
          }
        } else {
          await sendSolapiSms({
            to: phoneNormalized,
            text: `[대치루트] 인증번호는 ${code} 입니다. 5분 이내에 입력해 주세요.`
          });
        }
      } catch (sendErr) {
        await deleteParentSignupPhoneOtp(phoneNormalized);
        console.error("parent signup SMS error", sendErr);
        return res.status(502).json({
          error: "인증 문자를 보내지 못했습니다. 잠시 후 다시 시도해 주세요."
        });
      }
      res.json({ ok: true });
    } catch (e) {
      console.error("/auth/parent/signup/send-phone-code error", e);
      res.status(500).json({ error: "요청을 처리하지 못했습니다." });
    }
  });

  app.post("/auth/parent/signup/verify-phone-code", authLimiter, async (req, res) => {
    try {
      const phoneNormalized = normalizeKoreanPhone((req.body || {}).phone);
      const code = String((req.body || {}).code || "").trim();
      if (!isValidKoreanMobilePhone(phoneNormalized) || !/^\d{6}$/.test(code)) {
        return res.status(400).json({ error: "번호와 인증번호를 확인해 주세요." });
      }
      if (await parentPhoneNormalizedExists(phoneNormalized)) {
        return res.status(400).json({ error: "이미 가입에 사용된 번호입니다." });
      }
      const v = await verifyParentSignupPhoneOtp(phoneNormalized, code);
      if (!v.ok) {
        return res.status(400).json({ error: v.error });
      }
      if (!JWT_SECRET) {
        return res.status(500).json({ error: "서버 설정 오류입니다." });
      }
      const phoneVerifyToken = jwt.sign(
        { purpose: PARENT_SIGNUP_PHONE_JWT_PURPOSE, phone: phoneNormalized },
        JWT_SECRET,
        { expiresIn: "30m", algorithm: "HS256" }
      );
      res.json({ ok: true, phoneVerifyToken });
    } catch (e) {
      console.error("/auth/parent/signup/verify-phone-code error", e);
      res.status(500).json({ error: "요청을 처리하지 못했습니다." });
    }
  });

  app.post("/auth/register", authLimiter, async (req, res) => {
    try {
      const { email, password, role, serial, name, phone, phoneVerifyToken } = req.body || {};
      if (!email || !password) {
        return res
          .status(400)
          .json({ error: "이메일과 비밀번호를 입력해 주세요." });
      }
      const trimmedEmail = String(email).trim().toLowerCase();
      if (!isReasonableEmail(trimmedEmail)) {
        return res
          .status(400)
          .json({ error: "이메일을 올바르게 입력해 주세요." });
      }
      const pwMin = minPasswordLength();
      if (String(password).length < pwMin) {
        return res.status(400).json({
          error: `비밀번호는 ${pwMin}자 이상이어야 합니다.`
        });
      }
      const existing = await findUserByEmail(trimmedEmail);
      if (existing) {
        return res.status(409).json({ error: "이미 사용 중인 이메일입니다." });
      }
      const hash = await bcrypt.hash(String(password), 10);
      const safeRole =
        role === "parent" || role === "student" ? role : "student";
      let parentPhoneNormalized = "";
      if (safeRole === "parent") {
        parentPhoneNormalized = normalizeKoreanPhone(phone);
        if (!isValidKoreanMobilePhone(parentPhoneNormalized)) {
          return res.status(400).json({ error: "휴대폰 번호를 올바르게 입력해 주세요." });
        }
        const tokenOk = verifyParentSignupPhoneJwt(phoneVerifyToken, parentPhoneNormalized);
        if (!tokenOk) {
          return res.status(400).json({ error: "휴대폰 인증을 완료해 주세요." });
        }
        if (await parentPhoneNormalizedExists(parentPhoneNormalized)) {
          return res.status(409).json({ error: "이미 가입에 사용된 번호입니다." });
        }
      }
      if (safeRole === "student" && isStudentWebApiEnforcementEnabled()) {
        if (!assertStudentNativeClientHeader(req, res)) {
          return;
        }
      }
      const userId = await createUser(trimmedEmail, hash, safeRole);
      if (safeRole === "parent" && parentPhoneNormalized) {
        await setParentPhoneForUser(userId, parentPhoneNormalized);
      }
      if (safeRole === "student") {
        const studentName = String(name || "").trim().slice(0, 40);
        if (studentName) {
          await upsertStudentCoachProfile(userId, { name: studentName });
        }
      }
      if (isLikelySerial(serial)) {
        await linkDeviceToUserBySerial(userId, String(serial).trim()).catch(err => {
          console.warn("device link skipped on register body:", err.message);
        });
      }
      await attachDeviceByCookieIfPresent(req, userId).catch(err => {
        console.warn("device link skipped on register:", err.message);
      });
      const token = jwt.sign({ userId }, JWT_SECRET, {
        expiresIn: "30d",
        algorithm: "HS256"
      });
      res.json({ token, userId, email: trimmedEmail, role: safeRole });
    } catch (e) {
      console.error("/auth/register error", e);
      res.status(500).json({ error: "회원가입에 실패했습니다." });
    }
  });

  app.post("/auth/login", authLimiter, async (req, res) => {
    try {
      const { email, password, serial } = req.body || {};
      if (!email || !password) {
        return res
          .status(400)
          .json({ error: "이메일과 비밀번호를 입력해 주세요." });
      }
      const user = await findUserByEmail(email);
      if (!user) {
        return res
          .status(401)
          .json({ error: "이메일 또는 비밀번호가 올바르지 않습니다." });
      }
      const ok = await bcrypt.compare(String(password), user.password_hash);
      if (!ok) {
        return res
          .status(401)
          .json({ error: "이메일 또는 비밀번호가 올바르지 않습니다." });
      }
      if (String(user.role || "").toLowerCase() === "student" && isStudentWebApiEnforcementEnabled()) {
        if (!assertStudentNativeClientHeader(req, res)) {
          return;
        }
      }
      const token = jwt.sign({ userId: user.id }, JWT_SECRET, {
        expiresIn: "30d",
        algorithm: "HS256"
      });
      if (isLikelySerial(serial)) {
        await linkDeviceToUserBySerial(user.id, String(serial).trim()).catch(err => {
          console.warn("device link skipped on login body:", err.message);
        });
      }
      await attachDeviceByCookieIfPresent(req, user.id).catch(err => {
        console.warn("device link skipped on login:", err.message);
      });
      res.json({ token, userId: user.id, email: user.email, role: user.role });
    } catch (e) {
      console.error("/auth/login error", e);
      res.status(500).json({ error: "로그인에 실패했습니다." });
    }
  });
}

module.exports = { registerAuthRoutes };
