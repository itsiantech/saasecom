const express = require("express");
const router = express.Router();
const ctrl = require("../controllers/booksController");
const { auth, requireAdmin } = require("../middleware/auth");
const requireTenant = require("../middleware/requireTenant");
const { requireFeature } = require("../lib/features");
const { makeImageUpload, singleImage, finalizeImage } = require("../middleware/upload");
const { bookState } = require("../lib/bookModule");

// Author photos / publisher logos are ordinary images — the ebook file itself
// is a private upload and lands in phase 4.
const imageUpload = makeImageUpload({ maxBytes: 5 * 1024 * 1024 });

router.use(requireTenant, auth, requireAdmin, requireFeature("books"));

// Mounted before the toggle: an off module must still be able to explain
// itself, so the panel reads which gate is closed instead of a bare 403.
router.get("/state", ctrl.state);

// The package gate is requireFeature; this is the owner's own switch. A theme
// without book support still allows the data screens (the page then offers a
// theme switch), because preparing authors ahead of a redesign is normal.
router.use(async function booksToggle(req, res, next) {
  try {
    if (req.user && req.user.role === "superadmin") return next();
    const state = await bookState(req.store && req.store._id);
    if (state.toggle) return next();
    res.status(403).json({
      code: "books_module_off",
      message: "Book / Ebook module বন্ধ আছে — Settings > Module Settings-এ চালু করুন",
    });
  } catch (err) {
    next(err);
  }
});

// fixed paths before /:id
router.get("/genres", ctrl.genres);
router.post("/genres/starter", ctrl.starterGenres);
router.post("/genres/root", ctrl.booksRoot);
router.get("/genres/migration", ctrl.migrationPlan);
router.post("/genres/migration/apply", ctrl.migrationApply);

router.get("/authors/options", ctrl.authorOptions);
router.patch("/authors/bulk", ctrl.bulkAuthors);
router.get("/authors", ctrl.listAuthors);
router.post("/authors", singleImage(imageUpload, "image"), finalizeImage(), ctrl.createAuthor);
router.post("/authors/:id/merge", ctrl.mergeAuthor);
router.get("/authors/:id", ctrl.detailAuthor);
router.patch("/authors/:id", singleImage(imageUpload, "image"), finalizeImage(), ctrl.updateAuthor);

router.get("/publishers/options", ctrl.publisherOptions);
router.patch("/publishers/bulk", ctrl.bulkPublishers);
router.get("/publishers", ctrl.listPublishers);
router.post("/publishers", singleImage(imageUpload, "image"), finalizeImage(), ctrl.createPublisher);
router.post("/publishers/:id/merge", ctrl.mergePublisher);
router.get("/publishers/:id", ctrl.detailPublisher);
router.patch("/publishers/:id", singleImage(imageUpload, "image"), finalizeImage(), ctrl.updatePublisher);

module.exports = router;
