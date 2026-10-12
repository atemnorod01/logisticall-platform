import { useEffect, useRef, useState } from "react";
import { Icon } from "./ui.js";
import type { Calling } from "./calls-ui.js";

export function CallAudioPicker({
  controller,
  disabled,
}: {
  controller: Calling["controller"];
  disabled: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [devices, setDevices] = useState<Awaited<
    ReturnType<typeof controller.audioDevices>
  > | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const root = useRef<HTMLDivElement>(null);
  const button = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    if (!open) return;
    let alive = true;
    const refresh = () => {
      void controller
        .audioDevices()
        .then((value) => {
          if (alive) setDevices(value);
        })
        .catch(() => {
          if (alive) setError("Could not load audio devices.");
        });
    };
    refresh();
    const doc = root.current!.ownerDocument;
    const outside = (e: PointerEvent) => {
      if (!root.current?.contains(e.target as Node)) setOpen(false);
    };
    doc.addEventListener("pointerdown", outside);
    navigator.mediaDevices?.addEventListener("devicechange", refresh);
    return () => {
      alive = false;
      doc.removeEventListener("pointerdown", outside);
      navigator.mediaDevices?.removeEventListener("devicechange", refresh);
    };
  }, [open, controller]);
  async function change(kind: "microphone" | "speaker", id: string) {
    setBusy(true);
    setError("");
    try {
      await (kind === "microphone"
        ? controller.selectMicrophone(id)
        : controller.selectSpeaker(id));
      setDevices(await controller.audioDevices());
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not switch device.");
    } finally {
      setBusy(false);
    }
  }
  return (
    <div
      className="lc-audio-picker"
      ref={root}
      onKeyDown={(e) => {
        if (e.key === "Escape" && open) {
          e.preventDefault();
          e.stopPropagation();
          setOpen(false);
          button.current?.focus();
        }
      }}
    >
      <button
        ref={button}
        className="lc-active-control"
        disabled={disabled}
        aria-label="Audio devices"
        aria-expanded={open}
        onClick={() => setOpen(!open)}
        title="Audio devices"
      >
        <Icon name="headphones" />
        <span>Audio</span>
      </button>
      {open && (
        <section className="lc-audio-menu" aria-label="Audio devices">
          <strong>Audio devices</strong>
          {(["microphone", "speaker"] as const).map((kind) => (
            <label key={kind}>
              {kind === "microphone" ? "Microphone" : "Speaker"}
              <select
                aria-label={kind === "microphone" ? "Microphone" : "Speaker"}
                disabled={
                  busy ||
                  !devices ||
                  (kind === "speaker" && !devices.canSelectSpeaker)
                }
                value={devices?.[kind] ?? "default"}
                onChange={(e) => void change(kind, e.target.value)}
              >
                <option value="default">System default</option>
                {devices?.devices
                  .filter(
                    (d) =>
                      d.kind ===
                        (kind === "microphone"
                          ? "audioinput"
                          : "audiooutput") &&
                      d.deviceId &&
                      d.deviceId !== "default",
                  )
                  .map((d, i) => (
                    <option key={d.deviceId} value={d.deviceId}>
                      {d.label ||
                        `${kind === "microphone" ? "Microphone" : "Speaker"} ${i + 1}`}
                    </option>
                  ))}
              </select>
            </label>
          ))}
          {devices && !devices.canSelectSpeaker && (
            <p>Speaker output uses your system settings in this browser.</p>
          )}
          {error && <p role="alert">{error}</p>}
        </section>
      )}
    </div>
  );
}
