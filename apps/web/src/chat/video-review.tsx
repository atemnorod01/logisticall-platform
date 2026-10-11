import { useEffect, useRef, useState } from "react";
import { audioTime } from "./audio-waveform.js";

export function VideoReview({
  url,
  duration: initialDuration,
  name,
}: {
  url: string;
  duration: number;
  name: string;
}) {
  const video = useRef<HTMLVideoElement>(null);
  const [duration, setDuration] = useState(initialDuration);
  const [position, setPosition] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [frames, setFrames] = useState<string[]>([]);
  const [error, setError] = useState("");
  useEffect(() => {
    if (!url || !duration) return;
    let live = true;
    const source = document.createElement("video");
    source.muted = true;
    source.preload = "auto";
    source.src = url;
    const canvas = document.createElement("canvas");
    canvas.width = 128;
    canvas.height = 72;
    const images: string[] = [];
    let index = 0;
    const capture = () => {
      if (!live || !source.videoWidth) return;
      canvas.getContext("2d")?.drawImage(source, 0, 0, 128, 72);
      images.push(canvas.toDataURL("image/jpeg", 0.65));
      setFrames([...images]);
      if (++index < 10) source.currentTime = (duration * (index + 0.5)) / 10;
    };
    source.onloadeddata = () => {
      if (live) source.currentTime = duration / 20;
    };
    source.onseeked = capture;
    return () => {
      live = false;
      source.onloadeddata = null;
      source.onseeked = null;
      source.removeAttribute("src");
      source.load();
    };
  }, [url, duration]);
  async function toggle() {
    if (!video.current) return;
    try {
      if (video.current.paused) await video.current.play();
      else video.current.pause();
    } catch {
      setError(
        "Could not play this clip. You can download it or record again.",
      );
    }
  }
  return (
    <div className="lc-video-review">
      <video
        ref={video}
        src={url}
        playsInline
        onLoadedMetadata={(e) => {
          if (Number.isFinite(e.currentTarget.duration))
            setDuration(e.currentTarget.duration);
        }}
        onTimeUpdate={(e) => setPosition(e.currentTarget.currentTime)}
        onPlay={() => setPlaying(true)}
        onPause={() => setPlaying(false)}
        onEnded={() => setPlaying(false)}
        onClick={() => void toggle()}
        aria-label="Recorded video preview"
      />
      <div className="lc-video-timeline-row">
        <button
          type="button"
          aria-label={playing ? "Pause preview" : "Play preview"}
          onClick={() => void toggle()}
        >
          {playing ? "Ⅱ" : "▶"}
        </button>
        <div className="lc-video-timeline">
          <div className="lc-video-filmstrip" aria-hidden="true">
            {frames.map((frame, i) => (
              <img key={i} src={frame} alt="" />
            ))}
          </div>
          <div
            className="lc-video-playhead"
            style={{
              left: `${duration ? Math.min(100, (position / duration) * 100) : 0}%`,
            }}
          />
          <input
            type="range"
            aria-label="Seek video preview"
            aria-valuetext={`${audioTime(position)} of ${audioTime(duration)}`}
            min="0"
            max={duration || 1}
            step="0.01"
            value={Math.min(position, duration || 1)}
            disabled={!duration}
            onChange={(e) => {
              const time = Number(e.target.value);
              if (video.current) video.current.currentTime = time;
              setPosition(time);
            }}
          />
        </div>
        <a
          href={url}
          download={name}
          aria-label="Download recording"
          title="Download recording"
        >
          <svg
            width="20"
            height="20"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.8"
          >
            <path d="M12 3v12m-4-4 4 4 4-4M4 16v5h16v-5" />
          </svg>
        </a>
      </div>
      <p className="lc-video-review-time">
        {audioTime(position)} / {audioTime(duration)}
      </p>
      {error && <p role="alert">{error}</p>}
    </div>
  );
}
