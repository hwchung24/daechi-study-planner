import { Capacitor } from "@capacitor/core";
import {
  Haptics,
  ImpactStyle,
  NotificationType
} from "@capacitor/haptics";

/** iOS/Android 네이티브(Capacitor)에서만 동작. 순수 웹 브라우저에서는 무시. */

function canUse(): boolean {
  return Capacitor.isNativePlatform();
}

export function hapticImpactLight(): void {
  if (!canUse()) return;
  void Haptics.impact({ style: ImpactStyle.Light }).catch(() => {});
}

export function hapticImpactMedium(): void {
  if (!canUse()) return;
  void Haptics.impact({ style: ImpactStyle.Medium }).catch(() => {});
}

/** 탭 전환·세그먼트 등 선택 느낌 */
export function hapticSelection(): void {
  if (!canUse()) return;
  void Haptics.selectionChanged().catch(() => {});
}

export function hapticSuccess(): void {
  if (!canUse()) return;
  void Haptics.notification({ type: NotificationType.Success }).catch(
    () => {}
  );
}

export function hapticWarning(): void {
  if (!canUse()) return;
  void Haptics.notification({ type: NotificationType.Warning }).catch(
    () => {}
  );
}
