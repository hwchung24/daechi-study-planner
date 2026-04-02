# Capacitor (iOS) — 로컬 `dist` 번들

앱에 **빌드된 웹(`dist/`)이 포함**되므로, **망이 없어도** WebView는 뜨고 로그인·스플래시 등 **정적 화면은 기기 안에서 로드**됩니다.  
**API(`fetch`)** 는 서버 주소로 나가므로, 오프라인이면 실패합니다(앱 상단 오프라인 배너 참고).

## 한 번에 빌드 + Xcode

```bash
npm run mobile:ios
```

또는:

```bash
npm run build
npx cap sync
npx cap open ios
```

Xcode에서 **실기기 또는 시뮬레이터**로 Run.

## CocoaPods (최초 1회)

맥에 CocoaPods가 없으면:

```bash
sudo gem install cocoapods
cd ios/App
pod install
cd ../..
```

이후 `npx cap open ios` 로 `App.xcworkspace` 열기(`.xcodeproj` 가 아닌 **workspace**).

## 웹 수정 후 다시 반영

코드 수정 →

```bash
npm run cap:sync
```

(`build` + `ios/App/App/public` 로 웹 자산 복사)

## API 주소 (중요)

실기기에서는 `localhost` 가 **폰 자신**을 가리킵니다.  
백엔드가 PC에 있으면 같은 Wi‑Fi의 **PC IP**(예: `http://192.168.0.10:3000`)로 빌드해야 합니다.

프로젝트 루트에 `.env.production` 예:

```env
VITE_API_BASE=http://192.168.x.x:3000
```

그다음:

```bash
npm run build
npx cap sync
```

## 원격 URL만 띄우지 않기

`capacitor.config.ts` 의 `server.url` 은 **비워 두었습니다.**  
여기에 `https://...` 를 넣으면 **그 주소만** 로드하게 되어, 오프라인에서 화면이 안 뜰 수 있습니다.  
**즉시 반영**이 필요하면 `npm run cap:sync` 로 번들을 갱신하는 방식을 사용하세요.

## 앱 ID / 이름 변경

`capacitor.config.ts` 의 `appId`, `appName` 과 Xcode **Bundle Identifier** 를 맞춥니다.

## 햅틱 (iOS)

`@capacitor/haptics` 가 포함되어 있습니다. **Capacitor로 빌드한 앱**에서만 동작하고, **일반 Safari 웹**에서는 동작하지 않습니다.  
코드는 `src/lib/haptics.ts` 를 참고하세요.
