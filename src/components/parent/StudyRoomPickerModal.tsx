import React, { useEffect, useMemo, useRef, useState } from "react";
import L from "leaflet";
import "leaflet/dist/leaflet.css";
import type { ParentStudyRoomSetting } from "../../types/parent";

export type StudyRoomSetting = ParentStudyRoomSetting;

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

function formatCoordinate(value: number, suffix: string) {
  return `${Math.abs(value).toFixed(5)}°${suffix}`;
}

function studentAlias(email: string) {
  const localPart = String(email || "").split("@")[0]?.trim();
  return localPart || email || "학생";
}

export function StudyRoomPickerModal(props: {
  open: boolean;
  revealed: boolean;
  student: { id: number; email: string } | null;
  initialValue?: StudyRoomSetting;
  saving?: boolean;
  onClose: () => void;
  onSave: (value: StudyRoomSetting) => void;
}) {
  const { open, revealed, student, initialValue, saving = false, onClose, onSave } = props;
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
  const [mapZoom, setMapZoom] = useState(DEFAULT_ZOOM);
  const [resolvingAddress, setResolvingAddress] = useState(false);

  useEffect(() => {
    if (!open) return;
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
    setMapZoom(DEFAULT_ZOOM);
  }, [initialValue, open, student?.id]);

  useEffect(() => {
    if (!open || !mapHostRef.current || mapRef.current) return;
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
  }, [open]);

  useEffect(() => {
    if (!open || !mapRef.current) return;
    const map = mapRef.current;
    const center = selected || DEFAULT_CENTER;
    map.setView([center.lat, center.lng], initialValue ? DEFAULT_ZOOM : map.getZoom(), {
      animate: false
    });
    requestAnimationFrame(() => map.invalidateSize());
  }, [open, student?.id, initialValue?.latitude, initialValue?.longitude]);

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
      setResolvingAddress(true);
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
      } finally {
        if (!cancelled) setResolvingAddress(false);
      }
    };
    void resolveAddress();
    return () => {
      cancelled = true;
    };
  }, [selected]);

  const activeStudentName = useMemo(() => {
    if (!student) return "학생";
    return studentAlias(student.email);
  }, [student]);

  const runSearch = async () => {
    const raw = searchQuery.trim();
    if (!raw) {
      setSearchError("독서실 이름이나 주소를 입력해 주세요.");
      setSearchResults([]);
      return;
    }
    setSearching(true);
    setSearchError("");
    try {
      const q = /(독서실|스터디카페|study cafe)/i.test(raw) ? raw : `${raw} 독서실`;
      const res = await fetch(
        `https://nominatim.openstreetmap.org/search?format=jsonv2&limit=8&countrycodes=kr&accept-language=ko&q=${encodeURIComponent(q)}`,
        {
          headers: {
            Accept: "application/json"
          }
        }
      );
      if (!res.ok) {
        throw new Error(`검색에 실패했습니다. (${res.status})`);
      }
      const data = (await res.json()) as Array<{
        place_id?: number | string;
        display_name?: string;
        lat?: string;
        lon?: string;
        name?: string;
      }>;
      const nextResults = data
        .map(row => {
          const latitude = Number(row.lat);
          const longitude = Number(row.lon);
          if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) return null;
          return {
            id: String(row.place_id || `${latitude},${longitude}`),
            name: String(row.name || "").trim() || String(row.display_name || "").split(",")[0] || "검색 결과",
            address: String(row.display_name || "").trim(),
            latitude,
            longitude
          };
        })
        .filter((row): row is SearchResult => Boolean(row));
      setSearchResults(nextResults);
      if (nextResults.length === 0) {
        setSearchError("검색 결과가 없어요. 지도를 직접 눌러 위치를 설정할 수 있습니다.");
      }
    } catch (error) {
      setSearchResults([]);
      setSearchError(
        error instanceof Error && error.message
          ? error.message
          : "위치 검색 중 오류가 발생했습니다."
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

  if (!open || !student) return null;

  return (
    <div
      className={"dday-modal study-room-modal" + (revealed ? " dday-modal--open" : "")}
      onClick={onClose}
    >
      <div className="dday-modal-inner" onClick={event => event.stopPropagation()}>
        <div className="dday-modal-header">
          <span className="dday-modal-title">{activeStudentName} 독서실 위치 설정</span>
        </div>
        <div className="dday-modal-body">
          <p className="study-room-modal__guide">
            실제 지도에서 끌어 이동하거나 클릭해서 위치를 지정하세요. 검색 결과를 누르면 그 위치로 바로 이동합니다.
          </p>

          <div className="study-room-modal__search-row">
            <input
              className="field-input"
              value={searchQuery}
              onChange={event => setSearchQuery(event.target.value)}
              placeholder="예: 대치동 스터디카페"
            />
            <button
              type="button"
              className="modal-secondary study-room-modal__search-btn"
              onClick={() => void runSearch()}
              disabled={searching || saving}
            >
              {searching ? "검색 중…" : "검색"}
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

          <div className="study-room-map">
            <div className="study-room-map__frame">
              <div ref={mapHostRef} className="study-room-map__surface" />
              <div className="study-room-map__overlay">
                <span className="study-room-map__badge">드래그 · 휠 줌 · 탭 선택</span>
                <button
                  type="button"
                  className="study-room-map__focus-btn"
                  onClick={focusSelected}
                  disabled={!selected || saving}
                >
                  선택 위치 보기
                </button>
              </div>
            </div>
            <div className="study-room-map__toolbar">
              <div className="study-room-map__zoom-group">
                <button
                  type="button"
                  className="study-room-map__tool-btn"
                  onClick={() => mapRef.current?.zoomOut()}
                  disabled={mapZoom <= MIN_ZOOM || saving}
                >
                  -
                </button>
                <span className="study-room-map__zoom-label">줌 {mapZoom}</span>
                <button
                  type="button"
                  className="study-room-map__tool-btn"
                  onClick={() => mapRef.current?.zoomIn()}
                  disabled={mapZoom >= MAX_ZOOM || saving}
                >
                  +
                </button>
              </div>
              <span className="study-room-map__hint">
                {selected ? "지도 아무 곳이나 눌러 위치를 다시 지정할 수 있어요." : "먼저 위치를 클릭해 주세요."}
              </span>
            </div>
          </div>

          <div className="study-room-modal__field-grid">
            <div className="field">
              <label className="field-label">독서실 이름</label>
              <input
                className="field-input"
                value={studyRoomName}
                onChange={event => setStudyRoomName(event.target.value)}
                disabled={saving}
                placeholder="예: 대치 에이스 독서실"
              />
            </div>
            <div className="field">
              <label className="field-label">주소 메모</label>
              <input
                className="field-input"
                value={studyRoomAddress}
                onChange={event => setStudyRoomAddress(event.target.value)}
                disabled={saving}
                placeholder="검색 결과나 직접 선택한 위치 주소"
              />
            </div>
          </div>

          <div className="study-room-modal__coordinates">
            <span>
              {selected
                ? `${formatCoordinate(selected.lat, selected.lat >= 0 ? "N" : "S")} · ${formatCoordinate(selected.lng, selected.lng >= 0 ? "E" : "W")}`
                : "지도를 눌러 위치를 선택해 주세요."}
            </span>
            {resolvingAddress ? <span>주소 확인 중…</span> : null}
          </div>
        </div>
        <div className="dday-modal-footer">
          <button type="button" className="modal-secondary" onClick={onClose} disabled={saving}>
            취소
          </button>
          <button
            type="button"
            className="modal-primary"
            onClick={() => {
              if (!selected || !studyRoomName.trim()) return;
              onSave({
                studentId: student.id,
                studentEmail: student.email,
                name: studyRoomName.trim(),
                address: studyRoomAddress.trim() || undefined,
                latitude: selected.lat,
                longitude: selected.lng,
                updatedAt: new Date().toISOString()
              });
            }}
            disabled={!selected || !studyRoomName.trim() || saving}
          >
            {saving ? "저장 중…" : "저장"}
          </button>
        </div>
      </div>
    </div>
  );
}