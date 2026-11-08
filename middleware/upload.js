const path = require("path");
const fs = require("fs");
const crypto = require("crypto");
const multer = require("multer");

// Upload folder: public/uploads (served statically by express.static("public"))
const UPLOAD_DIR = path.join(__dirname, "..", "public", "uploads");
fs.mkdirSync(UPLOAD_DIR, { recursive: true });

const MAX_SIZE = 2 * 1024 * 1024; // 2MB default for generic uploads

// Safe extension is derived from the sniffed bytes, never from originalname.
const MIME_EXT = {
  "image/jpeg": ".jpg",
  "image/png": ".png",
  "image/webp": ".webp",
  "image/gif": ".gif",
  "image/x-icon": ".ico",
  "image/svg+xml": ".svg",
};

function sniffImage(buf) {
  if (!buf || buf.length < 4) return null;
  if (buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return "image/jpeg";
  if (
    buf.length >= 8 &&
    buf[0] === 0x89 &&
    buf[1] === 0x50 &&
    buf[2] === 0x4e &&
    buf[3] === 0x47 &&
    buf[4] === 0x0d &&
    buf[5] === 0x0a &&
    buf[6] === 0x1a &&
    buf[7] === 0x0a
  ) {
    return "image/png";
  }
  const head6 = buf.toString("ascii", 0, 6);
  if (head6 === "GIF87a" || head6 === "GIF89a") return "image/gif";
  if (
    buf.length >= 12 &&
    buf.toString("ascii", 0, 4) === "RIFF" &&
    buf.toString("ascii", 8, 12) === "WEBP"
  ) {
    return "image/webp";
  }
  if (buf.length >= 4 && buf[0] === 0x00 && buf[1] === 0x00 && buf[2] === 0x01 && buf[3] === 0x00) {
    return "image/x-icon";
  }
  if (/<svg[\s>]/i.test(buf.toString("utf8", 0, Math.min(buf.length, 4096)))) {
    return "image/svg+xml";
  }
  return null;
}

const SVG_BLOCKED = [
  [/<!DOCTYPE/i, "DOCTYPE"],
  [/<!ENTITY/i, "ENTITY"],
  [/<script[\s>]/i, "script"],
  [/<foreignObject/i, "foreignObject"],
  [/\son[a-z]+\s*=/i, "event handler"],
  [/javascript:/i, "javascript: URL"],
  [/data:text\/html/i, "data:text/html URL"],
  [/@import/i, "@import"],
];

// SVG is markup, so it can carry script. Only files with no active content pass.
function validateSvg(buffer) {
  const text = buffer.toString("utf8");
  for (const [pattern, label] of SVG_BLOCKED) {
    if (pattern.test(text)) return `SVG-এ ${label} অনুমোদিত নয়`;
  }
  const remote = /(?:xlink:)?href\s*=\s*["']\s*(?:https?:|\/\/)/i;
  if (remote.test(text)) return "SVG-এ বাইরের লিংক অনুমোদিত নয়";
  return "";
}

function makeImageUpload({ maxBytes = MAX_SIZE, allowSvg = false } = {}) {
  const upload = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: maxBytes, files: 1 },
    fileFilter: (_req, file, cb) => {
      const type = String(file.mimetype || "").toLowerCase();
      // Magic bytes in finalizeImage() decide the real type; this only rejects obvious non-images.
      if (type.startsWith("image/") || type === "application/octet-stream") return cb(null, true);
      const err = new Error("শুধু image ফাইল অনুমোদিত");
      err.status = 400;
      cb(err);
    },
  });
  upload.maxBytes = maxBytes;
  upload.allowSvg = allowSvg;
  return upload;
}

// Multer wrapper that turns size/type errors into one JSON response.
function singleImage(upload, field) {
  return (req, res, next) => {
    upload.single(field)(req, res, (err) => {
      if (!err) return next();
      if (err.code === "LIMIT_FILE_SIZE") {
        const mb = Math.round(upload.maxBytes / (1024 * 1024));
        return res.status(400).json({ message: `ফাইল অনেক বড় — সর্বোচ্চ ${mb}MB` });
      }
      return res.status(err.status || 400).json({ message: err.message });
    });
  };
}

// Verifies the buffered bytes, then writes a random-name file with a safe extension.
function finalizeImage({ dir = UPLOAD_DIR, allowSvg = false } = {}) {
  return async (req, res, next) => {
    if (!req.file) return next();
    try {
      const kind = sniffImage(req.file.buffer);
      if (!kind) {
        return res.status(400).json({ message: "ফাইলটি বৈধ image নয়" });
      }
      if (kind === "image/svg+xml") {
        if (!allowSvg) {
          return res.status(400).json({ message: "SVG এই জায়গায় অনুমোদিত নয় — jpg/png/webp/gif দিন" });
        }
        const problem = validateSvg(req.file.buffer);
        if (problem) return res.status(400).json({ message: problem });
      }
      const filename = crypto.randomBytes(16).toString("hex") + MIME_EXT[kind];
      await fs.promises.mkdir(dir, { recursive: true });
      const filePath = path.join(dir, filename);
      await fs.promises.writeFile(filePath, req.file.buffer);
      req.file.filename = filename;
      req.file.path = filePath;
      req.file.destination = dir;
      req.file.mimetype = kind;
      req.file.size = req.file.buffer.length;
      next();
    } catch (err) {
      next(err);
    }
  };
}

module.exports = {
  makeImageUpload,
  singleImage,
  finalizeImage,
  sniffImage,
  validateSvg,
  UPLOAD_DIR,
  MAX_SIZE,
};
