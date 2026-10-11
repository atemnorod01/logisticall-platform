import { AudioPlayer } from "./audio-player.js";
import { useEffect, useRef, useState } from "react";
import { Modal } from "../settings-ui.js";

export function AudioRecorder({
  onClose,
  onAttach,
  title = "Record audio",
  maxSeconds = 600,
  attachLabel = "Attach to message",
  standardPreview = false,
}: {
  standardPreview?: boolean;
  title?: string;
  maxSeconds?: number;
  attachLabel?: string;
  onClose: () => void;
  onAttach: (file: File) => void;
}) {
  const [recording, setRecording] = useState(false);
  const [starting, setStarting] = useState(false);
  const [seconds, setSeconds] = useState(0);
  const [error, setError] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState("");
  const live = useRef(true);
  const media = useRef<MediaStream | null>(null);
  const recorder = useRef<MediaRecorder | null>(null);
  const timer = useRef<ReturnType<typeof setInterval> | undefined>(undefined);
  const release = () => {
    clearInterval(timer.current);
    media.current?.getTracks().forEach((t) => t.stop());
    media.current = null;
  };
  useEffect(() => {
    live.current = true;
    return () => {
      live.current = false;
      if (recorder.current) {
        recorder.current.onstop = null;
        recorder.current.ondataavailable = null;
        recorder.current.onerror = null;
        if (recorder.current.state !== "inactive") recorder.current.stop();
      }
      release();
    };
  }, []);
  useEffect(() => {
    if (!file) {
      setPreview("");
      return;
    }
    const url = URL.createObjectURL(file);
    setPreview(url);
    return () => URL.revokeObjectURL(url);
  }, [file]);
  function stop() {
    if (recorder.current?.state === "recording") recorder.current.stop();
  }
  async function start() {
    if (starting || recording) return;
    setStarting(true);
    setError("");
    try {
      if (
        !navigator.mediaDevices?.getUserMedia ||
        typeof MediaRecorder === "undefined"
      )
        throw Error("Audio recording is not supported in this browser.");
      const mime = [
        "audio/webm;codecs=opus",
        "audio/webm",
        "audio/mp4",
        "audio/ogg;codecs=opus",
      ].find((t) => MediaRecorder.isTypeSupported(t));
      if (!mime)
        throw Error("This browser cannot record a supported audio format.");
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: true,
        video: false,
      });
      if (!live.current) {
        stream.getTracks().forEach((t) => t.stop());
        return;
      }
      media.current = stream;
      const capture = new MediaRecorder(stream, {
        mimeType: mime,
        audioBitsPerSecond: 128000,
      });
      recorder.current = capture;
      const chunks: Blob[] = [];
      let size = 0;
      let failed = false;
      capture.ondataavailable = (e) => {
        if (e.data.size) {
          chunks.push(e.data);
          size += e.data.size;
          if (size >= 24 * 1024 * 1024) stop();
        }
      };
      capture.onerror = () => {
        failed = true;
        release();
        setRecording(false);
        setError("Recording failed. Please try again.");
      };
      capture.onstop = () => {
        release();
        setRecording(false);
        if (failed) return;
        if (!size || size > 25 * 1024 * 1024) {
          setError(
            "Could not save this recording. Please try a shorter recording.",
          );
          return;
        }
        const type = mime.split(";")[0]!;
        const extension =
          type === "audio/mp4" ? "m4a" : type === "audio/ogg" ? "ogg" : "webm";
        setFile(new File(chunks, `audio-${Date.now()}.${extension}`, { type }));
      };
      capture.start(250);
      setRecording(true);
      setSeconds(0);
      const started = Date.now();
      timer.current = setInterval(() => {
        const elapsed = Math.floor((Date.now() - started) / 1000);
        setSeconds(elapsed);
        if (elapsed >= maxSeconds) stop();
      }, 250);
    } catch (e) {
      release();
      if (live.current)
        setError(
          e instanceof DOMException && e.name === "NotAllowedError"
            ? "Microphone access was denied. Allow access in your browser and try again."
            : e instanceof DOMException && e.name === "NotFoundError"
              ? "No microphone was found. Connect one and try again."
              : e instanceof Error
                ? e.message
                : "Could not start the microphone. Please try again.",
        );
    } finally {
      if (live.current) setStarting(false);
    }
  }
  return (
    <Modal title={title} onClose={onClose}>
      <div className="lc-audio-capture">
        {file ? (
          standardPreview ? (
            <audio
              controls
              src={preview}
              aria-label="Greeting preview"
              style={{ width: "100%" }}
            />
          ) : (
            <AudioPlayer url={preview} name={file.name} />
          )
        ) : (
          <>
            <div className="lc-audio-timer" role="status">
              {recording && <span className="lc-recording-dot" />}
              {Math.floor(seconds / 60)}:{String(seconds % 60).padStart(2, "0")}
            </div>
            <p>
              {starting
                ? "Starting microphone…"
                : recording
                  ? "Recording…"
                  : standardPreview
                    ? `Up to ${maxSeconds} seconds.`
                    : `Record, then listen before saving. Up to ${maxSeconds < 120 ? `${maxSeconds} seconds` : `${maxSeconds / 60} minutes`}.`}
            </p>
          </>
        )}
        {error && <p role="alert">{error}</p>}
        <div className="lc-camera-actions">
          {file ? (
            <>
              <button
                type="button"
                onClick={() => {
                  setFile(null);
                  setSeconds(0);
                }}
              >
                Record again
              </button>
              <button type="button" onClick={() => onAttach(file)}>
                {attachLabel}
              </button>
            </>
          ) : (
            <button
              type="button"
              disabled={starting}
              onClick={recording ? stop : () => void start()}
            >
              {recording ? "Stop recording" : "Start recording"}
            </button>
          )}
        </div>
      </div>
    </Modal>
  );
}
