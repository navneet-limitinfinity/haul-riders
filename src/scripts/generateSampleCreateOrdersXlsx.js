import fs from "node:fs";
import path from "node:path";

function crc32(buf) {
  // Small CRC32 (tableless) for ZIP; good enough for small files.
  let crc = 0xffffffff;
  for (let i = 0; i < buf.length; i += 1) {
    crc ^= buf[i];
    for (let j = 0; j < 8; j += 1) {
      const mask = -(crc & 1);
      crc = (crc >>> 1) ^ (0xedb88320 & mask);
    }
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function dosDateTime(date = new Date()) {
  const d = new Date(date);
  const year = Math.max(1980, d.getFullYear());
  const month = d.getMonth() + 1;
  const day = d.getDate();
  const hours = d.getHours();
  const minutes = d.getMinutes();
  const seconds = Math.floor(d.getSeconds() / 2);
  const dosTime = (hours << 11) | (minutes << 5) | seconds;
  const dosDate = ((year - 1980) << 9) | (month << 5) | day;
  return { dosTime, dosDate };
}

function u16(n) {
  const b = Buffer.alloc(2);
  b.writeUInt16LE(n & 0xffff, 0);
  return b;
}

function u32(n) {
  const b = Buffer.alloc(4);
  b.writeUInt32LE(n >>> 0, 0);
  return b;
}

function zipStore(files) {
  const { dosTime, dosDate } = dosDateTime(new Date());
  const localParts = [];
  const centralParts = [];
  let offset = 0;

  for (const f of files) {
    const nameBuf = Buffer.from(f.name, "utf8");
    const dataBuf = Buffer.isBuffer(f.data) ? f.data : Buffer.from(String(f.data ?? ""), "utf8");
    const crc = crc32(dataBuf);

    const localHeader = Buffer.concat([
      u32(0x04034b50),
      u16(20),
      u16(0),
      u16(0), // store
      u16(dosTime),
      u16(dosDate),
      u32(crc),
      u32(dataBuf.length),
      u32(dataBuf.length),
      u16(nameBuf.length),
      u16(0),
      nameBuf,
    ]);

    localParts.push(localHeader, dataBuf);

    const centralHeader = Buffer.concat([
      u32(0x02014b50),
      u16(20),
      u16(20),
      u16(0),
      u16(0),
      u16(dosTime),
      u16(dosDate),
      u32(crc),
      u32(dataBuf.length),
      u32(dataBuf.length),
      u16(nameBuf.length),
      u16(0),
      u16(0),
      u16(0),
      u16(0),
      u32(0),
      u32(offset),
      nameBuf,
    ]);
    centralParts.push(centralHeader);

    offset += localHeader.length + dataBuf.length;
  }

  const centralDir = Buffer.concat(centralParts);
  const centralOffset = offset;
  const centralSize = centralDir.length;
  offset += centralSize;

  const eocd = Buffer.concat([
    u32(0x06054b50),
    u16(0),
    u16(0),
    u16(files.length),
    u16(files.length),
    u32(centralSize),
    u32(centralOffset),
    u16(0),
  ]);

  return Buffer.concat([...localParts, centralDir, eocd]);
}

function xmlEscape(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&apos;");
}

function buildXlsx({ headers, mandatorySet, row }) {
  const shared = [];
  const indexOf = new Map();
  const addShared = (s) => {
    const v = String(s ?? "");
    if (indexOf.has(v)) return indexOf.get(v);
    const idx = shared.length;
    shared.push(v);
    indexOf.set(v, idx);
    return idx;
  };

  const headerIdx = headers.map((h) => addShared(h));
  const rowIdx = headers.map((h) => addShared(row[h] ?? ""));

  const cols = "ABCDEFGHIJKLMNOPQRSTUVWXYZ";
  const cellRef = (c, r) => `${cols[c]}${r}`;

  // Styles: 0=default, 1=mandatory header, 2=optional header
  const sheetCells = [];
  for (let c = 0; c < headers.length; c += 1) {
    const key = headers[c];
    const isMandatory = mandatorySet.has(key);
    const style = isMandatory ? 1 : 2;
    sheetCells.push(
      `<c r="${cellRef(c, 1)}" t="s" s="${style}"><v>${headerIdx[c]}</v></c>`
    );
  }
  const rowCells = [];
  for (let c = 0; c < headers.length; c += 1) {
    rowCells.push(`<c r="${cellRef(c, 2)}" t="s"><v>${rowIdx[c]}</v></c>`);
  }

  const sheetXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
  <sheetData>
    <row r="1">${sheetCells.join("")}</row>
    <row r="2">${rowCells.join("")}</row>
  </sheetData>
</worksheet>`;

  const sharedStringsXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<sst xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" count="${shared.length}" uniqueCount="${shared.length}">
${shared.map((s) => `<si><t>${xmlEscape(s)}</t></si>`).join("")}
</sst>`;

  const stylesXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
  <fonts count="1">
    <font>
      <sz val="11"/>
      <color theme="1"/>
      <name val="Calibri"/>
      <family val="2"/>
    </font>
  </fonts>
  <fills count="3">
    <fill><patternFill patternType="none"/></fill>
    <fill><patternFill patternType="solid"><fgColor rgb="FFD1FAE5"/><bgColor indexed="64"/></patternFill></fill>
    <fill><patternFill patternType="solid"><fgColor rgb="FFE5E7EB"/><bgColor indexed="64"/></patternFill></fill>
  </fills>
  <borders count="1">
    <border><left/><right/><top/><bottom/><diagonal/></border>
  </borders>
  <cellStyleXfs count="1">
    <xf numFmtId="0" fontId="0" fillId="0" borderId="0"/>
  </cellStyleXfs>
  <cellXfs count="3">
    <xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0" applyFill="1"/>
    <xf numFmtId="0" fontId="0" fillId="1" borderId="0" xfId="0" applyFill="1"/>
    <xf numFmtId="0" fontId="0" fillId="2" borderId="0" xfId="0" applyFill="1"/>
  </cellXfs>
</styleSheet>`;

  const workbookXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
  <sheets>
    <sheet name="Orders" sheetId="1" r:id="rId1"/>
  </sheets>
</workbook>`;

  const workbookRels = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/>
  <Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>
  <Relationship Id="rId3" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/sharedStrings" Target="sharedStrings.xml"/>
</Relationships>`;

  const rels = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>
</Relationships>`;

  const contentTypes = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
  <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
  <Default Extension="xml" ContentType="application/xml"/>
  <Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>
  <Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>
  <Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>
  <Override PartName="/xl/sharedStrings.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sharedStrings+xml"/>
</Types>`;

  const files = [
    { name: "[Content_Types].xml", data: contentTypes },
    { name: "_rels/.rels", data: rels },
    { name: "xl/workbook.xml", data: workbookXml },
    { name: "xl/_rels/workbook.xml.rels", data: workbookRels },
    { name: "xl/styles.xml", data: stylesXml },
    { name: "xl/sharedStrings.xml", data: sharedStringsXml },
    { name: "xl/worksheets/sheet1.xml", data: sheetXml },
  ];

  return zipStore(files);
}

const headers = [
  "orderName",
  "order_date",
  "fullName",
  "customerEmail",
  "phone1",
  "phone2",
  "address1",
  "address2",
  "city",
  "state",
  "pinCode",
  "totalPrice",
  "financialStatus",
  "invoice_value",
  "content_and_quantity",
];

const mandatory = new Set([
  "fullName",
  "phone1",
  "address1",
  "city",
  "state",
  "pinCode",
  "totalPrice",
  "financialStatus",
]);

const sampleRow = {
  orderName: "O000001",
  order_date: "2026-02-04",
  fullName: "Navneet Sinha",
  customerEmail: "navneet@example.com",
  phone1: "9815582923",
  phone2: "0981558292",
  address1: "P No.-90B, Sector-18",
  address2: "Near Medcity",
  city: "Gurugram",
  state: "Haryana",
  pinCode: "122001",
  totalPrice: "499.00",
  financialStatus: "paid",
  invoice_value: "499.00",
  content_and_quantity: "T-Shirt x1",
};

const out = buildXlsx({ headers, mandatorySet: mandatory, row: sampleRow });
const dest = path.join(process.cwd(), "src", "public", "sample_create_orders.xlsx");
fs.writeFileSync(dest, out);
console.log(`Wrote ${dest} (${out.length} bytes)`);

