// @ts-nocheck
// Adapted from the user-provided Atem chat implementation.
import { displaySnippets, languages } from "./code-snippets.js";
import { escape as h } from "./view-model.js";
const tags = new Set([
  "B",
  "STRONG",
  "I",
  "EM",
  "U",
  "S",
  "STRIKE",
  "BR",
  "P",
  "DIV",
  "UL",
  "OL",
  "LI",
  "BLOCKQUOTE",
  "A",
  "CODE",
  "PRE",
  "SPAN",
  "H1",
  "H2",
  "H3",
  "H4",
  "H5",
  "H6",
]);
export function cleanRich(html) {
  const t = document.createElement("template");
  t.innerHTML = html || "";
  const walk = (node) => {
    if (node.nodeType === 3) return h(node.textContent);
    if (node.nodeType !== 1) return "";
    if (node.hasAttribute("data-code-card")) {
      const language =
          node.querySelector("select")?.value ||
          node.dataset.language ||
          "plaintext",
        text =
          node.querySelector("textarea")?.value ??
          node.querySelector("pre")?.textContent ??
          "";
      return (
        '<pre data-language="' +
        (Object.hasOwn(languages, language) ? language : "plaintext") +
        '"><code>' +
        h(text) +
        "</code></pre>"
      );
    }
    if (["SCRIPT", "STYLE", "IFRAME", "OBJECT"].includes(node.tagName))
      return "";
    const children = [...node.childNodes].map(walk).join("");
    if (!tags.has(node.tagName)) return children;
    const tag = node.tagName.toLowerCase();
    if (tag === "br") return "<br>";
    let attrs =
      tag === "pre"
        ? ' data-language="' +
          (Object.hasOwn(languages, node.dataset.language)
            ? node.dataset.language
            : "plaintext") +
          '"'
        : "";
    if (tag === "a") {
      const href = node.getAttribute("href") || "";
      if (/^(https?:\/\/|mailto:)/i.test(href))
        attrs =
          ' href="' + h(href) + '" target="_blank" rel="noopener noreferrer"';
    }
    // Inherit theme colors in the composer and message bubbles, including older messages.
    // Clipboard foregrounds/backgrounds can be unreadable in the opposite theme.
    const styles = [];
    for (const property of [
      "font-size",
      "font-weight",
      "font-style",
      "text-decoration",
    ]) {
      const value = node.style.getPropertyValue(property);
      if (!value) continue;
      if (
        property === "font-size" &&
        !/^(?:[0-9.]+(?:px|pt|em|rem|%)|small|medium|large|x-large|xx-large)$/.test(
          value,
        )
      )
        continue;
      if (property === "font-size") {
        const sizes = { small: 13, medium: 16, large: 18, "x-large": 24, "xx-large": 32 };
        if (sizes[value]) { styles.push("font-size:" + sizes[value] + "px"); continue; }
        const match = value.match(/^([0-9.]+)(px|pt)$/);
        if (match) {
          styles.push(
            "font-size:" +
              Math.max(
                10,
                Math.min(
                  48,
                  Number(match[1]) * (match[2] === "pt" ? 4 / 3 : 1),
                ),
              ) +
              "px",
          );
          continue;
        }
      }
      if (
        /^[a-zA-Z0-9#.,%()\s-]+$/.test(value) &&
        !/(url|expression|var)\s*\(/i.test(value)
      )
        styles.push(property + ":" + value);
    }
    if (styles.length) attrs += ' style="' + h(styles.join(";")) + '"';
    return "<" + tag + attrs + ">" + children + "</" + tag + ">";
  };
  return [...t.content.childNodes].map(walk).join("");
}
const expanded = new Set();
export function richToggle(id) {
  return `<button type="button" class="format-toggle" data-rich-toggle="${id}" aria-label="Toggle formatting" title="Show or hide formatting" aria-expanded="${expanded.has(id)}"><span aria-hidden="true">A</span></button>`;
}
export function toggleRich(id) {
  if (expanded.has(id)) expanded.delete(id);
  else expanded.add(id);
  const toolbar = document.getElementById(id + "-toolbar");
  if (toolbar) toolbar.hidden = !expanded.has(id);
  document
    .querySelector('[data-rich-toggle="' + id + '"]')
    ?.setAttribute("aria-expanded", String(expanded.has(id)));
}
export function richToolbar(id) {
  return (
    `<div id="${id}-toolbar" class="rich-toolbar" role="toolbar" aria-label="Text formatting" ${expanded.has(id) ? "" : "hidden"}>` +
    [
      ["bold", "Bold", "<b>B</b>"],
      ["italic", "Italic", "<i>I</i>"],
      ["underline", "Underline", "<u>U</u>"],
      ["strikeThrough", "Strikethrough", "<s>S</s>"],
      ["insertUnorderedList", "Bulleted list", "☷"],
      ["insertOrderedList", "Numbered list", "1."],
      ["formatBlock", "Quote", "❞"],
      ["codeBlock", "Code block", "&lt;/&gt;"],
      ["createLink", "Insert link", "↗"],
      ["removeFormat", "Clear formatting", "Tx"],
    ]
      .map(
        ([cmd, label, icon]) =>
          `<button type="button" data-rich-command="${cmd}" data-rich-target="${id}" title="${label}" aria-label="${label}">${icon}</button>`,
      )
      .join("") +
    "</div>"
  );
}
export const richValue = (html, text) =>
  html
    ? displaySnippets(cleanRich(html), true)
    : h(text || "").replaceAll("\n", "<br>");
export const richDisplay = (html) => displaySnippets(cleanRich(html), false);
export function richSnapshot(editor) {
  const clone = editor.cloneNode(true);
  const originals = editor.querySelectorAll("[data-code-card]");
  clone.querySelectorAll("[data-code-card]").forEach((card, i) => {
    const original = originals[i],
      area = card.querySelector("textarea");
    if (area) area.textContent = original.querySelector("textarea").value;
    card.dataset.language = original.dataset.language;
    card.querySelector("select")?.remove();
  });
  return cleanRich(clone.innerHTML);
}
export function richPlain(editor) {
  const t = document.createElement("template");
  t.innerHTML = richSnapshot(editor);
  const walk = (n) => {
    if (n.nodeType === 3) return n.textContent;
    if (n.nodeType !== 1) return "";
    if (n.tagName === "BR") return "\n";
    if (n.tagName === "PRE") return n.textContent + "\n";
    const text = [...n.childNodes].map(walk).join("");
    return (
      text + (["DIV", "P", "LI", "BLOCKQUOTE"].includes(n.tagName) ? "\n" : "")
    );
  };
  return [...t.content.childNodes].map(walk).join("").replace(/\n$/, "");
}
