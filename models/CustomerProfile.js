const mongoose = require("mongoose");

const noteSchema = new mongoose.Schema(
  {
    text: { type: String, required: true, trim: true, maxlength: 1000 },
    by: { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null },
    byName: { type: String, default: "", trim: true, maxlength: 120 },
    createdAt: { type: Date, default: Date.now },
  },
  { _id: true }
);

// Store-wise customer metadata: admin notes + soft delete. The account itself
// stays in User, so hiding a customer never touches order history.
const customerProfileSchema = new mongoose.Schema(
  {
    customer: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
    notes: { type: [noteSchema], default: [] },
    hiddenAt: { type: Date, default: null },
  },
  { timestamps: true }
);

customerProfileSchema.plugin(require("../lib/tenantPlugin"));
customerProfileSchema.index({ store: 1, customer: 1 }, { unique: true });

module.exports = mongoose.model("CustomerProfile", customerProfileSchema);
