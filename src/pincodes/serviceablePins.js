import fs from "node:fs";
import path from "node:path";

let cached = null;
let cachedDirectory = null;

function getCsvPath() {
  return path.resolve(process.cwd(), "src/public/Pincode_master.csv");
}

function parseDirectoryFromCsv(text) {
  const lines = String(text ?? "").split(/\r?\n/);
  const directory = new Map();
  if (!lines.length) return directory;

  const header = String(lines[0] ?? "").trim().toLowerCase();
  const columns = header.split(",").map((c) => String(c ?? "").trim());
  const pinIdx = columns.indexOf("pincode");
  const stateIdx = columns.indexOf("state");
  const districtIdx = columns.indexOf("district");

  for (let i = 1; i < lines.length; i += 1) {
    const line = lines[i];
    if (!line) continue;
    const parts = line.split(",");
    const pin = String(parts[pinIdx >= 0 ? pinIdx : 0] ?? "").trim();
    if (!/^\d{6}$/.test(pin)) continue;
    const state = String(parts[stateIdx] ?? "").trim();
    const district = String(parts[districtIdx] ?? "").trim();
    directory.set(pin, { pincode: pin, state, district });
  }

  return directory;
}

export function getServiceablePincodeSet() {
  if (cached) return cached;
  const csvPath = getCsvPath();
  const text = fs.readFileSync(csvPath, "utf8");
  const lines = text.split(/\r?\n/);
  const set = new Set();
  for (let i = 1; i < lines.length; i += 1) {
    const line = lines[i];
    if (!line) continue;
    const first = line.split(",")[0] ?? "";
    const pin = String(first).trim();
    if (/^\d{6}$/.test(pin)) set.add(pin);
  }
  cached = set;
  return set;
}

export function getPincodeDirectory() {
  if (cachedDirectory) return cachedDirectory;
  const csvPath = getCsvPath();
  const text = fs.readFileSync(csvPath, "utf8");
  cachedDirectory = parseDirectoryFromCsv(text);
  return cachedDirectory;
}

export function getPincodeInfo(pinCode) {
  const pin = String(pinCode ?? "").trim();
  if (!/^\d{6}$/.test(pin)) return null;
  const dir = getPincodeDirectory();
  return dir.get(pin) ?? null;
}

export function isPincodeServiceable(pinCode) {
  const pin = String(pinCode ?? "").trim();
  if (!/^\d{6}$/.test(pin)) return false;
  return getServiceablePincodeSet().has(pin);
}
