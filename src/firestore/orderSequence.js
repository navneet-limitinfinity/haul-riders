export function formatManualOrderName(seq, { pad = 6 } = {}) {
  const n = Number(seq);
  if (!Number.isFinite(n) || n <= 0) throw new Error("invalid_order_sequence");
  return `O${String(Math.trunc(n)).padStart(pad, "0")}`;
}

export async function reserveOrderSequences({ firestore, count }) {
  const n = Math.max(1, Math.min(5000, Number(count) || 0));
  const ref = firestore.collection("meta").doc("counters");

  return firestore.runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    const data = snap.exists ? snap.data() ?? {} : {};
    const current = Number(data?.nextOrderSeq ?? 1);
    const start = Number.isFinite(current) && current > 0 ? Math.trunc(current) : 1;
    const next = start + n;
    tx.set(ref, { nextOrderSeq: next, updatedAt: new Date().toISOString() }, { merge: true });
    const out = [];
    for (let i = 0; i < n; i += 1) out.push(start + i);
    return out;
  });
}

