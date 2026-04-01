const SIMPLEMDM_API_BASE = String(
  process.env.SIMPLEMDM_API_BASE || "https://a.simplemdm.com/api/v1"
).replace(/\/+$/, "");
const SIMPLEMDM_API_KEY = String(process.env.SIMPLEMDM_API_KEY || "").trim();

function getBasicAuthHeader() {
  if (!SIMPLEMDM_API_KEY) {
    throw new Error("SIMPLEMDM_API_KEY가 설정되어 있지 않습니다.");
  }
  return `Basic ${Buffer.from(`${SIMPLEMDM_API_KEY}:`).toString("base64")}`;
}

async function simpleMdmRequest(path, options = {}) {
  const res = await fetch(`${SIMPLEMDM_API_BASE}${path}`, {
    ...options,
    headers: {
      Authorization: getBasicAuthHeader(),
      Accept: "application/json",
      ...(options.body ? { "Content-Type": "application/x-www-form-urlencoded" } : {}),
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
    throw new Error(message);
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

module.exports = {
  findDeviceBySerial,
  findAppByBundleId,
  findAppByName,
  createAppInCatalog,
  createAssignmentGroup,
  assignAppToGroup,
  unassignAppFromGroup,
  assignDeviceToGroup,
  pushApps
};
