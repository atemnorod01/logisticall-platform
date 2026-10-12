import { LoadingSkeleton } from "../loading-skeleton.js";
import { useEffect, useRef, useState } from "react";
import { z } from "zod";
import {
  attachmentSchema,
  type Attachment,
  type Address,
} from "../../../../packages/types/src/messaging.js";
import type { messagingController } from "../messaging.js";
import { ConversationParticipants } from "./conversation-participants.js";
import { FileThumbnail } from "./file-thumbnail.js";
import { FileViewer } from "./file-viewer.js";
import { ImageGallery } from "./image-gallery.js";
import { AudioPlayer } from "./audio-player.js";
import { useMediaUrls } from "./media-urls.js";
const tabs = [
  "Participants",
  "Shared media",
  "Lanes",
  "Loads",
  "Past conversations",
] as const;
type Tab = (typeof tabs)[number];
const lanes = [
  {
    from: "Chicago, IL",
    to: "Columbus, OH",
    miles: "356 mi",
    frequency: "3 loads / week",
    equipment: "Dry van",
  },
  {
    from: "Indianapolis, IN",
    to: "Atlanta, GA",
    miles: "533 mi",
    frequency: "2 loads / week",
    equipment: "Reefer",
  },
  {
    from: "Detroit, MI",
    to: "Nashville, TN",
    miles: "534 mi",
    frequency: "Weekly",
    equipment: "Dry van",
  },
];
const loads = [
  {
    id: "4821",
    status: "In transit",
    route: "Chicago → Columbus",
    detail: "Dry van · 38,400 lb",
    date: "Delivery · Oct 10, 3:00 PM",
  },
  {
    id: "4818",
    status: "Delivered",
    route: "Indianapolis → Atlanta",
    detail: "Reefer · 32,000 lb",
    date: "Delivered · Oct 9, 10:42 AM",
  },
  {
    id: "4830",
    status: "Scheduled",
    route: "Detroit → Nashville",
    detail: "Dry van · 41,200 lb",
    date: "Pickup · Oct 12, 8:00 AM",
  },
];
const history = [
  {
    title: "Delivery appointment · #4818",
    date: "Oct 9",
    preview: "Casey Rivera: POD received. Thank you.",
    status: "Completed",
  },
  {
    title: "Weekly capacity planning",
    date: "Oct 7",
    preview: "Taylor Brooks: Two trucks confirmed for Friday.",
    status: "Completed",
  },
  {
    title: "Rate confirmation · #4794",
    date: "Oct 4",
    preview: "Alex Morgan: Confirmed at the agreed rate.",
    status: "Completed",
  },
];
export function ConversationDetails({
  controller,
  organizationId,
  userId,
  onPersonAction,
}: {
  controller: ReturnType<typeof messagingController>;
  organizationId: string;
  userId: string;
  onPersonAction:(person:Address,call:boolean)=>void;
}) {
  const [tab, setTab] = useState<Tab>("Participants");
  const tabStrip = useRef<HTMLDivElement>(null);
  const scrollTabs = (direction: number) =>
    tabStrip.current?.scrollBy({
      left: direction * 180,
      behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches
        ? "auto"
        : "smooth",
    });
  const demo =
    !!(import.meta as ImportMeta & { env?: { DEV?: boolean } }).env?.DEV &&
    ["127.0.0.1", "localhost"].includes(window.location.hostname);
  return (
    <div className="lc-details-content">
      <div className="lc-details-tab-bar">
        <button
          className="lc-details-tab-scroll"
          aria-label="Scroll conversation tabs left"
          onClick={() => scrollTabs(-1)}
        >
          ‹
        </button>
        <div
          ref={tabStrip}
          className="lc-details-tabs"
          role="tablist"
          aria-label="Conversation sections"
        >
          {tabs.map((t) => (
            <button
              key={t}
              id={`details-tab-${tabs.indexOf(t)}`}
              role="tab"
              aria-selected={tab === t}
              aria-controls="conversation-details-panel"
              onClick={(event) => {
                setTab(t);
                event.currentTarget.scrollIntoView({
                  block: "nearest",
                  inline: "nearest",
                });
              }}
            >
              {t}
            </button>
          ))}
        </div>
        <button
          className="lc-details-tab-scroll"
          aria-label="Scroll conversation tabs right"
          onClick={() => scrollTabs(1)}
        >
          ›
        </button>
      </div>
      <div
        id="conversation-details-panel"
        role="tabpanel"
        aria-labelledby={`details-tab-${tabs.indexOf(tab)}`}
      >
        {tab === "Participants" ? (
          <ConversationParticipants
            onPersonAction={onPersonAction}
            controller={controller}
            organizationId={organizationId}
            userId={userId}
          />
        ) : tab === "Shared media" ? (
          <SharedMedia controller={controller} />
        ) : (
          <>
            <div className="lc-details-section-heading">
              <h3>{tab}</h3>
              {demo && <span className="lc-demo-label">Sample data</span>}
            </div>
            {!demo ? (
              <p className="sub">
                No {tab.toLowerCase()} linked to this conversation yet.
              </p>
            ) : tab === "Lanes" ? (
              <div className="lc-related-list">
                {lanes.map((l) => (
                  <article key={l.from} className="lc-related-card">
                    <div className="lc-lane-route">
                      <span className="lc-route-dot" />
                      <strong>{l.from}</strong>
                      <span className="lc-route-link" />
                      <span className="lc-route-dot destination" />
                      <strong>{l.to}</strong>
                    </div>
                    <div className="lc-related-meta">
                      <span>{l.equipment}</span>
                      <span>{l.miles}</span>
                    </div>
                    <p>{l.frequency}</p>
                  </article>
                ))}
              </div>
            ) : tab === "Loads" ? (
              <div className="lc-related-list">
                {loads.map((l) => (
                  <article className="lc-related-card" key={l.id}>
                    <header>
                      <strong>Load #{l.id}</strong>
                      <span
                        className={`lc-load-status ${l.status === "In transit" ? "transit" : l.status === "Delivered" ? "delivered" : ""}`}
                      >
                        {l.status}
                      </span>
                    </header>
                    <p className="lc-related-route">{l.route}</p>
                    <div className="lc-related-meta">{l.detail}</div>
                    <small>{l.date}</small>
                  </article>
                ))}
              </div>
            ) : (
              <div className="lc-related-list">
                {history.map((h) => (
                  <details key={h.title} className="lc-related-card">
                    <summary>
                      <span>
                        <strong>{h.title}</strong>
                        <small>
                          {h.date} · {h.status}
                        </small>
                      </span>
                      <span aria-hidden="true">⌄</span>
                    </summary>
                    <p>{h.preview}</p>
                    <div className="lc-history-sample">
                      Synthetic conversation preview
                    </div>
                  </details>
                ))}
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}
function SharedMedia({
  controller,
}: {
  controller: ReturnType<typeof messagingController>;
}) {
  const [files, setFiles] = useState<
      Array<Attachment & { sentAt: string; sender: string }>
    >([]),
    [next, setNext] = useState<number | null>(null),
    [offset, setOffset] = useState(0),
    [loading, setLoading] = useState(false),
    [error, setError] = useState(""),
    [selected, setSelected] = useState<string | null>(null),
    [retry, setRetry] = useState(0);
  const path = controller.path("/shared-media");
  useEffect(() => {
    let live = true;
    setLoading(true);
    setError("");
    void controller
      .request(`${path}${path.includes("?") ? "&" : "?"}offset=${offset}`)
      .then((v) => {
        const page = z
          .object({
            files: z.array(
              attachmentSchema.extend({
                sentAt: z.string(),
                sender: z.string(),
              }),
            ),
            nextOffset: z.number().nullable(),
          })
          .parse(v);
        if (live) {
          setFiles((old) =>
            offset
              ? [
                  ...new Map(
                    [...old, ...page.files].map((f) => [f.id, f]),
                  ).values(),
                ]
              : page.files,
          );
          setNext(page.nextOffset);
        }
      })
      .catch(() => {
        if (live) setError("Shared media could not be loaded.");
      })
      .finally(() => {
        if (live) setLoading(false);
      });
    return () => {
      live = false;
    };
  }, [controller, path, offset, retry]);
  const urls = useMediaUrls(
    files,
    (id) => controller.path(`/attachments/${id}`),
    controller.request,
  );
  const images = files.filter((f) => f.mime.startsWith("image/")),
    documents = files.filter(
      (f) => !f.mime.startsWith("image/") && !f.mime.startsWith("audio/"),
    ),
    active = files.find((f) => f.id === selected);
  return (
    <>
      <div className="lc-details-section-heading">
        <h3>Shared media</h3>
        <span className="sub">
          {files.length}
          {next !== null ? "＋" : ""} files
        </span>
      </div>
      {error && (
        <p role="alert">
          {error}{" "}
          <button className="button" onClick={() => setRetry((v) => v + 1)}>
            Retry
          </button>
        </p>
      )}
      <div className="lc-shared-media-grid">
        {files.map((f) => (
          <button
            key={f.id}
            className="lc-shared-media-tile"
            aria-label={`Preview ${f.filename}`}
            title={f.filename}
            disabled={!urls[f.id] || urls[f.id] === "#unavailable"}
            onClick={() => setSelected(f.id)}
          >
            <span className="lc-shared-media-preview">
              {urls[f.id] && urls[f.id] !== "#unavailable" ? (
                <FileThumbnail
                  url={urls[f.id]!}
                  mime={f.mime}
                  name={f.filename}
                />
              ) : (
                <span>
                  {urls[f.id] === "#unavailable" ? "Unavailable" : "Loading…"}
                </span>
              )}
            </span>
            <strong>{f.filename}</strong>
            <small>
              {f.mime.startsWith("image/")
                ? "Image"
                : f.mime.startsWith("audio/")
                  ? "Audio"
                  : f.mime.startsWith("video/")
                    ? "Video"
                    : f.filename.split(".").pop()?.toUpperCase()}{" "}
              ·{" "}
              {f.size < 1048576
                ? `${Math.max(1, Math.round(f.size / 1024))} KB`
                : `${(f.size / 1048576).toFixed(1)} MB`}
            </small>
          </button>
        ))}
      </div>
      {loading && !files.length && <LoadingSkeleton variant="details" rows={4} />}
      {!loading && !files.length && !error && (
        <p className="sub">No media shared in this conversation yet.</p>
      )}
      {next !== null && (
        <button
          className="button lc-media-more"
          disabled={loading}
          onClick={() => setOffset(next)}
        >
          Load more
        </button>
      )}
      {active && active.mime.startsWith("image/") ? (
        <ImageGallery
          files={images}
          selected={images.findIndex((f) => f.id === active.id)}
          url={(id) => urls[id] ?? ""}
          sender={active.sender}
          sentAt={active.sentAt}
          onClose={() => setSelected(null)}
        />
      ) : active?.mime.startsWith("audio/") ? (
        <div className="lc-details-audio">
          <button className="button" onClick={() => setSelected(null)}>
            Close player
          </button>
          <AudioPlayer url={urls[active.id]!} name={active.filename} />
        </div>
      ) : active ? (
        <FileViewer
          files={documents}
          selected={documents.findIndex((f) => f.id === active.id)}
          url={(id) => urls[id] ?? ""}
          onClose={() => setSelected(null)}
        />
      ) : null}
    </>
  );
}
