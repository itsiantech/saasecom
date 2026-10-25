require("dotenv").config();
const express = require("express");
const cors = require("cors");

const mongoose = require("mongoose");

const app = express();
app.use(cors());
app.use(express.json());

// public storefront resolves its own store by slug, so it mounts before tenant middleware
app.use("/api/storefront", require("./routes/storefront"));

app.use(require("./middleware/tenant"));
app.use("/api/products", require("./routes/products"));
app.use("/api/auth", require("./routes/auth"));
app.use("/api/stores", require("./routes/stores"));
app.use("/api/plans", require("./routes/plans"));
app.use("/api/admin", require("./routes/admin"));
app.use("/api/subscriptions", require("./routes/subscriptions"));
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
app.use("/api/staff", require("./routes/staff"));
app.use("/api/plans", require("./routes/plans"));
app.use("/api/admin", require("./routes/admin"));
app.use("/api/categories", require("./routes/categories"));
app.use("/api/brands", require("./routes/brands"));
app.use("/api/product-form", require("./routes/productForm"));
app.use("/api/settings", require("./routes/settings"));
app.use("/api/cart", require("./routes/cart"));
app.use("/api/international", require("./routes/international"));
app.use("/api/wholesale", require("./routes/wholesale"));
app.use("/api/installments", require("./routes/installments"));
app.use("/api/product-catalog", require("./routes/productCatalog"));
app.use("/api/promotions", require("./routes/promotions"));
app.use("/api/flash-sales", require("./routes/flashSales"));
app.use("/api/coupons", require("./routes/coupons"));
app.use("/api/hero-slides", require("./routes/heroSlides"));
app.use(express.static("public"));

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