const mongoose = require("mongoose");

const specEnumValueSchema = new mongoose.Schema(
  {
    value: { type: String, required: true, trim: true },
    label: { type: String, default: "", trim: true },
  },
  { _id: false }
);

// One row per spec field a product of `category` can carry. `category: null`
// means "every category" — handy for shared specs such as brand origin.
const specDefinitionSchema = new mongoose.Schema(
  {
    category: { type: mongoose.Schema.Types.ObjectId, ref: "Category", default: null },
    key: { type: String, required: true, trim: true, lowercase: true },
    label: { type: String, required: true, trim: true },
    labelBn: { type: String, default: "", trim: true },
    type: {
      type: String,
      enum: ["text", "number", "enum", "boolean", "multi-enum"],
      default: "text",
    },
    unit: { type: String, default: "", trim: true },
    enumValues: { type: [specEnumValueSchema], default: [] },
    filterable: { type: Boolean, default: true },
    showInList: { type: Boolean, default: false },
    active: { type: Boolean, default: true },
    sortOrder: { type: Number, default: 0 },
  },
  { timestamps: true }
);

specDefinitionSchema.index({ store: 1, category: 1, sortOrder: 1 });
specDefinitionSchema.index({ store: 1, category: 1, key: 1 }, { unique: true });

specDefinitionSchema.plugin(require("../lib/tenantPlugin"));

module.exports = mongoose.model("SpecDefinition", specDefinitionSchema);
