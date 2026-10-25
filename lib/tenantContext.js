const { AsyncLocalStorage } = require("async_hooks");

const tenantStorage = new AsyncLocalStorage();

function getStoreId() {
  const ctx = tenantStorage.getStore();
  return ctx ? ctx.storeId : null;
}

module.exports = { tenantStorage, getStoreId };
