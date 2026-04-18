## Daechi Planner (웹앱 기반 iOS 전용 학습 플래너)

React + Vite로 만든 iOS 감성의 학습 플래너 웹앱입니다. 아이폰 사파리에서 사용하기 좋게 화면 비율과 하단 탭, 둥근 카드 디자인을 적용했습니다.

### 실행 방법

1. 의존성 설치

```bash
npm install
```

2. 개발 서버 실행

```bash
npm run dev
```

브라우저에서 `http://localhost:5173` 에 접속하면 됩니다. 아이폰에서는 같은 네트워크에 있을 때, 맥의 로컬 IP로 접속하면 실기기에서도 확인할 수 있습니다.

### 주요 기능

- 오늘 날짜 기준 학습 계획(시간대) 표시
- 과목 / 시간대별 학습 블록 생성 및 완료 체크
- 수학/국어/영어 등 빠른 과목 선택 칩
- iOS 스타일 하단 탭 바와 카드형 UI
- 관리자 계정: 학생과 연결 후 **AI 일일 리포트**(GPT-4o-mini) — 매일 **한국시간 자정**에 서버가 생성해 관리자 페이지에 표시

### 백엔드 + AI 리포트

1. `server/` 에서 `npm install`
2. `server/.env` 에 `DATABASE_URL`, `JWT_SECRET`, **`OPENAI_API_KEY`**, **`SIMPLEMDM_API_KEY`** 설정 (`server/.env.example` 참고)
3. `cd server && npm run migrate && npm start`
4. 관리자 페이지: 연결된 학생 선택 시 **AI 일일 리포트** 카드에서 확인 (자정 배치 이후 또는 데이터가 쌓인 뒤)
---
⚠️ 안내: 코드 내부 변수명, API, DB 등은 parent/학부모 용어를 그대로 사용합니다. 앱 내 노출 문구만 "관리자"로 표기합니다. (2026-04-09)

학생용 학습 앱스토어에서 앱 설치/삭제까지 쓰려면 `SIMPLEMDM_API_KEY`가 운영 중인 백엔드 서버 환경에도 설정되어 있어야 합니다. iOS 앱(IPA) 안에 넣는 값이 아니라 서버가 SimpleMDM API를 호출할 때 사용하는 키입니다.

### iOS 앱 (Capacitor — `dist` 번들 내장)

웹 빌드 결과를 앱에 넣어 **오프라인에서도 화면(스플래시·로그인 UI 등)은 로드**됩니다. 서버 API는 네트워크가 필요합니다.

```bash
npm run mobile:ios
```

자세한 절차·API 주소 설정은 **`docs/CAPACITOR.md`** 참고.

