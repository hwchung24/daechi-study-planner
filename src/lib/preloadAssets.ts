const preloadedAssets = new Set<string>();

export function preloadImageAsset(path: string) {
  const src = String(path || "").trim();
  if (!src || preloadedAssets.has(src) || typeof Image === "undefined") return;
  preloadedAssets.add(src);
  const image = new Image();
  image.decoding = "async";
  image.src = src;
}

export function preloadImageAssets(paths: string[]) {
  for (const path of paths) preloadImageAsset(path);
}
