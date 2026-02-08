import fs from "node:fs/promises";
import path from "node:path";
import zlib from "node:zlib";

function csvPath() {
  return path.resolve(process.cwd(), "src/public/Pincode_master.csv");
}

function assetGzPath() {
  return path.resolve(process.cwd(), "src/public/pincodes_directory.json.gz");
}

function assetMetaPath() {
  return path.resolve(process.cwd(), "src/public/pincodes_directory.meta.json");
}

async function readJsonIfExists(filePath) {
  try {
    const raw = await fs.readFile(filePath, "utf8");
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

async function writeFileAtomic(filePath, bufferOrText) {
  const tmp = `${filePath}.tmp`;
  await fs.writeFile(tmp, bufferOrText);
  await fs.rename(tmp, filePath);
}

function parseCsvDirectory(text) {
  const lines = String(text ?? "").split(/\r?\n/);
  if (!lines.length) return {};

  const header = String(lines[0] ?? "").trim().toLowerCase();
  const cols = header.split(",").map((c) => String(c ?? "").trim());
  const pinIdx = cols.indexOf("pincode");
  const stateIdx = cols.indexOf("state");
  const districtIdx = cols.indexOf("district");

  const out = Object.create(null);
  for (let i = 1; i < lines.length; i += 1) {
    const line = lines[i];
    if (!line) continue;
    const parts = line.split(",");
    const pin = String(parts[pinIdx >= 0 ? pinIdx : 0] ?? "").trim();
    if (!/^\d{6}$/.test(pin)) continue;
    // Use uppercase (as provided by CSV) to keep consistent display.
    const state = String(parts[stateIdx] ?? "").trim();
    const district = String(parts[districtIdx] ?? "").trim();
    out[pin] = { state, district };
  }
  return out;
}

export async function ensurePincodeDirectoryAsset({ logger } = {}) {
  const src = csvPath();
  const gz = assetGzPath();
  const metaPath = assetMetaPath();

  const stat = await fs.stat(src);
  const sourceMtimeMs = Number(stat.mtimeMs) || 0;
  const sourceSize = Number(stat.size) || 0;

  const meta = await readJsonIfExists(metaPath);
  const shouldRebuild =
    !meta ||
    Number(meta?.sourceMtimeMs ?? 0) !== sourceMtimeMs ||
    Number(meta?.sourceSize ?? 0) !== sourceSize;

  if (!shouldRebuild) return { ok: true, rebuilt: false };

  const csv = await fs.readFile(src, "utf8");
  const directory = parseCsvDirectory(csv);
  const payload = {
    version: 1,
    built_at: new Date().toISOString(),
    source: { file: "Pincode_master.csv", sourceMtimeMs, sourceSize },
    directory,
  };

  const json = JSON.stringify(payload);
  const gzBuffer = zlib.gzipSync(Buffer.from(json, "utf8"), { level: 9 });

  await writeFileAtomic(gz, gzBuffer);
  await writeFileAtomic(
    metaPath,
    `${JSON.stringify({ version: 1, built_at: payload.built_at, sourceMtimeMs, sourceSize }, null, 2)}\n`
  );

  logger?.info?.(
    { pins: Object.keys(directory).length, bytes: gzBuffer.length },
    "pincode_directory_asset_built"
  );

  return { ok: true, rebuilt: true, pins: Object.keys(directory).length, bytes: gzBuffer.length };
}

