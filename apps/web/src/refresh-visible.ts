/** Refresh cross-browser changes without polling hidden pages. */
export function refreshWhileVisible(refresh: () => void) {
  const update = () => {
    if (document.visibilityState === "visible") refresh();
  };
  window.addEventListener("focus", update);
  document.addEventListener("visibilitychange", update);
  const timer = window.setInterval(update, 30_000);
  return () => {
    window.removeEventListener("focus", update);
    document.removeEventListener("visibilitychange", update);
    window.clearInterval(timer);
  };
}
