// @ts-nocheck
// Adapted from the user-provided Atem chat implementation.
const boundDocuments = new WeakSet();
export function mountMessageMenus(doc = document) {
  if (boundDocuments.has(doc)) return;
  boundDocuments.add(doc);
  const closeExcept = (keep) => {
    for (const menu of doc.querySelectorAll(".message-more[open]"))
      if (menu !== keep) menu.open = false;
  };
  const owner = (target) => target?.closest?.(".message-more");
  doc.addEventListener(
    "pointerdown",
    (event) => closeExcept(owner(event.target)),
    true,
  );
  doc.addEventListener(
    "click",
    (event) => {
      const menu = owner(event.target);
      closeExcept(menu);
      if (menu && event.target.closest("button[data-action]"))
        menu.open = false;
    },
    true,
  );
  doc.addEventListener("focusin", (event) => closeExcept(owner(event.target)));
  doc.addEventListener(
    "keydown",
    (event) => {
      if (event.key !== "Escape") return;
      const menus = [...doc.querySelectorAll(".message-more[open]")];
      if (!menus.length) return;
      event.preventDefault();
      const focused = owner(doc.activeElement);
      closeExcept(null);
      (focused || menus[0]).querySelector("summary")?.focus();
    },
    true,
  );
}
