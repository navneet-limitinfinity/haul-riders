import fs from "node:fs";
import path from "node:path";

let cached = null;

function getCsvPath() {
  return path.resolve(process.cwd(), "src/public/Pincode_master.csv");
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

export function isPincodeServiceable(pinCode) {
  const pin = String(pinCode ?? "").trim();
  if (!/^\d{6}$/.test(pin)) return false;
  return getServiceablePincodeSet().has(pin);
}

