import { parse } from "csv-parse/sync";

export function parseCsvRows(buffer) {
  const raw = Buffer.isBuffer(buffer) ? buffer.toString("utf8") : String(buffer ?? "");
  const clean = raw.replace(/^\uFEFF/, "");
  const rows = parse(clean, {
    columns: true,
    skip_empty_lines: true,
    trim: true,
    relax_column_count: true,
  });
  return Array.isArray(rows) ? rows : [];
}

