import { Capacitor, registerPlugin } from "@capacitor/core";

export type PendingNetworkBanner = {
  kind?: string;
  message?: string;
};

type AppShellPlugin = {
  switchToBundledAssets(options: PendingNetworkBanner): Promise<void>;
  switchToRemoteIfAvailable(options: PendingNetworkBanner): Promise<{ switched: boolean }>;
  consumePendingNetworkBanner(): Promise<PendingNetworkBanner>;
  openExternalUrl(options: { url: string }): Promise<void>;
};

export const AppShell = registerPlugin<AppShellPlugin>("AppShell");

export function canUseNativeAppShell(): boolean {
  return Capacitor.isNativePlatform();
}