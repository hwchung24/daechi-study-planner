import React from "react";

export function StudentNativeOnlyGate(props: {
  userEmail: string | null;
  onLogout: () => void;
}) {
  return (
    <div className="student-native-gate">
      <div className="student-native-gate__card coach-card coach-card--padded">
        <h1 className="student-native-gate__title">학생 메뉴는 앱에서만 열 수 있어요</h1>
        <p className="student-native-gate__body">
          보안과 기기 연동(MDM·위치 등) 때문에 학생 계정은{" "}
          <strong>공식 iOS/Android 앱</strong>으로만 이용할 수 있습니다. 웹 브라우저에서는 이어서
          사용할 수 없어요.
        </p>
        {props.userEmail ? (
          <p className="student-native-gate__meta">로그인된 계정: {props.userEmail}</p>
        ) : null}
        <button type="button" className="modal-primary student-native-gate__btn" onClick={props.onLogout}>
          로그아웃
        </button>
      </div>
    </div>
  );
}
