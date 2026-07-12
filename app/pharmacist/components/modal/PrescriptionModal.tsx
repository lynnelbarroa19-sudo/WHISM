"use client";

import { CSSProperties, useEffect, useMemo, useState } from "react";
import { useTheme } from "@/lib/theme";
import { supabase } from "@/lib/supabase";
import { logAction } from "@/app/utils/auditLogs";
import { useAuth } from "@/context/AuthContext";

type Prescription = {
  id: string;
  patient_id: string;
  prescription_date: string;
  medicine: string;
  quantity: string | null;
  dosage_frequency?: string | null;
  dosage?: string | null;
  frequency?: string | null;
  notes: string | null;
  status: string | null;
  created_at: string | null;
  patient_name?: string;
  age?: number | null;
  sex?: string | null;
  barangay?: string | null;
};

type MedicineStock = {
  id: string;
  med_name: string;
  quantity: number;
  archived: boolean | null;
  exp_date: string | null;
};

type Props = {
  onClose: () => void;
  onToast: (msg: string, type: "success" | "error") => void;
};

function normalize(text: string) {
  return text.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

function isExpired(expDate?: string | null) {
  if (!expDate) return false;
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const exp = new Date(expDate);
  exp.setHours(0, 0, 0, 0);
  return exp < today;
}

export default function PrescriptionModal({ onClose, onToast }: Props) {
  const { user } = useAuth();
  const { t } = useTheme();

  const [prescriptions, setPrescriptions] = useState<Prescription[]>([]);
  const [stocks, setStocks] = useState<MedicineStock[]>([]);
  const [loading, setLoading] = useState(true);
  const [confirming, setConfirming] = useState(false);

  useEffect(() => {
    fetchLatestGroup();
  }, []);

  const fetchLatestGroup = async () => {
    setLoading(true);

    try {
      const { data: latest, error: latestError } = await supabase
        .from("prescriptions")
        .select(`
          id,
          patient_id,
          prescription_date,
          medicine,
          quantity,
          dosage_frequency,
          dosage,
          frequency,
          notes,
          status,
          created_at,
          patients (
            first_name,
            last_name,
            age,
            sex,
            barangay
          )
        `)
        .eq("status", "sent")
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();

      if (latestError) throw latestError;

      if (!latest) {
        setPrescriptions([]);
        setLoading(false);
        return;
      }

      const { data: groupData, error: groupError } = await supabase
        .from("prescriptions")
        .select(`
          id,
          patient_id,
          prescription_date,
          medicine,
          quantity,
          dosage_frequency,
          dosage,
          frequency,
          notes,
          status,
          created_at,
          patients (
            first_name,
            last_name,
            age,
            sex,
            barangay
          )
        `)
        .eq("status", "sent")
        .eq("patient_id", latest.patient_id)
        .eq("prescription_date", latest.prescription_date)
        .order("created_at", { ascending: true });

      if (groupError) throw groupError;

      const mapped: Prescription[] = (groupData ?? []).map((row: any) => {
        const p = row.patients;
        const fullName = p
          ? `${p.first_name ?? ""} ${p.last_name ?? ""}`.trim()
          : "Unknown";

        return {
          ...row,
          patient_name: fullName || "Unknown",
          age: p?.age ?? null,
          sex: p?.sex ?? null,
          barangay: p?.barangay ?? null,
        };
      });

      const { data: medicineStocks, error: stockError } = await supabase
        .from("pharma_medicines")
        .select("id, med_name, quantity, archived, exp_date");

      if (stockError) throw stockError;

      setPrescriptions(mapped);
      setStocks((medicineStocks ?? []) as MedicineStock[]);
    } catch (err: any) {
      onToast(err.message || "Failed to load prescriptions.", "error");
      onClose();
    } finally {
      setLoading(false);
    }
  };

  const unavailableMedicines = useMemo(() => {
    return prescriptions.filter((rx) => {
      const found = stocks.find(
        (m) => normalize(m.med_name) === normalize(rx.medicine)
      );

      if (!found) return true;
      if (found.archived) return true;
      if (isExpired(found.exp_date)) return true;
      if ((found.quantity ?? 0) <= 0) return true;

      return false;
    });
  }, [prescriptions, stocks]);

  const isNotAvailable = unavailableMedicines.length > 0;
  const patient = prescriptions[0];

  const handleConfirm = async () => {
    if (prescriptions.length === 0) return;

    if (isNotAvailable) {
      onToast(
        "Cannot dispense. Some prescribed medicine is not available in RHU.",
        "error"
      );
      return;
    }

    setConfirming(true);

    try {
      for (const rx of prescriptions) {
        const stock = stocks.find(
          (m) => normalize(m.med_name) === normalize(rx.medicine)
        );

        if (!stock) continue;

        const qtyNumber = Number(String(rx.quantity ?? "1").match(/\d+/)?.[0] ?? 1);
        const remaining = Math.max(0, (stock.quantity ?? 0) - qtyNumber);

        const { error: stockError } = await supabase
          .from("pharma_medicines")
          .update({ quantity: remaining })
          .eq("id", stock.id);

        if (stockError) throw stockError;

        const { error: dispenseError } = await supabase
          .from("pharma_dispense")
          .insert([
            {
              medicine_id: stock.id,
              med_name: stock.med_name,
              quantity: qtyNumber,
              dispensed_at: new Date().toISOString(),
            },
          ]);

        if (dispenseError) throw dispenseError;
      }

      const ids = prescriptions.map((p) => p.id);

      const { error } = await supabase
        .from("prescriptions")
        .update({ status: "dispensed" })
        .in("id", ids);

      if (error) throw error;

      await logAction({
        user_name: user?.name || "Pharmacist",
        user_role: "Pharmacist",
        action: "Dispense Prescription",
        module: "Pharmacy",
        description: `Dispensed ${prescriptions.length} medicine(s) to ${patient?.patient_name}`,
        status: "success",
      });

      onToast("Prescription marked as dispensed.", "success");
      onClose();
    } catch (err: any) {
      onToast(err.message || "Failed to dispense prescription.", "error");
    } finally {
      setConfirming(false);
    }
  };

  const fieldLabel: CSSProperties = {
    fontSize: 11,
    fontWeight: 800,
    color: "#111",
  };

  return (
    <div
      style={{
        position: "fixed",
        inset: 0,
        background: "rgba(0,0,0,0.55)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        zIndex: 1000,
        padding: 20,
      }}
      onClick={onClose}
    >
      <div
        style={{
          width: "min(560px, 95vw)",
          background: "#f8fafc",
          borderRadius: 18,
          overflow: "hidden",
          boxShadow: "0 20px 60px rgba(0,0,0,0.4)",
        }}
        onClick={(e) => e.stopPropagation()}
      >
        <div
          style={{
            background: "linear-gradient(135deg,#116b37,#18a052)",
            padding: "16px 22px",
            color: "#fff",
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
          }}
        >
          <div>
            <div style={{ fontSize: 15, fontWeight: 900 }}>
              Prescription Form
            </div>
            <div style={{ fontSize: 12, opacity: 0.85 }}>
              {patient?.patient_name ?? "Loading..."}
            </div>
          </div>

          <button
            onClick={onClose}
            style={{
              border: "1px solid rgba(255,255,255,0.5)",
              background: "rgba(255,255,255,0.15)",
              color: "#fff",
              borderRadius: 8,
              padding: "8px 14px",
              fontWeight: 800,
              cursor: "pointer",
            }}
          >
            ✕ Close
          </button>
        </div>

        <div style={{ padding: 22 }}>
          {loading && (
            <div style={{ textAlign: "center", padding: 40, color: t.text3 }}>
              Loading prescription…
            </div>
          )}

          {!loading && prescriptions.length === 0 && (
            <div style={{ textAlign: "center", padding: 40, color: t.text3 }}>
              No pending prescriptions.
            </div>
          )}

          {!loading && prescriptions.length > 0 && (
            <>
              <div
                style={{
                  background: "#fff",
                  minHeight: 520,
                  padding: 28,
                  borderRadius: 6,
                  color: "#000",
                  fontFamily: "Arial, sans-serif",
                  boxShadow: "0 2px 10px rgba(0,0,0,0.08)",
                }}
              >
                <div style={{ textAlign: "center", marginBottom: 18 }}>
                  <div style={{ fontSize: 11 }}>Republic of the Philippines</div>
                  <div style={{ fontSize: 12 }}>Department of Health</div>
                  <div style={{ fontSize: 12 }}>Lopez, Quezon</div>
                  <div style={{ fontSize: 12 }}>Municipal Health Office</div>
                  <div style={{ fontSize: 14, fontWeight: 900 }}>
                    PRESCRIPTION FORM
                  </div>
                </div>

                <div style={{ borderBottom: "2px solid #000", marginBottom: 12 }} />

                <div style={{ fontSize: 12, marginBottom: 12 }}>
                  <div style={{ display: "flex", gap: 10, marginBottom: 7 }}>
                    <span style={fieldLabel}>Name:</span>
                    <span style={{ flex: 1, borderBottom: "1px solid #000" }}>
                      {patient?.patient_name}
                    </span>

                    <span style={fieldLabel}>Date:</span>
                    <span style={{ width: 130, borderBottom: "1px solid #000" }}>
                      {new Date(patient.prescription_date).toLocaleDateString(
                        "en-US",
                        { month: "long", day: "numeric", year: "numeric" }
                      )}
                    </span>
                  </div>

                  <div style={{ display: "flex", gap: 10, marginBottom: 7 }}>
                    <span style={fieldLabel}>Age:</span>
                    <span style={{ width: 70, borderBottom: "1px solid #000" }}>
                      {patient?.age ?? ""}
                    </span>

                    <span style={fieldLabel}>Gender:</span>
                    <span style={{ width: 90, borderBottom: "1px solid #000" }}>
                      {patient?.sex === "M"
                        ? "Male"
                        : patient?.sex === "F"
                        ? "Female"
                        : ""}
                    </span>

                    <span style={fieldLabel}>Barangay:</span>
                    <span style={{ flex: 1, borderBottom: "1px solid #000" }}>
                      {patient?.barangay ?? ""}
                    </span>
                  </div>
                </div>

                <div style={{ borderBottom: "1px solid #000", marginBottom: 16 }} />

                <div
                  style={{
                    fontFamily: "serif",
                    fontSize: 42,
                    fontWeight: 900,
                    marginBottom: 10,
                  }}
                >
                  R<sub style={{ fontSize: 22 }}>x</sub>
                </div>

                <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
                  {prescriptions.map((rx, index) => {
                    const unavailable = unavailableMedicines.some(
                      (u) => u.id === rx.id
                    );

                    return (
                      <div
                        key={rx.id}
                        style={{
                          borderBottom: "1px solid #ddd",
                          paddingBottom: 10,
                          background: unavailable ? "#fff7ed" : "transparent",
                        }}
                      >
                        <div style={{ fontSize: 14, fontWeight: 900 }}>
                          {index + 1}. {rx.medicine}
                          {unavailable && (
                            <span
                              style={{
                                marginLeft: 8,
                                color: "#c2410c",
                                fontSize: 10,
                                fontWeight: 900,
                              }}
                            >
                              NOT AVAILABLE
                            </span>
                          )}
                        </div>

                        <div style={{ fontSize: 12, marginTop: 4 }}>
                          <b>Dosage/Frequency:</b>{" "}
                          {rx.dosage_frequency ||
                            [rx.dosage, rx.frequency].filter(Boolean).join(" - ") ||
                            "—"}
                        </div>

                        <div style={{ fontSize: 12 }}>
                          <b>Quantity:</b> {rx.quantity ?? "—"}
                        </div>

                        {rx.notes && (
                          <div style={{ fontSize: 12 }}>
                            <b>Notes:</b> {rx.notes}
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>

                <div style={{ marginTop: 50, textAlign: "center" }}>
                  <div
                    style={{
                      width: "60%",
                      borderTop: "1px solid #000",
                      margin: "0 auto 4px",
                    }}
                  />
                  <div style={{ fontSize: 11, fontWeight: 900 }}>
                    MUNICIPAL HEALTH OFFICER
                  </div>
                  <div style={{ fontSize: 10 }}>Physician</div>
                </div>
              </div>

              {isNotAvailable && (
                <div
                  style={{
                    marginTop: 14,
                    background: "#fff7ed",
                    border: "1.5px solid #fb923c",
                    color: "#9a3412",
                    borderRadius: 10,
                    padding: "12px 14px",
                    fontSize: 12,
                    fontWeight: 700,
                  }}
                >
                  These medicine(s) are not available in RHU:{" "}
                  {unavailableMedicines.map((m) => m.medicine).join(", ")}.
                  This should appear under the Not Available queue.
                </div>
              )}

              <div style={{ display: "flex", gap: 12, marginTop: 16 }}>
                <button
                  onClick={onClose}
                  style={{
                    flex: 1,
                    padding: "12px 0",
                    borderRadius: 9,
                    border: "none",
                    background: "#d63031",
                    color: "#fff",
                    fontWeight: 900,
                    cursor: "pointer",
                  }}
                >
                  CANCEL
                </button>

                <button
                  onClick={handleConfirm}
                  disabled={confirming || isNotAvailable}
                  style={{
                    flex: 1,
                    padding: "12px 0",
                    borderRadius: 9,
                    border: "none",
                    background: isNotAvailable ? "#9ca3af" : "#116b37",
                    color: "#fff",
                    fontWeight: 900,
                    cursor: isNotAvailable ? "not-allowed" : "pointer",
                    opacity: confirming ? 0.6 : 1,
                  }}
                >
                  {confirming ? "SAVING…" : "CONFIRM"}
                </button>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}