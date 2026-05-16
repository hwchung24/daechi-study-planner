import React, { useCallback, useEffect, useRef, useState } from "react";
import { useModalReveal } from "../../lib/useModalReveal";
import type { ParentMdmSurfaceMode } from "./parentDeviceModeDisplay";
import { PARENT_MDM_SURFACE_LABEL } from "./parentDeviceModeDisplay";
import ko from "../fallbacks/ko.json";

const H = ko.parentHomeTab;
const ME = ko.parentModeExplain;

const PROFILE_CACHE_MS = 5 * 60_000;

type ProfileCache = {
  at: number;
  names: string[];
  skippedReason?: string | null;
};

export function ParentModeDetailSheet(props: {
  open: boolean;
  onClose: () => void;
  apiBase: string;
  authToken: string | null;
  studentId: number | null;
  displaySurfaceMode: ParentMdmSurfaceMode | null;
  onActivateMode: (mode: "utility" | "free" | "default") => void;
  modeToggling?: boolean;
}) {
  const reveal = useModalReveal(props.open);
  const cacheRef = useRef<Map<number, ProfileCache>>(new Map());
  const [profiles, setProfiles] = useState<string[]>([]);
  const [profilesLoading, setProfilesLoading] = useState(false);
  const [skippedReason, setSkippedReason] = useState<string | null>(null);

  const loadProfiles = useCallback(async () => {
    if (!props.open || !props.authToken || !props.studentId) return;
    const cached = cacheRef.current.get(props.studentId);
    if (cached && Date.now() - cached.at < PROFILE_CACHE_MS) {
      setProfiles(cached.names);
      setSkippedReason(cached.skippedReason || null);
      return;
    }
    setProfilesLoading(true);
    try {
      const res = await fetch(
        `${props.apiBase}/api/parent/students/${encodeURIComponent(String(props.studentId))}/simplemdm-device-profiles`,
        { headers: { Authorization: `Bearer ${props.authToken}` }, cache: "no-store" }
      );
      const data = (await res.json().catch(() => ({}))) as {
        ok?: boolean;
        skipped?: boolean;
        skippedReason?: string;
        profilesDirectOnDevice?: Array<{ name?: string }>;
        profilesOnAssignmentGroup?: Array<{ name?: string }>;
      };
      if (data.skipped) {
        setSkippedReason(
          String(data.skippedReason || data.reason || "simplemdm_not_configured")
        );
        setProfiles([]);
        cacheRef.current.set(props.studentId, {
          at: Date.now(),
          names: [],
          skippedReason: data.skippedReason
        });
        return;
      }
      const names = [
        ...(data.profilesOnAssignmentGroup || []),
        ...(data.profilesDirectOnDevice || [])
      ]
        .map(p => String(p.name || "").trim())
        .filter(Boolean);
      const unique = [...new Set(names)];
      setProfiles(unique);
      setSkippedReason(null);
      cacheRef.current.set(props.studentId, { at: Date.now(), names: unique });
    } catch {
      setProfiles([]);
    } finally {
      setProfilesLoading(false);
    }
  }, [props.apiBase, props.authToken, props.open, props.studentId]);

  useEffect(() => {
    if (props.open) void loadProfiles();
  }, [props.open, loadProfiles]);

  if (!props.open) return null;

  const surface = props.displaySurfaceMode || "default";
  const explain = ME[surface as keyof typeof ME] || ME.default;

  return (
    <div
      className={"dday-modal" + (reveal.revealed ? " dday-modal--open" : "")}
      role="presentation"
      onClick={() => reveal.beginClose(props.onClose)}
    >
      <div
        className="dday-modal-inner parent-mode-detail-sheet"
        role="dialog"
        aria-modal="true"
        aria-labelledby="parent-mode-detail-title"
        onClick={e => e.stopPropagation()}
      >
        <div className="dday-modal-header">
          <h2 id="parent-mode-detail-title" className="dday-modal-title">
            {H.modeDetailSheetTitle}
          </h2>
        </div>
        <div className="dday-modal-body">
          <p className="parent-type-kpi">
            {PARENT_MDM_SURFACE_LABEL[surface]} · {explain}
          </p>
          {profilesLoading ? (
            <p className="parent-type-caption">{H.modeDetailProfilesLoading}</p>
          ) : skippedReason === "simplemdm_not_configured" ? (
            <p className="parent-type-caption">{H.modeDetailSkippedNotConfigured}</p>
          ) : profiles.length > 0 ? (
            <div className="parent-mode-detail-sheet__pills" role="list">
              {profiles.map(name => (
                <span key={name} className="coach-pill parent-mode-detail-sheet__pill" role="listitem">
                  <span className="coach-pill__value">{name}</span>
                </span>
              ))}
            </div>
          ) : (
            <p className="parent-type-caption">{H.modeDetailProfilesEmpty}</p>
          )}
          <div className="parent-mode-detail-sheet__actions">
            {(["utility", "free", "default"] as const).map(mode => (
              <button
                key={mode}
                type="button"
                className="coach-ghost-btn"
                disabled={props.modeToggling || surface === mode}
                onClick={() => props.onActivateMode(mode)}
              >
                {PARENT_MDM_SURFACE_LABEL[mode]}
              </button>
            ))}
          </div>
        </div>
        <div className="dday-modal-footer">
          <button
            type="button"
            className="timeline-save-button study-room-editor__save-button"
            onClick={() => reveal.beginClose(props.onClose)}
          >
            {H.netModalClose}
          </button>
        </div>
      </div>
    </div>
  );
}
