const SIMPLEMDM_API_BASE = String(
  process.env.SIMPLEMDM_API_BASE || "https://a.simplemdm.com/api/v1"
).replace(/\/+$/, "");
const SIMPLEMDM_API_KEY = String(process.env.SIMPLEMDM_API_KEY || "").trim();

function isSimpleMdmConfigured() {
  return SIMPLEMDM_API_KEY.length > 0;
}

function getBasicAuthHeader() {
  if (!isSimpleMdmConfigured()) {
    throw new Error("SIMPLEMDM_API_KEY가 설정되어 있지 않습니다.");
  }
  return `Basic ${Buffer.from(`${SIMPLEMDM_API_KEY}:`).toString("base64")}`;
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/** 429/503 시 재시도 — Simple MDM 쪽 속도 제한 완화 */
const SIMPLEMDM_RETRYABLE_STATUS = new Set([429, 503]);
const SIMPLEMDM_MAX_ATTEMPTS = Number(
  process.env.SIMPLEMDM_MAX_RETRY_ATTEMPTS || 6
);

async function simpleMdmRequest(path, options = {}, attempt = 1) {
  const isFormDataBody =
    typeof FormData !== "undefined" && options.body instanceof FormData;
  const res = await fetch(`${SIMPLEMDM_API_BASE}${path}`, {
    ...options,
    headers: {
      Authorization: getBasicAuthHeader(),
      Accept: "application/json",
      ...(
        options.body && !isFormDataBody
          ? { "Content-Type": "application/x-www-form-urlencoded" }
          : {}
      ),
      ...(options.headers || {})
    }
  });

  if (res.status === 204) return null;

  if (
    SIMPLEMDM_RETRYABLE_STATUS.has(res.status) &&
    attempt < SIMPLEMDM_MAX_ATTEMPTS
  ) {
    await res.text().catch(() => {});
    const ra = res.headers.get("retry-after");
    let delayMs = Math.min(90000, 500 * 2 ** (attempt - 1));
    if (ra != null && String(ra).trim() !== "") {
      const sec = Number(ra);
      if (Number.isFinite(sec) && sec >= 0) {
        delayMs = Math.min(120000, Math.max(delayMs, sec * 1000));
      }
    }
    await sleep(delayMs);
    return simpleMdmRequest(path, options, attempt + 1);
  }

  const text = await res.text();
  let data = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = text;
  }

  if (!res.ok) {
    const message =
      data?.errors?.[0]?.detail ||
      data?.error ||
      `SimpleMDM 요청 실패 (${res.status})`;
    const error = new Error(message);
    error.status = res.status;
    error.payload = data;
    throw error;
  }

  return data;
}

const findDeviceBySerialInflight = new Map();

async function findDeviceBySerial(serial) {
  const key = String(serial ?? "")
    .trim()
    .toUpperCase();
  if (!key) return null;

  if (findDeviceBySerialInflight.has(key)) {
    return findDeviceBySerialInflight.get(key);
  }

  const promise = (async () => {
    try {
      const data = await simpleMdmRequest(
        `/devices?search=${encodeURIComponent(serial)}`
      );
      const list = Array.isArray(data?.data) ? data.data : [];
      return (
        list.find(
          item =>
            String(item?.attributes?.serial_number || "").toUpperCase() === key
        ) || null
      );
    } finally {
      findDeviceBySerialInflight.delete(key);
    }
  })();

  findDeviceBySerialInflight.set(key, promise);
  return promise;
}

async function getDeviceById(deviceId) {
  const id = Number(deviceId);
  if (!Number.isFinite(id) || id <= 0) {
    throw new Error("deviceId가 올바르지 않습니다.");
  }
  return simpleMdmRequest(`/devices/${id}`);
}

/** GET /devices/:id 의 relationships.groups (assignment group id 목록) */
function getAssignmentGroupIdsFromDevice(deviceDetailResponse) {
  const rows = deviceDetailResponse?.data?.relationships?.groups?.data;
  if (!Array.isArray(rows)) return [];
  return rows
    .map(r => Number(r?.id))
    .filter(n => Number.isFinite(n) && n > 0);
}

function profileReferencesAssignmentGroup(row, assignmentGroupId) {
  const target = Number(assignmentGroupId);
  if (!Number.isFinite(target) || target <= 0) return false;
  const collectIds = rel => {
    if (!rel) return [];
    const data = rel.data;
    if (Array.isArray(data)) {
      return data.map(g => Number(g?.id)).filter(n => Number.isFinite(n) && n > 0);
    }
    if (data && typeof data === "object" && data.id != null) {
      const n = Number(data.id);
      return Number.isFinite(n) && n > 0 ? [n] : [];
    }
    return [];
  };
  const rel = row?.relationships || {};
  const ids = new Set([
    ...collectIds(rel.groups),
    ...collectIds(rel.assignment_groups)
  ]);
  return ids.has(target);
}

function isNotFoundError(err) {
  const st = Number(err?.status);
  const msg = String(err?.message || err || "");
  return st === 404 || /\(\s*404\s*\)/.test(msg) || /\b404\b/.test(msg);
}

/** GET /assignment_groups/:id/profiles 목록 API는 없거나 404인 경우가 많아 계정 /profiles(실패 시 custom_configuration_profiles)로만 조회 */
async function listProfilesFilteredByAssignmentGroupId(assignmentGroupId) {
  let rows = [];
  try {
    rows = await listPaginatedCollection("/profiles");
  } catch (err) {
    if (!isNotFoundError(err)) throw err;
    try {
      rows = await listPaginatedCollection("/custom_configuration_profiles");
    } catch (err2) {
      throw err;
    }
  }
  return (Array.isArray(rows) ? rows : []).filter(row =>
    profileReferencesAssignmentGroup(row, assignmentGroupId)
  );
}

/** 기기가 속한 그룹 id들 중 이름이 student-{userId} 인 할당 그룹 찾기 */
async function findStudentAssignmentGroupOnDevice(deviceGroupIds, studentUserId) {
  const wantName = `student-${Number(studentUserId)}`;
  const ids = Array.isArray(deviceGroupIds)
    ? deviceGroupIds.map(n => Number(n)).filter(n => Number.isFinite(n) && n > 0)
    : [];
  for (const gid of ids) {
    try {
      const data = await simpleMdmRequest(`/assignment_groups/${gid}`);
      const name = String(data?.data?.attributes?.name || "").trim();
      if (name === wantName) {
        return { id: gid, name };
      }
    } catch {
      // 다음 후보
    }
  }
  return null;
}

async function createAssignmentGroup(name) {
  const body = new URLSearchParams({
    name,
    auto_deploy: "false"
  }).toString();
  const data = await simpleMdmRequest("/assignment_groups", {
    method: "POST",
    body
  });
  return data?.data || null;
}

async function listApps() {
  const all = [];
  let startingAfter = null;

  while (true) {
    const query = new URLSearchParams({ limit: "100" });
    if (startingAfter) query.set("starting_after", String(startingAfter));
    const data = await simpleMdmRequest(`/apps?${query.toString()}`);
    const rows = Array.isArray(data?.data) ? data.data : [];
    all.push(...rows);
    if (!data?.has_more || rows.length === 0) break;
    startingAfter = rows[rows.length - 1]?.id;
    if (!startingAfter) break;
  }

  return all;
}

async function listPaginatedCollection(pathWithOptionalQuery) {
  const all = [];
  let startingAfter = null;

  while (true) {
    const separator = pathWithOptionalQuery.includes("?") ? "&" : "?";
    const pagePath = `${pathWithOptionalQuery}${separator}limit=100${
      startingAfter ? `&starting_after=${encodeURIComponent(String(startingAfter))}` : ""
    }`;
    const data = await simpleMdmRequest(pagePath);
    const rows = Array.isArray(data?.data) ? data.data : [];
    all.push(...rows);
    if (!data?.has_more || rows.length === 0) break;
    startingAfter = rows[rows.length - 1]?.id;
    if (!startingAfter) break;
  }

  return all;
}

function normalizeSimpleMdmText(value) {
  return String(value || "")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, " ");
}

async function findAppByName(name) {
  const apps = await listApps();
  const target = normalizeSimpleMdmText(name);
  return (
    apps.find(
      app => normalizeSimpleMdmText(app?.attributes?.name) === target
    ) || null
  );
}

async function findAppByBundleId(bundleId) {
  const apps = await listApps();
  const target = normalizeSimpleMdmText(bundleId);
  return (
    apps.find(
      app =>
        normalizeSimpleMdmText(app?.attributes?.bundle_identifier) === target
    ) || null
  );
}

async function findAppByBundleIdOrName(bundleId, name) {
  const apps = await listApps();
  const bundleTarget = normalizeSimpleMdmText(bundleId);
  const nameTarget = normalizeSimpleMdmText(name);
  return (
    apps.find(
      app =>
        (bundleTarget &&
          normalizeSimpleMdmText(app?.attributes?.bundle_identifier) ===
            bundleTarget) ||
        (nameTarget &&
          normalizeSimpleMdmText(app?.attributes?.name) === nameTarget)
    ) || null
  );
}

async function listAppInstalls(appId) {
  const all = [];
  let startingAfter = null;

  while (true) {
    const query = new URLSearchParams({ limit: "100" });
    if (startingAfter) query.set("starting_after", String(startingAfter));
    const data = await simpleMdmRequest(`/apps/${appId}/installs?${query.toString()}`);
    const rows = Array.isArray(data?.data) ? data.data : [];
    all.push(...rows);
    if (!data?.has_more || rows.length === 0) break;
    startingAfter = rows[rows.length - 1]?.id;
    if (!startingAfter) break;
  }

  return all;
}

async function findInstalledAppForDevice(appId, deviceId) {
  const installs = await listAppInstalls(appId);
  return (
    installs.find(
      item => Number(item?.relationships?.device?.data?.id) === Number(deviceId)
    ) || null
  );
}

function normalizeInstalledAppRow(row, catalogById = new Map()) {
  const attrs = row?.attributes || {};
  const appId = row?.relationships?.app?.data?.id;
  const catalog = appId != null ? catalogById.get(Number(appId)) : null;
  const catalogAttrs = catalog?.attributes || {};
  const name = String(
    attrs.name ||
      attrs.app_name ||
      attrs.display_name ||
      catalogAttrs.name ||
      ""
  ).trim();
  const bundleId = String(
    attrs.bundle_identifier || attrs.bundle_id || catalogAttrs.bundle_identifier || ""
  ).trim();
  if (!name && !bundleId) return null;
  return {
    id: String(row?.id || appId || bundleId || name).trim(),
    name: name || bundleId,
    bundleId: bundleId || null,
    version: String(attrs.version || attrs.short_version || "").trim() || null,
    source: "simplemdm"
  };
}

async function listInstalledAppsForDevice(deviceId) {
  const numericDeviceId = Number(deviceId);
  if (!Number.isFinite(numericDeviceId) || numericDeviceId <= 0) {
    throw new Error("deviceId가 올바르지 않습니다.");
  }

  const appsCatalog = await listApps().catch(() => []);
  const catalogById = new Map(
    (appsCatalog || []).map(item => [Number(item?.id), item])
  );

  const endpointCandidates = [
    `/devices/${numericDeviceId}/installed_apps`,
    `/installed_apps?device_id=${numericDeviceId}`
  ];

  for (const path of endpointCandidates) {
    try {
      const rows = await listPaginatedCollection(path);
      const normalized = rows
        .map(row => normalizeInstalledAppRow(row, catalogById))
        .filter(Boolean);
      if (normalized.length > 0) {
        const seen = new Set();
        return normalized.filter(app => {
          const key = `${String(app.bundleId || "").toLowerCase()}::${String(app.name).toLowerCase()}`;
          if (seen.has(key)) return false;
          seen.add(key);
          return true;
        });
      }
    } catch {
      // Try the next candidate path.
    }
  }

  const fallback = [];
  for (const app of appsCatalog) {
    const appId = Number(app?.id);
    if (!Number.isFinite(appId) || appId <= 0) continue;
    const installed = await findInstalledAppForDevice(appId, numericDeviceId).catch(() => null);
    if (!installed) continue;
    const attrs = app?.attributes || {};
    fallback.push({
      id: String(installed?.id || appId),
      name: String(attrs.name || "").trim() || String(attrs.bundle_identifier || `app-${appId}`),
      bundleId: String(attrs.bundle_identifier || "").trim() || null,
      version: null,
      source: "simplemdm"
    });
  }

  const seen = new Set();
  return fallback.filter(app => {
    const key = `${String(app.bundleId || "").toLowerCase()}::${String(app.name).toLowerCase()}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

async function createAppInCatalog({ appStoreId, bundleId, name }) {
  const params = new URLSearchParams();
  if (appStoreId) {
    params.set("app_store_id", String(appStoreId));
  } else if (bundleId) {
    params.set("bundle_id", String(bundleId));
  } else {
    throw new Error("SimpleMDM 카탈로그 등록에 필요한 appStoreId 또는 bundleId가 없습니다.");
  }
  if (name) params.set("name", String(name));
  const data = await simpleMdmRequest("/apps", {
    method: "POST",
    body: params.toString()
  });
  return data?.data || null;
}

async function assignAppToGroup(groupId, appId) {
  await simpleMdmRequest(`/assignment_groups/${groupId}/apps/${appId}`, {
    method: "POST",
    body: new URLSearchParams({ deployment_type: "standard" }).toString()
  });
}

async function unassignAppFromGroup(groupId, appId) {
  await simpleMdmRequest(`/assignment_groups/${groupId}/apps/${appId}`, {
    method: "DELETE"
  });
}

async function uninstallInstalledApp(installedAppId) {
  await simpleMdmRequest(`/installed_apps/${installedAppId}`, {
    method: "DELETE"
  });
}

async function assignDeviceToGroup(groupId, deviceId) {
  await simpleMdmRequest(`/assignment_groups/${groupId}/devices/${deviceId}`, {
    method: "POST"
  });
}

async function pushApps(groupId) {
  await simpleMdmRequest(`/assignment_groups/${groupId}/push_apps`, {
    method: "POST"
  });
}

async function pushAssignedAppsToDevice(deviceId) {
  await simpleMdmRequest(`/devices/${deviceId}/push_apps`, {
    method: "POST"
  });
}

async function refreshDevice(deviceId) {
  await simpleMdmRequest(`/devices/${deviceId}/refresh`, {
    method: "POST"
  });
}

async function createCustomConfigurationProfile({
  name,
  mobileconfig,
  userScope = false,
  attributeSupport = false,
  declarative = false
}) {
  const form = new FormData();
  form.set("name", String(name || "Weekly App Allowance"));
  form.set(
    "mobileconfig",
    new Blob([String(mobileconfig || "")], {
      type: "application/x-apple-aspen-config"
    }),
    "weekly-app-allowance.mobileconfig"
  );
  form.set("user_scope", userScope ? "true" : "false");
  form.set("attribute_support", attributeSupport ? "true" : "false");
  form.set("declarative", declarative ? "true" : "false");
  const data = await simpleMdmRequest("/custom_configuration_profiles", {
    method: "POST",
    body: form
  });
  return data?.data || null;
}

async function updateCustomConfigurationProfile(
  profileId,
  { name, mobileconfig, userScope = false, attributeSupport = false, declarative = false }
) {
  const form = new FormData();
  if (name != null) form.set("name", String(name));
  if (mobileconfig != null) {
    form.set(
      "mobileconfig",
      new Blob([String(mobileconfig)], {
        type: "application/x-apple-aspen-config"
      }),
      "weekly-app-allowance.mobileconfig"
    );
  }
  form.set("user_scope", userScope ? "true" : "false");
  form.set("attribute_support", attributeSupport ? "true" : "false");
  form.set("declarative", declarative ? "true" : "false");
  const data = await simpleMdmRequest(
    `/custom_configuration_profiles/${profileId}`,
    {
      method: "PATCH",
      body: form
    }
  );
  return data?.data || null;
}

async function deleteCustomConfigurationProfile(profileId) {
  await simpleMdmRequest(`/custom_configuration_profiles/${profileId}`, {
    method: "DELETE"
  });
}

async function assignProfileToGroup(groupId, profileId) {
  await simpleMdmRequest(
    `/assignment_groups/${groupId}/profiles/${profileId}`,
    {
      method: "POST"
    }
  );
}

async function unassignProfileFromGroup(groupId, profileId) {
  await simpleMdmRequest(
    `/assignment_groups/${groupId}/profiles/${profileId}`,
    {
      method: "DELETE"
    }
  );
}

/**
 * 앱 허용/제한 슬롯을 차지하는 프로파일인지 — 그룹에는 이 계열만 하나 두는 전제.
 * - Simple MDM 네이티브 App Restrictions (`app_restrictions`)
 * - env로 지정한 named 프로파일 이름과 일치
 * - 주간 동적 mobileconfig (`DaechiRoot Weekly App Allowance …`)
 */
function shouldUnassignProfileForAllowanceSlot(profileRow, targetProfileId, managedNameKeys) {
  const id = Number(profileRow?.id);
  if (!Number.isFinite(id) || id <= 0) return false;
  const target = Number(targetProfileId);
  if (target > 0 && id === target) return false;
  const keys =
    managedNameKeys instanceof Set ? managedNameKeys : new Set();
  const typeLc = String(profileRow?.type || "").trim().toLowerCase();
  const nameKey = normalizeSimpleMdmName(profileRow?.attributes?.name);
  if (typeLc === "app_restrictions") return true;
  if (nameKey && keys.has(nameKey)) return true;
  if (nameKey && nameKey.startsWith("dae chiroot weekly app allowance")) return true;
  return false;
}

/**
 * 새 허용앱 프로파일을 붙이기 전, 같은 그룹에 남아 있는 경쟁 프로파일을 모두 그룹에서 뗀다(계정에서 삭제하지 않음).
 */
async function unassignCompetingAppAllowanceProfilesFromGroup(groupId, options = {}) {
  const targetProfileId = Number(options.targetProfileId || 0);
  const managedNameKeys =
    options.managedNameKeys instanceof Set
      ? options.managedNameKeys
      : new Set();
  const assigned = await listProfilesForAssignmentGroup(groupId).catch(() => []);
  const removedIds = [];
  for (const profile of Array.isArray(assigned) ? assigned : []) {
    if (!shouldUnassignProfileForAllowanceSlot(profile, targetProfileId, managedNameKeys)) {
      continue;
    }
    const pid = Number(profile?.id);
    if (!Number.isFinite(pid) || pid <= 0) continue;
    await unassignProfileFromGroup(groupId, pid).catch(() => {});
    removedIds.push(pid);
  }
  return removedIds;
}

async function syncProfiles(groupId) {
  await simpleMdmRequest(`/assignment_groups/${groupId}/sync_profiles`, {
    method: "POST"
  });
}

async function listProfiles(search = "") {
  const query = String(search || "").trim();
  const path = query ? `/profiles?search=${encodeURIComponent(query)}` : "/profiles";
  return listPaginatedCollection(path);
}

function normalizeSimpleMdmName(value) {
  return String(value || "")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, " ");
}

async function findProfileByName(name) {
  const target = normalizeSimpleMdmName(name);
  if (!target) return null;
  const profiles = await listProfiles(name);
  return (
    profiles.find(
      profile => normalizeSimpleMdmName(profile?.attributes?.name) === target
    ) || null
  );
}

async function listProfilesForAssignmentGroup(groupId) {
  const numericGroupId = Number(groupId);
  if (!Number.isFinite(numericGroupId) || numericGroupId <= 0) {
    throw new Error("assignment group id가 올바르지 않습니다.");
  }
  try {
    return await listPaginatedCollection(
      `/assignment_groups/${numericGroupId}/profiles`
    );
  } catch (err) {
    if (Number(err?.status) === 404) {
      return listProfilesFilteredByAssignmentGroupId(numericGroupId);
    }
    throw err;
  }
}

/** 기기에 직접 할당된 프로파일(SimpleMDM). 그룹 경유 프로파일은 목록에 안 나올 수 있음. */
async function listDeviceProfiles(deviceId) {
  const numericDeviceId = Number(deviceId);
  if (!Number.isFinite(numericDeviceId) || numericDeviceId <= 0) {
    throw new Error("deviceId가 올바르지 않습니다.");
  }
  return listPaginatedCollection(`/devices/${numericDeviceId}/profiles`);
}

module.exports = {
  isSimpleMdmConfigured,
  simpleMdmRequest,
  findDeviceBySerial,
  getDeviceById,
  getAssignmentGroupIdsFromDevice,
  findStudentAssignmentGroupOnDevice,
  profileReferencesAssignmentGroup,
  findAppByBundleId,
  findAppByName,
  findAppByBundleIdOrName,
  listInstalledAppsForDevice,
  findInstalledAppForDevice,
  createAppInCatalog,
  createAssignmentGroup,
  assignAppToGroup,
  unassignAppFromGroup,
  uninstallInstalledApp,
  assignDeviceToGroup,
  pushApps,
  pushAssignedAppsToDevice,
  refreshDevice,
  createCustomConfigurationProfile,
  updateCustomConfigurationProfile,
  deleteCustomConfigurationProfile,
  assignProfileToGroup,
  unassignProfileFromGroup,
  shouldUnassignProfileForAllowanceSlot,
  unassignCompetingAppAllowanceProfilesFromGroup,
  syncProfiles,
  listProfiles,
  findProfileByName,
  listProfilesForAssignmentGroup,
  listDeviceProfiles
};
