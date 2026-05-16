export async function sendParentAdminChannelMessage(
  apiBase: string,
  authToken: string,
  studentId: number,
  message: string
) {
  const trimmed = String(message || "").trim();
  if (!trimmed) {
    throw new Error("message_required");
  }
  const res = await fetch(`${apiBase.replace(/\/$/, "")}/api/parent/admin-channel/messages`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${authToken}`
    },
    body: JSON.stringify({ studentId, message: trimmed })
  });
  const data = (await res.json().catch(() => ({}))) as { error?: string };
  if (!res.ok) {
    throw new Error(String(data.error || "메시지 전송에 실패했습니다."));
  }
  return data;
}
