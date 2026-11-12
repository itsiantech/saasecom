const MAX_ROWS = 2000;
const MAX_MOVEMENT_SCAN = 5000;
const LOW_STOCK_DEFAULT = 5;

function inventoryError(message, status = 400) {
  return Object.assign(new Error(message), { status });
}

function toInteger(value, label, { min = 0, max = 1000000000 } = {}) {
  const n = Number(value);
  if (!Number.isInteger(n)) throw inventoryError(`${label} purno shonkha hote hobe`);
  if (n < min) throw inventoryError(`${label} ${min} er kom hote parbe na`);
  if (n > max) throw inventoryError(`${label} ${max} er beshi hote parbe na`);
  return n;
}

function cleanText(value, max = 300) {
  return String(value == null ? "" : value).trim().slice(0, max);
}

function escapeRegex(value) {
  return String(value || "").replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

// RFC4180-ish CSV reader: BOM, CRLF, quoted cells, doubled quotes and
// embedded newlines. Returns an array of string arrays.
function parseCsv(text) {
  const source = String(text == null ? "" : text).replace(/^\uFEFF/, "");
  const rows = [];
  let row = [];
  let cell = "";
  let quoted = false;
  for (let i = 0; i < source.length; i += 1) {
    const ch = source[i];
    if (quoted) {
      if (ch === '"') {
        if (source[i + 1] === '"') {
          cell += '"';
          i += 1;
        } else {
          quoted = false;
        }
      } else {
        cell += ch;
      }
      continue;
    }
    if (ch === '"') {
      quoted = true;
    } else if (ch === ",") {
      row.push(cell);
      cell = "";
    } else if (ch === "\n" || ch === "\r") {
      if (ch === "\r" && source[i + 1] === "\n") i += 1;
      row.push(cell);
      rows.push(row);
      row = [];
      cell = "";
    } else {
      cell += ch;
    }
  }
  row.push(cell);
  rows.push(row);
  return rows;
}

function normalizeHeader(value) {
  return String(value || "")
    .trim()
    .toLowerCase()
    .replace(/[\s_-]+/g, "");
}

// Expected header: sku, stock (required) and optional variant, swatch, note.
function parseStockImport(text) {
  const rows = parseCsv(text).filter((cells) => cells.some((cell) => String(cell).trim() !== ""));
  if (!rows.length) throw inventoryError("CSV khali");
  if (rows.length - 1 > MAX_ROWS) throw inventoryError(`Ekbar e maximum ${MAX_ROWS} row import kora jabe`);

  const header = rows[0].map(normalizeHeader);
  const index = (name) => header.indexOf(name);
  const skuAt = index("sku");
  const stockAt = index("stock");
  if (skuAt < 0 || stockAt < 0) throw inventoryError("CSV header e sku ar stock column lagbe");
  const variantAt = index("variant");
  const swatchAt = index("swatch");
  const noteAt = index("note");

  const parsed = [];
  const errors = [];
  for (let i = 1; i < rows.length; i += 1) {
    const cells = rows[i];
    const line = i + 1;
    const sku = cleanText(cells[skuAt], 120);
    const rawStock = cleanText(cells[stockAt], 20);
    if (!sku && !rawStock) continue;
    if (!sku) {
      errors.push({ line, message: "SKU nei" });
      continue;
    }
    if (!/^\d+$/.test(rawStock)) {
      errors.push({ line, message: `${sku}: stock purno shonkha hote hobe` });
      continue;
    }
    const stock = Number(rawStock);
    if (stock > 1000000000) {
      errors.push({ line, message: `${sku}: stock onek beshi` });
      continue;
    }
    parsed.push({
      line,
      sku,
      variant: variantAt >= 0 ? cleanText(cells[variantAt], 120) : "",
      swatch: swatchAt >= 0 ? cleanText(cells[swatchAt], 120) : "",
      stock,
      note: noteAt >= 0 ? cleanText(cells[noteAt], 300) : "",
    });
  }
  return { rows: parsed, errors };
}

function batchReference(prefix) {
  const stamp = new Date().toISOString().slice(2, 10).replace(/-/g, "");
  const rand = Math.random().toString(36).slice(2, 6).toUpperCase();
  return `${prefix}-${stamp}-${rand}`;
}

module.exports = {
  MAX_ROWS,
  MAX_MOVEMENT_SCAN,
  LOW_STOCK_DEFAULT,
  inventoryError,
  toInteger,
  cleanText,
  escapeRegex,
  parseCsv,
  parseStockImport,
  batchReference,
};
