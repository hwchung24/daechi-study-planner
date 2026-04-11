import { Capacitor, registerPlugin } from "@capacitor/core";

export type NativePushStatus = {
  supported: boolean;
  platform: string;
  permissionStatus: string;
  registered: boolean;
  deviceToken: string | null;
  lastError: string | null;
};

type NativePushNotificationsPlugin = {
  getStatus(): Promise<NativePushStatus>;
  requestPermissions(): Promise<NativePushStatus>;
  register(): Promise<NativePushStatus>;
};

const NativePushNotifications = registerPlugin<NativePushNotificationsPlugin>(
  "NativePushNotifications"
);

const WEB_STATUS: NativePushStatus = {
  supported: false,
  platform: Capacitor.getPlatform(),
  permissionStatus: "unsupported",
  registered: false,
  deviceToken: null,
  lastError: null
};

function isNativeIos() {
  return Capacitor.getPlatform() === "ios";
}

export async function getNativePushStatus() {
  if (!isNativeIos()) return WEB_STATUS;
  return NativePushNotifications.getStatus();
}

export async function requestNativePushPermissions() {
  if (!isNativeIos()) return WEB_STATUS;
  return NativePushNotifications.requestPermissions();
}

export async function registerNativePushNotifications() {
  if (!isNativeIos()) return WEB_STATUS;
  return NativePushNotifications.register();
}
