const mongoose = require("mongoose");

const storeSchema = new mongoose.Schema(
  {
    name: { type: String, required: true },
    slug: { type: String, required: true, unique: true, lowercase: true, trim: true },
    owner: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
    plan: { type: mongoose.Schema.Types.ObjectId, ref: "Plan", required: true },
    // domain gulo optional — default deya hoy na, na-hole sparse unique index null niye dhake
    subdomain: { type: String, unique: true, sparse: true, lowercase: true, trim: true },
    customDomain: { type: String, unique: true, sparse: true, lowercase: true, trim: true },
    customDomainStatus: { type: String, enum: ["none", "pending", "verified", "failed"], default: "none" },
    domainToken: { type: String, default: null },
    domainCheckedAt: { type: Date, default: null },
  },
  { timestamps: true }
);

module.exports = mongoose.model("Store", storeSchema);
