import type { VoicemailSettings } from "../../../packages/types/src/voicemail.js";
export function greetingUrl(
  greeting: NonNullable<VoicemailSettings["greeting"]>,
) {
  return URL.createObjectURL(
    new Blob([Uint8Array.from(atob(greeting.data), (c) => c.charCodeAt(0))], {
      type: greeting.mime,
    }),
  );
}
