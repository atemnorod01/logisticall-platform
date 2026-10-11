import { useEffect, useState } from "react";
import { firstWebUrl } from "../../../../packages/types/src/link-url.js";
/** Only prose is eligible for previews; code is never a navigation request. */
export function previewText(text: string, rich = ""): string {
  if (!rich) return text.replace(/```[\s\S]*?(?:```|$)/g, " ").replace(/`[^`]*`/g, " ");
  const template = document.createElement("template");
  template.innerHTML = rich;
  template.content.querySelectorAll("pre, code, [data-code-card], script, style").forEach((el) => el.replaceWith(document.createTextNode(" ")));
  template.content.querySelectorAll("br").forEach((el) => el.replaceWith(document.createTextNode("\n")));
  template.content.querySelectorAll("p, div, li").forEach((el) => el.append(document.createTextNode("\n")));
  return template.content.textContent ?? "";
}
type Preview = {
  url: string;
  domain: string;
  title: string;
  description: string;
  image?: string | null;
  available: boolean;
};
export function LinkPreview({
  text,
  rich,
  request,
  titleLink = false,
}: {
  titleLink?: boolean;
  text: string;
  rich?: string;
  request: (path: string) => Promise<unknown>;
}) {
  const url = firstWebUrl(previewText(text, rich));
  const [value, setValue] = useState<Preview | null>(null);
  const [dismissed, setDismissed] = useState<string | null>(null);
  const [failedImage, setFailedImage] = useState(false);
  useEffect(() => {
    let live = true;
    setValue(null);
    setFailedImage(false);
    if (url)
      void request("/preview?" + new URLSearchParams({ url }))
        .then((v) => {
          if (live) setValue(v as Preview);
        })
        .catch(() => {
          if (live)
            setValue({
              url,
              domain: new URL(url).hostname,
              title: "",
              description: "",
              available: false,
            });
        });
    return () => {
      live = false;
    };
  }, [url, request]);
  if (!url) return null;
  return (
    <>
      {titleLink && (
        <a
          className="lc-message-link-title"
          href={url}
          title={url}
          target="_blank"
          rel="noopener noreferrer"
        >
          {value?.title || new URL(url).hostname}
        </a>
      )}
      {dismissed !== url && (
        <div className="lc-link-preview">
          <a
            className="lc-link-card"
            href={url}
            target="_blank"
            rel="noopener noreferrer"
          >
            {value?.image && !failedImage && (
              <img
                src={value.image}
                alt=""
                referrerPolicy="no-referrer"
                onError={() => setFailedImage(true)}
              />
            )}
            <span className="lc-link-copy">
              <strong>
                {value?.available
                  ? value.title
                  : value
                    ? "Preview unavailable. Open the link…"
                    : "Loading preview…"}
              </strong>
              {value?.description && (
                <span className="lc-link-description">{value.description}</span>
              )}
              <small>{value?.domain ?? new URL(url).hostname}</small>
            </span>
          </a>
          <button
            className="lc-link-dismiss"
            type="button"
            aria-label="Dismiss link preview"
            onClick={() => setDismissed(url)}
          >
            ×
          </button>
        </div>
      )}
    </>
  );
}
