import React from "react";
import ko from "../fallbacks/ko.json";

const H = ko.parentHomeTab;

export type ParentHomeKpiChip = {
  id: string;
  label: string;
  tone: "ok" | "warn" | "neutral";
  onClick?: () => void;
};

export function ParentHomeKpiStrip(props: {
  chips: ParentHomeKpiChip[];
  loading?: boolean;
}) {
  if (props.loading) {
    return (
      <div className="parent-home__kpi-strip" aria-busy="true" aria-label={H.loadingNetStatus}>
        <div className="parent-skeleton parent-skeleton--phrase-short" aria-hidden />
      </div>
    );
  }
  if (props.chips.length === 0) return null;

  return (
    <div className="parent-home__kpi-strip" role="list" aria-label={H.kpiStripAria}>
      {props.chips.map(chip => (
        <button
          key={chip.id}
          type="button"
          role="listitem"
          className={
            "parent-home__kpi-chip" +
            (chip.tone === "ok"
              ? " parent-home__kpi-chip--ok"
              : chip.tone === "warn"
                ? " parent-home__kpi-chip--warn"
                : " parent-home__kpi-chip--neutral")
          }
          onClick={chip.onClick}
          disabled={!chip.onClick}
        >
          {chip.label}
        </button>
      ))}
    </div>
  );
}
