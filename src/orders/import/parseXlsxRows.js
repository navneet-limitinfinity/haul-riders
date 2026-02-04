import zlib from "node:zlib";

const EOCD_SIGNATURE = 0x06054b50;
const CENTRAL_SIGNATURE = 0x02014b50;
const LOCAL_SIGNATURE = 0x04034b50;

function readUInt16LE(buf, off) {
  return buf.readUInt16LE(off);
}

function readUInt32LE(buf, off) {
  return buf.readUInt32LE(off);
}

function findEocdOffset(buf) {
  // EOCD is at most 65,535 bytes from the end (comment length limit) + header length.
  const maxBack = Math.min(buf.length, 66_000);
  for (let i = buf.length - 22; i >= buf.length - maxBack; i -= 1) {
    if (i < 0) break;
    if (readUInt32LE(buf, i) === EOCD_SIGNATURE) return i;
  }
  return -1;
}

function decodeXmlEntities(value) {
  return String(value ?? "")
    .replaceAll("&lt;", "<")
    .replaceAll("&gt;", ">")
    .replaceAll("&quot;", '"')
    .replaceAll("&apos;", "'")
    .replaceAll("&amp;", "&");
}

function unzipXlsxEntries(buf) {
  const eocdOff = findEocdOffset(buf);
  if (eocdOff < 0) throw new Error("invalid_xlsx_zip");

  const centralDirSize = readUInt32LE(buf, eocdOff + 12);
  const centralDirOff = readUInt32LE(buf, eocdOff + 16);
  const end = centralDirOff + centralDirSize;

  const entries = new Map();
  let off = centralDirOff;
  while (off + 46 <= end) {
    if (readUInt32LE(buf, off) !== CENTRAL_SIGNATURE) break;
    const compressionMethod = readUInt16LE(buf, off + 10);
    const flags = readUInt16LE(buf, off + 8);
    const compressedSize = readUInt32LE(buf, off + 20);
    const uncompressedSize = readUInt32LE(buf, off + 24);
    const fileNameLen = readUInt16LE(buf, off + 28);
    const extraLen = readUInt16LE(buf, off + 30);
    const commentLen = readUInt16LE(buf, off + 32);
    const localHeaderOff = readUInt32LE(buf, off + 42);

    const nameStart = off + 46;
    const nameEnd = nameStart + fileNameLen;
    const fileName = buf.slice(nameStart, nameEnd).toString("utf8");

    entries.set(fileName, {
      fileName,
      compressionMethod,
      flags,
      compressedSize,
      uncompressedSize,
      localHeaderOff,
    });

    off = nameEnd + extraLen + commentLen;
  }

  const out = new Map();
  for (const [name, entry] of entries) {
    // We only need XML parts.
    if (!name.endsWith(".xml")) continue;

    const localOff = entry.localHeaderOff;
    if (readUInt32LE(buf, localOff) !== LOCAL_SIGNATURE) continue;
    const fileNameLen = readUInt16LE(buf, localOff + 26);
    const extraLen = readUInt16LE(buf, localOff + 28);
    const dataOff = localOff + 30 + fileNameLen + extraLen;
    const compressed = buf.slice(dataOff, dataOff + entry.compressedSize);

    let data;
    if (entry.compressionMethod === 0) {
      data = compressed;
    } else if (entry.compressionMethod === 8) {
      data = zlib.inflateRawSync(compressed);
    } else {
      throw new Error(`unsupported_zip_method_${entry.compressionMethod}`);
    }

    // Some zips include the sizes in a descriptor; central directory is authoritative.
    if (entry.uncompressedSize && data.length !== entry.uncompressedSize) {
      // Best-effort; still accept.
    }
    out.set(name, data);
  }
  return out;
}

function cellRefToColIndex(ref) {
  const m = String(ref ?? "").match(/^([A-Z]+)\d+$/);
  if (!m) return -1;
  const letters = m[1];
  let n = 0;
  for (let i = 0; i < letters.length; i += 1) {
    n = n * 26 + (letters.charCodeAt(i) - 64);
  }
  return n - 1;
}

function parseSharedStrings(xml) {
  const text = xml.toString("utf8");
  const out = [];
  // Minimal parser: collects <t> inside each <si>.
  const siMatches = text.matchAll(/<si\b[^>]*>([\s\S]*?)<\/si>/g);
  for (const m of siMatches) {
    const si = m[1] ?? "";
    const tMatches = si.matchAll(/<t\b[^>]*>([\s\S]*?)<\/t>/g);
    let combined = "";
    for (const tm of tMatches) combined += decodeXmlEntities(tm[1] ?? "");
    out.push(combined);
  }
  return out;
}

function pickFirstSheetPath(entries) {
  const names = Array.from(entries.keys()).filter((n) => /^xl\/worksheets\/sheet\d+\.xml$/.test(n));
  names.sort((a, b) => {
    const an = Number(a.match(/sheet(\d+)\.xml$/)?.[1] ?? "999");
    const bn = Number(b.match(/sheet(\d+)\.xml$/)?.[1] ?? "999");
    return an - bn;
  });
  return names[0] ?? "";
}

function parseSheetRows(sheetXml, sharedStrings) {
  const text = sheetXml.toString("utf8");
  const rows = [];

  const rowMatches = text.matchAll(/<row\b[^>]*>([\s\S]*?)<\/row>/g);
  for (const rm of rowMatches) {
    const rowXml = rm[1] ?? "";
    const cells = [];
    const cellMatches = rowXml.matchAll(/<c\b([^>]*)>([\s\S]*?)<\/c>/g);
    for (const cm of cellMatches) {
      const attrs = cm[1] ?? "";
      const body = cm[2] ?? "";
      const ref = attrs.match(/\br="([^"]+)"/)?.[1] ?? "";
      const t = attrs.match(/\bt="([^"]+)"/)?.[1] ?? "";
      const col = cellRefToColIndex(ref);
      if (col < 0) continue;

      let value = "";
      if (t === "inlineStr") {
        const tVal = body.match(/<t\b[^>]*>([\s\S]*?)<\/t>/)?.[1] ?? "";
        value = decodeXmlEntities(tVal);
      } else {
        const vVal = body.match(/<v>([\s\S]*?)<\/v>/)?.[1] ?? "";
        if (t === "s") {
          const idx = Number.parseInt(String(vVal), 10);
          value = Number.isFinite(idx) ? String(sharedStrings[idx] ?? "") : "";
        } else {
          value = decodeXmlEntities(vVal);
        }
      }

      cells[col] = value;
    }
    rows.push(cells);
  }
  return rows;
}

function normalizeHeader(value) {
  return String(value ?? "").trim();
}

export function parseXlsxRows(buffer) {
  if (!Buffer.isBuffer(buffer)) throw new Error("xlsx_buffer_required");
  const entries = unzipXlsxEntries(buffer);
  const sharedXml = entries.get("xl/sharedStrings.xml");
  const sharedStrings = sharedXml ? parseSharedStrings(sharedXml) : [];

  const sheetPath = pickFirstSheetPath(entries);
  if (!sheetPath) throw new Error("xlsx_missing_sheet");
  const sheetXml = entries.get(sheetPath);
  if (!sheetXml) throw new Error("xlsx_missing_sheet");

  const gridRows = parseSheetRows(sheetXml, sharedStrings);
  if (!gridRows.length) return [];

  const headerRow = gridRows[0] ?? [];
  const headers = headerRow.map((h) => normalizeHeader(h));
  const out = [];
  for (let i = 1; i < gridRows.length; i += 1) {
    const row = gridRows[i] ?? [];
    const obj = {};
    for (let c = 0; c < headers.length; c += 1) {
      const key = headers[c];
      if (!key) continue;
      const val = row[c] ?? "";
      obj[key] = String(val ?? "").trim();
    }
    if (Object.keys(obj).length) out.push(obj);
  }
  return out;
}

