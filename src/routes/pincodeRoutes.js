import { Router } from "express";
import { getServiceablePincodeSet } from "../pincodes/serviceablePins.js";

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

  return router;
}

