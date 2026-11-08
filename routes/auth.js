const express = require("express");
const router = express.Router();
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const { OAuth2Client } = require("google-auth-library");
const User = require("../models/User");
const { auth } = require("../middleware/auth");
const { getStoreId } = require("../lib/tenantContext");
const { hostKind } = require("../lib/hostKind");
const { requestOtp, verifyOtp } = require("../lib/otp");

function signToken(user) {
  return jwt.sign({ id: user._id, role: user.role }, process.env.JWT_SECRET, {
    expiresIn: "7d",
  });
}

const PHONE_RE = /^01[3-9]\d{8}$/;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function normalizePhone(value) {
  let s = String(value || "").replace(/[^\d+]/g, "");
  if (s.startsWith("+880")) s = "0" + s.slice(4);
  return s;
}

function publicUser(user) {
  return {
    id: user._id,
    name: user.name,
    email: user.email || "",
    phone: user.phone || "",
    role: user.role,
  };
}

// api.* is the platform host — only the superadmin account may exist/log in there
async function onPanelHost(req) {
  return (await hostKind(req)) === "panel";
}

// frontend e google button dekhano jabe kina
router.get("/config", (req, res) => {
  res.json({ googleClientId: process.env.GOOGLE_CLIENT_ID || null });
});

// register — email ba phone (jekono ekta), password always required
router.post("/register", async (req, res) => {
  try {
    if (await onPanelHost(req)) {
      return res.status(403).json({ message: "এই ঠিকানায় নতুন অ্যাকাউন্ট খোলা যায় না — নিজের দোকানের সাইটে যান" });
    }
    const name = String(req.body.name || "").trim();
    const email = String(req.body.email || "").trim().toLowerCase() || null;
    const phone = normalizePhone(req.body.phone) || null;
    const password = String(req.body.password || "");

    if (!name || !password) {
      return res.status(400).json({ message: "Name ar password lagbe" });
    }
    if (!email && !phone) {
      return res.status(400).json({ message: "Email ba phone number er ekta lagbe" });
    }
    if (email && !EMAIL_RE.test(email)) {
      return res.status(400).json({ message: "Email valid na" });
    }
    if (phone && !PHONE_RE.test(phone)) {
      return res.status(400).json({ message: "Phone number valid Bangladesh number hote hobe (01XXXXXXXXX)" });
    }

    const or = [];
    if (email) or.push({ email });
    if (phone) or.push({ phone });
    const exists = await User.findOne({ $or: or });
    if (exists) return res.status(409).json({ message: "Ei email/phone diye age theke account ache" });

    const hash = await bcrypt.hash(password, 10);
    const isFirst = (await User.countDocuments()) === 0;
    const user = await User.create({
      name,
      email: email || undefined,
      phone: phone || undefined,
      password: hash,
      role: isFirst ? "admin" : "customer",
    });
    res.status(201).json({ token: signToken(user), user: publicUser(user) });
  } catch (err) {
    res.status(400).json({ message: err.message });
  }
});

// email ba phone (server nije detect kore) + password check
async function credentialsUser(body) {
  const identifier = String(body.identifier || body.email || body.phone || "").trim();
  const password = String(body.password || "");
  if (!identifier || !password) return null;

  let user = null;
  if (identifier.includes("@")) {
    user = await User.findOne({ email: identifier.toLowerCase() });
  } else {
    const phone = normalizePhone(identifier);
    if (!PHONE_RE.test(phone)) return null;
    user = await User.findOne({ phone });
  }

  if (!user || !user.password) return null;
  const ok = await bcrypt.compare(password, user.password);
  return ok ? user : null;
}

// login — store owner/staff/customer entry (shop subdomain or local dev)
router.post("/login", async (req, res) => {
  try {
    const user = await credentialsUser(req.body || {});
    if (!user) return res.status(401).json({ message: "Email/phone ba password vul hoyeche" });
    const kind = await hostKind(req);
    // superadmin has its own entry point and must not use a shop host
    if (kind === "store" && user.role === "superadmin") {
      return res.status(403).json({ message: "সুপার অ্যাডমিন লগইন প্ল্যাটফর্মের ঠিকানা (api) থেকে করুন" });
    }
    // api host is superadmin-only — owners/customers log in on their shop host
    if (kind === "panel" && user.role !== "superadmin") {
      return res.status(403).json({ message: "এই ঠিকানায় শুধু প্ল্যাটফর্ম অ্যাডমিন লগইন করে" });
    }
    res.json({ token: signToken(user), user: publicUser(user) });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// platform login — api/platform host, superadmin account only
router.post("/platform-login", async (req, res) => {
  try {
    if ((await hostKind(req)) === "store") {
      return res.status(403).json({ message: "প্ল্যাটফর্ম লগইন দোকানের ঠিকানায় চলে না" });
    }
    const user = await credentialsUser(req.body || {});
    if (!user || user.role !== "superadmin") {
      return res.status(401).json({ message: "শুধু প্ল্যাটফর্ম অ্যাডমিন অ্যাকাউন্ট দিয়ে লগইন করুন" });
    }
    res.json({ token: signToken(user), user: publicUser(user) });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// google login — frontend theke ID token ashe, verify kore login/register
router.post("/google", async (req, res) => {
  try {
    if (!process.env.GOOGLE_CLIENT_ID) {
      return res.status(501).json({
        message: "Google login ekhono set up hoyni (GOOGLE_CLIENT_ID missing)",
      });
    }
    const { credential } = req.body;
    if (!credential) return res.status(400).json({ message: "Google credential lagbe" });

    const client = new OAuth2Client(process.env.GOOGLE_CLIENT_ID);
    const ticket = await client.verifyIdToken({
      idToken: credential,
      audience: process.env.GOOGLE_CLIENT_ID,
    });
    const payload = ticket.getPayload();
    const email = payload.email.toLowerCase();
    const isFirst = (await User.countDocuments()) === 0;

    let user = await User.findOne({ $or: [{ googleId: payload.sub }, { email }] });
    if (!user) {
      user = await User.create({
        name: payload.name || email.split("@")[0],
        email,
        googleId: payload.sub,
        role: isFirst ? "admin" : "customer",
      });
    } else if (!user.googleId) {
      user.googleId = payload.sub;
      await user.save();
    }
    res.json({ token: signToken(user), user: publicUser(user) });
  } catch (err) {
    res.status(401).json({ message: "Google verification fail: " + err.message });
  }
});

// login kora user er info
router.get("/me", auth, async (req, res) => {
  const user = await User.findById(req.user.id);
  if (!user) return res.status(404).json({ message: "User pawa jayni" });
  res.json(publicUser(user));
});

/* ------------------------------------------------------------------ *
 * Phone OTP login — SMS config Settings > Phone / SMS theke ashe
 * ------------------------------------------------------------------ */
function storeOf(req) {
  return (req.store && req.store._id) || getStoreId();
}

router.post("/otp/request", async (req, res) => {
  const storeId = storeOf(req);
  if (!storeId) return res.status(400).json({ message: "Prothome store select korun" });

  const phone = normalizePhone(req.body.phone);
  if (!PHONE_RE.test(phone)) {
    return res.status(400).json({ message: "Phone number valid na (01XXXXXXXXX)" });
  }

  const result = await requestOtp(storeId, phone, "login");
  if (!result.ok) return res.status(400).json({ message: result.message });
  // Enumeration avoid: phone exist koruk ba na, same response
  res.json({ ok: true, message: "OTP pathano hoyeche", minutes: result.minutes });
});

router.post("/otp/verify", async (req, res) => {
  const storeId = storeOf(req);
  if (!storeId) return res.status(400).json({ message: "Prothome store select korun" });

  const phone = normalizePhone(req.body.phone);
  const code = String(req.body.code || "").trim();
  if (!PHONE_RE.test(phone) || !code) {
    return res.status(400).json({ message: "Phone ar OTP din" });
  }

  const verified = await verifyOtp(storeId, phone, code, "login");
  if (!verified.ok) return res.status(401).json({ message: verified.message });

  const user = await User.findOne({ phone });
  if (!user) return res.status(404).json({ message: "Ei phone diye account nei — age register korun" });

  res.json({ token: signToken(user), user: publicUser(user) });
});

module.exports = router;
