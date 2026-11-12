require("dotenv").config();
const path = require("path");
const express = require("express");
const cors = require("cors");

const mongoose = require("mongoose");
const Store = require("./models/Store");

const app = express();
app.use(cors());
// rawBody kept for HMAC-verified webhooks
app.use(express.json({ verify: (req, _res, buf) => { req.rawBody = buf; } }));

// Liveness probe for the deploy pipeline — mounted before tenant resolution so any host can hit it.
app.get("/api/health", (req, res) => {
  res.json({ status: "ok", db: mongoose.connection.readyState === 1 ? "up" : "down" });
});

// live shop-address check — onboarding has no store yet, so this must skip tenant resolution
app.use("/api", require("./routes/shopAddress"));

// public storefront resolves its own store by slug, so it mounts before tenant middleware
app.use("/api/storefront", require("./routes/storefront"));
app.use("/api/public", require("./routes/publicApi"));

app.use(require("./middleware/tenant"));
app.use("/api/products", require("./routes/products"));
app.use("/api/auth", require("./routes/auth"));
app.use("/api/stores", require("./routes/stores"));
app.use("/api/plans", require("./routes/plans"));
app.use("/api/admin", require("./routes/admin"));
app.use("/api/subscriptions", require("./routes/subscriptions"));
app.use("/api/billing", require("./routes/billing"));
app.use("/api/orders", require("./routes/orders"));
app.use("/api/customers", require("./routes/customers"));
// Isolated module: a supplier load failure must never stop the app from booting.
try {
  app.use("/api/suppliers", require("./routes/suppliers"));
} catch (err) {
  console.error("Suppliers module mount failed:", err.message);
}
// Isolated module: reports must never stop the app from booting.
try {
  app.use("/api/admin/reports", require("./routes/reports"));
} catch (err) {
  console.error("Reports module mount failed:", err.message);
}
// Isolated module: inventory must never stop the app from booting.
try {
  app.use("/api/admin/inventory", require("./routes/inventory"));
} catch (err) {
  console.error("Inventory module mount failed:", err.message);
}
// Isolated module: accounts must never stop the app from booting.
try {
  app.use("/api/admin/accounts", require("./routes/accounts"));
} catch (err) {
  console.error("Accounts module mount failed:", err.message);
}
app.use("/api/staff", require("./routes/staff"));
app.use("/api/plans", require("./routes/plans"));
app.use("/api/admin", require("./routes/admin"));
app.use("/api/categories", require("./routes/categories"));
app.use("/api/brands", require("./routes/brands"));
app.use("/api/product-form", require("./routes/productForm"));
app.use("/api/settings", require("./routes/settings"));
app.use("/api/appearance", require("./routes/appearance"));
app.use("/api/cart", require("./routes/cart"));
app.use("/api/international", require("./routes/international"));
app.use("/api/wholesale", require("./routes/wholesale"));
app.use("/api/installments", require("./routes/installments"));
app.use("/api/product-catalog", require("./routes/productCatalog"));
app.use("/api/promotions", require("./routes/promotions"));
app.use("/api/flash-sales", require("./routes/flashSales"));
app.use("/api/coupons", require("./routes/coupons"));
app.use("/api/hero-slides", require("./routes/heroSlides"));
// ---- tenant host (amar-dokan.platform.com ba dokan.com) — ekhane storefront ar store panel cholbe
const { resolveHostStore } = require("./lib/hostStore");
const { storefrontUrl } = require("./lib/storefrontUrl");
// platform-only pages must not open on a shop host; shop pages are allowed there
const PLATFORM_ONLY_PAGES = new Set(["/admin.html", "/admin-login.html", "/index.html", "/setup.html", "/plan-checkout.html"]);

// store er frontend = Next.js themed site (Store Settings → Appearance er published theme)
async function toStorefront(res, req, store) {
  const target = await storefrontUrl(store);
  const here = req.protocol + "://" + req.get("host");
  if (target.replace(/\/$/, "") === here.replace(/\/$/, "")) return false; // loop hobe na
  res.redirect(302, target);
  return true;
}

app.use(require("./middleware/hostGate"));

app.use(async (req, res, next) => {
  if (req.method !== "GET" && req.method !== "HEAD") return next();
  try {
    const store = await resolveHostStore(req);
    if (!store) return next();
    if (PLATFORM_ONLY_PAGES.has(req.path)) return res.status(404).send("এই ঠিকানায় প্ল্যাটফর্ম পেজ নেই — দোকান ম্যানেজ করতে ড্যাশবোর্ড ব্যবহার করুন।");
    if (req.path === "/") {
      if (await toStorefront(res, req, store)) return;
      return res.sendFile(path.join(__dirname, "public", "shop.html"));
    }
    next();
  } catch (err) {
    next(err);
  }
});

// purano /?store=slug link ekhon /slug e jay, jate shared link ভাঙে না
app.use((req, res, next) => {
  const slug = String(req.query.store || "").trim().toLowerCase();
  if (req.path === "/" && /^[a-z0-9][a-z0-9-]{0,62}$/.test(slug)) return res.redirect(302, "/" + slug);
  next();
});

// Uploaded files are untrusted: never let a browser sniff them into HTML/JS,
// and sandbox anything that is opened directly.
app.use("/uploads", (_req, res, next) => {
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader(
    "Content-Security-Policy",
    "default-src 'none'; img-src 'self' data:; style-src 'unsafe-inline'; sandbox"
  );
  next();
});

app.use(express.static("public"));

// Store er folder address: /demo-store → shudhu redirect to the themed Next storefront
const RESERVED = new Set(["api", "css", "js", "uploads", "node_modules"]);
app.use(async (req, res, next) => {
  if (req.method !== "GET") return next();
  try {
    const slug = decodeURIComponent(req.path.slice(1)).toLowerCase();
    if (RESERVED.has(slug) || !/^[a-z0-9][a-z0-9-]{0,62}$/.test(slug)) return next();
    const store = await Store.findOne({ slug });
    if (!store) return next();
    if (await toStorefront(res, req, store)) return;
    res.sendFile(path.join(__dirname, "public", "shop.html"));
  } catch (err) {
    next(err);
  }
});

// Central error handler — catches multer (file type / size) and any thrown errors.
app.use((err, req, res, next) => {
  const isMulter = err && (err.name === "MulterError" || /image|file/i.test(err.message || ""));
  if (isMulter) {
    const msg = err.code === "LIMIT_FILE_SIZE" ? "File 2MB er beshi hote parbe na" : err.message;
    return res.status(400).json({ message: msg });
  }
  res.status(err.status || 500).json({ message: err.message || "Server error" });
});

const PORT = process.env.PORT || 3000;
mongoose
  .connect(process.env.MONGO_URI)
  .then(() => console.log("MongoDB connected"))
  .catch((err) => console.log("MongoDB error:", err.message));
app.listen(PORT, () => console.log(`Server running on port ${PORT}`));

// Daily installment reminders/overdue pass; also exposed via POST /api/installments/admin/run-scheduler.
const { startInstallmentScheduler } = require("./services/installmentScheduler");
mongoose.connection.once("open", () => startInstallmentScheduler());

// Nightly report reconciliation (02:30 Asia/Dhaka, last 3 completed days).
const { startReportScheduler } = require("./services/reportScheduler");
mongoose.connection.once("open", () => startReportScheduler());