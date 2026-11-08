/* ==========================================================================
   Server-side rich-text sanitizer for admin-authored HTML (product
   descriptions). Allow-list based — no dependency needed. Any tag outside
   the list stays as text, and raw-text containers (script/style/iframe…)
   are removed together with their contents.
   ========================================================================== */
const MAX_LENGTH = 100000;

const ALLOWED_TAGS = new Set([
  "p", "br", "b", "strong", "i", "em", "u", "s", "strike", "del", "ins",
  "ul", "ol", "li", "h1", "h2", "h3", "h4", "h5", "h6", "blockquote",
  "pre", "code", "a", "img", "span", "div", "table", "thead", "tbody",
  "tfoot", "tr", "th", "td", "hr", "figure", "figcaption", "sub", "sup",
  "small",
]);

const VOID_TAGS = new Set(["br", "img", "hr"]);

// dropped with their inner content (never re-emitted as text)
const RAW_TEXT_TAGS = new Set([
  "script", "style", "iframe", "object", "noscript", "template",
  "svg", "math", "form", "select", "textarea", "button", "title", "head",
  "applet", "frameset", "marquee", "audio", "video",
]);

// dangerous but empty — the tag is dropped, the following content is kept
const DROP_TAG_ONLY = new Set(["link", "meta", "base", "embed", "param", "source", "track"]);

const ALLOWED_ATTRS = {
  a: new Set(["href", "title", "target"]),
  img: new Set(["src", "alt", "title", "width", "height"]),
  td: new Set(["colspan", "rowspan"]),
  th: new Set(["colspan", "rowspan"]),
  ol: new Set(["start", "type"]),
};

const NAMED_ENTITIES = {
  amp: "&",
  lt: "<",
  gt: ">",
  quot: '"',
  apos: "'",
  colon: ":",
  tab: "\t",
  newline: "\n",
};

function decodeEntities(value) {
  return String(value).replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (match, body) => {
    if (body[0] === "#") {
      const code = body[1] === "x" || body[1] === "X"
        ? parseInt(body.slice(2), 16)
        : parseInt(body.slice(1), 10);
      return Number.isFinite(code) && code > 0 && code <= 0x10ffff ? String.fromCodePoint(code) : "";
    }
    const named = NAMED_ENTITIES[body.toLowerCase()];
    return named === undefined ? match : named;
  });
}

function escapeText(value) {
  return String(value).replace(/[&<>]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" }[c]));
}

function escapeAttr(value) {
  return String(value).replace(/[&<>"']/g, (c) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;",
  }[c]));
}

// absolute http(s) or same-origin relative URLs only
function safeUrl(raw, { image = false } = {}) {
  const decoded = decodeEntities(String(raw || "")).trim();
  if (!decoded) return "";
  const compact = decoded.replace(/[\u0000-\u0020\u007f]+/g, "");
  if (!compact) return "";
  const lower = compact.toLowerCase();

  if (/^[a-z][a-z0-9+.-]*:/i.test(compact)) {
    if (lower.startsWith("http://") || lower.startsWith("https://")) return compact.slice(0, 2000);
    if (!image && (lower.startsWith("mailto:") || lower.startsWith("tel:"))) return compact.slice(0, 2000);
    return "";
  }
  // relative path / fragment / query — a leading // is protocol-relative (http) and safe
  return compact.slice(0, 2000);
}

// index of the tag-closing ">" (quotes respected) — -1 when the tag never ends
function findTagEnd(html, from) {
  let quote = "";
  for (let i = from; i < html.length; i++) {
    const ch = html[i];
    if (quote) {
      if (ch === quote) quote = "";
      continue;
    }
    if (ch === '"' || ch === "'") quote = ch;
    else if (ch === ">") return i;
  }
  return -1;
}

// skip to the end of a raw-text container, tracking same-name nesting
function skipRawBlock(html, from, name) {
  const re = new RegExp("<\\s*(/?)\\s*" + name + "\\b[^>]*>", "gi");
  re.lastIndex = from;
  let depth = 1;
  let match;
  while ((match = re.exec(html))) {
    if (match[1] === "/") depth -= 1;
    else depth += 1;
    if (depth === 0) return re.lastIndex;
  }
  return html.length;
}

const ATTR_RE = /([a-zA-Z_:][-a-zA-Z0-9_:.]*)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'=<>`]+)))?/g;

function parseAttrs(raw) {
  const attrs = {};
  ATTR_RE.lastIndex = 0;
  let match;
  while ((match = ATTR_RE.exec(raw))) {
    const name = match[1].toLowerCase();
    if (attrs[name] !== undefined) continue;
    const value = match[2] !== undefined ? match[2] : match[3] !== undefined ? match[3] : match[4];
    attrs[name] = value === undefined ? "" : value;
  }
  return attrs;
}

function renderOpenTag(name, attrs) {
  const allowed = ALLOWED_ATTRS[name] || new Set();
  const parts = [];

  if (name === "a") {
    const href = safeUrl(attrs.href);
    if (href) {
      parts.push('href="' + escapeAttr(href) + '"');
      if (String(attrs.target || "").toLowerCase() === "_blank") {
        parts.push('target="_blank"', 'rel="noopener noreferrer"');
      }
    }
    if (allowed.has("title") && attrs.title) {
      parts.push('title="' + escapeAttr(String(attrs.title).slice(0, 200)) + '"');
    }
  } else if (name === "img") {
    const src = safeUrl(attrs.src, { image: true });
    if (!src) return ""; // an image without a safe source is dropped entirely
    parts.push('src="' + escapeAttr(src) + '"');
    if (attrs.alt) parts.push('alt="' + escapeAttr(String(attrs.alt).slice(0, 300)) + '"');
    if (attrs.title) parts.push('title="' + escapeAttr(String(attrs.title).slice(0, 200)) + '"');
    if (/^\d{1,4}$/.test(String(attrs.width || ""))) parts.push('width="' + attrs.width + '"');
    if (/^\d{1,4}$/.test(String(attrs.height || ""))) parts.push('height="' + attrs.height + '"');
  } else {
    if (name === "td" || name === "th") {
      if (/^\d{1,3}$/.test(String(attrs.colspan || ""))) parts.push('colspan="' + attrs.colspan + '"');
      if (/^\d{1,3}$/.test(String(attrs.rowspan || ""))) parts.push('rowspan="' + attrs.rowspan + '"');
    }
    if (name === "ol") {
      if (/^-?\d{1,4}$/.test(String(attrs.start || ""))) parts.push('start="' + attrs.start + '"');
      if (/^[1aAiI]$/.test(String(attrs.type || ""))) parts.push('type="' + attrs.type + '"');
    }
  }

  return "<" + name + (parts.length ? " " + parts.join(" ") : "") + ">";
}

function sanitizeRichText(input) {
  const html = String(input == null ? "" : input).slice(0, MAX_LENGTH);
  let out = "";
  let i = 0;

  while (i < html.length) {
    const lt = html.indexOf("<", i);
    if (lt === -1) {
      out += html.slice(i);
      break;
    }
    out += html.slice(i, lt);

    if (html.startsWith("<!--", lt)) {
      const end = html.indexOf("-->", lt + 4);
      i = end === -1 ? html.length : end + 3;
      continue;
    }
    if (html.startsWith("<!", lt) || html.startsWith("<?", lt)) {
      const end = html.indexOf(">", lt + 1);
      i = end === -1 ? html.length : end + 1;
      continue;
    }

    const tagEnd = findTagEnd(html, lt + 1);
    if (tagEnd === -1) {
      out += "&lt;";
      i = lt + 1;
      continue;
    }

    const inner = html.slice(lt + 1, tagEnd);
    const closing = inner.startsWith("/");
    const nameMatch = /^([a-zA-Z][a-zA-Z0-9:-]*)/.exec(closing ? inner.slice(1) : inner);

    if (!nameMatch) {
      // "<" that does not start a tag — keep it as literal text
      out += "&lt;";
      i = lt + 1;
      continue;
    }

    const name = nameMatch[1].toLowerCase();

    if (closing) {
      if (ALLOWED_TAGS.has(name) && !VOID_TAGS.has(name)) out += "</" + name + ">";
      i = tagEnd + 1;
      continue;
    }

    if (DROP_TAG_ONLY.has(name)) {
      i = tagEnd + 1;
      continue;
    }

    if (RAW_TEXT_TAGS.has(name)) {
      i = skipRawBlock(html, tagEnd + 1, name);
      continue;
    }

    if (ALLOWED_TAGS.has(name)) {
      const attrSource = (closing ? inner.slice(1) : inner).slice(nameMatch[0].length);
      out += renderOpenTag(name, parseAttrs(attrSource));
    }
    i = tagEnd + 1;
  }

  return out;
}

module.exports = { sanitizeRichText };
