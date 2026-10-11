import { useEffect, useRef, useState } from "react";
import { audioTime, waveformPeaks } from "./audio-waveform.js";
let currentAudio: HTMLAudioElement | null = null;

export function AudioPlayer({ url, name }: { url: string; name: string }) {
  const root = useRef<HTMLDivElement>(null);
  const audio = useRef<HTMLAudioElement>(null);
  const [visible, setVisible] = useState(false);
  const [peaks, setPeaks] = useState<number[] | null>(null);
  const [duration, setDuration] = useState(0);
  const [position, setPosition] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [waveError, setWaveError] = useState(false);
  const [error, setError] = useState("");
  useEffect(() => {
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting)) {
          setVisible(true);
          observer.disconnect();
        }
      },
      { rootMargin: "200px" },
    );
    if (root.current) observer.observe(root.current);
    return () => observer.disconnect();
  }, []);
  useEffect(() => {
    if (!visible || !url) return;
    let live = true;
    const abort = new AbortController();
    let context: AudioContext | undefined;
    setPeaks(null);
    setWaveError(false);
    setError("");
    setDuration(0);
    setPosition(0);
    async function load() {
      try {
        const response = await fetch(url, { signal: abort.signal });
        if (!response.ok) throw Error("Audio unavailable");
        const bytes = await response.arrayBuffer();
        if (!live) return;
        context = new AudioContext();
        const decoded = await context.decodeAudioData(bytes);
        if (live) {
          setDuration(decoded.duration);
          setPeaks(
            waveformPeaks(
              Array.from({ length: decoded.numberOfChannels }, (_, i) =>
                decoded.getChannelData(i),
              ),
            ),
          );
        }
      } catch {
        if (live) setWaveError(true);
      } finally {
        if (context && context.state !== "closed")
          void context.close().catch(() => {});
      }
    }
    void load();
    return () => {
      live = false;
      abort.abort();
      if (context && context.state !== "closed")
        void context.close().catch(() => {});
    };
  }, [url, visible]);
  useEffect(() => {
    if (!playing) return;
    let frame: number;
    const update = () => {
      if (audio.current) setPosition(audio.current.currentTime);
      frame = requestAnimationFrame(update);
    };
    frame = requestAnimationFrame(update);
    return () => cancelAnimationFrame(frame);
  }, [playing]);
  useEffect(() => {
    const el = audio.current;
    return () => {
      el?.pause();
      if (currentAudio === el) currentAudio = null;
    };
  }, []);
  async function toggle() {
    const el = audio.current;
    if (!el) return;
    setError("");
    if (!el.paused) {
      el.pause();
      return;
    }
    try {
      await el.play();
    } catch {
      setError("Unable to play this recording. Download it to listen.");
    }
  }
  const fraction = duration > 0 ? Math.min(1, position / duration) : 0;
  return (
    <div
      ref={root}
      className="lc-audio-player"
      role="group"
      aria-label={`Audio: ${name}`}
    >
      <audio
        ref={audio}
        src={visible ? url : undefined}
        preload="metadata"
        onLoadedMetadata={(e) => {
          if (Number.isFinite(e.currentTarget.duration))
            setDuration(e.currentTarget.duration);
        }}
        onDurationChange={(e) => {
          if (Number.isFinite(e.currentTarget.duration))
            setDuration(e.currentTarget.duration);
        }}
        onPlay={(e) => {
          if (currentAudio && currentAudio !== e.currentTarget)
            currentAudio.pause();
          currentAudio = e.currentTarget;
          setPlaying(true);
        }}
        onPause={() => setPlaying(false)}
        onEnded={() => setPlaying(false)}
        onTimeUpdate={(e) => setPosition(e.currentTarget.currentTime)}
        onError={() =>
          setError("Unable to play this recording. Download it to listen.")
        }
      />
      <button
        type="button"
        className="lc-audio-play"
        aria-label={`${playing ? "Pause" : "Play"} ${name}`}
        onClick={() => void toggle()}
      >
        <svg viewBox="0 0 24 24" aria-hidden="true">
          {playing ? (
            <path d="M6 4h4v16H6zm8 0h4v16h-4z" />
          ) : (
            <path d="M7 3v18l15-9z" />
          )}
        </svg>
      </button>
      <div className="lc-audio-track">
        <div className="lc-waveform" data-loading={!peaks && !waveError}>
          <svg
            viewBox="0 0 384 48"
            preserveAspectRatio="none"
            aria-hidden="true"
          >
            {peaks ? (
              peaks.map((peak, i) => {
                const height = Math.max(3, peak * 42);
                return (
                  <rect
                    key={i}
                    x={i * 6 + 1}
                    y={(48 - height) / 2}
                    width="3"
                    height={height}
                    rx="1.5"
                    className={i / peaks.length < fraction ? "played" : ""}
                  />
                );
              })
            ) : (
              <path d="M0 24H384" className="lc-waveform-fallback" />
            )}
            <path
              d={`M${fraction * 383} 2V46`}
              className="lc-waveform-cursor"
            />
          </svg>
          <input
            type="range"
            aria-label={`Seek ${name}`}
            aria-valuetext={`${audioTime(position)} of ${audioTime(duration)}`}
            min={0}
            max={duration || 1}
            step={0.01}
            value={Math.min(position, duration || 1)}
            disabled={!duration}
            onChange={(e) => {
              const time = Number(e.target.value);
              if (audio.current) {
                audio.current.currentTime = time;
                setPosition(time);
              }
            }}
          />
        </div>
        <div className="lc-audio-meta">
          <span>
            {audioTime(position)} / {audioTime(duration)}
          </span>

        </div>
      </div>
      <div className="lc-audio-footer">
        <div className="lc-audio-name" title={name}>{name}</div>
          <a
            href={url}
            download={name}
            aria-label={`Download ${name}`}
            title="Download audio"
          >
            <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <path d="M12 3v12m-4-4 4 4 4-4M4 16v4a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1v-4" />
            </svg>
          </a>
      </div>
      {waveError && !error && (
        <small className="lc-audio-notice">
          Waveform unavailable; playback is still available.
        </small>
      )}
      {error && (
        <small className="lc-audio-notice" role="alert">
          {error}
        </small>
      )}
    </div>
  );
}
