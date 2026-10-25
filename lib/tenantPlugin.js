const mongoose = require("mongoose");
const { getStoreId } = require("./tenantContext");

// je model e plugin bosbe tar schema te store field add hobe
function addStoreField(schema) {
  schema.add({
    store: { type: mongoose.Schema.Types.ObjectId, ref: "Store", index: true },
  });
}

// prottek read/update query te current tenant er filter bose jay
function addTenantFilter(query) {
  const storeId = getStoreId();
  if (storeId) query.where({ store: storeId });
}

module.exports = function tenantPlugin(schema) {
  addStoreField(schema);

  [
    "find",
    "findOne",
    "findById",
    "findOneAndUpdate",
    "findOneAndDelete",
    "findOneAndReplace",
    "findByIdAndUpdate",
    "findByIdAndDelete",
    "findByIdAndReplace",
    "countDocuments",
    "count",
    "updateOne",
    "updateMany",
    "deleteOne",
    "deleteMany",
  ].forEach((op) => {
    schema.pre(op, function () {
      addTenantFilter(this);
    });
  });

  // notun document e store na thakle current tenant set hoy
  schema.pre("save", function () {
    if (this.isNew && !this.store) {
      const storeId = getStoreId();
      if (storeId) this.store = storeId;
    }
  });
};
