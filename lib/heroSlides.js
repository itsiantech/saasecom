const MAX_SLIDES = 10;

function cleanText(value, max) {
  return String(value == null ? "" : value)
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, max);
}

function safeUrl(value, message) {
  const raw = String(value || "").trim();
  if (!raw) return "";
  if (raw.length > 500) throw new Error("URL 500 character er beshi hote parbe na");
  const lower = raw.toLowerCase();
  if (lower.startsWith("javascript:") || lower.startsWith("data:") || lower.startsWith("vbscript:")) {
    throw new Error(message);
  }
  if (/[\u0000-\u001f]/.test(raw)) throw new Error(message);
  if (raw.startsWith("//")) throw new Error(message);
  if (raw.startsWith("/")) return raw;
  let url;
  try {
    url = new URL(raw);
  } catch {
    throw new Error(message);
  }
  if (url.protocol !== "https:" && url.protocol !== "http:") throw new Error(message);
  return url.toString();
}

function normalizeImage(value) {
  const image = safeUrl(value, "Image path valid na");
  if (!image) throw new Error("Slide image lagbe");
  return image;
}

function normalizeLink(value) {
  return safeUrl(value, "Link /path ba https:// diye shuru hote hobe");
}

function normalizeSlide(body) {
  const input = body || {};
  return {
    image: normalizeImage(input.image),
    alt: cleanText(input.alt, 160),
    title: cleanText(input.title, 120),
    subtitle: cleanText(input.subtitle, 240),
    buttonLabel: cleanText(input.buttonLabel, 40),
    linkUrl: normalizeLink(input.linkUrl),
    active: input.active !== false,
  };
}

function publicSlide(slide) {
  return {
    id: slide && slide._id ? String(slide._id) : "",
    image: (slide && slide.image) || "",
    alt: (slide && slide.alt) || "",
    title: (slide && slide.title) || "",
    subtitle: (slide && slide.subtitle) || "",
    buttonLabel: (slide && slide.buttonLabel) || "",
    linkUrl: (slide && slide.linkUrl) || "",
  };
}

function sortForPublic(slides) {
  return (Array.isArray(slides) ? slides : [])
    .filter((slide) => slide && slide.active === true)
    .sort((a, b) => {
      const orderDiff = (Number(a.sortOrder) || 0) - (Number(b.sortOrder) || 0);
      if (orderDiff) return orderDiff;
      return new Date(a.createdAt || 0) - new Date(b.createdAt || 0);
    });
}

module.exports = {
  MAX_SLIDES,
  cleanText,
  normalizeImage,
  normalizeLink,
  normalizeSlide,
  publicSlide,
  sortForPublic,
};
