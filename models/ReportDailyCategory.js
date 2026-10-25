const mongoose = require("mongoose");

const schema = new mongoose.Schema(
  {
    date: { type: String, required: true, match: /^\d{4}-\d{2}-\d{2}$/ },
    categoryKey: { type: String, required: true },
    name: { type: String, default: "" },
    salesPaisa: { type: Number, default: 0, min: 0 },
    quantity: { type: Number, default: 0, min: 0 },
    ordersCount: { type: Number, default: 0, min: 0 },
  },
  { timestamps: true, collection: "report_daily_categories" }
);

schema.plugin(require("../lib/tenantPlugin"));
schema.index({ store: 1, date: 1, categoryKey: 1 }, { unique: true });
schema.index({ store: 1, categoryKey: 1, date: 1 });

module.exports = mongoose.model("ReportDailyCategory", schema);
