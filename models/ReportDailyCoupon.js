const mongoose = require("mongoose");

const schema = new mongoose.Schema(
  {
    date: { type: String, required: true, match: /^\d{4}-\d{2}-\d{2}$/ },
    couponCode: { type: String, required: true },
    label: { type: String, default: "" },
    discountPaisa: { type: Number, default: 0, min: 0 },
    ordersCount: { type: Number, default: 0, min: 0 },
  },
  { timestamps: true, collection: "report_daily_coupons" }
);

schema.plugin(require("../lib/tenantPlugin"));
schema.index({ store: 1, date: 1, couponCode: 1 }, { unique: true });
schema.index({ store: 1, couponCode: 1, date: 1 });

module.exports = mongoose.model("ReportDailyCoupon", schema);
