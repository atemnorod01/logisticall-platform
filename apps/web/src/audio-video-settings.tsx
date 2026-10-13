import { useEffect, useRef, useState } from "react";
import {
  captureMicrophone,
  configureSpeaker,
  readMediaPreferences,
  saveMediaPreferences,
  speakerTestBlob,
  type MediaPreferences,
  type MicrophoneCapture,
} from "./media-preferences.js";
import "./styles/audio-video-settings.css";
function mediaError(error: unknown) {
  const name = error instanceof Error ? error.name : "";
  if (name === "NotAllowedError" || name === "SecurityError")
    return "Device access was denied. Allow access in your browser or Mac privacy settings, then try again.";
  if (["NotFoundError", "OverconstrainedError"].includes(name))
    return "This device is unavailable. Reconnect it or choose another device.";
  if (name === "NotReadableError")
    return "This device could not be opened. Close other apps using it and try again.";
  return error instanceof Error
    ? error.message
    : "Could not use this device. Please try again.";
}
export function AudioVideoSettings() {
  const [tab, setTab] = useState<"audio" | "video">("audio");
  const [saved, setSaved] = useState(readMediaPreferences);
  const [value, setValue] = useState(saved);
  const [devices, setDevices] = useState<MediaDeviceInfo[]>([]);
  const [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [notice, setNotice] = useState("");
  const [testing, setTesting] = useState<
    "" | "speaker" | "microphone" | "sample" | "camera"
  >("");
  const [level, setLevel] = useState(0),
    [seconds, setSeconds] = useState(0),
    [sample, setSample] = useState<Blob | null>(null);
  const live = useRef(true),
    version = useRef(0);
  const mic = useRef<MicrophoneCapture | null>(null),
    camera = useRef<MediaStream | null>(null);
  const video = useRef<HTMLVideoElement | null>(null),
    player = useRef<HTMLAudioElement | null>(null);
  const context = useRef<AudioContext | null>(null),
    recorder = useRef<MediaRecorder | null>(null);
  const meterTimer = useRef<ReturnType<typeof setInterval> | undefined>(
      undefined,
    ),
    recordTimer = useRef<ReturnType<typeof setInterval> | undefined>(undefined);
  const objectUrl = useRef("");
  const supportsSpeaker =
    typeof HTMLMediaElement !== "undefined" &&
    typeof HTMLMediaElement.prototype.setSinkId === "function";
  function releaseInput() {
    clearInterval(meterTimer.current);
    clearInterval(recordTimer.current);
    mic.current?.close();
    mic.current = null;
    camera.current?.getTracks().forEach((t) => t.stop());
    camera.current = null;
    if (video.current) video.current.srcObject = null;
    if (context.current) {
      void context.current.close().catch(() => {});
      context.current = null;
    }
  }
  function stop() {
    version.current++;
    if (recorder.current) {
      recorder.current.onstop = null;
      recorder.current.ondataavailable = null;
      recorder.current.onerror = null;
      if (recorder.current.state !== "inactive") recorder.current.stop();
      recorder.current = null;
    }
    releaseInput();
    if (player.current) {
      player.current.onended = null;
      player.current.onerror = null;
      player.current.pause();
      player.current.src = "";
      player.current = null;
    }
    if (objectUrl.current) {
      URL.revokeObjectURL(objectUrl.current);
      objectUrl.current = "";
    }
    if (live.current) {
      setTesting("");
      setBusy(false);
      setLevel(0);
    }
  }
  async function refreshDevices() {
    try {
      const list = await navigator.mediaDevices?.enumerateDevices();
      if (live.current) setDevices(list || []);
    } catch (error) {
      if (live.current) setError(mediaError(error));
    }
  }
  useEffect(() => {
    live.current = true;
    void refreshDevices();
    const changed = () => void refreshDevices();
    navigator.mediaDevices?.addEventListener("devicechange", changed);
    return () => {
      live.current = false;
      stop();
      navigator.mediaDevices?.removeEventListener("devicechange", changed);
    };
  }, []);
  function update<K extends keyof MediaPreferences>(
    key: K,
    next: MediaPreferences[K],
  ) {
    stop();
    setValue((v) => ({ ...v, [key]: next }));
    setNotice("");
    setError("");
    if (
      [
        "microphone",
        "microphoneVolume",
        "autoGainControl",
        "noiseSuppression",
        "echoCancellation",
      ].includes(key)
    )
      setSample(null);
  }
  async function allowAccess() {
    stop();
    const v = version.current;
    setBusy(true);
    setError("");
    try {
      const media = await navigator.mediaDevices.getUserMedia({
        audio: true,
        video: false,
      });
      media.getTracks().forEach((t) => t.stop());
      if (live.current && v === version.current) await refreshDevices();
    } catch (error) {
      if (live.current && v === version.current) setError(mediaError(error));
    } finally {
      if (live.current && v === version.current) setBusy(false);
    }
  }
  async function playback(blob: Blob, kind: "speaker" | "sample") {
    stop();
    const v = version.current;
    setError("");
    setBusy(true);
    const url = URL.createObjectURL(blob);
    objectUrl.current = url;
    const audio = new Audio(url);
    player.current = audio;
    try {
      await configureSpeaker(audio, value, false);
      if (!live.current || v !== version.current) return;
      audio.onended = () => {
        if (v === version.current) {
          stop();
          setNotice(
            kind === "speaker"
              ? "Speaker test finished."
              : "Microphone playback finished.",
          );
        }
      };
      audio.onerror = () => {
        if (v === version.current) {
          stop();
          setError("Could not play the test audio. Try another speaker.");
        }
      };
      await audio.play();
      if (live.current && v === version.current) {
        setTesting(kind);
        setBusy(false);
      }
    } catch (error) {
      if (live.current && v === version.current) {
        stop();
        setError(mediaError(error));
      }
    }
  }
  async function testMicrophone() {
    stop();
    const v = version.current;
    setBusy(true);
    setError("");
    setSample(null);
    setSeconds(0);
    setNotice("");
    try {
      if (typeof MediaRecorder === "undefined")
        throw Error(
          "Microphone recording tests are not supported by this browser.",
        );
      const capture = await captureMicrophone(value, false);
      if (!live.current || v !== version.current) {
        capture.close();
        return;
      }
      mic.current = capture;
      await refreshDevices();
      if (!live.current || v !== version.current) return;
      const ctx = new AudioContext();
      context.current = ctx;
      await ctx.resume();
      if (!live.current || v !== version.current) return;
      const source = ctx.createMediaStreamSource(capture.stream),
        analyser = ctx.createAnalyser();
      analyser.fftSize = 256;
      source.connect(analyser);
      const data = new Uint8Array(analyser.fftSize);
      meterTimer.current = setInterval(() => {
        analyser.getByteTimeDomainData(data);
        let sum = 0;
        for (const x of data) sum += ((x - 128) / 128) ** 2;
        setLevel(Math.min(100, Math.sqrt(sum / data.length) * 300));
      }, 100);
      const recording = new MediaRecorder(capture.stream);
      recorder.current = recording;
      const chunks: Blob[] = [];
      recording.ondataavailable = (e) => {
        if (e.data.size) chunks.push(e.data);
      };
      recording.onerror = () => {
        if (v === version.current) {
          stop();
          setError("Microphone recording failed. Please try again.");
        }
      };
      recording.onstop = () => {
        if (!live.current || v !== version.current) return;
        recorder.current = null;
        releaseInput();
        setTesting("");
        setLevel(0);
        const blob = new Blob(chunks, { type: recording.mimeType });
        setSample(blob.size ? blob : null);
        setNotice(
          blob.size
            ? "Sample ready. Play it back to hear your microphone."
            : "No audio was recorded. Please try again.",
        );
      };
      capture.raw.getAudioTracks().forEach((t) =>
        t.addEventListener(
          "ended",
          () => {
            if (v === version.current) {
              stop();
              setError("Microphone disconnected. Choose another device.");
            }
          },
          { once: true },
        ),
      );
      recording.start();
      setTesting("microphone");
      setBusy(false);
      let elapsed = 0;
      recordTimer.current = setInterval(() => {
        elapsed++;
        setSeconds(elapsed);
        if (elapsed >= 8 && recording.state === "recording") recording.stop();
      }, 1000);
    } catch (error) {
      if (live.current && v === version.current) {
        stop();
        setError(mediaError(error));
      }
    }
  }
  async function testCamera() {
    stop();
    const v = version.current;
    setBusy(true);
    setError("");
    try {
      const media = await navigator.mediaDevices.getUserMedia({
        audio: false,
        video:
          value.camera === "default"
            ? true
            : { deviceId: { exact: value.camera } },
      });
      if (!live.current || v !== version.current) {
        media.getTracks().forEach((t) => t.stop());
        return;
      }
      camera.current = media;
      await refreshDevices();
      if (!live.current || v !== version.current) return;
      if (video.current) {
        video.current.srcObject = media;
        await video.current.play();
      }
      if (live.current && v === version.current) {
        setTesting("camera");
        setBusy(false);
      }
      media.getVideoTracks().forEach(
        (t) =>
          (t.onended = () => {
            if (v === version.current) {
              stop();
              setError("Camera disconnected. Choose another device.");
            }
          }),
      );
    } catch (error) {
      if (live.current && v === version.current) {
        stop();
        setError(mediaError(error));
      }
    }
  }
  function deviceSelect(
    kind: MediaDeviceKind,
    key: "microphone" | "speaker" | "camera",
    label: string,
  ) {
    const options = devices.filter(
      (d) =>
        d.kind === kind &&
        d.deviceId &&
        d.deviceId !== "default" &&
        d.deviceId !== "communications",
    );
    const missing =
      value[key] !== "default" &&
      !options.some((d) => d.deviceId === value[key]);
    return (
      <>
        <select
          aria-label={label}
          value={value[key]}
          disabled={busy || (key === "speaker" && !supportsSpeaker)}
          onChange={(e) => update(key, e.target.value)}
        >
          <option value="default">System default</option>
          {missing && (
            <option value={value[key]}>Saved device (unavailable)</option>
          )}
          {options.map((d, i) => (
            <option key={d.deviceId} value={d.deviceId}>
              {d.label || `${label} ${i + 1}`}
            </option>
          ))}
        </select>
        {missing && (
          <small>
            Reconnect your saved device or select another. Calls use the system
            default if it is unavailable.
          </small>
        )}
      </>
    );
  }
  function volume(key: "speakerVolume" | "microphoneVolume", label: string) {
    return (
      <label className="lc-av-row">
        <span>{label}</span>
        <div className="lc-av-range">
          <input
            aria-label={label}
            type="range"
            min="0"
            max="100"
            value={Math.round(value[key] * 100)}
            disabled={
              busy || (key === "microphoneVolume" && value.autoGainControl)
            }
            onChange={(e) => update(key, Number(e.target.value) / 100)}
          />
          <output>
            {key === "microphoneVolume" && value.autoGainControl
              ? "Auto"
              : `${Math.round(value[key] * 100)}%`}
          </output>
        </div>
      </label>
    );
  }
  const dirty = JSON.stringify(saved) !== JSON.stringify(value);
  return (
    <div className="lc-av-settings">
      <div
        className="lc-av-tabs"
        role="tablist"
        aria-label="Audio and video settings"
      >
        {(["audio", "video"] as const).map((t) => (
          <button
            key={t}
            id={`av-${t}-tab`}
            role="tab"
            aria-controls={`av-${t}-panel`}
            aria-selected={tab === t}
            tabIndex={tab === t ? 0 : -1}
            onKeyDown={(e) => {
              if (["ArrowLeft", "ArrowRight"].includes(e.key)) {
                e.preventDefault();
                stop();
                const next = tab === "audio" ? "video" : "audio";
                setTab(next);
                document.getElementById(`av-${next}-tab`)?.focus();
              }
            }}
            onClick={() => {
              stop();
              setError("");
              setNotice("");
              setTab(t);
            }}
          >
            {t === "audio" ? "Audio" : "Video"}
          </button>
        ))}
      </div>
      {!navigator.mediaDevices && (
        <p role="alert">
          Device controls require a supported browser with a secure connection.
        </p>
      )}
      <div
        id="av-audio-panel"
        role="tabpanel"
        aria-labelledby="av-audio-tab"
        hidden={tab !== "audio"}
      >
        <section className="lc-av-section">
          <h3>Speaker</h3>
          <label className="lc-av-row">
            <span>Output device</span>
            <div>
              {deviceSelect("audiooutput", "speaker", "Speaker device")}
            </div>
          </label>
          {!supportsSpeaker && (
            <p>
              Your browser uses the system speaker. Output selection is
              available in the desktop app and supported browsers.
            </p>
          )}
          {volume("speakerVolume", "Call volume")}
          <div className="lc-av-test">
            <button
              className="button"
              disabled={busy || value.speakerVolume === 0}
              onClick={() =>
                testing === "speaker"
                  ? stop()
                  : void playback(speakerTestBlob(), "speaker")
              }
            >
              {testing === "speaker" ? "Stop test" : "Test speaker"}
            </button>
            <span>Plays a short tone on the selected speaker.</span>
          </div>
        </section>
        <section className="lc-av-section">
          <h3>Microphone</h3>
          <label className="lc-av-row">
            <span>Input device</span>
            <div>
              {deviceSelect("audioinput", "microphone", "Microphone device")}
            </div>
          </label>
          {volume("microphoneVolume", "Microphone level")}
          <div className="lc-av-row">
            <span>Input level</span>
            <meter
              min="0"
              max="100"
              value={level}
              aria-label="Microphone input level"
            />
          </div>
          <div className="lc-av-test">
            <button
              className="button"
              disabled={busy || !navigator.mediaDevices}
              onClick={() =>
                testing === "microphone"
                  ? recorder.current?.stop()
                  : void testMicrophone()
              }
            >
              {testing === "microphone"
                ? `Stop recording · ${seconds}s`
                : "Test microphone"}
            </button>
            {sample && (
              <button
                className="button"
                disabled={busy || value.speakerVolume === 0}
                onClick={() =>
                  testing === "sample"
                    ? stop()
                    : void playback(sample, "sample")
                }
              >
                {testing === "sample" ? "Stop playback" : "Play sample"}
              </button>
            )}
            <span>
              Records up to 8 seconds for playback. Nothing is uploaded.
            </span>
          </div>
          <details>
            <summary>Microphone processing</summary>
            {(
              [
                ["noiseSuppression", "Noise suppression"],
                ["echoCancellation", "Echo cancellation"],
                ["autoGainControl", "Automatically adjust microphone level"],
              ] as const
            ).map(([key, label]) => (
              <label className="lc-av-check" key={key}>
                <span>{label}</span>
                <input
                  type="checkbox"
                  checked={value[key]}
                  disabled={busy}
                  onChange={(e) => update(key, e.target.checked)}
                />
              </label>
            ))}
          </details>
        </section>
      </div>
      <div
        id="av-video-panel"
        role="tabpanel"
        aria-labelledby="av-video-tab"
        hidden={tab !== "video"}
      >
        <section className="lc-av-section">
          <h3>Camera</h3>
          <label className="lc-av-row">
            <span>Video device</span>
            <div>{deviceSelect("videoinput", "camera", "Camera device")}</div>
          </label>
          <div className="lc-av-camera">
            <video
              ref={video}
              muted
              playsInline
              style={{
                transform: value.mirror ? "scaleX(-1)" : undefined,
                visibility: testing === "camera" ? "visible" : "hidden",
              }}
            />
            {testing !== "camera" && <span>Camera preview off</span>}
          </div>
          <div className="lc-av-test">
            <button
              className="button"
              disabled={busy || !navigator.mediaDevices}
              onClick={() =>
                testing === "camera" ? stop() : void testCamera()
              }
            >
              {testing === "camera" ? "Stop preview" : "Preview camera"}
            </button>
          </div>
          <label className="lc-av-check">
            <span>Mirror my preview</span>
            <input
              type="checkbox"
              checked={value.mirror}
              onChange={(e) =>
                setValue((v) => ({ ...v, mirror: e.target.checked }))
              }
            />
          </label>
          <p>
            Saved camera default for this app. Video calling is not available
            yet.
          </p>
        </section>
      </div>
      {(devices.length === 0 || devices.some((d) => d.kind !== "videoinput" && !d.label)) && (
        <button
          className="button"
          disabled={busy || !navigator.mediaDevices}
          onClick={() => void allowAccess()}
        >
          Allow device access
        </button>
      )}
      <div className="lc-av-footer">
        <span>
          {dirty
            ? "Unsaved changes"
            : "Defaults for LogistiCall on this device"}
          <small>
            Saved audio settings apply to your next call or recording.
          </small>
        </span>
        <button
          className="button primary"
          disabled={busy || !dirty}
          onClick={() => {
            try {
              saveMediaPreferences(value);
              setSaved({ ...value });
              setNotice("Device preferences saved.");
              setError("");
            } catch {
              setError(
                "Could not save preferences on this device. Please try again.",
              );
            }
          }}
        >
          Save changes
        </button>
      </div>
      <p className="lc-av-feedback" role={error ? "alert" : "status"}>
        {error || notice || (busy ? "Opening device…" : "")}
      </p>
    </div>
  );
}
