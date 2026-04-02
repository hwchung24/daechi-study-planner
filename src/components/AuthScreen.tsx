import React from "react";

type AuthMode = "login" | "signup";
type AuthRole = "student" | "parent";

export function AuthScreen(props: {
  authLeaving: boolean;
  authMode: AuthMode;
  authRole: AuthRole;
  authStudentName: string;
  authEmail: string;
  authPassword: string;
  authError: string;
  onModeChange: (mode: AuthMode) => void;
  onRoleChange: (role: AuthRole) => void;
  onStudentNameChange: (value: string) => void;
  onEmailChange: (value: string) => void;
  onPasswordChange: (value: string) => void;
  onSubmit: (e: React.FormEvent<HTMLFormElement>) => void;
}) {
  const {
    authLeaving,
    authMode,
    authRole,
    authStudentName,
    authEmail,
    authPassword,
    authError,
    onModeChange,
    onRoleChange,
    onStudentNameChange,
    onEmailChange,
    onPasswordChange,
    onSubmit
  } = props;

  return (
    <div className={"auth-page" + (authLeaving ? " auth-page--leaving" : "")}>
      <div className="status-bar-safe" />
      <div className="auth-page-inner">
        <h2 key={authMode} className="auth-title auth-title--enter">
          {authMode === "login" ? "로그인" : "회원가입"}
        </h2>
        <p className="auth-desc">
          계정으로 로그인하면 학습 플랜이 계정별로 안전하게 저장됩니다.
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
        <div
          className={
            "auth-role-wrap" + (authMode === "signup" ? " auth-role-wrap--open" : "")
          }
        >
          <div className="auth-role-inner">
            <div
              className={
                "auth-tabs auth-tabs--segmented auth-tabs--role" +
                (authRole === "student"
                  ? " auth-tabs--active-0"
                  : " auth-tabs--active-1")
              }
              role="tablist"
            >
              <span className="auth-tabs__indicator" aria-hidden />
              <button
                type="button"
                role="tab"
                aria-selected={authRole === "student"}
                className={"auth-tab" + (authRole === "student" ? " active" : "")}
                onClick={() => onRoleChange("student")}
              >
                학생
              </button>
              <button
                type="button"
                role="tab"
                aria-selected={authRole === "parent"}
                className={"auth-tab" + (authRole === "parent" ? " active" : "")}
                onClick={() => onRoleChange("parent")}
              >
                학부모
              </button>
            </div>
          </div>
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
              ? "이동 중…"
              : authMode === "login"
                ? "로그인"
                : "회원가입 후 로그인"}
          </button>
        </form>
      </div>
    </div>
  );
}
