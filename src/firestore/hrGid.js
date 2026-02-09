function nowIso() {
  return new Date().toISOString();
}

const HR_GID_START = 100000000000; // 12-digit numeric start

export async function reserveHrGids({ firestore, count }) {
  const n = Math.max(1, Math.min(500, Number(count ?? 0) || 0));
  if (!n) return [];

  const ref = firestore.collection("meta").doc("counters");

  const result = await firestore.runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    const data = snap.data() ?? {};
    const next = Number(data?.nextHrGid ?? HR_GID_START);
    if (!Number.isFinite(next) || next < HR_GID_START) {
      throw new Error("hr_gid_counter_invalid");
    }

    const allocated = [];
    for (let i = 0; i < n; i += 1) {
      allocated.push(String(next + i));
    }

    tx.set(
      ref,
      {
        nextHrGid: next + n,
        updatedAt: nowIso(),
      },
      { merge: true }
    );

    return allocated;
  });

  return Array.isArray(result) ? result : [];
}

