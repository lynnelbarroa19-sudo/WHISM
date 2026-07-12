// Generatelabrequestpdf.ts
// Uses jsPDF (browser-side) to generate the lab request PDF
// Format: A6 (105mm × 148mm) — fits 4 copies on A4 in a 2×2 grid

import jsPDF from "jspdf";

export type LabRequestPDFParams = {
  patientName: string;
  age: string;
  gender: string;
  civilStatus: string;
  address: string;
  date: string;

  hgb_hct: boolean;
  cbc_with_platelet: boolean;
  pt_ptt: boolean;
  random_blood_sugar: boolean;
  fasting_blood_sugar: boolean;
  cholesterol: boolean;
  triglycerides: boolean;
  lipid_profile: boolean;
  blood_uric_acid: boolean;
  bun: boolean;
  creatinine: boolean;
  sgpt_alt: boolean;
  sgot_ast: boolean;
  serum_na_k_cl: boolean;

  urinalysis: boolean;
  fecalysis: boolean;
  pregnancy_test: boolean;

  abo_rh_blood_typing: boolean;
  dengue_ns1: boolean;
  dengue_igg_igm: boolean;
  typhidot_igg_igm: boolean;
  hbsag: boolean;
  ecg_12_lead: boolean;
  gene_xpert: boolean;

  afb_dssm: boolean;
  culture_and_sensitivity: boolean;

  ultrasound?: string;
  xray?: string;
  others?: string;
};

export function generateLabRequestPDF(params: LabRequestPDFParams) {
  // A6 = 105mm × 148mm → fits 4 copies on A4 (210mm × 297mm) in a 2×2 grid
  const doc = new jsPDF({ unit: "mm", format: "a6", orientation: "portrait" });

  const W = 105; // A6 width in mm
  const H = 148; // A6 height in mm
  const margin = 8;
  let y = 6;

  // ── Safe string coercion — jsPDF's doc.text() requires string/array, not number/null ──
  const s = (v: unknown) => (v === undefined || v === null ? "" : String(v));

  // ── Helpers ──────────────────────────────────────────────────────────────
  const centerText = (text: string, yPos: number, size = 7, style = "normal") => {
    doc.setFontSize(size);
    doc.setFont("helvetica", style);
    doc.text(text, W / 2, yPos, { align: "center" });
  };

  const lineAt = (x1: number, y1: number, x2: number, y2: number, lw = 0.3) => {
    doc.setLineWidth(lw);
    doc.line(x1, y1, x2, y2);
  };

  const checkbox = (x: number, yPos: number, checked: boolean) => {
    const sz = 2.6;
    doc.setLineWidth(0.25);
    doc.rect(x, yPos - sz + 0.5, sz, sz);
    if (checked) {
      doc.setLineWidth(0.4);
      doc.line(x + 0.3, yPos - sz + 0.5 + sz / 2, x + sz / 2, yPos - 0.3);
      doc.line(x + sz / 2, yPos - 0.3, x + sz - 0.3, yPos - sz + 0.5 + 0.3);
    }
  };

  const testRow = (
    x: number,
    yPos: number,
    label: string,
    checked: boolean,
    fontSize = 6
  ) => {
    checkbox(x, yPos, checked);
    doc.setFontSize(fontSize);
    doc.setFont("helvetica", "normal");
    doc.text(label, x + 3.5, yPos);
    return yPos + 4;
  };

  const sectionLabel = (x: number, yPos: number, title: string) => {
    doc.setFontSize(6);
    doc.setFont("helvetica", "bold");
    doc.text(title, x, yPos);
    return yPos + 4;
  };

  // ── HEADER ───────────────────────────────────────────────────────────────
  // Left seal placeholder
  doc.setLineWidth(0.3);
  doc.circle(margin + 4, y + 4, 4);
  doc.setFontSize(3);
  doc.setFont("helvetica", "normal");
  doc.text("QUEZON", margin + 4, y + 3.5, { align: "center" });
  doc.text("PROVINCE", margin + 4, y + 5.5, { align: "center" });

  // Right seal placeholder
  doc.circle(W - margin - 4, y + 4, 4);
  doc.text("RURAL", W - margin - 4, y + 3.5, { align: "center" });
  doc.text("HEALTH UNIT", W - margin - 4, y + 5.5, { align: "center" });

  // Header text
  centerText("Republic of the Philippines", y + 1.5, 5.5);
  y += 4;
  centerText("DEPARTMENT OF HEALTH", y + 1, 7.5, "bold");
  y += 4.5;
  centerText("MUNICIPAL HEALTH OFFICE", y + 1, 6, "bold");
  y += 4;
  centerText("LOPEZ, QUEZON", y + 1, 5.5);
  y += 5;

  lineAt(margin, y, W - margin, y, 0.4);
  y += 4;

  // ── PATIENT INFO ─────────────────────────────────────────────────────────
  doc.setFontSize(6);
  doc.setFont("helvetica", "normal");

  // Name & Date row
  doc.text("Name:", margin, y);
  lineAt(margin + 8, y + 0.5, 62, y + 0.5);
  doc.text(s(params.patientName), margin + 9, y);

  doc.text("Date:", 64, y);
  lineAt(70, y + 0.5, W - margin, y + 0.5);
  doc.text(s(params.date), 71, y);
  y += 4;

  // Age / Gender / Civil Status row
  doc.text("Age:", margin, y);
  lineAt(margin + 6, y + 0.5, margin + 17, y + 0.5);
  doc.text(s(params.age), margin + 7, y);

  doc.text("Gender:", margin + 19, y);
  lineAt(margin + 29, y + 0.5, margin + 42, y + 0.5);
  doc.text(s(params.gender), margin + 30, y);

  doc.text("Civil Status:", margin + 44, y);
  lineAt(margin + 57, y + 0.5, W - margin, y + 0.5);
  doc.text(s(params.civilStatus), margin + 58, y);
  y += 4;

  // Address row
  doc.text("Address:", margin, y);
  lineAt(margin + 12, y + 0.5, W - margin, y + 0.5);
  doc.text(s(params.address), margin + 13, y);
  y += 5;

  lineAt(margin, y, W - margin, y, 0.25);
  y += 3;

  // ── Rx symbol ──────────────────────────────────────────────────────────
  const rxX = margin;
  const rxY = y;
  doc.setFontSize(16);
  doc.setFont("helvetica", "bold");
  doc.text("R", rxX, rxY + 6);
  doc.setFontSize(7);
  doc.text("x", rxX + 4.5, rxY + 9);

  // ── TWO COLUMNS ─────────────────────────────────────────────────────────
  const colLeft = margin + 10;
  const colRight = W / 2 + 3;
  const startY = y;
  let yL = startY;
  let yR = startY;

  // ── LEFT COLUMN ──────────────────────────────────────────────────────────
  // HEMATOLOGY
  yL = sectionLabel(colLeft, yL, "HEMATOLOGY");
  yL = testRow(colLeft, yL, "Hgb/Hct", params.hgb_hct);
  yL = testRow(colLeft, yL, "CBC with Platelet Count", params.cbc_with_platelet);
  yL = testRow(colLeft, yL, "PT, PTT", params.pt_ptt);
  yL += 1.5;

  // BLOOD CHEMISTRY
  yL = sectionLabel(colLeft, yL, "BLOOD CHEMISTRY");
  yL = testRow(colLeft, yL, "Random Blood Sugar", params.random_blood_sugar);
  yL = testRow(colLeft, yL, "Fasting Blood Sugar", params.fasting_blood_sugar);
  yL = testRow(colLeft, yL, "Cholesterol", params.cholesterol);
  yL = testRow(colLeft, yL, "Triglycerides", params.triglycerides);
  yL = testRow(colLeft, yL, "Lipid Profile", params.lipid_profile);
  yL = testRow(colLeft, yL, "Blood Uric Acid", params.blood_uric_acid);
  yL = testRow(colLeft, yL, "BUN", params.bun);
  yL = testRow(colLeft, yL, "Creatinine", params.creatinine);
  yL = testRow(colLeft, yL, "SGPT (ALT)", params.sgpt_alt);
  yL = testRow(colLeft, yL, "SGOT (AST)", params.sgot_ast);
  yL = testRow(colLeft, yL, "Serum Na, K, Cl", params.serum_na_k_cl);
  yL += 1.5;

  // Fasting note
  doc.setFontSize(5);
  doc.setFont("helvetica", "italic");
  doc.text("Fasting: 8-10 hours no food/water", colLeft, yL);
  yL += 3;
  doc.text("*Last meal: 10:30PM – 12AM*", colLeft, yL);
  yL += 3;

  // ── RIGHT COLUMN ─────────────────────────────────────────────────────────
  // MICROSCOPY / PARASITOLOGY
  yR = sectionLabel(colRight, yR, "MICROSCOPY/PARASITOLOGY");
  yR = testRow(colRight, yR, "Urinalysis", params.urinalysis);
  yR = testRow(colRight, yR, "Fecalysis", params.fecalysis);
  yR = testRow(colRight, yR, "Pregnancy Test", params.pregnancy_test);
  yR += 1.5;

  // SEROLOGY
  yR = sectionLabel(colRight, yR, "SEROLOGY");
  yR = testRow(colRight, yR, "ABO, Rh Blood Typing", params.abo_rh_blood_typing);
  yR = testRow(colRight, yR, "Dengue NS1", params.dengue_ns1);
  yR = testRow(colRight, yR, "Dengue IgG, IgM", params.dengue_igg_igm);
  yR = testRow(colRight, yR, "Typhidot IgG/IgM", params.typhidot_igg_igm);
  yR = testRow(colRight, yR, "HbsAg", params.hbsag);
  yR = testRow(colRight, yR, "12 Lead ECG", params.ecg_12_lead);
  yR = testRow(colRight, yR, "Gene Xpert", params.gene_xpert);
  yR += 1.5;

  // MICROBIOLOGY
  yR = sectionLabel(colRight, yR, "MICROBIOLOGY");
  yR = testRow(colRight, yR, "AFB/DSSM", params.afb_dssm);
  yR = testRow(colRight, yR, "Culture and Sensitivity", params.culture_and_sensitivity);
  yR += 3;

  // OTHERS
  doc.setFontSize(6);
  doc.setFont("helvetica", "bold");
  doc.text("OTHERS", colRight, yR);
  yR += 4;

  const othersLineLen = W - margin - colRight - 2;
  const othersFields = [
    { label: "Ultrasound:", value: s(params.ultrasound) },
    { label: "X-ray:", value: s(params.xray) },
    { label: "Others:", value: s(params.others) },
  ];

  for (const field of othersFields) {
    doc.setFontSize(6);
    doc.setFont("helvetica", "normal");
    doc.text(field.label, colRight, yR);
    const labelW = doc.getTextWidth(field.label) + 1;
    lineAt(colRight + labelW, yR + 0.5, colRight + labelW + othersLineLen, yR + 0.5);
    if (field.value) {
      doc.text(field.value, colRight + labelW + 1, yR);
    }
    yR += 5;
  }

  // ── FOOTER ───────────────────────────────────────────────────────────────
  const footerY = Math.max(yL, yR) + 5;
  lineAt(margin, footerY, W - margin, footerY, 0.4);
  centerText("PAOLO GAYLORD S. VILLAFAÑE, MD, FPPS", footerY + 5, 6, "bold");
  centerText("Municipal Health Officer", footerY + 9, 5.5);
  centerText("Lic No. 89594", footerY + 13, 5.5);

  doc.autoPrint();
  window.open(doc.output("bloburl"), "_blank");
}