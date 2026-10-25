const Store = require("../models/Store");
const Plan = require("../models/Plan");
const Subscription = require("../models/Subscription");

// Model name to limit key mapping
const LIMIT_MAP = {
  Product: "products",
  Order: "orders",
  Staff: "staffMembers",
};

// store er plan onujayi limit enforce kore
module.exports = function planLimitPlugin(schema) {
  schema.pre("save", async function () {
    if (!this.isNew || !this.store) return;

    const modelName = this.constructor.modelName;
    const limitKey = LIMIT_MAP[modelName];

    if (!limitKey) return; // Model e limit applicable na

    const store = await Store.findById(this.store).populate("plan");
    if (!store || !store.plan) return;

    const plan = store.plan;
    if (!plan.active) return;

    const limit = plan.limits?.[limitKey];
    if (!limit || limit === 0) return; // 0 = unlimited

    const count = await this.constructor.countDocuments({ store: this.store });
    if (count >= limit) {
      throw new Error(
        `"${plan.name}" plan e sorbocho ${limit} ti ${limitKey} — beshi add korte upgrade korte hobe`
      );
    }
  });
};
