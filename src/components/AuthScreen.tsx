import React from "react";

type AuthMode = "login" | "signup";
type AuthRole = "student" | "parent";

/** 웹: 학부모만 / 네이티브 앱: 학생만 */
export type AuthChannel = "parent" | "student";

export function AuthScreen(props: {
  authChannel: AuthChannel;
  authLeaving: boolean;
  authMode: AuthMode;
  authRole: AuthRole;
  authStudentName: string;
  authParentPhone: string;
  authParentPhoneCode: string;
  authParentPhoneVerified: boolean;
  authParentPhoneSending: boolean;
  authParentPhoneVerifying: boolean;
  authParentPhoneNotice: string;
  authParentPhoneNoticeTone: "neutral" | "success" | "error";
  authEmail: string;
  authPassword: string;
  authError: string;
  onModeChange: (mode: AuthMode) => void;
  onStudentNameChange: (value: string) => void;
  onParentPhoneChange: (value: string) => void;
  onParentPhoneCodeChange: (value: string) => void;
  onParentPhoneSendCode: () => void;
  onParentPhoneVerifyCode: () => void;
  onEmailChange: (value: string) => void;
  onPasswordChange: (value: string) => void;
  onSubmit: (e: React.FormEvent<HTMLFormElement>) => void;
}) {
  const {
    authChannel,
    authLeaving,
    authMode,
    authRole,
    authStudentName,
    authParentPhone,
    authParentPhoneCode,
    authParentPhoneVerified,
    authParentPhoneSending,
    authParentPhoneVerifying,
    authParentPhoneNotice,
    authParentPhoneNoticeTone,
    authEmail,
    authPassword,
    authError,
    onModeChange,
    onStudentNameChange,
    onParentPhoneChange,
    onParentPhoneCodeChange,
    onParentPhoneSendCode,
    onParentPhoneVerifyCode,
    onEmailChange,
    onPasswordChange,
    onSubmit
  } = props;

  const isParentSurface = authChannel === "parent";

  return (
    <div className={"auth-page" + (authLeaving ? " auth-page--leaving" : "")}>
      <div className="auth-page-inner">
        <section className="auth-panel coach-card coach-card--padded">
          <h2 key={authMode} className="auth-title auth-title--enter">
            {authMode === "login" ? "로그인" : "회원가입"}
          </h2>
          <p className="auth-desc">
            {isParentSurface
              ? authMode === "login"
                ? "학부모 계정으로 로그인해 자녀 일정·기록·알림을 관리하세요."
                : "학부모 계정을 만들면 자녀 연결 후 앱과 함께 이용할 수 있어요."
              : authMode === "login"
                ? "학생 계정으로 로그인해 오늘 계획과 기록을 이어가세요."
                : "학생 계정을 만들면 바로 공부 기록을 시작할 수 있어요."}
          </p>
          <div
            className={
              "auth-tabs auth-tabs--segmented" +
              (authMode === "login"
                ? " auth-tabs--active-0"
                : " auth-tabs--active-1")
            }
            role="tablist"
          >
            <span className="auth-tabs__indicator" aria-hidden />
            <button
              type="button"
              role="tab"
              aria-selected={authMode === "login"}
              className={"auth-tab" + (authMode === "login" ? " active" : "")}
              onClick={() => onModeChange("login")}
            >
              로그인
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={authMode === "signup"}
              className={"auth-tab" + (authMode === "signup" ? " active" : "")}
              onClick={() => onModeChange("signup")}
            >
              회원가입
            </button>
          </div>
          <form className="auth-form" onSubmit={onSubmit}>
            {authMode === "signup" && authRole === "student" && (
              <div className="auth-field">
                <label htmlFor="auth-student-name">학생 이름</label>
                <input
                  id="auth-student-name"
                  type="text"
                  className="auth-input"
                  autoComplete="name"
                  value={authStudentName}
                  onChange={e => onStudentNameChange(e.target.value)}
                />
              </div>
            )}
            {authMode === "signup" && authRole === "parent" && (
              <>
                <div className="auth-field">
                  <label htmlFor="auth-parent-phone">휴대폰 번호</label>
                  <div className="auth-phone-row">
                    <input
                      id="auth-parent-phone"
                      type="tel"
                      className="auth-input"
                      inputMode="numeric"
                      autoComplete="tel"
                      placeholder="01012345678"
                      value={authParentPhone}
                      onChange={e => onParentPhoneChange(e.target.value)}
                      disabled={authLeaving || authParentPhoneVerified}
                      aria-invalid={authParentPhoneNoticeTone === "error"}
                    />
                    <button
                      type="button"
                      className="auth-inline-btn"
                      onClick={() => onParentPhoneSendCode()}
                      disabled={
                        authLeaving ||
                        authParentPhoneSending ||
                        authParentPhoneVerified ||
                        authParentPhone.trim().replace(/\D/g, "").length < 10
                      }
                    >
                      {authParentPhoneSending ? "발송 중…" : "인증번호 받기"}
                    </button>
                  </div>
                </div>
                <div className="auth-field">
                  <label htmlFor="auth-parent-phone-code">인증번호</label>
                  <div className="auth-phone-row">
                    <input
                      id="auth-parent-phone-code"
                      type="text"
                      className="auth-input"
                      inputMode="numeric"
                      autoComplete="one-time-code"
                      placeholder="6자리"
                      maxLength={6}
                      value={authParentPhoneCode}
                      onChange={e =>
                        onParentPhoneCodeChange(e.target.value.replace(/\D/g, "").slice(0, 6))
                      }
                      disabled={authLeaving || authParentPhoneVerified}
                    />
                    <button
                      type="button"
                      className="auth-inline-btn"
                      onClick={() => onParentPhoneVerifyCode()}
                      disabled={
                        authLeaving ||
                        authParentPhoneVerifying ||
                        authParentPhoneVerified ||
                        authParentPhoneCode.length !== 6
                      }
                    >
                      {authParentPhoneVerifying ? "확인 중…" : "인증 확인"}
                    </button>
                  </div>
                  {authParentPhoneVerified ? (
                    <p className="auth-phone-status auth-phone-status--ok">휴대폰 인증이 완료되었어요.</p>
                  ) : null}
                  {authParentPhoneNotice ? (
                    <p
                      className={
                        "auth-phone-status" +
                        (authParentPhoneNoticeTone === "error"
                          ? " auth-phone-status--err"
                          : authParentPhoneNoticeTone === "success"
                            ? " auth-phone-status--ok"
                            : "")
                      }
                    >
                      {authParentPhoneNotice}
                    </p>
                  ) : null}
                </div>
              </>
            )}
            <div className="auth-field">
              <label htmlFor="auth-email">이메일</label>
              <input
                id="auth-email"
                type="email"
                className="auth-input"
                autoComplete="username"
                value={authEmail}
                onChange={e => onEmailChange(e.target.value)}
              />
            </div>
            <div className="auth-field">
              <label htmlFor="auth-password">비밀번호</label>
              <input
                id="auth-password"
                type="password"
                className="auth-input"
                autoComplete="current-password"
                value={authPassword}
                onChange={e => onPasswordChange(e.target.value)}
              />
            </div>
            {authError && <div className="auth-error">{authError}</div>}
            <button type="submit" className="auth-submit" disabled={authLeaving}>
              {authLeaving
                ? "잠깐만요…"
                : authMode === "login"
                  ? "로그인"
                  : "계정 만들기"}
            </button>
          </form>
        </section>
      </div>
    </div>
  );
}
