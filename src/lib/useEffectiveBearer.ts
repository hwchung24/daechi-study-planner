import { useEffect, useState } from "react";

/** App의 authToken과 동일 세션 보장 + 이메일 없이 LS에만 토큰 있을 때 대비 */
export function useEffectiveBearer(authToken: string | null): string {
  const parent = String(authToken ?? "").trim();
  const [fromLs, setFromLs] = useState("");
  useEffect(() => {
    const read = () => {
      try {
        setFromLs(String(localStorage.getItem("daechi_planner_token") || "").trim());
      } catch {
        setFromLs("");
      }
    };
    read();
    window.addEventListener("storage", read);
    return () => window.removeEventListener("storage", read);
  }, []);
  useEffect(() => {
    if (parent) setFromLs(parent);
  }, [parent]);
  return parent || fromLs;
}
