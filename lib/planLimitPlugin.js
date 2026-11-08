const Store = require("../models/Store");

// Model name to limit key mapping
const LIMIT_MAP = {
  Product: "products",
  Order: "orders",
  Staff: "staffMembers",
};

const LIMIT_LABEL = {
  products: "product",
  orders: "order",
  staffMembers: "staff member",
};

/* ------------------------------------------------------------------ *
 * Per-store in-process lock. The limit check and the insert must stay
 * serialized, otherwise parallel creates all read the same count and
 * every one of them passes the check.
 * ------------------------------------------------------------------ */
const tails = new Map(); // storeId -> promise that settles when the last holder releases

function acquire(storeId) {
  const key = String(storeId);
  const previous = tails.get(key) || Promise.resolve();
  let releaseGate;
  const gate = new Promise((resolve) => {
    releaseGate = resolve;
  });
  const tail = previous.then(() => gate);
  tails.set(key, tail);

  // previous never rejects (it is a chain of release gates), so this resolves in FIFO order.
  return previous.then(() => {
    let released = false;
    return function release() {
      if (released) return;
      released = true;
      releaseGate();
      if (tails.get(key) === tail) tails.delete(key);
    };
  });
}

function releaseHeldLock(doc) {
  const release = doc && doc.$locals && doc.$locals.planLimitRelease;
  if (!release) return;
  doc.$locals.planLimitRelease = null;
  release();
}

// store er plan onujayi limit enforce kore — check + insert ek lock er bhitor
module.exports = function planLimitPlugin(schema) {
  schema.pre("save", async function () {
    if (!this.isNew || !this.store) return;

    const modelName = this.constructor.modelName;
    const limitKey = LIMIT_MAP[modelName];
    if (!limitKey) return; // Model e limit applicable na

    const storeId = this.store;
    const release = await acquire(storeId);
    let keepLock = false;
    try {
      const store = await Store.findById(storeId).populate("plan").lean();
      if (!store || !store.plan) return;

      const plan = store.plan;
      const limit = Number(plan.limits && plan.limits[limitKey]) || 0;
      if (limit <= 0) return; // 0 = unlimited

      // session thakle oi transaction er bhitorer row gulo o count e dhore
      let countQuery = this.constructor.countDocuments({ store: storeId });
      const session = typeof this.$session === "function" ? this.$session() : null;
      if (session) countQuery = countQuery.session(session);
      const count = await countQuery;
      if (count >= limit) {
        const err = new Error(
          `"${plan.name}" plan e sorbocho ${limit} ti ${LIMIT_LABEL[limitKey]} — beshi add korte upgrade korte hobe`
        );
        err.status = 403;
        err.code = "PLAN_LIMIT";
        throw err;
      }

      keepLock = true;
      this.$locals.planLimitRelease = release;
    } finally {
      if (!keepLock) release();
    }
  });

  schema.post("save", function () {
    releaseHeldLock(this);
  });

  // save fail hole lock chere dite hobe — error-handler post hook
  schema.post("save", function (err, doc, next) {
    releaseHeldLock(doc);
    next(err);
  });
};

module.exports.LIMIT_MAP = LIMIT_MAP;
