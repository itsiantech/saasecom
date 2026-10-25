const SupplierCounter = require("../models/SupplierCounter");
const { formatSequence } = require("../lib/supplierDomain");

async function nextSupplierNumber(storeId, kind, year, session) {
  const doc = await SupplierCounter.findOneAndUpdate(
    { store: storeId, kind, year },
    { $inc: { seq: 1 } },
    { new: true, upsert: true, setDefaultsOnInsert: true, session }
  );
  return formatSequence(kind, year, doc.seq);
}

module.exports = { nextSupplierNumber };
