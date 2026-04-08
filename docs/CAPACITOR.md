# Capacitor (iOS) — 원격 우선, 번들 fallback

앱에는 **빌드된 웹(`dist/`)이 포함**되어 있고, iOS 시작 시에는 먼저 원격 웹을 짧게 확인합니다. 원격 웹이 살아 있으면 그걸 열고, 네트워크가 없거나 원격이 응답하지 않으면 **내장 번들로 자동 fallback** 됩니다.

즉:

- 온라인 + 원격 정상: 최신 웹 화면 사용
- 오프라인 또는 원격 장애: 앱 안의 `dist` 화면 사용
- 어떤 경우든 서버 API(`fetch`)는 네트워크가 없으면 실패할 수 있음

앱이 이미 원격 웹으로 열린 상태에서 네트워크가 끊기면, native 환경에서는 `offline` 이벤트를 감지해 로컬 번들(`public`)로 전환합니다.

반대로 로컬 번들 상태에서 네트워크가 다시 살아나면, native 환경에서는 원격 웹 연결을 다시 확인한 뒤 가능할 때 즉시 온라인 모드로 복귀합니다.

전환 시 배너:

- 온라인 → 오프라인: "인터넷 연결이 끊겨 오프라인 모드로 전환되었습니다."
- 오프라인 → 온라인: "인터넷 연결이 복구되어 온라인 모드로 전환되었습니다."

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

내장 번들은 fallback 용으로 유지되므로, 원격 웹을 쓰더라도 새 IPA를 만들 때는 이 번들도 함께 최신 상태로 넣어 두는 편이 좋습니다.

## API 주소 (중요)

실기기에서는 `localhost` 가 **폰 자신**을 가리킵니다.  
백엔드가 PC에 있으면 같은 Wi‑Fi의 **PC IP**(예: `http://192.168.0.10:3000`)로 빌드해야 합니다.

프로젝트 루트에 `.env.production` 예:

```env
VITE_API_BASE=https://backend-production-2fd5c.up.railway.app
```

로컬 테스트용 IP를 넣어 빌드하면, 그 값이 IPA 안에 그대로 포함됩니다. 배포용 IPA는 반드시 운영 백엔드 주소로 다시 빌드하세요.

그다음:

```bash
npm run build
npx cap sync
```

App Store 배포처럼 한 번 빌드된 IPA를 계속 써야 하는 경우에는 MDM Managed App Config로 API 주소를 덮어쓸 수 있습니다.

- Key: `api_base`
- Type: `string`
- Value: `https://your-server.up.railway.app`

앱은 native 환경에서 `api_base` 또는 `apiBase` 값을 우선 사용하고, 없으면 빌드 시점의 `VITE_API_BASE`를 사용합니다.

## 원격 웹 주소

현재 iOS 앱은 [ios/App/App/Info.plist](../ios/App/App/Info.plist) 의 `DaechiRemoteWebUrl` 값을 먼저 확인합니다.

기본값:

```xml
<key>DaechiRemoteWebUrl</key>
<string>https://daechi-study-planner.vercel.app/</string>
```

동작 방식:

- 앱 시작 시 이 URL이 짧게 응답하면 원격 웹 사용
- 응답하지 않으면 내장 번들 사용
- 최근에 실패한 직후에는 잠깐 원격 재시도를 쉬고 바로 번들로 열어 시작 지연을 줄임

즉시 반영이 필요한 운영 환경에서는 이 방식이 MDM 배포에 더 잘 맞습니다.

## 앱 ID / 이름 변경

`capacitor.config.ts` 의 `appId`, `appName` 과 Xcode **Bundle Identifier** 를 맞춥니다.

## 햅틱 (iOS)

`@capacitor/haptics` 가 포함되어 있습니다. **Capacitor로 빌드한 앱**에서만 동작하고, **일반 Safari 웹**에서는 동작하지 않습니다.  
코드는 `src/lib/haptics.ts` 를 참고하세요. 화면별 사용 기준은 `docs/HAPTICS.md` 를 따릅니다.

## 키보드 (iOS)

`@capacitor/keyboard` 를 사용해 iOS 네이티브 셸에서 키보드 리사이즈 모드를 `none` 으로 고정합니다.

- 목적: 웹뷰 전체가 키보드에 맞춰 재배치되는 현상을 줄이고, 앱 셸 고정을 더 강하게 유지
- 설정 위치: `capacitor.config.ts` 의 `plugins.Keyboard.resize`
- 런타임 처리: `src/main.tsx` 에서 native 환경일 때 Capacitor Keyboard 이벤트를 기준으로 키보드 열림/닫힘 상태를 처리

웹(Safari/PWA)에서는 브라우저 기본 동작 한계가 남지만, Capacitor 앱에서는 이 설정이 더 직접적으로 동작합니다.

## Managed App Config 로 시리얼 받기

MDM에서 앱 구성값으로 기기 시리얼을 주입할 때는 키를 `serial_number` 로 넣으면 됩니다.

- Key: `serial_number`
- Type: `string`
- Value: `{{serial_number}}`

앱은 현재 `serial_number` 를 우선 읽고, 이전 설정과의 호환을 위해 `serial` 도 함께 지원합니다.
