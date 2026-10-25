const mongoose = require("mongoose");

const wholesaleVehicleSchema = new mongoose.Schema(
  {
    name: { type: String, required: true, trim: true, maxlength: 60 },
    maxWeightKg: { type: Number, required: true, min: 1 },
    chargePaisa: { type: Number, required: true, min: 0 },
    sortOrder: { type: Number, default: 0 },
  },
  { timestamps: true }
);

wholesaleVehicleSchema.plugin(require("../lib/tenantPlugin"));

module.exports = mongoose.model("WholesaleVehicle", wholesaleVehicleSchema);
