import { Capacitor } from "@capacitor/core";
import {
  Haptics,
  ImpactStyle,
  NotificationType
} from "@capacitor/haptics";

/** iOS/Android 네이티브(Capacitor)에서만 동작. 순수 웹 브라우저에서는 무시. */

const lastTriggeredAt = new Map<string, number>();

function canUse(): boolean {
  return Capacitor.isNativePlatform();
}

function canTrigger(kind: string, cooldownMs: number): boolean {
  const now = Date.now();
  const prev = lastTriggeredAt.get(kind) ?? 0;
  if (now - prev < cooldownMs) return false;
  lastTriggeredAt.set(kind, now);
  return true;
}

export function hapticImpactLight(): void {
  if (!canUse() || !canTrigger("impact-light", 90)) return;
  void Haptics.impact({ style: ImpactStyle.Light }).catch(() => {});
}

export function hapticImpactMedium(): void {
  if (!canUse() || !canTrigger("impact-medium", 140)) return;
  void Haptics.impact({ style: ImpactStyle.Medium }).catch(() => {});
}

/** 탭 전환·세그먼트 등 선택 느낌 */
export function hapticSelection(): void {
  if (!canUse() || !canTrigger("selection", 70)) return;
  void Haptics.selectionChanged().catch(() => {});
}

export function hapticSuccess(): void {
  if (!canUse() || !canTrigger("success", 260)) return;
  void Haptics.notification({ type: NotificationType.Success }).catch(
    () => {}
  );
}

export function hapticWarning(): void {
  if (!canUse() || !canTrigger("warning", 260)) return;
  void Haptics.notification({ type: NotificationType.Warning }).catch(
    () => {}
  );
}
