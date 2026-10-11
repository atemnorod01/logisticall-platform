// @ts-nocheck
// Adapted from the user-provided Atem chat implementation.
import hljs from "highlight.js/lib/core";
import json from "highlight.js/lib/languages/json";
import javascript from "highlight.js/lib/languages/javascript";
import typescript from "highlight.js/lib/languages/typescript";
import python from "highlight.js/lib/languages/python";
import sql from "highlight.js/lib/languages/sql";
import bash from "highlight.js/lib/languages/bash";
import css from "highlight.js/lib/languages/css";
import xml from "highlight.js/lib/languages/xml";
import yaml from "highlight.js/lib/languages/yaml";
import c from "highlight.js/lib/languages/c";
import cpp from "highlight.js/lib/languages/cpp";
import csharp from "highlight.js/lib/languages/csharp";
import go from "highlight.js/lib/languages/go";
import java from "highlight.js/lib/languages/java";
import dockerfile from "highlight.js/lib/languages/dockerfile";
import { escape as h } from "./view-model.js";
const grammars = {
  json,
  javascript,
  typescript,
  python,
  sql,
  bash,
  css,
  xml,
  yaml,
  c,
  cpp,
  csharp,
  go,
  java,
  dockerfile,
};
for (const [name, grammar] of Object.entries(grammars))
  hljs.registerLanguage(name, grammar);
export const languages = {
  auto: "Auto-detect",
  plaintext: "Plain Text",
  json: "JSON",
  javascript: "JavaScript",
  typescript: "TypeScript",
  python: "Python",
  sql: "SQL",
  bash: "Bash",
  css: "CSS",
  xml: "HTML / XML",
  yaml: "YAML",
  c: "C",
  cpp: "C++",
  csharp: "C#",
  go: "Go",
  java: "Java",
  dockerfile: "Dockerfile",
};
export function pastedCode(text, empty) {
  const normalized = text.replace(/\r\n?/g, "\n");
  return empty ? normalized.replace(/^(?:[ \t]*\n)+/, "") : normalized;
}
export function colorCode(code, language) {
  if (code.length > 20000) return { value: h(code), language: "plaintext" };
  if (language === "auto") {
    // Shared C-family syntax can outscore Java; prefer unambiguous Java constructs.
    if (/^\s*import\s+(?:static\s+)?(?:java|javax|jakarta)\.[\w.*]+\s*;/m.test(code) ||
        /\bSystem\.out\.(?:println|print|printf)\s*\(/.test(code) ||
        /\bpublic\s+static\s+void\s+main\s*\(\s*String\s*(?:\[\]|\.\.\.)/.test(code)) {
      return hljs.highlight(code, { language: "java" });
    }
    try {
      JSON.parse(code);
      return {
        ...hljs.highlight(code, { language: "json" }),
        language: "json",
      };
    } catch {}
    const result = hljs.highlightAuto(code, Object.keys(grammars));
    return result.relevance >= 3
      ? result
      : { value: h(code), language: "plaintext" };
  }
  return grammars[language]
    ? hljs.highlight(code, { language })
    : { value: h(code), language: "plaintext" };
}
const copyIcon = '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.7" aria-hidden="true"><rect x="8" y="8" width="12" height="12" rx="2"/><path d="M16 8V5a2 2 0 0 0-2-2H5a2 2 0 0 0-2 2v9a2 2 0 0 0 2 2h3"/></svg>';
const copiedIcon = '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.7" aria-hidden="true"><path d="m5 12 4 4L19 6"/></svg>';
export function snippetCard(code = "", language = "auto", editable = true) {
  language = Object.hasOwn(languages, language) ? language : "plaintext";
  return `<section class="code-card" data-code-card data-code-source="${h(code)}" contenteditable="false" data-language="${language}"><header>${
    editable
      ? `<select aria-label="Code language">${Object.entries(languages)
          .map(
            ([id, name]) =>
              `<option value="${id}" ${id === language ? "selected" : ""}>${name}</option>`,
          )
          .join("")}</select>`
      : `<span>${h(languages[language])}</span>`
  }<small class="code-detected"></small><button type="button" data-code-copy aria-label="Copy code" title="Copy code">${copyIcon}</button>${editable ? '<button type="button" data-code-remove aria-label="Remove code snippet">×</button>' : ""}</header><div class="code-body"><div class="code-lines" aria-hidden="true"></div><div class="code-viewport"><pre class="code-highlight" aria-hidden="${editable}"><code>${h(code)}</code></pre>${editable ? `<textarea class="code-input" aria-label="Code snippet" spellcheck="false" wrap="off">${h(code)}</textarea>` : ""}</div></div></section>`;
}
export function displaySnippets(html, editable) {
  const t = document.createElement("div");
  t.innerHTML = html;
  for (const pre of [...t.querySelectorAll("pre")]) {
    const spacer = pre.nextElementSibling;
    if (!editable && spacer && !spacer.nextSibling &&
        /^(DIV|P)$/.test(spacer.tagName) && !spacer.textContent.trim() &&
        [...spacer.children].every((child) => child.tagName === "BR")) {
      spacer.remove();
    }
    const card = document.createElement("template");
    card.innerHTML = snippetCard(
      pre.textContent,
      pre.dataset.language || "plaintext",
      editable,
    );
    pre.replaceWith(card.content);
  }
  return t.innerHTML;
}
export function mountSnippets(onChange) {
  for (const card of document.querySelectorAll("[data-code-card]")) {
    if (card.dataset.bound) continue;
    card.dataset.bound = "1";
    const area = card.querySelector("textarea"),
      select = card.querySelector("select"),
      pre = card.querySelector("pre"),
      lines = card.querySelector(".code-lines");
    const original = card.dataset.codeSource ?? pre.textContent;
    const code = () => (area ? area.value : original);
    const paint = () => {
      const text = code(),
        result = colorCode(text, card.dataset.language);
      pre.querySelector("code").innerHTML = result.value + (area ? "\n" : "");
      lines.innerHTML = text
        .split("\n")
        .map((_, i) => "<div>" + (i + 1) + "</div>")
        .join("");
      card.querySelector(".code-detected").textContent =
        card.dataset.language === "auto"
          ? languages[result.language] || "Plain Text"
          : "";
    };
    const change = () => {
      paint();
      onChange(card.closest('[contenteditable="true"]'));
    };
    if (area) {
      area.oninput = change;
      area.onpaste = (e) => {
        e.preventDefault();
        e.stopPropagation();
        const empty = !area.value.trim();
        const text = pastedCode(e.clipboardData.getData("text/plain"), empty);
        if (empty) area.select();
        // Native insertion retains the textarea's undo history.
        if (!document.execCommand("insertText", false, text)) {
          area.setRangeText(text, area.selectionStart, area.selectionEnd, "end");
          change();
        }
      };
      area.onscroll = () => {
        pre.scrollTop = area.scrollTop;
        pre.scrollLeft = area.scrollLeft;
        lines.scrollTop = area.scrollTop;
      };
      area.onkeydown = (e) => {
        if (e.key === "Tab") {
          e.preventDefault();
          area.setRangeText(
            "  ",
            area.selectionStart,
            area.selectionEnd,
            "end",
          );
          change();
        }
      };
    }
    if (select)
      select.onchange = () => {
        card.dataset.language = select.value;
        change();
      };
    card.querySelector("[data-code-copy]").onclick = async (e) => {
      const button = e.currentTarget;
      try {
        await navigator.clipboard.writeText(code());
        button.innerHTML = copiedIcon;
        button.setAttribute("aria-label", "Code copied");
        button.title = "Code copied";
      } catch {
        button.setAttribute("aria-label", "Copy failed — try again");
        button.title = "Copy failed — try again";
      }
      setTimeout(() => {
        button.innerHTML = copyIcon;
        button.setAttribute("aria-label", "Copy code");
        button.title = "Copy code";
      }, 1500);
    };
    card.querySelector("[data-code-remove]")?.addEventListener("click", () => {
      const editor = card.closest('[contenteditable="true"]');
      card.remove();
      onChange(editor);
    });
    paint();
  }
}
