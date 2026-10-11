import { AudioPlayer } from "./audio-player.js";
import { useState } from "react";
import type { Attachment } from "../../../../packages/types/src/messaging.js";
import { ImageGallery } from "./image-gallery.js";
import { FileViewer } from "./file-viewer.js";
import { FileThumbnail } from "./file-thumbnail.js";
export function Media({
  files,
  url,
  sender,
  sentAt,
}: {
  files: Attachment[];
  sender?: string;
  sentAt?: string;
  url: (id: string) => string;
}) {
  const [index, setIndex] = useState<number | null>(null);
  const file = index === null ? null : files[index];
  const viewerFiles = files.filter((f) => !f.mime.startsWith("audio/"));
  const images = files.filter((f) => f.mime.startsWith("image/"));
  const visible = files.filter(
    (f) => !f.mime.startsWith("image/") || images.indexOf(f) < 4,
  );
  return (
    <>
      <div
        className={`lc-message-media ${images.length > 1 ? "lc-image-grid" : ""}`}
      >
        {visible.map((f) => (
          <div
            key={f.id}
            className={
              f.mime.startsWith("image/") ? "lc-image-cell" : "lc-file-cell"
            }
          >
            {url(f.id) === "#unavailable" ? (
              <small>{f.filename} · Media unavailable. Refresh to retry.</small>
            ) : !url(f.id) ? (
              <small>{f.filename} · Loading media…</small>
            ) : f.mime.startsWith("image/") ? (
              <button
                type="button"
                className="lc-image-button"
                aria-label={
                  images.length > 4 && images.indexOf(f) === 3
                    ? `${f.filename}, view ${images.length - 4} more images`
                    : f.filename
                }
                onClick={() => {
                  setIndex(files.indexOf(f));
                }}
              >
                <img
                  src={url(f.id)}
                  alt={f.filename}
                  loading="lazy"
                  onLoad={(e) => {
                    if (images.length !== 1) return;
                    const img = e.currentTarget;
                    const width = Math.min(
                      img.naturalWidth,
                      320,
                      (360 * img.naturalWidth) / img.naturalHeight,
                    );
                    img
                      .closest<HTMLElement>(".lc-image-cell")
                      ?.style.setProperty("--photo-width", `${width}px`);
                  }}
                />
                {images.length > 4 && images.indexOf(f) === 3 && (
                  <span className="lc-image-overflow">
                    +{images.length - 4}
                  </span>
                )}
              </button>
            ) : f.mime.startsWith("audio/") ? (
              <AudioPlayer url={url(f.id)} name={f.filename} />
            ) : (
              <button
                type="button"
                className="lc-file-card"
                onClick={() => setIndex(files.indexOf(f))}
                aria-label={`Open ${f.filename}`}
              >
                <FileThumbnail
                  url={url(f.id)}
                  mime={f.mime}
                  name={f.filename}
                />
              </button>
            )}
          </div>
        ))}
      </div>
      {file?.mime.startsWith("image/") && (
        <ImageGallery
          files={images}
          selected={images.indexOf(file)}
          url={url}
          sender={sender ?? ""}
          sentAt={sentAt ?? ""}
          onClose={() => setIndex(null)}
        />
      )}
      {file && !file.mime.startsWith("image/") && (
        <FileViewer
          files={viewerFiles}
          selected={viewerFiles.indexOf(file)}
          url={url}
          sender={sender ?? ""}
          sentAt={sentAt ?? ""}
          onClose={() => setIndex(null)}
        />
      )}
    </>
  );
}
