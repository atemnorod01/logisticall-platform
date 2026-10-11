import sanitizeHtml from "sanitize-html";
// The server is the persistence boundary; the browser sanitizer is defense in depth.
export function cleanMessageRich(value: string) {
  return sanitizeHtml(value, {
    allowedTags: [
      "b",
      "strong",
      "i",
      "em",
      "u",
      "s",
      "strike",
      "br",
      "p",
      "div",
      "ul",
      "ol",
      "li",
      "blockquote",
      "a",
      "code",
      "pre",
      "span",
      "h1",
      "h2",
      "h3",
      "h4",
      "h5",
      "h6",
    ],
    allowedAttributes: {
      "*": ["style"],
      a: ["href", "target", "rel"],
      pre: ["data-language"],
    },
    allowedSchemes: ["http", "https", "mailto"],
    allowProtocolRelative: false,
    transformTags: {
      a: sanitizeHtml.simpleTransform("a", {
        target: "_blank",
        rel: "noopener noreferrer",
      }),
    },
    allowedStyles: {
      "*": {
        "font-size": [/^(?:1[0-9]|[2-3][0-9]|4[0-8])px$/],
        "font-weight": [/^(bold|normal|[1-9]00)$/],
        "font-style": [/^(normal|italic|oblique)$/],
        "text-decoration": [/^(underline|line-through|none)$/],
        color: [/^(#[a-f0-9]{3,8}|[a-z]+|rgba?\([\d.,% ]+\))$/i],
        "background-color": [/^(#[a-f0-9]{3,8}|[a-z]+|rgba?\([\d.,% ]+\))$/i],
      },
    },
  });
}
