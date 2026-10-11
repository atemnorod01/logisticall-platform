import { VideoReview } from "./video-review.js";
import { audioTime } from "./audio-waveform.js";
import { AudioRecorder } from "./audio-recorder.js";
import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Modal } from "../settings-ui.js";

export function AttachmentMenu({
  disabled,
  onFiles,
}: {
  disabled: boolean;
  onFiles: (files: File[]) => void;
}) {
  const [open, setOpen] = useState(false);
  const [camera, setCamera] = useState(false);
  const [audio, setAudio] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const input = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (!open) return;
    const outside = (e: PointerEvent) => {
      if (!root.current?.contains(e.target as Node)) setOpen(false);
    };
    const escape = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        setOpen(false);
        trigger.current?.focus();
      }
    };
    document.addEventListener("pointerdown", outside);
    document.addEventListener("keydown", escape);
    root.current
      ?.querySelector<HTMLButtonElement>('[role="menuitem"]')
      ?.focus();
    return () => {
      document.removeEventListener("pointerdown", outside);
      document.removeEventListener("keydown", escape);
    };
  }, [open]);
  return (
    <div className="lc-attachment-control" ref={root}>
      <input
        type="file"
        multiple
        hidden
        ref={input}
        onChange={(e) => {
          onFiles(Array.from(e.target.files ?? []));
          e.target.value = "";
        }}
      />
      <button
        ref={trigger}
        type="button"
        className="lc-attach"
        aria-label="Add attachment"
        aria-haspopup="menu"
        aria-expanded={open}
        disabled={disabled}
        onClick={() => setOpen(!open)}
      >
        +
      </button>
      {open && (
        <div
          className="lc-attachment-menu"
          role="menu"
          aria-label="Add attachment"
          onKeyDown={(e) => {
            if (!["ArrowDown", "ArrowUp", "Home", "End"].includes(e.key))
              return;
            e.preventDefault();
            const items = [
              ...e.currentTarget.querySelectorAll<HTMLButtonElement>(
                '[role="menuitem"]',
              ),
            ];
            const index = items.indexOf(
              document.activeElement as HTMLButtonElement,
            );
            items[
              e.key === "Home"
                ? 0
                : e.key === "End"
                  ? items.length - 1
                  : (index + (e.key === "ArrowDown" ? 1 : -1) + items.length) %
                    items.length
            ]?.focus();
          }}
        >
          <button
            type="button"
            role="menuitem"
            onClick={() => {
              setOpen(false);
              setCamera(true);
            }}
          >
            Camera <span>Take a photo or record a video</span>
          </button>
          <button
            type="button"
            role="menuitem"
            onClick={() => {
              setOpen(false);
              setAudio(true);
            }}
          >
            Record audio
          </button>
          <button
            type="button"
            role="menuitem"
            onClick={() => {
              setOpen(false);
              input.current?.click();
            }}
          >
            Photos and files
          </button>
        </div>
      )}
      {audio &&
        createPortal(
          <AudioRecorder
            onClose={() => {
              setAudio(false);
              trigger.current?.focus();
            }}
            onAttach={(file) => {
              onFiles([file]);
              setAudio(false);
              trigger.current?.focus();
            }}
          />,
          document.getElementById("app")!,
        )}
      {camera &&
        createPortal(
          <CameraAttachment
            onClose={() => {
              setCamera(false);
              trigger.current?.focus();
            }}
            onAttach={(file) => {
              onFiles([file]);
              setCamera(false);
              trigger.current?.focus();
            }}
          />,
          document.getElementById("app")!,
        )}
    </div>
  );
}

function CameraAttachment({
  onClose,
  onAttach,
}: {
  onClose: () => void;
  onAttach: (file: File) => void;
}) {
  const [mode, setMode] = useState<"photo" | "video">("video");
  const [screen, setScreen] = useState<MediaStream | null>(null);
  const display = useRef<MediaStream | null>(null);
  const [choosingScreen, setChoosingScreen] = useState(false);
  const mounted = useRef(true);
  const [cameraOff, setCameraOff] = useState(false);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      display.current?.getTracks().forEach((t) => t.stop());
    };
  }, []);
  const [ready, setReady] = useState(false);
  const [paused, setPaused] = useState(false);
  const [micMuted, setMicMuted] = useState(false);
  const [devices, setDevices] = useState<MediaDeviceInfo[]>([]);
  const [cameraId, setCameraId] = useState("");
  const [micId, setMicId] = useState("");
  const elapsed = useRef(0);
  const [error, setError] = useState("");
  const [recording, setRecording] = useState(false);
  const [seconds, setSeconds] = useState(0);
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState("");
  const [retry, setRetry] = useState(0);
  const video = useRef<HTMLVideoElement>(null);
  const stream = useRef<MediaStream | null>(null);
  const recorder = useRef<MediaRecorder | null>(null);
  const timer = useRef<ReturnType<typeof setInterval> | undefined>(undefined);
  useEffect(() => {
    if (!file) {
      setPreview("");
      return;
    }
    const url = URL.createObjectURL(file);
    setPreview(url);
    return () => URL.revokeObjectURL(url);
  }, [file]);
  useEffect(() => {
    if (file) return;
    let live = true;
    setReady(false);
    setError("");
    async function start() {
      try {
        if (!navigator.mediaDevices?.getUserMedia)
          throw Error("Camera access is unavailable in this browser.");
        const media = await navigator.mediaDevices.getUserMedia({
          video: screen
            ? false
            : {
                width: { ideal: 1280 },
                height: { ideal: 720 },
                ...(cameraId ? { deviceId: { exact: cameraId } } : {}),
              },
          audio:
            mode === "video"
              ? micId
                ? { deviceId: { exact: micId } }
                : true
              : false,
        });
        if (!live) {
          media.getTracks().forEach((t) => t.stop());
          return;
        }
        const captureStream = screen
          ? new MediaStream([
              ...screen.getVideoTracks(),
              ...media.getAudioTracks(),
            ])
          : media;
        stream.current = captureStream;
        if (!screen)
          media.getVideoTracks().forEach((t) => {
            t.enabled = !cameraOff;
          });
        media.getAudioTracks().forEach((t) => {
          t.enabled = !micMuted;
        });
        const available = await navigator.mediaDevices
          .enumerateDevices()
          .catch(() => []);
        if (!live) return;
        setDevices(available);
        if (video.current) {
          video.current.srcObject = captureStream;
          await video.current.play();
        }
        if (live) setReady(true);
      } catch (e) {
        if (live)
          setError(
            e instanceof DOMException && e.name === "NotAllowedError"
              ? "Camera or microphone access was denied. Allow access in your browser and try again."
              : e instanceof DOMException && e.name === "NotFoundError"
                ? "No camera or microphone was found. Connect a device and try again."
                : "Could not start the camera. Check that it is connected and not in use, then try again.",
          );
      }
    }
    void start();
    return () => {
      live = false;
      clearInterval(timer.current);
      if (recorder.current) {
        recorder.current.onstop = null;
        recorder.current.ondataavailable = null;
        recorder.current.onerror = null;
        if (recorder.current.state !== "inactive") recorder.current.stop();
        recorder.current = null;
      }
      stream.current?.getTracks().forEach((t) => {
        if (!screen?.getTracks().includes(t)) t.stop();
      });
      stream.current = null;
    };
  }, [mode, file, retry, cameraId, micId, screen]);
  useEffect(() => {
    if (file && display.current) {
      display.current.getTracks().forEach((t) => t.stop());
      display.current = null;
      setScreen(null);
    }
  }, [file]);
  async function chooseScreen() {
    if (recording || choosingScreen) return;
    if (!navigator.mediaDevices?.getDisplayMedia) {
      setError("Screen recording is unavailable in this browser.");
      return;
    }
    setChoosingScreen(true);
    try {
      const selected = await navigator.mediaDevices.getDisplayMedia({
        video: true,
        audio: false,
      });
      if (!mounted.current) {
        selected.getTracks().forEach((t) => t.stop());
        return;
      }
      display.current?.getTracks().forEach((t) => t.stop());
      display.current = selected;
      selected.getVideoTracks()[0]!.onended = () => {
        if (!mounted.current || display.current !== selected) return;
        if (recorder.current && recorder.current.state !== "inactive") {
          stopRecording();
          return;
        }
        display.current = null;
        setScreen(null);
      };
      setScreen(selected);
      setCameraOff(false);
    } catch (e) {
      if (
        mounted.current &&
        !(e instanceof DOMException && e.name === "NotAllowedError")
      )
        setError("Could not share the screen. Please try again.");
    } finally {
      if (mounted.current) setChoosingScreen(false);
    }
  }
  function useCamera() {
    if (screen) {
      if (recording) return;
      display.current?.getTracks().forEach((t) => t.stop());
      display.current = null;
      setScreen(null);
      setCameraOff(false);
    } else {
      setCameraOff(!cameraOff);
      stream.current?.getVideoTracks().forEach((t) => {
        t.enabled = cameraOff;
      });
    }
  }
  function stopRecording() {
    if (recorder.current && recorder.current.state !== "inactive")
      recorder.current.stop();
  }
  async function photo() {
    const source = video.current;
    if (!source?.videoWidth) return;
    const canvas = document.createElement("canvas");
    canvas.width = source.videoWidth;
    canvas.height = source.videoHeight;
    canvas.getContext("2d")?.drawImage(source, 0, 0);
    const blob = await new Promise<Blob | null>((resolve) =>
      canvas.toBlob(resolve, "image/jpeg", 0.92),
    );
    if (blob)
      setFile(
        new File([blob], `photo-${Date.now()}.jpg`, { type: "image/jpeg" }),
      );
    else setError("Could not capture the photo. Please try again.");
  }
  function record() {
    if (!stream.current) return;
    setError("");
    if (typeof MediaRecorder === "undefined") {
      setError(
        "Video recording is not supported in this browser. You can still attach a video file.",
      );
      return;
    }
    const mime = ["video/webm;codecs=vp8,opus", "video/webm", "video/mp4"].find(
      (t) => MediaRecorder.isTypeSupported(t),
    );
    if (!mime) {
      setError("This browser cannot record a supported video format.");
      return;
    }
    try {
      const capture = new MediaRecorder(stream.current, {
        mimeType: mime,
        videoBitsPerSecond: 1_000_000,
      });
      recorder.current = capture;
      const chunks: Blob[] = [];
      let size = 0;
      let failed = false;
      capture.ondataavailable = (e) => {
        if (e.data.size) {
          chunks.push(e.data);
          size += e.data.size;
          if (size >= 24 * 1024 * 1024) stopRecording();
        }
      };
      capture.onerror = () => {
        failed = true;
        clearInterval(timer.current);
        setRecording(false);
        setError("Recording failed. Please try again.");
      };
      capture.onstop = () => {
        clearInterval(timer.current);
        setRecording(false);
        if (failed) return;
        if (!size || size > 25 * 1024 * 1024) {
          setError("The recording could not be attached. Try a shorter video.");
          return;
        }
        const type = mime.split(";")[0]!;
        setFile(
          new File(
            chunks,
            `video-${Date.now()}.${type === "video/mp4" ? "mp4" : "webm"}`,
            { type },
          ),
        );
      };
      capture.start(250);
      setSeconds(0);
      elapsed.current = 0;
      setPaused(false);
      setRecording(true);
      let last = Date.now();
      timer.current = setInterval(() => {
        const now = Date.now();
        if (capture.state === "recording")
          elapsed.current += (now - last) / 1000;
        last = now;
        setSeconds(elapsed.current);
        if (elapsed.current >= 120) stopRecording();
      }, 250);
    } catch {
      setError("Could not start recording. Please try again.");
    }
  }
  function pauseRecording() {
    const capture = recorder.current;
    if (capture?.state === "recording") {
      capture.pause();
      setPaused(true);
    } else if (capture?.state === "paused") {
      capture.resume();
      setPaused(false);
    }
  }
  function restart() {
    setRecording(false);
    setPaused(false);
    setSeconds(0);
    setFile(null);
    setRetry((n) => n + 1);
  }
  function toggleMic() {
    setMicMuted(!micMuted);
    stream.current?.getAudioTracks().forEach((t) => {
      t.enabled = micMuted;
    });
  }
  return (
    <Modal
      title={
        file
          ? "Review your clip"
          : recording
            ? paused
              ? "Recording paused"
              : "Recording in progress"
            : "Create a clip"
      }
      onClose={onClose}
    >
      <div className="lc-camera-capture lc-clip-studio">
        {file?.type.startsWith("video/") ? (
          <VideoReview url={preview} duration={seconds} name={file.name} />
        ) : (
          <div className="lc-camera-stage">
            {file ? (
              <img src={preview} alt="Captured photo" />
            ) : (
              <video
                ref={video}
                autoPlay
                muted
                playsInline
                aria-label={screen ? "Screen preview" : "Camera preview"}
              />
            )}
            {!file && (
              <div className="lc-capture-controls">
                {mode === "photo" ? (
                  <button
                    className="lc-capture-main"
                    type="button"
                    disabled={!ready}
                    onClick={() => void photo()}
                    aria-label="Take photo"
                    title="Take photo"
                  >
                    ●
                  </button>
                ) : (
                  <>
                    <button
                      className="lc-capture-main"
                      type="button"
                      disabled={!ready}
                      onClick={recording ? stopRecording : record}
                      aria-label={
                        recording ? "Stop and review" : "Start video recording"
                      }
                      title={recording ? "Stop and review" : "Start recording"}
                    >
                      {recording ? "■" : "●"}
                    </button>
                    {recording && (
                      <button
                        type="button"
                        onClick={pauseRecording}
                        aria-label={
                          paused ? "Resume recording" : "Pause recording"
                        }
                        title={paused ? "Resume" : "Pause"}
                      >
                        {paused ? "▶" : "Ⅱ"}
                      </button>
                    )}
                    <span className="lc-capture-time" role="timer">
                      {audioTime(seconds)} / 2:00
                    </span>
                    <button
                      type="button"
                      disabled={!recording}
                      onClick={restart}
                      aria-label="Restart recording"
                      title="Restart recording"
                    >
                      ↺
                    </button>
                  </>
                )}
              </div>
            )}
          </div>
        )}
        {error && (
          <p className="lc-capture-notice" role="alert">
            {error}{" "}
            <button type="button" onClick={() => setRetry((n) => n + 1)}>
              Try again
            </button>
          </p>
        )}
        {!file && !error && (
          <p className="lc-capture-notice" role="status">
            {!ready
              ? screen
                ? "Preparing screen recording…"
                : "Starting camera…"
              : screen
                ? "Screen selected · microphone audio only"
                : ""}
          </p>
        )}
        <div className="lc-capture-toolbar">
          {file ? (
            <>
              <button type="button" onClick={restart}>
                ↺ <span>Record again</span>
              </button>
              <span className="lc-capture-spacer" />
              <button
                className="lc-capture-next"
                type="button"
                onClick={() => onAttach(file)}
              >
                Attach to message →
              </button>
            </>
          ) : (
            <>
              <div className="lc-camera-modes" aria-label="Capture mode">
                <button
                  type="button"
                  aria-pressed={mode === "photo"}
                  disabled={recording}
                  onClick={() => {
                    if (screen) useCamera();
                    setCameraOff(false);
                    setMode("photo");
                  }}
                >
                  Photo
                </button>
                <button
                  type="button"
                  aria-pressed={mode === "video"}
                  disabled={recording}
                  onClick={() => setMode("video")}
                >
                  Video
                </button>
              </div>
              <div className="lc-capture-device">
                <button
                  type="button"
                  onClick={useCamera}
                  disabled={!ready || (recording && !!screen)}
                  aria-pressed={!screen && !cameraOff}
                  aria-label={
                    screen
                      ? "Use camera"
                      : cameraOff
                        ? "Turn camera on"
                        : "Turn camera off"
                  }
                >
                  <CaptureIcon kind="camera" />
                  <span>Camera</span>
                </button>
                <div className="lc-device-picker">
                  <span aria-hidden="true">⌄</span>
                  <select
                    aria-label="Recording camera"
                    disabled={recording || !!screen}
                    value={cameraId}
                    onChange={(e) => {
                      setCameraOff(false);
                      setCameraId(e.target.value);
                    }}
                  >
                    <option value="">Default camera</option>
                    {devices
                      .filter((d) => d.kind === "videoinput")
                      .map((d) => (
                        <option key={d.deviceId} value={d.deviceId}>
                          {d.label || "Camera"}
                        </option>
                      ))}
                  </select>
                </div>
              </div>
              {mode === "video" && (
                <>
                  <div className="lc-capture-device">
                    <button
                      type="button"
                      aria-label={
                        micMuted ? "Turn microphone on" : "Turn microphone off"
                      }
                      aria-pressed={!micMuted}
                      disabled={!ready}
                      onClick={toggleMic}
                    >
                      <CaptureIcon kind="mic" />
                      <span>{micMuted ? "Mic off" : "Mic"}</span>
                    </button>
                    <div className="lc-device-picker">
                      <span aria-hidden="true">⌄</span>
                      <select
                        aria-label="Recording microphone"
                        disabled={recording}
                        value={micId}
                        onChange={(e) => setMicId(e.target.value)}
                      >
                        <option value="">Default microphone</option>
                        {devices
                          .filter((d) => d.kind === "audioinput")
                          .map((d) => (
                            <option key={d.deviceId} value={d.deviceId}>
                              {d.label || "Microphone"}
                            </option>
                          ))}
                      </select>
                    </div>
                  </div>
                  <button
                    className="lc-capture-tool"
                    type="button"
                    aria-label="Share screen to record"
                    aria-pressed={!!screen}
                    disabled={recording || choosingScreen}
                    onClick={() => void chooseScreen()}
                  >
                    <CaptureIcon kind="screen" />
                    <span>{choosingScreen ? "Choosing…" : "Screen"}</span>
                  </button>
                </>
              )}
            </>
          )}
        </div>
        <p className="lc-capture-footnote">
          {file
            ? "Review your clip before adding it to the message."
            : "Your capture stays in the draft until you send the message."}
        </p>
      </div>
    </Modal>
  );
}

function CaptureIcon({ kind }: { kind: "camera" | "mic" | "screen" }) {
  return (
    <svg
      width="20"
      height="20"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.7"
      aria-hidden="true"
    >
      {kind === "camera" ? (
        <>
          <rect x="3" y="6" width="12" height="12" rx="2" />
          <path d="m15 10 6-3v10l-6-3" />
        </>
      ) : kind === "mic" ? (
        <>
          <rect x="9" y="2" width="6" height="13" rx="3" />
          <path d="M5 10v2a7 7 0 0 0 14 0v-2M12 19v3m-4 0h8" />
        </>
      ) : (
        <>
          <rect x="2" y="3" width="20" height="15" rx="2" />
          <path d="M12 14V6m-3 3 3-3 3 3M8 22h8m-4-4v4" />
        </>
      )}
    </svg>
  );
}
