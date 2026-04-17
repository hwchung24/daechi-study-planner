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

async function simpleMdmRequest(path, options = {}) {
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

async function findDeviceBySerial(serial) {
  const data = await simpleMdmRequest(
    `/devices?search=${encodeURIComponent(serial)}`
  );
  const list = Array.isArray(data?.data) ? data.data : [];
  return (
    list.find(
      item =>
        String(item?.attributes?.serial_number || "").toUpperCase() ===
        String(serial).toUpperCase()
    ) || null
  );
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
  return listPaginatedCollection(`/assignment_groups/${numericGroupId}/profiles`);
}

module.exports = {
  isSimpleMdmConfigured,
  simpleMdmRequest,
  findDeviceBySerial,
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
  syncProfiles,
  listProfiles,
  findProfileByName,
  listProfilesForAssignmentGroup
};
