const path = require("path");
const fs = require("fs");
const multer = require("multer");

// Upload folder: public/uploads (served statically by express.static("public"))
const UPLOAD_DIR = path.join(__dirname, "..", "public", "uploads");
fs.mkdirSync(UPLOAD_DIR, { recursive: true });

const ALLOWED_TYPES = ["image/jpeg", "image/png", "image/webp", "image/gif", "image/svg+xml"];
const MAX_SIZE = 2 * 1024 * 1024; // 2MB max (spec)

const storage = multer.diskStorage({
  destination: (_req, _file, cb) => cb(null, UPLOAD_DIR),
  filename: (_req, file, cb) => {
    const ext = path.extname(file.originalname || "").toLowerCase() || ".png";
    const base = Date.now().toString(36) + "-" + Math.random().toString(36).slice(2, 8);
    cb(null, base + ext);
  },
});

// Reject anything that is not an image — protects against malicious uploads.
function fileFilter(_req, file, cb) {
  if (ALLOWED_TYPES.includes(file.mimetype)) return cb(null, true);
  const err = new Error("শুধু image ফাইল অনুমোদিত (jpg, png, webp, gif, svg)");
  err.status = 400;
  cb(err);
}

const upload = multer({
  storage,
  fileFilter,
  limits: { fileSize: MAX_SIZE, files: 1 },
});

module.exports = { upload, UPLOAD_DIR, MAX_SIZE };
