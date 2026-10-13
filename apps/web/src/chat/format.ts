import type { Message } from "../../../../packages/types/src/messaging.js";
type GroupableMessage = Pick<Message, "senderKey" | "internal" | "createdAt" | "callEvent">;
export function continuesMessageGroup(
  m: GroupableMessage,
  previous?: GroupableMessage,
) {
  if (
    !previous ||
    m.callEvent || previous.callEvent ||
    !m.senderKey ||
    m.senderKey !== previous.senderKey ||
    m.internal !== previous.internal
  )
    return false;
  const time = new Date(m.createdAt),
    before = new Date(previous.createdAt),
    gap = +time - +before;
  return (
    Number.isFinite(gap) &&
    gap >= 0 &&
    gap < 300000 &&
    time.toDateString() === before.toDateString()
  );
}
export function inboxTime(value: string, now = new Date()) {
  const date = new Date(value);
  if (date.toDateString() === now.toDateString())
    return date.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
  const yesterday = new Date(now);
  yesterday.setDate(yesterday.getDate() - 1);
  if (date.toDateString() === yesterday.toDateString()) return "Yesterday";
  return date.toLocaleDateString([], { month: "short", day: "numeric" });
}

export function commentTime(value: string, now = new Date()) {
  const date = new Date(value);
  const time = date.toLocaleTimeString([], {
    hour: "numeric",
    minute: "2-digit",
  });
  if (date.toDateString() === now.toDateString()) return time;
  const yesterday = new Date(now);
  yesterday.setDate(yesterday.getDate() - 1);
  if (date.toDateString() === yesterday.toDateString())
    return `Yesterday, ${time}`;
  const day = date.toLocaleDateString([], {
    month: "short",
    day: "numeric",
    ...(date.getFullYear() !== now.getFullYear()
      ? { year: "numeric" as const }
      : {}),
  });
  return `${day}, ${time}`;
}

export function conversationDay(value: string, now = new Date()) {
  const date = new Date(value);
  if (date.toDateString() === now.toDateString()) return "Today";
  const yesterday = new Date(now);
  yesterday.setDate(yesterday.getDate() - 1);
  if (date.toDateString() === yesterday.toDateString()) return "Yesterday";
  return date.toLocaleDateString([], {
    month: "short",
    day: "numeric",
    ...(date.getFullYear() !== now.getFullYear() ? { year: "numeric" as const } : {}),
  });
}
