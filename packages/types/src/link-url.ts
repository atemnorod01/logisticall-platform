/** Recognize web links without interpreting email addresses as websites. */
export function firstWebUrl(text: string): string | null {
  const match =
    /(?:^|[\s([{])((?:https?:\/\/|www\.)[^\s<>"']+|(?:[a-z0-9](?:[a-z0-9-]*[a-z0-9])?\.)+[a-z]{2,63}(?::\d+)?(?:[/?#][^\s<>"']*)?)/i.exec(
      text,
    );
  if (!match?.[1]) return null;
  const raw = match[1].replace(/[.,!?;:)\]}]+$/, "");
  try {
    const url = new URL(/^https?:\/\//i.test(raw) ? raw : `https://${raw}`);
    if (url.username || url.password) return null;
    // Preview transport is HTTPS, including links pasted with legacy HTTP.
    url.protocol = "https:";
    return url.href;
  } catch {
    return null;
  }
}
