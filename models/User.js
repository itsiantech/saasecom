const mongoose = require("mongoose");

const userSchema = new mongoose.Schema(
  {
    name: { type: String, required: true },
    // email ba phone — jekono ekta diye account khola jay (duitai optional, tabe ekta thakte hobe)
    email: { type: String, unique: true, sparse: true, lowercase: true, trim: true, default: null },
    phone: { type: String, unique: true, sparse: true, trim: true, default: null },
    password: { type: String, default: null },
    googleId: { type: String, default: null },
    role: { type: String, enum: ["admin", "customer", "superadmin"], default: "customer" },
    // wholesale/installment eligibility approval by an admin
    wholesaleApproved: { type: Boolean, default: false },
    // checkout pre-fill er jonno customer er saved delivery details
    shipping: {
      name: { type: String, default: "" },
      phone: { type: String, default: "" },
      email: { type: String, default: "" },
      address: { type: String, default: "" },
      thana: { type: String, default: "" },
      district: { type: String, default: "" },
      division: { type: String, default: "" },
      postCode: { type: String, default: "" },
      country: { type: String, default: "" },
    },
  },
  { timestamps: true }
);

module.exports = mongoose.model("User", userSchema);
