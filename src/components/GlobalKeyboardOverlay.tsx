import React, { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Capacitor } from "@capacitor/core";

type SourceElement = HTMLInputElement | HTMLTextAreaElement;

type OverlayState = {
  source: SourceElement;
  multiline: boolean;
  value: string;
  inputType: string;
  placeholder: string;
  label: string;
  inputMode?: React.HTMLAttributes<HTMLInputElement>["inputMode"];
  autoComplete?: string;
  enterKeyHint?: React.HTMLAttributes<HTMLInputElement>["enterKeyHint"];
  maxLength?: number;
  autoCapitalize?: string;
  autoCorrect?: string;
  spellCheck: boolean;
};

const IS_NATIVE_PLATFORM = Capacitor.isNativePlatform();

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

function getLabelText(source: SourceElement) {
  const ariaLabel = source.getAttribute("aria-label")?.trim();
  if (ariaLabel) return ariaLabel;

  const labelledBy = source.getAttribute("aria-labelledby")?.trim();
  if (labelledBy) {
    const text = labelledBy
      .split(/\s+/)
      .map(id => document.getElementById(id)?.textContent?.trim() || "")
      .filter(Boolean)
      .join(" ");
    if (text) return text;
  }

  const sourceId = source.id?.trim();
  if (sourceId) {
    try {
      const label = document.querySelector(`label[for="${CSS.escape(sourceId)}"]`);
      const text = label?.textContent?.trim();
      if (text) return text;
    } catch {
      // ignore CSS.escape edge cases
    }
  }

  return source.getAttribute("placeholder")?.trim() || source.name || "텍스트 입력";
}

function isEligibleSource(node: EventTarget | null): node is SourceElement {
  if (!IS_NATIVE_PLATFORM) {
    return false;
  }

  if (!(node instanceof HTMLInputElement || node instanceof HTMLTextAreaElement)) {
    return false;
  }

  if (node.disabled || node.readOnly) {
    return false;
  }

  if (node.dataset.keyboardOverlay === "off") {
    return false;
  }

  if (
    node.closest(
      ".coach-chat-bottom-rail, .coach-chat-composer, [data-keyboard-overlay='off']"
    )
  ) {
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

export function GlobalKeyboardOverlay() {
  const [overlay, setOverlay] = useState<OverlayState | null>(null);
  const containerRef = useRef<HTMLDivElement | null>(null);
  const inputRef = useRef<HTMLInputElement | HTMLTextAreaElement | null>(null);
  const activeSource = overlay?.source ?? null;

  useEffect(() => {
    if (!IS_NATIVE_PLATFORM) {
      return;
    }

    const handleFocusIn = (event: FocusEvent) => {
      if (containerRef.current?.contains(event.target as Node)) {
        return;
      }

      if (!isEligibleSource(event.target)) {
        return;
      }

      const source = event.target;
      setOverlay({
        source,
        multiline: source instanceof HTMLTextAreaElement,
        value: source.value,
        inputType: source instanceof HTMLInputElement ? source.type || "text" : "text",
        placeholder: source.placeholder || "",
        label: getLabelText(source),
        inputMode: source.inputMode || undefined,
        autoComplete: source.autocomplete || undefined,
        enterKeyHint: source.enterKeyHint || undefined,
        maxLength: source.maxLength > 0 ? source.maxLength : undefined,
        autoCapitalize: source.autocapitalize || undefined,
        autoCorrect: source.autocorrect || undefined,
        spellCheck: source.spellcheck
      });
    };

    document.addEventListener("focusin", handleFocusIn, true);
    return () => {
      document.removeEventListener("focusin", handleFocusIn, true);
    };
  }, []);

  useEffect(() => {
    if (!activeSource) {
      return;
    }

    const source = activeSource;
    source.dataset.keyboardOverlaySource = "true";

    const shell = document.querySelector(".app-shell");
    shell?.classList.add("app-shell--keyboard-dock-active");
    document.body.classList.add("global-keyboard-overlay-open");

    const syncFromSource = () => {
      setOverlay(current => {
        if (!current || current.source !== source) {
          return current;
        }

        return {
          ...current,
          value: source.value
        };
      });
    };

    source.addEventListener("input", syncFromSource);
    source.addEventListener("change", syncFromSource);

    const focusOverlay = window.requestAnimationFrame(() => {
      const input = inputRef.current;
      if (!input) {
        return;
      }

      input.focus({ preventScroll: true });
      const valueLength = input.value.length;
      input.setSelectionRange?.(valueLength, valueLength);
    });

    return () => {
      window.cancelAnimationFrame(focusOverlay);
      source.removeEventListener("input", syncFromSource);
      source.removeEventListener("change", syncFromSource);
      delete source.dataset.keyboardOverlaySource;
      shell?.classList.remove("app-shell--keyboard-dock-active");
      document.body.classList.remove("global-keyboard-overlay-open");
    };
  }, [activeSource]);

  if (!overlay || typeof document === "undefined") {
    return null;
  }

  const closeOverlay = () => {
    setOverlay(current => {
      if (!current) {
        return current;
      }

      current.source.blur();
      return null;
    });
  };

  const handleBlur = () => {
    window.setTimeout(() => {
      const activeElement = document.activeElement;
      if (containerRef.current?.contains(activeElement)) {
        return;
      }
      closeOverlay();
    }, 0);
  };

  const sharedProps = {
    ref: inputRef,
    className: "global-keyboard-overlay__input",
    value: overlay.value,
    placeholder: overlay.placeholder,
    inputMode: overlay.inputMode,
    autoComplete: overlay.autoComplete,
    enterKeyHint: overlay.enterKeyHint,
    maxLength: overlay.maxLength,
    autoCapitalize: overlay.autoCapitalize,
    autoCorrect: overlay.autoCorrect,
    spellCheck: overlay.spellCheck,
    "aria-label": overlay.label,
    onBlur: handleBlur,
    onChange: (
      event: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>
    ) => {
      const nextValue = event.target.value;
      setOverlay(current => (current ? { ...current, value: nextValue } : current));
      syncSourceValue(overlay.source, nextValue);
    },
    onKeyDown: (
      event: React.KeyboardEvent<HTMLInputElement | HTMLTextAreaElement>
    ) => {
      if (overlay.multiline || event.key !== "Enter" || event.nativeEvent.isComposing) {
        return;
      }

      event.preventDefault();
      submitSourceForm(overlay.source);
      closeOverlay();
    }
  };

  return createPortal(
    <div ref={containerRef} className="global-keyboard-overlay" aria-hidden={false}>
      <button
        type="button"
        className="global-keyboard-overlay__backdrop"
        onMouseDown={event => event.preventDefault()}
        onClick={closeOverlay}
        aria-label="입력 닫기"
      />
      <div className="global-keyboard-overlay__dock" onMouseDown={event => event.stopPropagation()}>
        {overlay.multiline ? (
          <textarea {...sharedProps} rows={4} />
        ) : (
          <input {...sharedProps} type={overlay.inputType || "text"} />
        )}
      </div>
    </div>,
    document.body
  );
}