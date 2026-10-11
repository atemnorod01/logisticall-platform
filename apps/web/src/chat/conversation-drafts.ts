// @ts-nocheck
// Adapted from the user-provided Atem chat implementation.
// Browser-local drafts, isolated by account, tenant and conversation.
export function conversationDrafts(
  storage = () => globalThis.localStorage,
  onError = () => {},
) {
  const memory = new Map();
  const key = (scope, id) => `atem.conversation-draft.v1:${scope}:${id}`;
  function read(scope, id) {
    const k = key(scope, id);
    if (memory.has(k)) return memory.get(k);
    try {
      const value = JSON.parse(storage()?.getItem(k) || "null");
      const draft =
        value && typeof value.text === "string"
          ? {
              text: value.text,
              rich: typeof value.rich === "string" ? value.rich : "",
            }
          : { text: "", rich: "" };
      memory.set(k, draft);
      return draft;
    } catch {
      return { text: "", rich: "" };
    }
  }
  function write(scope, id, text, rich) {
    if (!scope || !id || id.startsWith("call:")) return;
    const k = key(scope, id),
      value = { text, rich };
    memory.set(k, value);
    try {
      if (text.trim()) storage()?.setItem(k, JSON.stringify(value));
      else storage()?.removeItem(k);
    } catch {
      onError();
    }
  }
  return { read, write };
}
