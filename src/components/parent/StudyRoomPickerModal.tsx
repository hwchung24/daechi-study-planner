import React, { forwardRef, useEffect, useImperativeHandle, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { MODAL_TRANSITION_MS } from "../../lib/uiTiming";
import L from "leaflet";
import "leaflet/dist/leaflet.css";
import { API_BASE } from "../../lib/apiBase";
import type { ParentStudyRoomSetting } from "../../types/parent";
import ko from "../../coach/fallbacks/ko.json";

export type StudyRoomSetting = ParentStudyRoomSetting;

const H = ko.parentHomeTab;

type SearchResult = {
  id: string;
  name: string;
  address: string;
  latitude: number;
  longitude: number;
};

type LatLng = {
  lat: number;
  lng: number;
};

const DEFAULT_CENTER: LatLng = { lat: 37.5665, lng: 126.978 };
const DEFAULT_ZOOM = 15;
const MIN_ZOOM = 12;
const MAX_ZOOM = 19;

const selectedMarkerIcon = L.divIcon({
  className: "study-room-leaflet-marker-wrap",
  html: '<span class="study-room-leaflet-marker"></span>',
  iconSize: [22, 22],
  iconAnchor: [11, 22]
});

export type StudyRoomPickerEditorHandle = {
  save: () => void;
  canSave: boolean;
};

export const StudyRoomPickerEditor = forwardRef<
  StudyRoomPickerEditorHandle,
  {
    student: { id: number; email: string } | null;
    initialValue?: StudyRoomSetting;
    authToken?: string | null;
    saving?: boolean;
    variant?: "default" | "sheet";
    hideFooter?: boolean;
    onCancel?: () => void;
    onSave: (value: StudyRoomSetting) => void;
    onCanSaveChange?: (canSave: boolean) => void;
  }
>(function StudyRoomPickerEditor(props, ref) {
  const {
    student,
    initialValue,
    authToken = null,
    saving = false,
    variant = "default",
    hideFooter = false,
    onCancel,
    onSave,
    onCanSaveChange
  } = props;

  const mapHostRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<L.Map | null>(null);
  const markerRef = useRef<L.Marker | null>(null);
  const [studyRoomName, setStudyRoomName] = useState("");
  const [studyRoomAddress, setStudyRoomAddress] = useState("");
  const [searchQuery, setSearchQuery] = useState("");
  const [searchResults, setSearchResults] = useState<SearchResult[]>([]);
  const [searching, setSearching] = useState(false);
  const [searchError, setSearchError] = useState("");
  const [selected, setSelected] = useState<LatLng | null>(null);
  const [radiusMeters, setRadiusMeters] = useState(120);
  const [mapZoom, setMapZoom] = useState(DEFAULT_ZOOM);

  const buildSaveValue = (): StudyRoomSetting | null => {
    if (!student || !selected || !studyRoomName.trim()) return null;
    return {
      studentId: student.id,
      studentEmail: student.email,
      name: studyRoomName.trim(),
      address: studyRoomAddress.trim() || undefined,
      latitude: selected.lat,
      longitude: selected.lng,
      radiusMeters,
      updatedAt: new Date().toISOString()
    };
  };

  const canSave = Boolean(student && selected && studyRoomName.trim() && !saving);

  useEffect(() => {
    onCanSaveChange?.(canSave);
  }, [canSave, onCanSaveChange]);

  useImperativeHandle(ref, () => ({
    save: () => {
      const value = buildSaveValue();
      if (value) onSave(value);
    },
    canSave
  }));

  useEffect(() => {
    if (!student) return;
    const nextSelected =
      initialValue && Number.isFinite(initialValue.latitude) && Number.isFinite(initialValue.longitude)
        ? { lat: initialValue.latitude, lng: initialValue.longitude }
        : null;
    setStudyRoomName(initialValue?.name || "");
    setStudyRoomAddress(initialValue?.address || "");
    setSearchQuery(initialValue?.name || "");
    setSearchResults([]);
    setSearchError("");
    setSelected(nextSelected);
    setRadiusMeters(Math.min(1000, Math.max(30, Number(initialValue?.radiusMeters) || 120)));
    setMapZoom(DEFAULT_ZOOM);
  }, [initialValue, student?.id]);

  useEffect(() => {
    if (!student || !mapHostRef.current || mapRef.current) return;
    const initialCenter = selected || DEFAULT_CENTER;
    const map = L.map(mapHostRef.current, {
      center: [initialCenter.lat, initialCenter.lng],
      zoom: DEFAULT_ZOOM,
      zoomControl: false,
      attributionControl: false,
      minZoom: MIN_ZOOM,
      maxZoom: MAX_ZOOM
    });
    L.tileLayer("https://{s}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}{r}.png", {
      subdomains: "abcd",
      minZoom: MIN_ZOOM,
      maxZoom: MAX_ZOOM
    }).addTo(map);
    map.on("click", event => {
      setSelected({ lat: event.latlng.lat, lng: event.latlng.lng });
    });
    map.on("zoomend", () => setMapZoom(map.getZoom()));
    mapRef.current = map;
    setMapZoom(map.getZoom());
    requestAnimationFrame(() => map.invalidateSize());
    return () => {
      markerRef.current?.remove();
      markerRef.current = null;
      map.remove();
      mapRef.current = null;
    };
  }, [student, selected]);

  useEffect(() => {
    if (!student || !mapRef.current) return;
    const map = mapRef.current;
    const center = selected || DEFAULT_CENTER;
    map.setView([center.lat, center.lng], initialValue ? DEFAULT_ZOOM : map.getZoom(), {
      animate: false
    });
    requestAnimationFrame(() => map.invalidateSize());
  }, [student, initialValue?.latitude, initialValue?.longitude]);

  useEffect(() => {
    if (!mapRef.current) return;
    const map = mapRef.current;
    if (!selected) {
      markerRef.current?.remove();
      markerRef.current = null;
      return;
    }
    if (!markerRef.current) {
      markerRef.current = L.marker([selected.lat, selected.lng], {
        icon: selectedMarkerIcon,
        keyboard: false
      }).addTo(map);
    } else {
      markerRef.current.setLatLng([selected.lat, selected.lng]);
    }
  }, [selected]);

  useEffect(() => {
    if (!selected) return;
    let cancelled = false;
    const resolveAddress = async () => {
      try {
        const res = await fetch(
          `https://nominatim.openstreetmap.org/reverse?format=jsonv2&accept-language=ko&lat=${encodeURIComponent(String(selected.lat))}&lon=${encodeURIComponent(String(selected.lng))}`,
          {
            headers: {
              Accept: "application/json"
            }
          }
        );
        if (!res.ok || cancelled) return;
        const data = (await res.json()) as { display_name?: string; name?: string };
        const resolvedAddress = String(data.display_name || "").trim();
        const resolvedName = String(data.name || "").trim();
        if (!cancelled && resolvedAddress) setStudyRoomAddress(resolvedAddress);
        if (!cancelled && !studyRoomName.trim() && resolvedName) {
          setStudyRoomName(resolvedName);
        }
      } catch {
        // ignore reverse-geocoding failures
      }
    };
    void resolveAddress();
    return () => {
      cancelled = true;
    };
  }, [selected, studyRoomName]);

  const runSearch = async () => {
    const raw = searchQuery.trim();
    if (!raw) {
      setSearchError(H.studyRoomQuickSearchRequired);
      setSearchResults([]);
      return;
    }
    setSearching(true);
    setSearchError("");
    try {
      if (!authToken) {
        throw new Error(H.studyRoomQuickSearchNoAuth);
      }
      const res = await fetch(
        `${API_BASE}/api/location/naver/local-search?query=${encodeURIComponent(raw)}&limit=5`,
        {
          headers: {
            Accept: "application/json",
            Authorization: `Bearer ${authToken}`
          }
        }
      );
      if (!res.ok) {
        const errorPayload = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(String(errorPayload.error || H.studyRoomQuickSearchFailed));
      }
      const data = (await res.json()) as {
        results?: Array<{
          id?: string;
          name?: string;
          address?: string;
          latitude?: number;
          longitude?: number;
        }>;
      };
      const nextResults = (Array.isArray(data.results) ? data.results : [])
        .map(row => {
          const latitude = Number(row.latitude);
          const longitude = Number(row.longitude);
          if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) return null;
          return {
            id: String(row.id || `${latitude},${longitude}`),
            name: String(row.name || "").trim() || H.studyRoomQuickSearchFallbackName,
            address: String(row.address || "").trim(),
            latitude,
            longitude
          };
        })
        .filter((row): row is SearchResult => Boolean(row));
      setSearchResults(nextResults);
      if (nextResults.length === 0) {
        setSearchError(H.studyRoomQuickSearchEmpty);
      }
    } catch (error) {
      setSearchResults([]);
      setSearchError(
        error instanceof Error && error.message ? error.message : H.studyRoomQuickSearchError
      );
    } finally {
      setSearching(false);
    }
  };

  const moveToResult = (result: SearchResult) => {
    const next = { lat: result.latitude, lng: result.longitude };
    setStudyRoomName(result.name);
    setStudyRoomAddress(result.address);
    setSelected(next);
    mapRef.current?.flyTo([result.latitude, result.longitude], Math.max(mapZoom, 17), {
      duration: 0.8
    });
  };

  const focusSelected = () => {
    if (!selected) return;
    mapRef.current?.flyTo([selected.lat, selected.lng], Math.max(mapZoom, 17), {
      duration: 0.8
    });
  };

  const radiusFillWidth = `${((radiusMeters - 30) / (500 - 30)) * 100}%`;

  if (!student) return null;

  const searchBlock = (
    <>
      <div className="study-room-modal__search-row">
        <input
          className="field-input"
          value={searchQuery}
          onChange={event => setSearchQuery(event.target.value)}
          placeholder={H.studyRoomQuickSearchPlaceholder}
          disabled={saving}
          onKeyDown={event => {
            if (event.key === "Enter") {
              event.preventDefault();
              void runSearch();
            }
          }}
        />
        <button
          type="button"
          className="study-room-modal__search-btn"
          onClick={() => void runSearch()}
          disabled={searching || saving}
        >
          {searching ? H.studyRoomQuickSearching : H.studyRoomQuickSearchAction}
        </button>
      </div>
      {searchError ? <p className="study-room-modal__status">{searchError}</p> : null}
      {searchResults.length > 0 ? (
        <div className="study-room-modal__results">
          {searchResults.map(result => (
            <button
              key={result.id}
              type="button"
              className="study-room-modal__result"
              disabled={saving}
              onClick={() => moveToResult(result)}
            >
              <span className="study-room-modal__result-name">{result.name}</span>
              <span className="study-room-modal__result-address">{result.address}</span>
            </button>
          ))}
        </div>
      ) : null}
    </>
  );

  const mapBlock = (
    <div className="study-room-map study-room-sheet__map">
      <div className="study-room-map__frame">
        <div ref={mapHostRef} className="study-room-map__surface study-room-sheet__map-surface" />
        <div className="study-room-map__overlay">
          <button
            type="button"
            className="study-room-map__focus-btn"
            onClick={focusSelected}
            disabled={!selected || saving}
          >
            {H.studyRoomQuickFocusMap}
          </button>
        </div>
      </div>
    </div>
  );

  const fieldsBlock = (
    <div className="study-room-modal__field-grid study-room-sheet__field-grid">
      <div className="field">
        <label className="field-label">{H.studyRoomQuickNameLabel}</label>
        <input
          className="field-input"
          value={studyRoomName}
          onChange={event => setStudyRoomName(event.target.value)}
          disabled={saving}
          placeholder={H.studyRoomQuickNamePlaceholder}
        />
      </div>
      <div className="field">
        <label className="field-label">{H.studyRoomQuickAddressLabel}</label>
        <input
          className="field-input"
          value={studyRoomAddress}
          onChange={event => setStudyRoomAddress(event.target.value)}
          disabled={saving}
          placeholder={H.studyRoomQuickAddressPlaceholder}
        />
      </div>
      <div className="field study-room-modal__field--radius">
        <label className="field-label">{H.studyRoomQuickRadiusLabel}</label>
        <div className="record-slider-row study-room-modal__radius-row">
          <div className="record-slider-pill">
            <div className="record-slider-pill__fill" style={{ width: radiusFillWidth }} />
            <input
              className="record-slider-pill__input"
              type="range"
              min={30}
              max={500}
              step={10}
              value={radiusMeters}
              onChange={event => setRadiusMeters(Number(event.target.value) || 120)}
              disabled={saving}
              aria-valuetext={`${radiusMeters}m`}
            />
          </div>
          <span className="record-slider-value study-room-modal__radius-value">{radiusMeters}m</span>
        </div>
      </div>
    </div>
  );

  const footerBlock =
    hideFooter || !onCancel ? null : (
      <div
        className={
          "study-room-editor__footer" + (!onCancel ? " study-room-editor__footer--single" : "")
        }
      >
        {onCancel ? (
          <button type="button" className="modal-secondary" onClick={onCancel} disabled={saving}>
            {H.cancel}
          </button>
        ) : null}
        <button
          type="button"
          className={
            (onCancel ? "modal-primary" : "timeline-save-button") + " study-room-editor__save-button"
          }
          onClick={() => {
            const value = buildSaveValue();
            if (value) onSave(value);
          }}
          disabled={!canSave}
        >
          {saving ? H.studyRoomQuickSaving : H.studyRoomQuickSave}
        </button>
      </div>
    );

  if (variant === "sheet") {
    return (
      <div className="parent-mode-quick-sheet parent-study-room-quick-sheet">
        <section
          className="parent-mode-quick-sheet__section parent-mode-quick-sheet__section--now"
          aria-label={H.modeQuickStudyRoomFindSection}
        >
          <h3 className="parent-mode-quick-sheet__section-title">{H.modeQuickStudyRoomFindSection}</h3>
          <p className="parent-mode-quick-sheet__section-hint">{H.studyRoomQuickFindHint}</p>
          <div className="parent-mode-quick-sheet__schedule-panel study-room-sheet__location-panel">
            {searchBlock}
            {mapBlock}
          </div>
        </section>
        <section
          className="parent-mode-quick-sheet__section parent-mode-quick-sheet__section--schedule"
          aria-label={H.modeQuickStudyRoomDetailSection}
        >
          <h3 className="parent-mode-quick-sheet__section-title">{H.modeQuickStudyRoomDetailSection}</h3>
          <p className="parent-mode-quick-sheet__section-hint">{H.studyRoomQuickDetailHint}</p>
          <div className="parent-mode-quick-sheet__schedule-panel">{fieldsBlock}</div>
        </section>
        {footerBlock}
      </div>
    );
  }

  return (
    <div className="study-room-editor">
      {searchBlock}
      {mapBlock}
      {fieldsBlock}
      {footerBlock}
    </div>
  );
});

const STUDY_ROOM_SHEET_META = {
  eyebrow: H.settingsListLocation,
  subtitle: H.studyRoomQuickSubtitle,
  title: H.studyRoomQuickTitle
};

export function StudyRoomPickerModal(props: {
  open: boolean;
  /** @deprecated 열림 애니메이션은 내부 처리 — 전달해도 무시 */
  revealed?: boolean;
  student: { id: number; email: string } | null;
  initialValue?: StudyRoomSetting;
  authToken?: string | null;
  saving?: boolean;
  onClose: () => void;
  onSave: (value: StudyRoomSetting) => void;
}) {
  const { open, student, initialValue, authToken = null, saving, onClose, onSave } = props;
  const show = Boolean(open && student);
  const [isRendered, setIsRendered] = useState(show);
  const [isAnimOpen, setIsAnimOpen] = useState(false);
  const editorRef = useRef<StudyRoomPickerEditorHandle>(null);
  const [canSave, setCanSave] = useState(false);

  useEffect(() => {
    if (show) {
      setIsRendered(true);
    }
  }, [show]);

  useEffect(() => {
    if (!isRendered) return;
    if (show) {
      const id = requestAnimationFrame(() => {
        requestAnimationFrame(() => setIsAnimOpen(true));
      });
      return () => cancelAnimationFrame(id);
    }
    setIsAnimOpen(false);
  }, [show, isRendered]);

  useEffect(() => {
    if (show || isAnimOpen || !isRendered) return;
    const id = window.setTimeout(() => setIsRendered(false), MODAL_TRANSITION_MS + 24);
    return () => clearTimeout(id);
  }, [show, isAnimOpen, isRendered]);

  if (!isRendered || !student) return null;

  return createPortal(
    <div
      className={"dday-modal" + (isAnimOpen ? " dday-modal--open" : "")}
      role="presentation"
      onClick={onClose}
    >
      <div
        className={
          "dday-modal-inner parent-home__live-quick-modal parent-home__live-quick-modal--schedule parent-home__live-quick-modal--mode-study-room"
        }
        role="dialog"
        aria-modal="true"
        aria-labelledby="study-room-modal-title"
        onClick={event => event.stopPropagation()}
      >
        <div className="dday-modal-header parent-home__live-quick-modal-header">
          <p className="parent-home__live-quick-modal-eyebrow">
            <span className="parent-home__live-quick-modal-eyebrow-dot" aria-hidden />
            {STUDY_ROOM_SHEET_META.eyebrow}
          </p>
          <h2 id="study-room-modal-title" className="dday-modal-title">
            {STUDY_ROOM_SHEET_META.title}
          </h2>
          <p className="parent-home__live-quick-modal-subtitle">{STUDY_ROOM_SHEET_META.subtitle}</p>
        </div>
        <div className="dday-modal-body parent-home__live-quick-modal-body parent-home__live-quick-modal-body--schedule">
          <StudyRoomPickerEditor
            ref={editorRef}
            variant="sheet"
            hideFooter
            student={student}
            initialValue={initialValue}
            authToken={authToken}
            saving={saving}
            onCanSaveChange={setCanSave}
            onSave={onSave}
          />
        </div>
        <div className="dday-modal-footer parent-home__live-quick-modal-footer">
          <button
            type="button"
            className="modal-secondary parent-home__live-quick-modal-btn"
            onClick={onClose}
            disabled={saving}
          >
            {H.cancel}
          </button>
          <button
            type="button"
            className="modal-primary parent-home__live-quick-modal-btn"
            disabled={!canSave || saving}
            onClick={() => editorRef.current?.save()}
          >
            {saving ? H.studyRoomQuickSaving : H.studyRoomQuickSave}
          </button>
        </div>
      </div>
    </div>,
    document.body
  );
}
