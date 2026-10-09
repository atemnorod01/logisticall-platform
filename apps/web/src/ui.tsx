import type { ReactNode } from "react";
const paths: Record<string, ReactNode> = {
  user: (
    <>
      <circle cx="12" cy="8" r="4" />
      <path d="M5 21v-2a7 7 0 0 1 14 0v2" />
    </>
  ),
  bell: (
    <>
      <path d="M18 8a6 6 0 0 0-12 0c0 7-3 7-3 9h18c0-2-3-2-3-9M10 21h4" />
    </>
  ),
  headphones: (
    <>
      <path d="M3 14v-3a9 9 0 0 1 18 0v3" />
      <rect x="3" y="12" width="4" height="9" rx="2" />
      <rect x="17" y="12" width="4" height="9" rx="2" />
    </>
  ),
  appearance: (
    <>
      <path d="M12 3v2M3 12h2M5.6 5.6 7 7M19 5l-1.5 1.5M15 8a6 6 0 1 0 6 7 7 7 0 0 1-6-7Z" />
    </>
  ),
  building: (
    <>
      <rect x="7" y="3" width="10" height="18" rx="1" />
      <path d="M7 7H3v14h18V7h-4M10 7h4M10 11h4M10 15h4M11 21v-3h2v3" />
    </>
  ),
  inbox: (
    <>
      <path d="m3 13 3-9h12l3 9v7H3ZM3 13h5l2 3h4l2-3h5" />
    </>
  ),
  star: (
    <path d="m12 3 2.8 5.7 6.2.9-4.5 4.4 1.1 6.2L12 17.3l-5.6 2.9 1.1-6.2L3 9.6l6.2-.9Z" />
  ),
  mail: (
    <>
      <rect x="3" y="5" width="18" height="14" rx="2" />
      <path d="m3 6 9 7 9-7" />
    </>
  ),
  filter: <path d="M4 6h16M7 12h10M10 18h4" />,
  more: (
    <>
      <circle cx="5" cy="12" r="1" />
      <circle cx="12" cy="12" r="1" />
      <circle cx="19" cy="12" r="1" />
    </>
  ),
  plus: <path d="M12 5v14M5 12h14" />,
  send: <path d="m22 2-7 20-4-9-9-4ZM11 13 22 2" />,
  calendar: (
    <>
      <rect x="3" y="5" width="18" height="16" rx="2" />
      <path d="M7 3v4m10-4v4M3 11h18" />
    </>
  ),

  message: (
    <path d="M21 11.5a8.4 8.4 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.4 8.4 0 0 1-3.8-.9L3 21l1.9-5.7a8.4 8.4 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.4 8.4 0 0 1 3.8-.9h.5a8.5 8.5 0 0 1 8 8v.5Z" />
  ),
  phone: (
    <path d="M5 3h4l2 5-3 2a15 15 0 0 0 6 6l2-3 5 2v4a2 2 0 0 1-2 2C10 21 3 14 3 5a2 2 0 0 1 2-2Z" />
  ),
  users: (
    <>
      <circle cx="9" cy="8" r="3" />
      <path d="M3 21v-3a6 6 0 0 1 12 0v3M16 5a3 3 0 0 1 0 6m2 4a5 5 0 0 1 3 5" />
    </>
  ),
  settings: (
    <>
      <path d="M4 6h16M4 12h16M4 18h16" />
      <circle cx="9" cy="6" r="2" />
      <circle cx="16" cy="12" r="2" />
      <circle cx="8" cy="18" r="2" />
    </>
  ),
  sun: (
    <>
      <circle cx="12" cy="12" r="4" />
      <path d="M12 1v2m0 18v2M1 12h2m18 0h2M4 4l2 2m12 12 2 2M4 20l2-2M18 6l2-2" />
    </>
  ),
  moon: <path d="M21 13a9 9 0 0 1-10-10 9 9 0 1 0 10 10Z" />,
  dialpad: (
    <>
      {[5, 11, 17].flatMap((y) =>
        [6, 12, 18].map((x) => (
          <circle key={`${x}-${y}`} cx={x} cy={y} r="1" />
        )),
      )}
    </>
  ),
};
export function Icon({ name }: { name: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.7"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      {paths[name]}
    </svg>
  );
}

export function Avatar({
  name,
  large = false,
  presence,
}: {
  name: string;
  large?: boolean;
  presence?: string;
}) {
  const tone = [...name].reduce((sum, c) => sum + c.charCodeAt(0), 0) % 5;
  return (
    <span className={`avatar tone-${tone}${large ? " large" : ""}`}>
      {name
        .trim()
        .split(/\s+/)
        .slice(0, 2)
        .map((w) => w[0])
        .join("")
        .toUpperCase() || <Icon name="users" />}
      {presence && (
        <span
          className="presence-dot"
          data-presence={presence}
          role="img"
          aria-label={`Presence: ${presence}`}
          title={`Presence: ${presence}`}
        />
      )}
    </span>
  );
}
