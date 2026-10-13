import { VoicemailVoicePicker } from "./voicemail-voice-picker.js";
import { LoadingSkeleton } from "./loading-skeleton.js";
import { useEffect, useState } from "react";
import {
  voicemailSettings,
  defaultVoicemailSettings,
  type VoicemailSettings,
} from "../../../packages/types/src/voicemail.js";
import { AudioRecorder } from "./chat/audio-recorder.js";
import { Icon } from "./ui.js";
import "./styles/voicemail-settings.css";
import { greetingUrl } from "./voicemail-audio.js";
export function VoicemailSettingsEditor({
  org,
  csrf,
  name,
}: {
  org: string;
  csrf: string;
  name: string;
}) {
  const [settings, setSettings] = useState<VoicemailSettings>(
    defaultVoicemailSettings,
  );
  const [saved, setSaved] = useState<VoicemailSettings | null>(null);
  const [busy, setBusy] = useState(false),
    [record, setRecord] = useState(false);
  const [error, setError] = useState(""),
    [notice, setNotice] = useState(""),
    [preview, setPreview] = useState("");
  const [reload, setReload] = useState(0);
  useEffect(() => {
    const abort = new AbortController();
    setSaved(null);
    setError("");
    void fetch(`/v1/organizations/${org}/calls`, {
      method: "POST",
      credentials: "same-origin",
      headers: { "Content-Type": "application/json", "X-CSRF-Token": csrf },
      body: JSON.stringify({
        action: "preferences",
        client: crypto.randomUUID(),
      }),
      signal: abort.signal,
    })
      .then(async (r) => {
        if (!r.ok) throw Error();
        const result = voicemailSettings.parse((await r.json()).settings);
        if (!abort.signal.aborted) {
          setSettings(result);
          setSaved(result);
        }
      })
      .catch(() => {
        if (!abort.signal.aborted)
          setError("Could not load voicemail settings. Please retry.");
      });
    return () => abort.abort();
  }, [org, csrf, reload]);
  useEffect(() => {
    if (!settings.greeting) {
      setPreview("");
      return;
    }
    const url = greetingUrl(settings.greeting);
    setPreview(url);
    return () => URL.revokeObjectURL(url);
  }, [settings.greeting]);
  async function recorded(file: File) {
    setRecord(false);
    setError("");
    setNotice("");
    if (file.size > 2 * 1024 * 1024) {
      setError("Please record a shorter greeting (up to 60 seconds).");
      return;
    }
    const bytes = new Uint8Array(await file.arrayBuffer());
    let raw = "";
    for (const byte of bytes) raw += String.fromCharCode(byte);
    const parsed = voicemailSettings.safeParse({
      ...settings,
      greeting: { mime: file.type, data: btoa(raw) },
    });
    if (!parsed.success) {
      setError("Unsupported recording. Please record again.");
      return;
    }
    setSettings(parsed.data);
  }
  async function save() {
    setBusy(true);
    setError("");
    setNotice("");
    try {
      const r = await fetch(`/v1/organizations/${org}/calls`, {
        method: "POST",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json", "X-CSRF-Token": csrf },
        body: JSON.stringify({
          action: "savePreferences",
          client: crypto.randomUUID(),
          settings,
        }),
        signal: AbortSignal.timeout(30000),
      });
      if (!r.ok) throw Error();
      const result = voicemailSettings.parse((await r.json()).settings);
      setSaved(result);
      setSettings(result);
      setNotice("Voicemail settings saved.");
    } catch {
      setError(
        "Could not save voicemail settings. Your changes are still here; try again.",
      );
    } finally {
      setBusy(false);
    }
  }
  const dirty =
    saved &&
    (settings.ringSeconds !== saved.ringSeconds ||
      settings.greeting !== saved.greeting ||
      JSON.stringify(settings.standardVoice) !==
        JSON.stringify(saved.standardVoice));
  return (
    <section className="lc-voicemail-settings" aria-label="Voicemail settings">
      {!saved ? (
        error ? (
          <div role="alert">
            {error}{" "}
            <button className="button" onClick={() => setReload((n) => n + 1)}>
              Retry
            </button>
          </div>
        ) : (
          <LoadingSkeleton variant="details" rows={3} />
        )
      ) : (
        <>
          <div className="lc-voicemail-card">
            <div className="lc-voicemail-card-heading">
              <span className="lc-voicemail-symbol">
                <Icon name="headphones" />
              </span>
              <div>
                <h3>Greeting</h3>
                <p>
                  {settings.greeting
                    ? "Personal recording"
                    : "Standard greeting"}
                </p>
              </div>
              {settings.greeting && (
                <span className="lc-voicemail-limit">60 sec max</span>
              )}
            </div>
            {!settings.greeting && (
              <VoicemailVoicePicker
                name={name}
                value={settings.standardVoice}
                disabled={busy}
                onChange={(voice) => {
                  setSettings({ ...settings, standardVoice: voice });
                  setNotice("");
                }}
              />
            )}
            {preview && (
              <audio
                key={preview}
                controls
                preload="metadata"
                src={preview}
                aria-label="Greeting preview"
              />
            )}
            <div className="lc-voicemail-buttons">
              <button
                className="button"
                disabled={busy}
                onClick={() => setRecord(true)}
              >
                {settings.greeting ? "Record again" : "Record greeting"}
              </button>
              {settings.greeting && (
                <button
                  className="button lc-voicemail-reset"
                  disabled={busy}
                  onClick={() => {
                    setSettings({ ...settings, greeting: null });
                    setNotice("");
                  }}
                >
                  Use standard
                </button>
              )}
            </div>
          </div>
          <div className="lc-voicemail-card lc-voicemail-ring">
            <div>
              <label htmlFor="voicemail-ring-time">Ring time</label>
              <p>Before sending callers to voicemail.</p>
            </div>
            <select
              id="voicemail-ring-time"
              aria-label="Ring time"
              value={settings.ringSeconds}
              disabled={busy}
              onChange={(e) => {
                setSettings({
                  ...settings,
                  ringSeconds: Number(e.target.value),
                });
                setNotice("");
              }}
            >
              {Array.from({ length: 23 }, (_, i) => 10 + i * 5).map(
                (seconds) => (
                  <option key={seconds} value={seconds}>
                    {seconds} seconds
                  </option>
                ),
              )}
            </select>
          </div>
          <div className="lc-voicemail-save">
            <span role="status">
              {dirty ? "Unsaved changes" : notice ? "Saved" : ""}
            </span>
            <button
              className="button primary"
              disabled={busy || !dirty}
              onClick={() => void save()}
            >
              {busy ? "Saving…" : "Save changes"}
            </button>
          </div>
          {error && <p role="alert">{error}</p>}
        </>
      )}
      {record && (
        <AudioRecorder
          title="Record greeting"
          standardPreview
          maxSeconds={60}
          attachLabel="Use greeting"
          onClose={() => setRecord(false)}
          onAttach={(file) => void recorded(file)}
        />
      )}
    </section>
  );
}
