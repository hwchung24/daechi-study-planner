import { Capacitor, registerPlugin, type PluginListenerHandle } from "@capacitor/core";

export type NativeKeyboardInputShowOptions = {
  value: string;
  multiline: boolean;
  placeholder?: string;
  label?: string;
  inputType?: string;
  inputMode?: string;
  autoComplete?: string;
  enterKeyHint?: string;
  maxLength?: number;
  autoCapitalize?: string;
  autoCorrect?: string;
  spellCheck?: boolean;
};

type NativeKeyboardInputEvent = {
  value: string;
};

type NativeKeyboardInputPlugin = {
  show(options: NativeKeyboardInputShowOptions): Promise<void>;
  hide(): Promise<void>;
  syncValue(options: { value: string }): Promise<void>;
  addListener(
    eventName: "textChange" | "submit" | "dismiss",
    listenerFunc: (event: NativeKeyboardInputEvent) => void
  ): Promise<PluginListenerHandle>;
};

export const NativeKeyboardInput = registerPlugin<NativeKeyboardInputPlugin>(
  "NativeKeyboardInput"
);

export function canUseNativeKeyboardInput() {
  return Capacitor.isNativePlatform();
}