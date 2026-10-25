const mongoose = require("mongoose");

const schema = new mongoose.Schema(
  {
    date: { type: String, required: true, match: /^\d{4}-\d{2}-\d{2}$/ },
    salesPaisa: { type: Number, default: 0, min: 0 },
    ordersCount: { type: Number, default: 0, min: 0 },
    itemsCount: { type: Number, default: 0, min: 0 },
    shippingPaisa: { type: Number, default: 0, min: 0 },
    couponDiscountPaisa: { type: Number, default: 0, min: 0 },
    refundsCount: { type: Number, default: 0, min: 0 },
    refundsAmountPaisa: { type: Number, default: 0, min: 0 },
    taxPaisa: { type: Number, default: 0, min: 0 },
  },
  { timestamps: true, collection: "report_daily" }
);

schema.plugin(require("../lib/tenantPlugin"));
schema.index({ store: 1, date: 1 }, { unique: true });

module.exports = mongoose.model("ReportDaily", schema);
