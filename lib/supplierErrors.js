class SupplierError extends Error {
  constructor(message, status = 400) {
    super(message);
    this.name = "SupplierError";
    this.status = status;
  }
}

function fail(message, status = 400) {
  throw new SupplierError(message, status);
}

module.exports = { SupplierError, fail };
