import type { CapacitorConfig } from "@capacitor/cli";

const config: CapacitorConfig = {
  appId: "com.daechiroot.ios",
  appName: "대치루트",
  webDir: "dist",
  plugins: {
    Keyboard: {
      resize: "none",
      resizeOnFullScreen: false
    }
  },
  ios: {
    contentInset: "never"
  },
  server: {
    // 로컬 번들만 사용 (앱에 포함된 dist). 원격 URL을 넣으면 오프라인에서 화면이 안 뜰 수 있음.
    // url: "https://example.com", // 필요 시에만 주석 해제
    androidScheme: "https"
  }
};

export default config;
