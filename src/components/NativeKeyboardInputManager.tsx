import { useEffect, useRef } from "react";
import {
  NativeKeyboardInput,
  canUseNativeKeyboardInput,
  type NativeKeyboardInputShowOptions
} from "../lib/nativeKeyboardInput";

type SourceElement = HTMLInputElement | HTMLTextAreaElement;

const NATIVE_KEYBOARD_DISMISS_EVENT = "daechi:native-keyboard-input-dismiss";
const NATIVE_KEYBOARD_SUBMIT_EVENT = "daechi:native-keyboard-input-submit";

const TEXT_INPUT_TYPES = new Set([
  "",
  "text",
  "search",
  "email",
  "password",
  "tel",
  "url",
  "number"
]);

function isEligibleSource(node: EventTarget | null): node is SourceElement {
  if (!(node instanceof HTMLInputElement || node instanceof HTMLTextAreaElement)) {
    return false;
  }

  if (node.disabled || node.readOnly) {
    return false;
  }

  if (node.dataset.nativeKeyboardInput === "off") {
    return false;
  }

  if (node.closest("[data-native-keyboard-input='off']")) {
    return false;
  }

  if (node instanceof HTMLInputElement) {
    return TEXT_INPUT_TYPES.has((node.type || "text").toLowerCase());
  }

  return true;
}

function syncSourceValue(source: SourceElement, nextValue: string) {
  const prototype =
    source instanceof HTMLTextAreaElement
      ? HTMLTextAreaElement.prototype
      : HTMLInputElement.prototype;
  const descriptor = Object.getOwnPropertyDescriptor(prototype, "value");

  descriptor?.set?.call(source, nextValue);
  if (!descriptor?.set) {
    source.value = nextValue;
  }

  source.dispatchEvent(new Event("input", { bubbles: true }));
}

function submitSourceForm(source: SourceElement) {
  const form = source.form || source.closest("form");
  if (form instanceof HTMLFormElement) {
    form.requestSubmit();
  }
}

function toShowOptions(source: SourceElement): NativeKeyboardInputShowOptions {
  return {
    value: source.value,
    multiline: source instanceof HTMLTextAreaElement,
    placeholder: source.placeholder || "",
    label:
      source.getAttribute("aria-label")?.trim() ||
      source.placeholder ||
      source.name ||
      "텍스트 입력",
    inputType: source instanceof HTMLInputElement ? source.type || "text" : "text",
    inputMode: source.inputMode || undefined,
    autoComplete: source.autocomplete || undefined,
    enterKeyHint: source.enterKeyHint || undefined,
    maxLength: source.maxLength > 0 ? source.maxLength : undefined,
    autoCapitalize: source.autocapitalize || undefined,
    autoCorrect: source.autocorrect || undefined,
    spellCheck: source.spellcheck
  };
}

export function NativeKeyboardInputManager() {
  const activeSourceRef = useRef<SourceElement | null>(null);

  useEffect(() => {
    if (!canUseNativeKeyboardInput()) {
      return;
    }

    const shell = document.querySelector(".app-shell");
    const dispatchSourceEvent = (name: string, source: SourceElement, value: string) => {
      window.dispatchEvent(
        new CustomEvent(name, {
          detail: {
            source,
            value
          }
        })
      );
    };

    const clearActiveSource = () => {
      const activeSource = activeSourceRef.current;
      if (!activeSource) {
        shell?.classList.remove("app-shell--keyboard-dock-active");
        return;
      }

      delete activeSource.dataset.nativeKeyboardSource;
      activeSourceRef.current = null;
      shell?.classList.remove("app-shell--keyboard-dock-active");
    };

    const handleFocusIn = (event: FocusEvent) => {
      if (!isEligibleSource(event.target)) {
        return;
      }

      const source = event.target;
      if (activeSourceRef.current === source) {
        void NativeKeyboardInput.syncValue({ value: source.value }).catch(() => {
          // ignore plugin sync edge cases
        });
        return;
      }

      const previousSource = activeSourceRef.current;
      if (previousSource && previousSource !== source) {
        delete previousSource.dataset.nativeKeyboardSource;
      }

      activeSourceRef.current = source;
      source.dataset.nativeKeyboardSource = "true";
      shell?.classList.add("app-shell--keyboard-dock-active");
      source.blur();

      void NativeKeyboardInput.show(toShowOptions(source)).catch(() => {
        clearActiveSource();
      });
    };

    document.addEventListener("focusin", handleFocusIn, true);

    const textChangePromise = NativeKeyboardInput.addListener("textChange", event => {
      const activeSource = activeSourceRef.current;
      if (!activeSource || !activeSource.isConnected) {
        return;
      }

      syncSourceValue(activeSource, String(event.value || ""));
    });

    const submitPromise = NativeKeyboardInput.addListener("submit", event => {
      const activeSource = activeSourceRef.current;
      if (!activeSource || !activeSource.isConnected) {
        clearActiveSource();
        return;
      }

      const nextValue = String(event.value || "");
      syncSourceValue(activeSource, nextValue);

      if (activeSource.dataset.nativeKeyboardSubmit === "custom") {
        dispatchSourceEvent(NATIVE_KEYBOARD_SUBMIT_EVENT, activeSource, nextValue);
        return;
      }

      submitSourceForm(activeSource);
    });

    const dismissPromise = NativeKeyboardInput.addListener("dismiss", event => {
      const activeSource = activeSourceRef.current;
      if (activeSource && activeSource.isConnected) {
        const nextValue = String(event.value || "");
        syncSourceValue(activeSource, nextValue);
        activeSource.dispatchEvent(new Event("change", { bubbles: true }));
        dispatchSourceEvent(NATIVE_KEYBOARD_DISMISS_EVENT, activeSource, nextValue);
      }
      clearActiveSource();
    });

    return () => {
      document.removeEventListener("focusin", handleFocusIn, true);
      void NativeKeyboardInput.hide().catch(() => {
        // ignore teardown edge cases
      });
      clearActiveSource();
      void textChangePromise.then(handle => handle.remove());
      void submitPromise.then(handle => handle.remove());
      void dismissPromise.then(handle => handle.remove());
    };
  }, []);

  return null;
}