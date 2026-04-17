type PerfSample = {
  name: string;
  durationMs: number;
  at: number;
  meta?: Record<string, unknown>;
};

const PERF_BUCKET_KEY = "__daechiPerfSamples";
const MAX_SAMPLES = 300;

function pushSample(sample: PerfSample) {
  if (typeof window === "undefined") return;
  const host = window as Window & { [PERF_BUCKET_KEY]?: PerfSample[] };
  const list = host[PERF_BUCKET_KEY] || [];
  list.push(sample);
  if (list.length > MAX_SAMPLES) {
    list.splice(0, list.length - MAX_SAMPLES);
  }
  host[PERF_BUCKET_KEY] = list;
}

export function markPerfPoint(name: string, meta?: Record<string, unknown>) {
  pushSample({ name, durationMs: 0, at: Date.now(), meta });
}

export async function trackAsync<T>(
  name: string,
  work: () => Promise<T>,
  meta?: Record<string, unknown>
): Promise<T> {
  const start = performance.now();
  try {
    return await work();
  } finally {
    const durationMs = Math.round((performance.now() - start) * 10) / 10;
    pushSample({
      name,
      durationMs,
      at: Date.now(),
      meta
    });
  }
}

export function isDocumentVisible() {
  if (typeof document === "undefined") return true;
  return document.visibilityState === "visible";
}
