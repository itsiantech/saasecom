// Minimal dependency-free XLSX writer.
// A workbook is a ZIP of XML parts; entries are stored (no compression), which
// every Excel/LibreOffice/Google Sheets build accepts. Only what we need is
// emitted: sheet names, inline strings, numbers, bold header row.

const CRC_TABLE = (() => {
  const table = new Int32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c;
  }
  return table;
})();

function crc32(buffer) {
  let crc = -1;
  for (let i = 0; i < buffer.length; i++) crc = (crc >>> 8) ^ CRC_TABLE[(crc ^ buffer[i]) & 0xff];
  return (crc ^ -1) >>> 0;
}

function dosDateTime(date) {
  const d = date || new Date();
  const year = Math.max(1980, d.getFullYear());
  const time =
    (Math.floor(d.getSeconds() / 2) & 0x1f) |
    ((d.getMinutes() & 0x3f) << 5) |
    ((d.getHours() & 0x1f) << 11);
  const day =
    (d.getDate() & 0x1f) |
    (((d.getMonth() + 1) & 0x0f) << 5) |
    (((year - 1980) & 0x7f) << 9);
  return { time, day };
}

// Stored (method 0) ZIP container with a central directory, UTF-8 names.
function zipStore(files, now) {
  const stamp = dosDateTime(now);
  const locals = [];
  const centrals = [];
  let offset = 0;

  files.forEach((file) => {
    const name = Buffer.from(file.name, "utf8");
    const data = Buffer.isBuffer(file.data) ? file.data : Buffer.from(String(file.data), "utf8");
    const crc = crc32(data);

    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(0x0800, 6); // UTF-8 names
    local.writeUInt16LE(0, 8); // stored
    local.writeUInt16LE(stamp.time, 10);
    local.writeUInt16LE(stamp.day, 12);
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(data.length, 18);
    local.writeUInt32LE(data.length, 22);
    local.writeUInt16LE(name.length, 26);
    local.writeUInt16LE(0, 28);
    locals.push(local, name, data);

    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(20, 4);
    central.writeUInt16LE(20, 6);
    central.writeUInt16LE(0x0800, 8);
    central.writeUInt16LE(0, 10);
    central.writeUInt16LE(stamp.time, 12);
    central.writeUInt16LE(stamp.day, 14);
    central.writeUInt32LE(crc, 16);
    central.writeUInt32LE(data.length, 20);
    central.writeUInt32LE(data.length, 24);
    central.writeUInt16LE(name.length, 28);
    central.writeUInt16LE(0, 30); // extra
    central.writeUInt16LE(0, 32); // comment
    central.writeUInt16LE(0, 34); // disk
    central.writeUInt16LE(0, 36); // internal attrs
    central.writeUInt32LE(0, 38); // external attrs
    central.writeUInt32LE(offset, 42);
    centrals.push(central, name);

    offset += local.length + name.length + data.length;
  });

  const localBody = Buffer.concat(locals);
  const centralBody = Buffer.concat(centrals);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(0, 4);
  end.writeUInt16LE(0, 6);
  end.writeUInt16LE(files.length, 8);
  end.writeUInt16LE(files.length, 10);
  end.writeUInt32LE(centralBody.length, 12);
  end.writeUInt32LE(localBody.length, 16);
  end.writeUInt16LE(0, 20);
  return Buffer.concat([localBody, centralBody, end]);
}

const XML_HEAD = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>';

function xmlText(value) {
  return String(value == null ? "" : value)
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, "")
    .slice(0, 32767)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

function columnLetters(index) {
  let n = index + 1;
  let out = "";
  while (n > 0) {
    const rem = (n - 1) % 26;
    out = String.fromCharCode(65 + rem) + out;
    n = Math.floor((n - 1) / 26);
  }
  return out;
}

function sheetName(value, used) {
  let name = String(value || "Sheet")
    .replace(/[\\/?*[\]:]/g, " ")
    .trim()
    .slice(0, 31) || "Sheet";
  let candidate = name;
  let i = 2;
  while (used.has(candidate.toLowerCase())) {
    const suffix = ` (${i})`;
    candidate = name.slice(0, 31 - suffix.length) + suffix;
    i += 1;
  }
  used.add(candidate.toLowerCase());
  return candidate;
}

function cellXml(value, ref, header) {
  const style = header ? ' s="1"' : "";
  if (typeof value === "number" && Number.isFinite(value)) {
    return `<c r="${ref}"${style}><v>${value}</v></c>`;
  }
  const text = xmlText(value);
  if (!text) return header ? `<c r="${ref}"${style}/>` : "";
  return `<c r="${ref}"${style} t="inlineStr"><is><t xml:space="preserve">${text}</t></is></c>`;
}

function sheetXml(rows) {
  const list = Array.isArray(rows) ? rows : [];
  let width = 0;
  list.forEach((row) => {
    width = Math.max(width, Array.isArray(row) ? row.length : 0);
  });
  width = Math.max(1, Math.min(width, 100));

  const columns = [];
  for (let c = 0; c < width; c++) {
    let longest = 10;
    list.forEach((row) => {
      const value = Array.isArray(row) ? row[c] : "";
      if (value == null) return;
      longest = Math.max(longest, String(value).length);
    });
    columns.push(`<col min="${c + 1}" max="${c + 1}" width="${Math.min(54, longest + 2)}" customWidth="1"/>`);
  }

  const body = list
    .map((row, r) => {
      const cells = (Array.isArray(row) ? row : [row])
        .map((value, c) => cellXml(value, `${columnLetters(c)}${r + 1}`, r === 0))
        .join("");
      return `<row r="${r + 1}">${cells}</row>`;
    })
    .join("");

  return (
    `${XML_HEAD}<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">` +
    `<sheetViews><sheetView workbookViewId="0"><pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/></sheetView></sheetViews>` +
    `<cols>${columns.join("")}</cols>` +
    `<sheetData>${body}</sheetData></worksheet>`
  );
}

const STYLES =
  `${XML_HEAD}<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">` +
  '<fonts count="2"><font><sz val="11"/><name val="Calibri"/></font><font><b/><sz val="11"/><name val="Calibri"/></font></fonts>' +
  '<fills count="2"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill></fills>' +
  '<borders count="1"><border/></borders>' +
  '<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>' +
  '<cellXfs count="2"><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/><xf numFmtId="0" fontId="1" fillId="0" borderId="0" xfId="0" applyFont="1"/></cellXfs>' +
  "</styleSheet>";

/**
 * @param {Array<{name: string, rows: Array<Array<string|number|null>>}>} sheets
 * @returns {Buffer} .xlsx file bytes
 */
function buildXlsx(sheets) {
  const used = new Set();
  const list = (Array.isArray(sheets) ? sheets : []).map((sheet) => ({
    name: sheetName(sheet && sheet.name, used),
    rows: (sheet && sheet.rows) || [],
  }));
  if (!list.length) list.push({ name: "Sheet1", rows: [] });

  const files = [
    {
      name: "[Content_Types].xml",
      data:
        `${XML_HEAD}<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">` +
        '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>' +
        '<Default Extension="xml" ContentType="application/xml"/>' +
        '<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>' +
        '<Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>' +
        list
          .map(
            (_, i) =>
              `<Override PartName="/xl/worksheets/sheet${i + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`
          )
          .join("") +
        "</Types>",
    },
    {
      name: "_rels/.rels",
      data:
        `${XML_HEAD}<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">` +
        '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>' +
        "</Relationships>",
    },
    {
      name: "xl/workbook.xml",
      data:
        `${XML_HEAD}<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">` +
        "<sheets>" +
        list
          .map(
            (sheet, i) =>
              `<sheet name="${xmlText(sheet.name)}" sheetId="${i + 1}" r:id="rId${i + 1}"/>`
          )
          .join("") +
        "</sheets></workbook>",
    },
    {
      name: "xl/_rels/workbook.xml.rels",
      data:
        `${XML_HEAD}<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">` +
        list
          .map(
            (_, i) =>
              `<Relationship Id="rId${i + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet${i + 1}.xml"/>`
          )
          .join("") +
        `<Relationship Id="rId${list.length + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>` +
        "</Relationships>",
    },
    { name: "xl/styles.xml", data: STYLES },
  ];

  list.forEach((sheet, i) => {
    files.push({ name: `xl/worksheets/sheet${i + 1}.xml`, data: sheetXml(sheet.rows) });
  });

  return zipStore(files, new Date());
}

module.exports = { buildXlsx, crc32 };
