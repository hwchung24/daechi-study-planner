import { tpl } from "../coach/fallbacks/tpl";
import ko from "../coach/fallbacks/ko.json";

const growthFb = ko.gptOutputFallbacks.parentGrowthReport;

/** 집중 구간(◎·○)이 학습 대비 이 비율 미만이면 '실제 저효율'로 표시 */
export const FOCUS_EFFICIENCY_LOW_THRESHOLD_PCT = 35;

export type FocusEfficiencyKind = "insufficient" | "low" | "normal";

export type FocusEfficiencyStudyInput = {
  focusEfficiencyPct: number | null;
  actualStudyHours: number;
  focusBandHours: number;
};

export type FocusEfficiencyDisplay = {
  kind: FocusEfficiencyKind;
  /** KPI·도넛 중앙 라벨 */
  headline: string;
  /** 도넛 채움(0~100). 데이터 부족이면 null */
  donutPct: number | null;
  /** 도넛 아래 보조 문구 */
  context: string | null;
  /** 전주 대비 델타 표시 여부 */
  showVsPrevDelta: boolean;
};

/**
 * 집중 효율을 '데이터 부족' / '실제 저효율' / '정상'으로 분기합니다.
 * 0%는 집중 구간(◎·○) 미기록일 때 데이터 부족으로 처리합니다.
 */
export function resolveFocusEfficiencyDisplay(
  study: FocusEfficiencyStudyInput | null | undefined
): FocusEfficiencyDisplay | null {
  if (!study) return null;

  const pct = study.focusEfficiencyPct;
  const studyH = study.actualStudyHours;
  const focusH = study.focusBandHours;
  const hasFocusMarks = focusH > 0;
  const hasStudyRecord = studyH > 0;

  if (!hasStudyRecord && !hasFocusMarks && pct == null) {
    return {
      kind: "insufficient",
      headline: growthFb.focusEfficiencyInsufficientLabel,
      donutPct: null,
      context: growthFb.focusNoStudyYet,
      showVsPrevDelta: false
    };
  }

  if (!hasFocusMarks && (pct == null || pct <= 0)) {
    return {
      kind: "insufficient",
      headline: growthFb.focusEfficiencyInsufficientLabel,
      donutPct: null,
      context: hasStudyRecord
        ? tpl(growthFb.focusZeroWithStudyTpl, { hours: studyH.toFixed(1) })
        : growthFb.focusNoStudyYet,
      showVsPrevDelta: false
    };
  }

  if (pct != null && hasFocusMarks && pct < FOCUS_EFFICIENCY_LOW_THRESHOLD_PCT) {
    const rounded = Math.round(pct);
    return {
      kind: "low",
      headline: `${rounded}%`,
      donutPct: pct,
      context: tpl(growthFb.focusEfficiencyLowContextTpl, { pct: String(rounded) }),
      showVsPrevDelta: true
    };
  }

  if (pct != null && hasFocusMarks) {
    return {
      kind: "normal",
      headline: `${Math.round(pct)}%`,
      donutPct: pct,
      context: null,
      showVsPrevDelta: true
    };
  }

  return {
    kind: "insufficient",
    headline: growthFb.focusEfficiencyInsufficientLabel,
    donutPct: null,
    context: growthFb.focusEfficiencyInsufficientGeneric,
    showVsPrevDelta: false
  };
}
