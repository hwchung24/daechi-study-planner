import React, { useEffect, useRef } from "react";
import L from "leaflet";
import "leaflet/dist/leaflet.css";
import type { ParentStudyRoomLiveStatus } from "./useParentStudyRoomLive";
import ko from "../fallbacks/ko.json";
import { tpl } from "../fallbacks/tpl";

const H = ko.parentHomeTab;

const DEFAULT_CENTER: L.LatLngExpression = [37.5665, 126.978];
const MIN_ZOOM = 5;
const MAX_ZOOM = 18;

const studentMarkerIcon = L.divIcon({
  className: "parent-location-map__marker-wrap",
  html: '<span class="parent-location-map__marker parent-location-map__marker--student" aria-hidden="true"></span>',
  iconSize: [20, 20],
  iconAnchor: [10, 10]
});

const roomMarkerIcon = L.divIcon({
  className: "parent-location-map__marker-wrap",
  html: '<span class="parent-location-map__marker parent-location-map__marker--room" aria-hidden="true"></span>',
  iconSize: [24, 24],
  iconAnchor: [12, 24]
});

function hasCoords(lat: number | null, lng: number | null) {
  return lat != null && lng != null && Number.isFinite(lat) && Number.isFinite(lng);
}

export function ParentHomeLocationCheckMap(props: {
  live: ParentStudyRoomLiveStatus;
  active: boolean;
}) {
  const hostRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<L.Map | null>(null);
  const studentMarkerRef = useRef<L.Marker | null>(null);
  const roomMarkerRef = useRef<L.Marker | null>(null);
  const circleRef = useRef<L.Circle | null>(null);

  useEffect(() => {
    if (!props.active || !hostRef.current) return;

    const map = L.map(hostRef.current, {
      center: DEFAULT_CENTER,
      zoom: 14,
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

    mapRef.current = map;
    const t1 = window.setTimeout(() => map.invalidateSize(), 80);
    const t2 = window.setTimeout(() => map.invalidateSize(), 320);

    return () => {
      window.clearTimeout(t1);
      window.clearTimeout(t2);
      studentMarkerRef.current?.remove();
      studentMarkerRef.current = null;
      roomMarkerRef.current?.remove();
      roomMarkerRef.current = null;
      circleRef.current?.remove();
      circleRef.current = null;
      map.remove();
      mapRef.current = null;
    };
  }, [props.active]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !props.active) return;

    const live = props.live;
    const studentOk = hasCoords(live.currentLatitude, live.currentLongitude);
    const roomOk = hasCoords(live.studyRoomLatitude, live.studyRoomLongitude);
    const studentLatLng = studentOk
      ? L.latLng(live.currentLatitude!, live.currentLongitude!)
      : null;
    const roomLatLng = roomOk ? L.latLng(live.studyRoomLatitude!, live.studyRoomLongitude!) : null;

    if (studentOk) {
      if (!studentMarkerRef.current) {
        studentMarkerRef.current = L.marker(studentLatLng!, {
          icon: studentMarkerIcon,
          zIndexOffset: 400
        }).addTo(map);
      } else {
        studentMarkerRef.current.setLatLng(studentLatLng!);
      }
    } else {
      studentMarkerRef.current?.remove();
      studentMarkerRef.current = null;
    }

    if (roomOk) {
      if (!roomMarkerRef.current) {
        roomMarkerRef.current = L.marker(roomLatLng!, {
          icon: roomMarkerIcon,
          zIndexOffset: 300
        }).addTo(map);
      } else {
        roomMarkerRef.current.setLatLng(roomLatLng!);
      }

      const radius =
        live.currentRadiusMeters != null && Number.isFinite(live.currentRadiusMeters)
          ? Math.max(30, Number(live.currentRadiusMeters))
          : 120;

      if (!circleRef.current) {
        circleRef.current = L.circle(roomLatLng!, {
          radius,
          color: "rgba(37, 99, 235, 0.85)",
          weight: 2,
          fillColor: "rgba(37, 99, 235, 0.12)",
          fillOpacity: 1
        }).addTo(map);
      } else {
        circleRef.current.setLatLng(roomLatLng!);
        circleRef.current.setRadius(radius);
      }
    } else {
      roomMarkerRef.current?.remove();
      roomMarkerRef.current = null;
      circleRef.current?.remove();
      circleRef.current = null;
    }

    const bounds = L.latLngBounds([]);
    if (studentLatLng) bounds.extend(studentLatLng);
    if (roomLatLng) {
      bounds.extend(roomLatLng);
      if (circleRef.current) {
        bounds.extend(circleRef.current.getBounds());
      }
    }

    if (bounds.isValid()) {
      map.fitBounds(bounds.pad(0.22), { animate: false, maxZoom: 16 });
    } else if (studentLatLng) {
      map.setView(studentLatLng, 15, { animate: false });
    } else if (roomLatLng) {
      map.setView(roomLatLng, 15, { animate: false });
    } else {
      map.setView(DEFAULT_CENTER, 12, { animate: false });
    }

    requestAnimationFrame(() => map.invalidateSize());
  }, [props.live, props.active]);

  const studentOk = hasCoords(props.live.currentLatitude, props.live.currentLongitude);
  const roomOk = hasCoords(props.live.studyRoomLatitude, props.live.studyRoomLongitude);

  return (
    <div className="parent-location-map" aria-label={H.liveLocationCheckMapAria}>
      <div ref={hostRef} className="parent-location-map__surface" />
      {!studentOk && !roomOk ? (
        <p className="parent-location-map__empty">{H.liveLocationCheckMapEmpty}</p>
      ) : null}
      <div className="parent-location-map__legend" aria-hidden={!studentOk && !roomOk}>
        {studentOk ? (
          <span className="parent-location-map__legend-item">
            <span className="parent-location-map__legend-dot parent-location-map__legend-dot--student" />
            {H.liveLocationCheckMapStudentLegend}
          </span>
        ) : null}
        {roomOk ? (
          <span className="parent-location-map__legend-item">
            <span className="parent-location-map__legend-dot parent-location-map__legend-dot--room" />
            {H.liveLocationCheckMapRoomLegend}
          </span>
        ) : null}
        {roomOk && props.live.currentRadiusMeters != null ? (
          <span className="parent-location-map__legend-item parent-location-map__legend-item--muted">
            {tpl(H.liveLocationCheckMapRadiusLegend, {
              meters: String(Math.round(props.live.currentRadiusMeters))
            })}
          </span>
        ) : null}
      </div>
    </div>
  );
}
