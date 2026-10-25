const mongoose = require("mongoose");

const schema = new mongoose.Schema(
  {
    date: { type: String, required: true, match: /^\d{4}-\d{2}-\d{2}$/ },
    customerKey: { type: String, required: true },
    name: { type: String, default: "" },
    isGuest: { type: Boolean, default: true },
    ordersCount: { type: Number, default: 0, min: 0 },
    spentPaisa: { type: Number, default: 0, min: 0 },
  },
  { timestamps: true, collection: "report_daily_customers" }
);

schema.plugin(require("../lib/tenantPlugin"));
schema.index({ store: 1, date: 1, customerKey: 1 }, { unique: true });
schema.index({ store: 1, customerKey: 1, date: 1 });

module.exports = mongoose.model("ReportDailyCustomer", schema);
