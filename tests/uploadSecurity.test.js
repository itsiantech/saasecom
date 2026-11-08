const { test, after } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const os = require("os");
const path = require("path");
const express = require("express");
const request = require("supertest");

const {
  makeImageUpload,
  singleImage,
  finalizeImage,
  sniffImage,
  validateSvg,
} = require("../middleware/upload");

const TMP_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "luxe-upload-"));

after(() => {
  fs.rmSync(TMP_DIR, { recursive: true, force: true });
});

const PNG = Buffer.concat([
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
  Buffer.alloc(16),
]);
const JPEG = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(16)]);
const GIF = Buffer.from("GIF89a" + "\0".repeat(16), "binary");
const WEBP = Buffer.concat([Buffer.from("RIFF"), Buffer.alloc(4), Buffer.from("WEBP")]);
const ICO = Buffer.from([0x00, 0x00, 0x01, 0x00, 0x01, 0x00]);
const HTML = Buffer.from("<html><script>alert(1)</script></html>");

function uploadApp({ allowSvg = false, maxBytes = 1024 * 1024 } = {}) {
  const app = express();
  const uploader = makeImageUpload({ maxBytes, allowSvg });
  app.post(
    "/upload",
    singleImage(uploader, "image"),
    finalizeImage({ dir: TMP_DIR, allowSvg }),
    (req, res) => res.json({ filename: req.file.filename, mimetype: req.file.mimetype })
  );
  return app;
}

test("magic-byte sniffing recognises the supported raster formats", () => {
  assert.equal(sniffImage(PNG), "image/png");
  assert.equal(sniffImage(JPEG), "image/jpeg");
  assert.equal(sniffImage(GIF), "image/gif");
  assert.equal(sniffImage(WEBP), "image/webp");
  assert.equal(sniffImage(ICO), "image/x-icon");
  assert.equal(sniffImage(Buffer.from("<svg xmlns=\"http://www.w3.org/2000/svg\"></svg>")), "image/svg+xml");
  assert.equal(sniffImage(HTML), null);
});

test("SVG validation blocks active content", () => {
  assert.equal(validateSvg(Buffer.from('<svg><rect width="1"/></svg>')), "");
  assert.match(validateSvg(Buffer.from('<svg><script>alert(1)</script></svg>')), /script/);
  assert.match(validateSvg(Buffer.from('<svg onload="alert(1)"></svg>')), /event handler/);
  assert.match(validateSvg(Buffer.from('<!DOCTYPE svg><svg></svg>')), /DOCTYPE/);
  assert.match(validateSvg(Buffer.from('<svg><image href="https://evil.test/x"/></svg>')), /বাইরের লিংক/);
});

test("extension comes from the bytes, not the client filename", async () => {
  const res = await request(uploadApp())
    .post("/upload")
    .attach("image", PNG, { filename: "shell.php", contentType: "image/png" });
  assert.equal(res.status, 200, JSON.stringify(res.body));
  assert.match(res.body.filename, /^[a-f0-9]{32}\.png$/);
  assert.ok(fs.existsSync(path.join(TMP_DIR, res.body.filename)));
});

test("non-image payloads are rejected even with an image content-type", async () => {
  const res = await request(uploadApp())
    .post("/upload")
    .attach("image", HTML, { filename: "photo.png", contentType: "image/png" });
  assert.equal(res.status, 400);
});

test("SVG is refused by default and dangerous SVG is refused when enabled", async () => {
  const svg = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"><rect/></svg>');

  const blocked = await request(uploadApp())
    .post("/upload")
    .attach("image", svg, { filename: "logo.svg", contentType: "image/svg+xml" });
  assert.equal(blocked.status, 400);

  const dangerous = await request(uploadApp({ allowSvg: true }))
    .post("/upload")
    .attach("image", Buffer.from("<svg><script>alert(1)</script></svg>"), {
      filename: "logo.svg",
      contentType: "image/svg+xml",
    });
  assert.equal(dangerous.status, 400);

  const clean = await request(uploadApp({ allowSvg: true }))
    .post("/upload")
    .attach("image", svg, { filename: "logo.svg", contentType: "image/svg+xml" });
  assert.equal(clean.status, 200, JSON.stringify(clean.body));
  assert.match(clean.body.filename, /^[a-f0-9]{32}\.svg$/);
});

test("oversized uploads are refused", async () => {
  const res = await request(uploadApp({ maxBytes: 32 }))
    .post("/upload")
    .attach("image", Buffer.concat([PNG, Buffer.alloc(64)]), {
      filename: "big.png",
      contentType: "image/png",
    });
  assert.equal(res.status, 400);
});
