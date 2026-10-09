import { useEffect, useState } from "react";
import { z } from "zod";
export type PresenceMode = "auto" | "available" | "away" | "busy";
const statusSchema = z.object({
  status: z.enum(["available", "away", "busy"]),
});
export function usePresence(
  organizationId: string | undefined,
  csrf: string | undefined,
  userId: string | undefined,
  refreshSession: () => Promise<void>,
) {
  const [mode, setMode] = useState<PresenceMode>("auto");
  const [status, setStatus] = useState("unknown");
  useEffect(() => {
    setMode("auto");
  }, [userId]);
  useEffect(() => {
    setStatus("unknown");
    if (!organizationId || !csrf) return;
    let stopped = false,
      busy = false,
      lastActivity = Date.now(),
      lastAttempt = 0,
      needsRecovery = false;
    const abort = new AbortController();
    const activity = () => {
      const wasIdle = Date.now() - lastActivity >= 5 * 60000;
      lastActivity = Date.now();
      if ((wasIdle || needsRecovery) && lastActivity - lastAttempt > 5000) void beat();
    };
    async function beat() {
      if (busy || stopped) return;
      // Presence alone must not keep an unattended session alive indefinitely.
      if (Date.now() - lastActivity > 25 * 60000) {
        needsRecovery = true;
        setStatus("unknown");
        return;
      }
      busy = true;
      lastAttempt = Date.now();
      try {
        const response = await fetch(
          `/v1/organizations/${encodeURIComponent(organizationId!)}/presence`,
          {
            method: "POST",
            credentials: "same-origin",
            cache: "no-store",
            redirect: "error",
            headers: {
              "Content-Type": "application/json",
              "X-CSRF-Token": csrf!,
            },
            body: JSON.stringify({
              mode,
              active:
                document.visibilityState === "visible" &&
                Date.now() - lastActivity < 5 * 60000,
            }),
            signal: AbortSignal.any([abort.signal, AbortSignal.timeout(8000)]),
          },
        );
        if (response.status === 401 || response.status === 403) {
          await refreshSession();
        }
        if (!response.ok) throw Error();
        const result = statusSchema.parse(await response.json());
        needsRecovery = false;
        if (!stopped) setStatus(result.status);
      } catch {
        needsRecovery = true;
        if (!stopped) setStatus("unknown");
      } finally {
        busy = false;
      }
    }
    const visibility = () => {
      void beat();
    };
    window.addEventListener("pointerdown", activity);
    window.addEventListener("keydown", activity);
    window.addEventListener("pointermove", activity);
    document.addEventListener("visibilitychange", visibility);
    void beat();
    const timer = setInterval(() => void beat(), 30000);
    return () => {
      stopped = true;
      abort.abort();
      clearInterval(timer);
      window.removeEventListener("pointerdown", activity);
      window.removeEventListener("keydown", activity);
      window.removeEventListener("pointermove", activity);
      document.removeEventListener("visibilitychange", visibility);
    };
  }, [organizationId, csrf, mode, userId, refreshSession]);
  return { mode, setMode, status };
}
