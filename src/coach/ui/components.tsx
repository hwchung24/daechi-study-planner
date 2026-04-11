import React from "react";
import type { Severity } from "../types";

export function SectionHeader(props: {
  title: string;
  subtitle?: string;
  right?: React.ReactNode;
}) {
  return (
    <div className="coach-section-header">
      <div className="coach-section-header__left">
        <h2 className="coach-section-title">{props.title}</h2>
        {props.subtitle && (
          <p className="coach-section-subtitle">{props.subtitle}</p>
        )}
      </div>
      {props.right && <div className="coach-section-header__right">{props.right}</div>}
    </div>
  );
}

export function RiskBadge({ level }: { level: Severity }) {
  const cls =
    level === "높음"
      ? "coach-badge coach-badge--danger"
      : level === "보통"
        ? "coach-badge coach-badge--warn"
        : "coach-badge coach-badge--ok";
  return <span className={cls}>{level}</span>;
}

export function StatPill({ label, value }: { label: string; value: string }) {
  return (
    <div className="coach-pill">
      <span className="coach-pill__label">{label}</span>
      <span className="coach-pill__value">{value}</span>
    </div>
  );
}

export function Card(props: {
  className?: string;
  children: React.ReactNode;
  onClick?: () => void;
  role?: React.AriaRole;
  style?: React.CSSProperties;
}) {
  return (
    <div
      className={"coach-card" + (props.className ? ` ${props.className}` : "")}
      onClick={props.onClick}
      role={props.role}
      style={props.style}
    >
      {props.children}
    </div>
  );
}

export function GradientHeroCard(props: {
  eyebrow: string;
  title: string;
  body: string;
  ctaLabel?: string;
  onCta?: () => void;
  badge?: React.ReactNode;
  showHeader?: boolean;
}) {
  const showHeader = props.showHeader !== false;
  return (
    <div className="coach-hero">
      <div className="coach-hero__bg" aria-hidden />
      <div className="coach-hero__content">
        {showHeader && (
          <div className="coach-hero__top">
            <span className="coach-hero__eyebrow">{props.eyebrow}</span>
            {props.badge}
          </div>
        )}
        <div className="coach-hero__title">{props.title}</div>
        <div className="coach-hero__body">{props.body}</div>
        {props.ctaLabel && props.onCta && (
          <button type="button" className="coach-primary-btn" onClick={props.onCta}>
            {props.ctaLabel}
          </button>
        )}
      </div>
    </div>
  );
}

export function MetricCard(props: {
  title: string;
  value: string;
  hint?: string;
  tone?: "neutral" | "good" | "warn";
  icon?: React.ReactNode;
}) {
  const toneCls =
    props.tone === "good"
      ? "coach-metric coach-metric--good"
      : props.tone === "warn"
        ? "coach-metric coach-metric--warn"
        : "coach-metric";
  return (
    <div className={toneCls}>
      <div className="coach-metric__title-row">
        {props.icon ? <span className="coach-metric__icon">{props.icon}</span> : null}
        <div className="coach-metric__title">{props.title}</div>
      </div>
      <div className="coach-metric__value">{props.value}</div>
      {props.hint && <div className="coach-metric__hint">{props.hint}</div>}
    </div>
  );
}

export function EmptyState(props: { title: string; body?: string; action?: React.ReactNode }) {
  return (
    <Card className="coach-empty">
      <div className="coach-empty__title">{props.title}</div>
      {props.body && <div className="coach-empty__body">{props.body}</div>}
      {props.action && <div className="coach-empty__action">{props.action}</div>}
    </Card>
  );
}

