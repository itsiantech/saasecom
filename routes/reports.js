const express = require("express");
const router = express.Router();
const User = require("../models/User");
const { auth, requireAdmin, requireSuperAdmin } = require("../middleware/auth");
const { correlation, rateLimit } = require("../middleware/reportRequest");
const {
  resolvePeriod,
  resolveCustomerRange,
  rangeError,
} = require("../lib/reportPeriods");
const {
  CUSTOMER_RANGES,
  MAX_REBUILD_DAYS,
  REPORT_TIMEZONE,
  REPORT_EXPORT_MAX_ROWS,
} = require("../lib/reportConstants");
const { getSummary, getSubreport, getTopCustomers } = require("../services/reportQuery");
const { rebuildRange } = require("../services/reportRollups");
const {
  buildReportData,
  csvRows,
  csvCell,
  csvFileName,
  buildPrintHtml,
} = require("../services/reportExport");

router.use(correlation);

function wrap(fn) {
  return function wrapped(req, res, next) {
    Promise.resolve(fn(req, res, next)).catch(next);
  };
}

function assertKeys(source, allowed, label) {
  for (const key of Object.keys(source || {})) {
    if (!allowed.includes(key)) throw rangeError(`${label} ${key} support kore na`);
  }
}

function single(query, key) {
  const value = query[key];
  if (Array.isArray(value)) throw rangeError(`${key} ekbar e deya jabe`);
  return value;
}

function requireStore(req) {
  if (!req.store || !req.store._id) throw rangeError("Store context pawa jayni");
  return req.store._id;
}

function periodFromQuery(req) {
  assertKeys(req.query, ["preset", "from", "to"], "Query");
  return resolvePeriod({
    preset: single(req.query, "preset"),
    from: single(req.query, "from"),
    to: single(req.query, "to"),
  });
}

function adminName(req) {
  return User.findById(req.user.id)
    .select("name")
    .lean()
    .then((user) => (user && user.name) || "Admin")
    .catch(() => "Admin");
}

// Fail-closed access probe for the sidebar. It deliberately does not use
// requireAdmin so a non-admin gets false instead of a 403/logout loop.
router.get(
  "/access",
  auth,
  wrap(async (req, res) => {
    const user = await User.findById(req.user.id).select("role").lean();
    const role = user && user.role;
    const owner =
      req.store &&
      req.store.owner &&
      String(req.store.owner.toString()) === String(req.user.id);
    const isAdmin = role === "admin" || role === "superadmin" || owner;
    res.json({
      canView: Boolean(isAdmin),
      canExport: Boolean(isAdmin),
      canRebuild: role === "superadmin",
    });
  })
);

router.use(auth, requireAdmin);

router.get(
  "/sales/summary",
  rateLimit("read"),
  wrap(async (req, res) => {
    const storeId = requireStore(req);
    const period = periodFromQuery(req);
    const data = await getSummary(storeId, period, { timezone: REPORT_TIMEZONE });
    res.json(data);
  })
);

router.get(
  "/sales/products",
  rateLimit("read"),
  wrap(async (req, res) => {
    const storeId = requireStore(req);
    assertKeys(req.query, ["preset", "from", "to", "sort", "page", "limit"], "Query");
    const period = resolvePeriod({
      preset: single(req.query, "preset"),
      from: single(req.query, "from"),
      to: single(req.query, "to"),
    });
    const sort = String(single(req.query, "sort") || "sales");
    if (!["sales", "quantity"].includes(sort)) throw rangeError("sort sales ba quantity hote hobe");
    const data = await getSubreport(storeId, period, "products", {
      timezone: REPORT_TIMEZONE,
      sort,
      page: single(req.query, "page"),
      limit: single(req.query, "limit"),
    });
    res.json(data);
  })
);

router.get(
  "/sales/categories",
  rateLimit("read"),
  wrap(async (req, res) => {
    const storeId = requireStore(req);
    assertKeys(req.query, ["preset", "from", "to", "sort", "page", "limit"], "Query");
    const period = resolvePeriod({
      preset: single(req.query, "preset"),
      from: single(req.query, "from"),
      to: single(req.query, "to"),
    });
    const sort = String(single(req.query, "sort") || "sales");
    if (!["sales", "quantity"].includes(sort)) throw rangeError("sort sales ba quantity hote hobe");
    const data = await getSubreport(storeId, period, "categories", {
      timezone: REPORT_TIMEZONE,
      sort,
      page: single(req.query, "page"),
      limit: single(req.query, "limit"),
    });
    res.json(data);
  })
);

router.get(
  "/sales/coupons",
  rateLimit("read"),
  wrap(async (req, res) => {
    const storeId = requireStore(req);
    assertKeys(req.query, ["preset", "from", "to", "page", "limit"], "Query");
    const period = resolvePeriod({
      preset: single(req.query, "preset"),
      from: single(req.query, "from"),
      to: single(req.query, "to"),
    });
    const data = await getSubreport(storeId, period, "coupons", {
      timezone: REPORT_TIMEZONE,
      page: single(req.query, "page"),
      limit: single(req.query, "limit"),
    });
    res.json(data);
  })
);

router.get(
  "/customers/top",
  rateLimit("read"),
  wrap(async (req, res) => {
    const storeId = requireStore(req);
    assertKeys(req.query, ["range", "limit"], "Query");
    const period = resolveCustomerRange(single(req.query, "range"));
    const data = await getTopCustomers(storeId, period, {
      timezone: REPORT_TIMEZONE,
      limit: single(req.query, "limit"),
    });
    res.json(data);
  })
);

router.get(
  "/export",
  rateLimit("export"),
  wrap(async (req, res) => {
    const storeId = requireStore(req);
    assertKeys(
      req.query,
      ["report", "format", "preset", "from", "to", "range", "sort", "limit"],
      "Query"
    );
    const report = String(single(req.query, "report") || "");
    const format = String(single(req.query, "format") || "").toLowerCase();
    if (!["summary", "products", "categories", "coupons", "customers"].includes(report)) {
      throw rangeError("report summary, products, categories, coupons ba customers hote hobe");
    }
    if (!["csv", "pdf"].includes(format)) throw rangeError("format csv ba pdf hote hobe");

    let period;
    let sort = "";
    let limit;
    if (report === "customers") {
      for (const key of ["preset", "from", "to", "sort"]) {
        if (req.query[key] !== undefined) throw rangeError("Customer report only range support kore");
      }
      if (!CUSTOMER_RANGES.includes(String(single(req.query, "range") || ""))) {
        throw rangeError("range monthly, half_yearly ba yearly hote hobe");
      }
      period = resolveCustomerRange(single(req.query, "range"));
      limit = Math.min(100, Math.max(1, parseInt(single(req.query, "limit"), 10) || 100));
    } else {
      if (req.query.range !== undefined) throw rangeError("Ei report only period support kore");
      period = resolvePeriod({
        preset: single(req.query, "preset"),
        from: single(req.query, "from"),
        to: single(req.query, "to"),
      });
      if (report === "products" || report === "categories") {
        sort = String(single(req.query, "sort") || "sales");
        if (!["sales", "quantity"].includes(sort)) throw rangeError("sort sales ba quantity hote hobe");
      }
      limit = REPORT_EXPORT_MAX_ROWS;
    }

    const name = await adminName(req);
    const data = await buildReportData(
      storeId,
      { report, period, sort, limit, now: new Date(), timezone: REPORT_TIMEZONE },
      name
    );

    res.setHeader("Cache-Control", "no-store");
    if (format === "csv") {
      res.setHeader("Content-Type", "text/csv; charset=utf-8");
      res.setHeader("Content-Disposition", `attachment; filename="${csvFileName(data)}"`);
      res.write("\uFEFF");
      const rows = csvRows(data);
      for (let i = 0; i < rows.length; i += 200) {
        const chunk = rows.slice(i, i + 200).map((row) => row.map(csvCell).join(","));
        res.write(`${chunk.join("\r\n")}\r\n`);
      }
      return res.end();
    }

    res.setHeader("Content-Type", "text/html; charset=utf-8");
    return res.send(buildPrintHtml(data));
  })
);

router.post(
  "/rebuild",
  requireSuperAdmin,
  rateLimit("rebuild"),
  wrap(async (req, res) => {
    const storeId = requireStore(req);
    assertKeys(req.body || {}, ["from", "to"], "Body");
    const period = resolvePeriod({ from: req.body && req.body.from, to: req.body && req.body.to });
    if (period.days > MAX_REBUILD_DAYS) {
      throw rangeError(`Ekbar e maximum ${MAX_REBUILD_DAYS} din rebuild kora jabe`);
    }
    const results = await rebuildRange(storeId, period.from, period.to, { delayMs: 50 });
    res.json({
      ok: true,
      from: period.from,
      to: period.to,
      days: period.days,
      rebuilt: results.length,
    });
  })
);

router.use((err, req, res, next) => {
  if (res.headersSent) return next(err);
  let status = Number(err.status) || 500;
  if (err && (err.code === 50 || /time limit|operation exceeded/i.test(err.message || ""))) {
    status = 503;
  }
  const message = status < 500 ? err.message : "Report banate parlam na";
  console.error("reports API:", req.correlationId, err.message || err);
  return res.status(status).json({ message, requestId: req.correlationId });
});

module.exports = router;
