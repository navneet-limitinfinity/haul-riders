import { Router } from "express";
import { getPincodeDirectory, getServiceablePincodeSet } from "../pincodes/serviceablePins.js";

export function createPincodeRouter({ auth }) {
  const router = Router();

  router.post("/pincodes/serviceable", auth.requireAnyRole(["admin", "shop"]), (req, res) => {
    const rawPins = req.body?.pincodes ?? req.body?.pins ?? [];
    const pins = Array.isArray(rawPins)
      ? rawPins.map((v) => String(v ?? "").trim()).filter(Boolean).slice(0, 500)
      : [];

    const set = getServiceablePincodeSet();
    const out = {};
    for (const pin of pins) {
      out[pin] = set.has(pin);
    }

    res.setHeader("Cache-Control", "no-store");
    res.json({ count: pins.length, serviceable: out });
  });

  router.post("/pincodes/lookup", auth.requireAnyRole(["admin", "shop"]), (req, res) => {
    const rawPins = req.body?.pincodes ?? req.body?.pins ?? [];
    const pins = Array.isArray(rawPins)
      ? rawPins.map((v) => String(v ?? "").trim()).filter(Boolean).slice(0, 500)
      : [];

    const directory = getPincodeDirectory();
    const out = {};
    for (const pin of pins) {
      const info = directory.get(pin) ?? null;
      out[pin] = info
        ? { serviceable: true, state: String(info.state ?? ""), district: String(info.district ?? "") }
        : { serviceable: false, state: "", district: "" };
    }

    res.setHeader("Cache-Control", "no-store");
    res.json({ count: pins.length, pincodes: out });
  });

  return router;
}
