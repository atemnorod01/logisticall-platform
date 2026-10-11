import { CallMessage } from "./call-message.js";
import { Avatar, Icon } from "../ui.js";
import { InternalComments } from "./internal-comments.js";
import { firstWebUrl } from "../../../../packages/types/src/link-url.js";
import { useMediaUrls } from "./media-urls.js";
import { LinkPreview } from "./link-preview.js";
import { useEffect, useState } from "react";
import type { Message } from "../../../../packages/types/src/messaging.js";
import { RichEditor, RichBody, type Draft } from "./rich-editor.js";
import { Media } from "./media.js";
export function MessageItem({
  readOnly = false,
  message: m,
  continuation,
  senderPresence,
  onPerson,
  continuesNext,
  onJump,
  source,
  latestOwn,
  editing,
  editDraft,
  setEditDraft,
  onEdit,
  onCancel,
  onSave,
  onReply,
  onForward,
  onReact,
  onDelete,
  pending,
  onUndo,
  mediaUrl,
  request,
  canComment, sharedInbox, commentBusy, onComment, searchCommentId,
}: {
  readOnly?: boolean;
  canComment: boolean;
  sharedInbox: boolean;
  commentBusy: boolean;
  searchCommentId?: string | null;
  onComment: (id: string, body: string) => Promise<boolean>;
  message: Message;
  onPerson: () => void;
  senderPresence?: string | undefined;
  continuation: boolean;
  continuesNext: boolean;
  onJump: (id: string) => void;
  source: Message | undefined;
  latestOwn: boolean;
  editing: boolean;
  editDraft: Draft;
  setEditDraft: (d: Draft) => void;
  onEdit: () => void;
  onCancel: () => void;
  onSave: () => void;
  onReply: () => void;
  onForward: () => void;
  onReact: (emoji: string) => void;
  onDelete: () => void;
  pending: boolean;
  onUndo: () => void;
  mediaUrl: (id: string) => string;
  request: (path: string, method?: string) => Promise<unknown>;
}) {
  const linkOnly = !/<(?:pre|code)\b/i.test(m.rich ?? "") && !/\s/.test(m.body.trim()) && !!firstWebUrl(m.body.trim());
  const media = useMediaUrls(m.attachments ?? [], mediaUrl, request);
  const quoted = source ? {body:source.body,deleted:!!source.deletedAt,attachments:source.attachments} : m.replyPreview;
  const quotedImage = quoted?.attachments.find(f => f.mime.startsWith("image/"));
  const quoteUrls = useMediaUrls(quotedImage ? [quotedImage] : [], mediaUrl, request);
  const [commentsOpen, setCommentsOpen] = useState(false);
  useEffect(() => {if(searchCommentId)setCommentsOpen(true);},[searchCommentId]);
  const [receipts, setReceipts] = useState(false);
  const own = m.own ?? m.outgoing,
    read = m.receipts?.some((r) => r.read),
    senderLabel = m.actorName || m.senderName;
  if (m.callEvent) return <CallMessage message={m} urls={media} onPerson={onPerson}/>;
  return (
    <div
      id={`message-${m.id}`}
      tabIndex={-1}
      className={`lc-message-item ${continuesNext ? "lc-message-continues-next" : ""} ${m.outgoing ? "lc-message-own" : ""} ${continuation ? "lc-message-continuation" : ""}`}
    >
      {(!continuation || (own && m.editedAt && !m.deletedAt)) && (
        <div className="lc-message-heading">
          {!continuation && (!own || m.internal) && (
            <button type="button" onClick={onPerson}
              className="sender-name"
              title={!own ? senderLabel : undefined}
            >
              {!own ? senderLabel : ""}
              {m.internal ? (!own ? " · Internal note" : "Internal note") : ""}
            </button>
          )}
          <time>
            {new Date(m.createdAt).toLocaleTimeString([], {
              hour: "numeric",
              minute: "2-digit",
            })}
          </time>
          {own && m.editedAt && !m.deletedAt && <span>Edited</span>}
        </div>
      )}
      <div
        className={`bubble ${m.outgoing ? "out" : ""} ${m.internal ? "lc-internal-note" : ""}`}
      >
        {!m.outgoing && !continuation && <button type="button" onClick={onPerson} className="lc-message-avatar" aria-label={`View ${senderLabel} in conversation details`}><Avatar name={senderLabel} {...(senderPresence && senderPresence !== "unknown" ? {presence:senderPresence} : {})}/></button>}
        {pending ? (
          <div className="lc-delete-pending">
            Message will be deleted.{" "}
            <button type="button" onClick={onUndo}>
              Undo
            </button>
          </div>
        ) : m.deletedAt ? (
          <p className="lc-tombstone">This message has been deleted.</p>
        ) : (
          <>
            {m.forwardedFrom && (
              <small className="lc-forwarded">Forwarded</small>
            )}
            {m.replyTo && (
              <button type="button" className="lc-quoted-message" onClick={() => onJump(m.replyTo!)} title="Go to original message" aria-label="Go to original message">
                {quotedImage && quoteUrls[quotedImage.id] && quoteUrls[quotedImage.id] !== "#unavailable" && <img src={quoteUrls[quotedImage.id]} alt="Quoted image" />}
                <span>
                  {quoted?.deleted ? "This message has been deleted." : <>
                    {!!quoted?.attachments.length && <strong>{quoted.attachments.map(f => `${f.mime.startsWith("image/") ? "Photo" : f.mime.startsWith("video/") ? "Video" : f.mime.startsWith("audio/") ? "Audio" : "File"}: ${f.filename}`).join(" · ")}</strong>}
                    {quoted?.body ? <span>{quoted.body.slice(0, 160)}</span> : !quoted?.attachments.length && "Original message"}
                  </>}
                </span>
              </button>
            )}
            <Media
              files={m.attachments ?? []}
              url={(id) => media[id] ?? ""}
              sender={senderLabel}
              sentAt={m.createdAt}
            />
            {editing ? (
              <div className="lc-inline-edit">
                <RichEditor
                  id={`edit-${m.id}`}
                  label="Edit message"
                  value={editDraft}
                  onChange={setEditDraft}
                  onSend={onSave}
                  onCancel={onCancel}
                />
                <div className="lc-edit-actions">
                  <small>Shift+Enter for a new line</small>
                  <button
                    type="button"
                    aria-label="Cancel edit"
                    onClick={onCancel}
                  >
                    ×
                  </button>
                  <button type="button" aria-label="Save edit" onClick={onSave}>
                    ✓
                  </button>
                </div>
              </div>
            ) : (
              <>
                <div className="lc-message-text-line">
                  {!linkOnly && <RichBody rich={m.rich ?? ""} text={m.body} />}
                  {!own && m.editedAt && (
                    <span className="lc-incoming-edited">Edited</span>
                  )}
                </div>
                <LinkPreview
                  text={m.body}
                  rich={m.rich ?? ""}
                  request={request}
                  titleLink={linkOnly}
                />
              </>
            )}
            {!editing && !readOnly && (
              <div className="lc-message-actions">
                {["👍", "❤️", "😂", "🎉"].map((emoji) => (
                  <button
                    type="button"
                    key={emoji}
                    aria-label={`React ${emoji}`}
                    onClick={() => onReact(emoji)}
                  >
                    {emoji}
                  </button>
                ))}
                <button type="button" aria-label="Reply with quote" title="Reply with quote" disabled={m.internal} onClick={onReply}>
                  <Icon name="quote" />
                </button>
                {own && (
                  <button
                    type="button"
                    aria-label="Edit message"
                    onClick={onEdit}
                  >
                    ✎
                  </button>
                )}
                <details className="message-more">
                  <summary aria-label="More message actions">•••</summary>
                  <div role="menu">
                    {canComment && <button type="button" data-action="comment" onClick={() => setCommentsOpen(true)}>Add internal comment</button>}
                    <button type="button" data-action="reply" disabled={m.internal} onClick={onReply}>
                      Reply with quote
                    </button>
                    <button
                      type="button"
                      data-action="forward"
                      disabled={m.internal || !m.body}
                      onClick={onForward}
                    >
                      Forward
                    </button>
                    {own && (
                      <button
                        type="button"
                        data-action="delete"
                        onClick={onDelete}
                      >
                        Delete
                      </button>
                    )}
                  </div>
                </details>
              </div>
            )}
          </>
        )}
        <div className="message-status">
          {latestOwn && !m.deletedAt && (
            <button
              className={`lc-receipt ${read ? "read" : ""}`}
              type="button"
              aria-label={read ? "Read by at least one participant" : "Sent"}
              onClick={() => setReceipts(!receipts)}
            >
              <svg
                viewBox="0 0 24 18"
                width="24"
                height="18"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.8"
                strokeLinecap="round"
                strokeLinejoin="round"
                aria-hidden="true"
              >
                <path d="m2 9 5 5L18 3" />
                {read && <path d="m12 12 2 2 8-8" />}
              </svg>
            </button>
          )}
        </div>
        {receipts && latestOwn && (
          <div className="lc-receipt-popover">
            <strong>Read receipts</strong>
            {m.receipts?.length ? (
              m.receipts.map((r, i) => (
                <div key={i}>
                  {r.name} · {r.read ? "Read" : "Not read yet"}
                </div>
              ))
            ) : (
              <div>No read receipts yet.</div>
            )}
            <button type="button" onClick={() => setReceipts(false)}>
              Close
            </button>
          </div>
        )}
      </div>
      {!pending && !m.deletedAt && !!m.reactions?.length && (
        <div className="lc-reactions">
          {m.reactions.map((r) => (
            <button
              type="button"
              aria-pressed={r.mine}
              key={r.emoji}
              onClick={() => onReact(r.emoji)}
            >
              {r.emoji} {r.count}
            </button>
          ))}
        </div>
      )}
      {(canComment || m.internalComments.length > 0) && <InternalComments highlightedId={searchCommentId ?? null} comments={m.internalComments} open={commentsOpen} setOpen={setCommentsOpen} shared={sharedInbox} busy={commentBusy} onSend={onComment} />}
    </div>
  );
}
