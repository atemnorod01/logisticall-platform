/** A controls-only window. The original tab retains the single audio connection. */
export function openCallWindow(onClosed: () => void, focus = true) {
  const popup = window.open("", "_blank", "popup=yes,width=390,height=700");
  if (!popup) return null;
  try {
    const doc = popup.document;
    doc.title = "Active call · LogistiCall";
    doc.documentElement.lang = document.documentElement.lang || "en";
    const root = doc.createElement("div");
    root.className = "lc-call-window";
    doc.body.replaceChildren(root);
    const syncAppearance = () => {
      doc.documentElement.className = document.documentElement.className;
      doc.documentElement.style.colorScheme = getComputedStyle(
        document.getElementById("app") ?? document.documentElement,
      ).colorScheme;
      doc.body.className = document.body.className;
    };
    // Use actual stylesheet nodes, including Vite's development styles.
    const copies: Node[] = [];
    const syncStyles = () => {
      copies.forEach((node) => node.parentNode?.removeChild(node));
      copies.length = 0;
      document
        .querySelectorAll('link[rel="stylesheet"],style')
        .forEach((node) => {
          const copy = node.cloneNode(true) as HTMLElement;
          if (copy instanceof HTMLLinkElement)
            copy.href = (node as HTMLLinkElement).href;
          doc.head.appendChild(copy);
          copies.push(copy);
        });
    };
    syncAppearance();
    syncStyles();
    const appearance = new MutationObserver(syncAppearance);
    appearance.observe(document.documentElement, { attributes: true });
    appearance.observe(document.body, { attributes: true });
    const app = document.getElementById("app");
    if (app) appearance.observe(app, { attributes: true });
    const styles = new MutationObserver(syncStyles);
    styles.observe(document.head, {
      childList: true,
      subtree: true,
      characterData: true,
    });
    let disposed = false;
    const cleanup = () => {
      if (disposed) return;
      disposed = true;
      appearance.disconnect();
      styles.disconnect();
      window.clearInterval(watch);
      popup.removeEventListener("pagehide", closed);
      window.removeEventListener("pagehide", parentClosed);
    };
    const closed = () => {
      cleanup();
      onClosed();
    };
    const parentClosed = () => {
      cleanup();
      popup.close();
    };
    const watch = window.setInterval(() => {
      if (popup.closed) closed();
    }, 500);
    popup.addEventListener("pagehide", closed);
    window.addEventListener("pagehide", parentClosed);
    if(focus)popup.focus();
    return {
      root,
      focus: () => popup.focus(),
      close: () => {
        cleanup();
        popup.close();
      },
    };
  } catch {
    popup.close();
    return null;
  }
}
