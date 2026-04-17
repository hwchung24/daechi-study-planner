import { Capacitor, registerPlugin } from "@capacitor/core";

type NativeTrackingStatus = {
  supported: boolean;
  platform: string;
  authorizationStatus: string;
  trackingEnabled: boolean;
  hasConfig: boolean;
  lastHeartbeatAt: string | null;
  lastError: string | null;
};

type StartTrackingOptions = {
  apiBase: string;
  authToken: string;
};

type StopTrackingOptions = {
  clearConfig?: boolean;
};

type NativeStudyRoomTrackingPlugin = {
  getStatus(): Promise<NativeTrackingStatus>;
  requestPermissions(): Promise<NativeTrackingStatus>;
  startTracking(options: StartTrackingOptions): Promise<NativeTrackingStatus>;
  stopTracking(options?: StopTrackingOptions): Promise<NativeTrackingStatus>;
};

const NativeStudyRoomTracking = registerPlugin<NativeStudyRoomTrackingPlugin>(
  "NativeStudyRoomTracking"
);

const WEB_STATUS_BASE: NativeTrackingStatus = {
  supported: typeof navigator !== "undefined" && "geolocation" in navigator,
  platform: Capacitor.getPlatform(),
  authorizationStatus: "prompt",
  trackingEnabled: false,
  hasConfig: false,
  lastHeartbeatAt: null,
  lastError: null
};

let webStatus: NativeTrackingStatus = { ...WEB_STATUS_BASE };
let webWatchId: number | null = null;
let webApiBase = "";
let webAuthToken = "";
let webLastSentAt = 0;
const HEARTBEAT_INTERVAL_MS_VISIBLE = 30_000;
const HEARTBEAT_INTERVAL_MS_HIDDEN = 120_000;

function isNativeIos() {
  return Capacitor.getPlatform() === "ios";
}

function buildHeartbeatUrl(apiBase: string) {
  return `${apiBase.replace(/\/$/, "")}/api/student/location/heartbeat`;
}

async function sendWebHeartbeat(position: GeolocationPosition) {
  if (!webApiBase || !webAuthToken) return;
  const now = Date.now();
  const visibilityBasedInterval =
    typeof document !== "undefined" && document.visibilityState === "hidden"
      ? HEARTBEAT_INTERVAL_MS_HIDDEN
      : HEARTBEAT_INTERVAL_MS_VISIBLE;
  if (now - webLastSentAt < visibilityBasedInterval) return;
  webLastSentAt = now;
  try {
    const res = await fetch(buildHeartbeatUrl(webApiBase), {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${webAuthToken}`
      },
      body: JSON.stringify({
        latitude: position.coords.latitude,
        longitude: position.coords.longitude,
        accuracy: position.coords.accuracy,
        timestamp: new Date(position.timestamp).toISOString()
      })
    });
    if (!res.ok) {
      throw new Error(`heartbeat_${res.status}`);
    }
    webStatus = {
      ...webStatus,
      lastHeartbeatAt: new Date().toISOString(),
      lastError: null
    };
  } catch (error) {
    webStatus = {
      ...webStatus,
      lastError:
        error instanceof Error && error.message
          ? error.message
          : "heartbeat_failed"
    };
  }
}

function clearWebTracking(clearConfig = false) {
  if (webWatchId !== null && typeof navigator !== "undefined") {
    navigator.geolocation.clearWatch(webWatchId);
  }
  webWatchId = null;
  webLastSentAt = 0;
  webStatus = {
    ...webStatus,
    trackingEnabled: false,
    hasConfig: clearConfig ? false : webStatus.hasConfig
  };
  if (clearConfig) {
    webApiBase = "";
    webAuthToken = "";
  }
}

async function getWebStatus(): Promise<NativeTrackingStatus> {
  return {
    ...webStatus,
    supported: typeof navigator !== "undefined" && "geolocation" in navigator,
    platform: Capacitor.getPlatform()
  };
}

async function requestWebPermissions(): Promise<NativeTrackingStatus> {
  if (typeof navigator === "undefined" || !("geolocation" in navigator)) {
    webStatus = {
      ...webStatus,
      supported: false,
      authorizationStatus: "unsupported",
      lastError: "geolocation_unavailable"
    };
    return getWebStatus();
  }

  await new Promise<void>((resolve, reject) => {
    navigator.geolocation.getCurrentPosition(
      () => resolve(),
      error => reject(error),
      { enableHighAccuracy: true, maximumAge: 0, timeout: 15_000 }
    );
  })
    .then(() => {
      webStatus = {
        ...webStatus,
        authorizationStatus: "authorized",
        lastError: null
      };
    })
    .catch(() => {
      webStatus = {
        ...webStatus,
        authorizationStatus: "denied",
        lastError: "permission_denied"
      };
    });

  return getWebStatus();
}

async function startWebTracking(options: StartTrackingOptions): Promise<NativeTrackingStatus> {
  const permissionStatus = await requestWebPermissions();
  if (permissionStatus.authorizationStatus === "denied") {
    throw new Error("location_permission_required");
  }
  if (typeof navigator === "undefined" || !("geolocation" in navigator)) {
    throw new Error("location_unsupported");
  }

  clearWebTracking(false);
  webApiBase = options.apiBase;
  webAuthToken = options.authToken;
  webStatus = {
    ...webStatus,
    hasConfig: true,
    trackingEnabled: true,
    lastError: null
  };

  webWatchId = navigator.geolocation.watchPosition(
    position => {
      void sendWebHeartbeat(position);
    },
    error => {
      webStatus = {
        ...webStatus,
        lastError: error?.message || "watch_failed"
      };
    },
    {
      enableHighAccuracy: false,
      maximumAge: 60_000,
      timeout: 30_000
    }
  );

  return getWebStatus();
}

async function stopWebTracking(options?: StopTrackingOptions): Promise<NativeTrackingStatus> {
  clearWebTracking(Boolean(options?.clearConfig));
  return getWebStatus();
}

export async function getNativeStudyRoomTrackingStatus() {
  if (isNativeIos()) {
    return NativeStudyRoomTracking.getStatus();
  }
  return getWebStatus();
}

export async function requestNativeStudyRoomTrackingPermissions() {
  if (isNativeIos()) {
    return NativeStudyRoomTracking.requestPermissions();
  }
  return requestWebPermissions();
}

export async function startNativeStudyRoomTracking(options: StartTrackingOptions) {
  if (isNativeIos()) {
    return NativeStudyRoomTracking.startTracking(options);
  }
  return startWebTracking(options);
}

export async function stopNativeStudyRoomTracking(options?: StopTrackingOptions) {
  if (isNativeIos()) {
    return NativeStudyRoomTracking.stopTracking(options);
  }
  return stopWebTracking(options);
}

export type { NativeTrackingStatus };