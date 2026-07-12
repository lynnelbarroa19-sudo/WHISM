"use client";
/**
 * RestockConfirmListener — RETIRED.
 *
 * ── WHY ────────────────────────────────────────────────────────────────────
 * lib/restockTransfer.ts's confirmRestockTransfer() is the single source of
 * truth for moving stock warehouse → pharmacy. It is called directly and
 * synchronously from PharmacyRequestsCard.tsx's confirmRequest(), and it
 * already does all four steps in one transaction-like sequence:
 *   1. Compute total pieces from the request
 *   2. Deduct from warehouse_medicines (FEFO)
 *   3. Add to pharma_medicines (update existing row or insert new one)
 *   4. Set restock_requests.status = 'confirmed'
 *
 * This component used to ALSO listen for restock_requests.status becoming
 * 'confirmed' (via Supabase realtime) and performed its OWN separate
 * addition into pharma_medicines. Since step 4 above is exactly the event
 * this listener was watching for, every single confirmation triggered BOTH
 * additions — doubling pharmacy stock on every restock
 * (e.g. 1 box of 10 pcs → +20 pcs instead of +10, because
 * confirmRestockTransfer added 10 and this listener's mergeIntoExisting /
 * insertNew added another 10 on top).
 *
 * ── THE FIX ────────────────────────────────────────────────────────────────
 * This component is now a no-op. It accepts the same props so you don't
 * have to touch the file that mounts it, but it subscribes to nothing and
 * does nothing.
 *
 * IMPORTANT — also remove the actual mount point:
 *   Find `<RestockConfirmListener ... />` in your pharmacist page/layout
 *   (likely app/pharmacist/page.tsx or app/pharmacist/layout.tsx) and
 *   delete that line entirely. Leaving this stub in place is a safety net
 *   in case the import can't be removed immediately, but the real fix is
 *   to stop rendering it at all.
 */

type Props = {
  pharmacistName: string;
  onStockAdded?: () => void;
};

export default function RestockConfirmListener(_props: Props) {
  return null;
}