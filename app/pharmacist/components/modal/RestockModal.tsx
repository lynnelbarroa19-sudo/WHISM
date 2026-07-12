"use client";
import { CSSProperties, useState, useMemo } from "react";
import { useTheme } from "@/lib/theme";
import { supabase } from "@/lib/supabase";
import { RestockItem } from "@/lib/types";

type Props = {
  onClose:      () => void;
  onToast:      (msg: string, type: "success" | "error") => void;
  onSaved?:     () => void;
  prefill?:     Partial<RestockItem>;
  medicineId?:  string;
  requestType?: "drugs" | "supplies";
};

// ── Excel data embedded directly ───────────────────────────────────────────────
type MedEntry = { med_name: string; med_dosage: string; med_type: string; unit: string };

const DRUGS_DATA: MedEntry[] = [
  { med_name: "[BCG Vaccine] Bacillus Calmette Guerin", med_dosage: "20mg", med_type: "vaccine", unit: "vial" },
  { med_name: "[COC Pill] Levonorgestrel + Ethinylestradiol + Ferrous Fumarate Film-Coated", med_dosage: "150mcg/30mcg/75mg", med_type: "tablet", unit: "box" },
  { med_name: "[Cotrimoxazole] Sulfamethoxazole + Trimethoprim", med_dosage: "400mg/80mg", med_type: "tablet", unit: "box" },
  { med_name: "[MR Vaccine] Measles and Rubella Live Attenuated", med_dosage: "10", med_type: "vaccine", unit: "vial" },
  { med_name: "[POP Pill] Lynestrenol", med_dosage: "500mcg", med_type: "tablet", unit: "box" },
  { med_name: "Acetylcysteine", med_dosage: "200mg", med_type: "powder", unit: "box/sachet" },
  { med_name: "Albendazole", med_dosage: "400mg", med_type: "tablet", unit: "box" },
  { med_name: "Allopurinol", med_dosage: "100mg", med_type: "tablet", unit: "box" },
  { med_name: "Aluminum Hydroxide + Magnesium Hydroxide", med_dosage: "200mg/100mg", med_type: "tablet", unit: "box" },
  { med_name: "Ambroxol HCl", med_dosage: "15mg/5ml (10ml)", med_type: "drop/syrup", unit: "bottle" },
  { med_name: "Amlodipine", med_dosage: "10mg", med_type: "tablet", unit: "box" },
  { med_name: "Amoxicillin", med_dosage: "250mg/5mL", med_type: "powder", unit: "bottle" },
  { med_name: "Amoxicillin", med_dosage: "500mcg", med_type: "capsule", unit: "box" },
  { med_name: "Ascorbic Acid", med_dosage: "100mg/5mL 120mL", med_type: "syrup", unit: "bottle" },
  { med_name: "Ascorbic Acid", med_dosage: "100mg/mL 15mL", med_type: "drop", unit: "bottle" },
  { med_name: "Ascorbic Acid", med_dosage: "500mg", med_type: "tablet", unit: "box" },
  { med_name: "Ascorbic Acid 500mg + Zinc", med_dosage: "500mg/50mg", med_type: "capsule", unit: "box" },
  { med_name: "Aspirin", med_dosage: "80mg", med_type: "tablet", unit: "box" },
  { med_name: "Atorvastatin", med_dosage: "40mg", med_type: "tablet", unit: "box" },
  { med_name: "Bedaquiline", med_dosage: "100mg", med_type: "tablet", unit: "bottle" },
  { med_name: "Biperiden Hydrochloride", med_dosage: "2mg", med_type: "tablet", unit: "box" },
  { med_name: "Biphasic Isophane Human Insulin", med_dosage: "100IU/mL 10mL", med_type: "injection", unit: "vial" },
  { med_name: "Blumea Balsamifera", med_dosage: "500mg", med_type: "tablet", unit: "box" },
  { med_name: "Carbamazepine", med_dosage: "200mg", med_type: "tablet", unit: "box" },
  { med_name: "Carbocisteine", med_dosage: "250mg/5ml", med_type: "Liquid", unit: "bottle" },
  { med_name: "Cefalexin", med_dosage: "250mg/5mL/60mL", med_type: "powder", unit: "bottle" },
  { med_name: "Cefalexin", med_dosage: "500mg", med_type: "capsule", unit: "box" },
  { med_name: "Cefixime", med_dosage: "100mg/5ml 60ml", med_type: "powder", unit: "bottle" },
  { med_name: "Cefixime", med_dosage: "200mg", med_type: "capsule", unit: "box" },
  { med_name: "Cefuroxime", med_dosage: "500mg", med_type: "tablet", unit: "box" },
  { med_name: "Celecoxib", med_dosage: "200mg", med_type: "capsule", unit: "box" },
  { med_name: "Cetirizine", med_dosage: "10mg", med_type: "tablet", unit: "box" },
  { med_name: "Chlorphenamine", med_dosage: "4mg", med_type: "tablet", unit: "box" },
  { med_name: "Chlorpromazine", med_dosage: "200mg", med_type: "tablet", unit: "box" },
  { med_name: "Cinnarizine", med_dosage: "25mg", med_type: "tablet", unit: "box" },
  { med_name: "Ciprofloxacin", med_dosage: "500mg", med_type: "tablet", unit: "box" },
  { med_name: "Clarithromycin", med_dosage: "125 mg/5 mL, 50 mL", med_type: "powder", unit: "bottle" },
  { med_name: "Clonidine", med_dosage: "75mcg", med_type: "tablet", unit: "box" },
  { med_name: "Clopidogrel", med_dosage: "75mg", med_type: "tablet", unit: "box" },
  { med_name: "Cloxacillin", med_dosage: "500mg", med_type: "capsule", unit: "box" },
  { med_name: "Cloxacillin", med_dosage: "250mg/5mL 60mL", med_type: "powder", unit: "bottle" },
  { med_name: "Clozapine", med_dosage: "100mg", med_type: "tablet", unit: "box" },
  { med_name: "Co-Amoxiclav", med_dosage: "625mg", med_type: "tablet", unit: "box" },
  { med_name: "Colchicine", med_dosage: "500mcg", med_type: "tablet", unit: "box" },
  { med_name: "Cotrimoxazole", med_dosage: "240mg/5ml", med_type: "Liquid", unit: "bottle" },
  { med_name: "Cotrimoxazole", med_dosage: "960mg", med_type: "tablet", unit: "box" },
  { med_name: "Delamanid", med_dosage: "50mg", med_type: "tablet", unit: "box" },
  { med_name: "Dicycloverine", med_dosage: "10mg", med_type: "tablet", unit: "box" },
  { med_name: "Dicycloverine", med_dosage: "10mg/5mL/60mL", med_type: "Liquid", unit: "bottle" },
  { med_name: "Diphenhydramine Hydrochloride", med_dosage: "12.5mg/5mL", med_type: "syrup", unit: "bottle" },
  { med_name: "Divalproex Sodium", med_dosage: "250mg", med_type: "tablet", unit: "box" },
  { med_name: "Doxycycline Hyclate", med_dosage: "100mg", med_type: "capsule", unit: "box" },
  { med_name: "Epinephrine", med_dosage: "", med_type: "injection", unit: "ampule" },
  { med_name: "Erythromycin", med_dosage: "", med_type: "ointment", unit: "tube" },
  { med_name: "Escitalopram Oxalate", med_dosage: "10mg", med_type: "tablet", unit: "box" },
  { med_name: "Ethambutol", med_dosage: "400mg", med_type: "tablet", unit: "box" },
  { med_name: "Fenofibrate", med_dosage: "200 mg", med_type: "capsule", unit: "box" },
  { med_name: "Ferrous Salt + Folic Acid", med_dosage: "60mg/400mcg", med_type: "capsule", unit: "box" },
  { med_name: "Ferrous Sulfate + Folic Acid", med_dosage: "60mg", med_type: "tablet", unit: "box" },
  { med_name: "Fluoxetine", med_dosage: "20 mg", med_type: "capsule", unit: "box" },
  { med_name: "Flupantixol", med_dosage: "20 mg/ml", med_type: "injection", unit: "ampule" },
  { med_name: "Flupentixol Decanoate", med_dosage: "20 mg/ml/1ml", med_type: "injection", unit: "ampule" },
  { med_name: "Fluphenazine Decanoate", med_dosage: "25 mg/ml/1ml", med_type: "injection", unit: "ampule" },
  { med_name: "Fusidate Sodium / Fusidic Acid", med_dosage: "", med_type: "cream", unit: "tube" },
  { med_name: "Fusidic Acid", med_dosage: "", med_type: "cream", unit: "tube" },
  { med_name: "Gabapentin", med_dosage: "100mg", med_type: "capsule", unit: "box" },
  { med_name: "Gliclazide", med_dosage: "80mg", med_type: "tablet", unit: "box" },
  { med_name: "Guaifenesin", med_dosage: "100mg/20ml", med_type: "syrup", unit: "bottle" },
  { med_name: "Hexetidine", med_dosage: "0.10%", med_type: "mouthwash/gargle", unit: "bottle" },
  { med_name: "Human Papillomavirus (HPV)", med_dosage: "1 dose", med_type: "vaccine", unit: "vial" },
  { med_name: "Hydrocortisone", med_dosage: "10mg/g (1%)", med_type: "cream", unit: "tube" },
  { med_name: "Inactivated Polio Vaccine (IPV)", med_dosage: "1 dose", med_type: "vaccine", unit: "vial" },
  { med_name: "Isoniazid", med_dosage: "200mg/5mL 120mL", med_type: "syrup", unit: "bottle" },
  { med_name: "Isoniazid + Rifampicin + Pyrazinamide + Ethambutol", med_dosage: "75mg/150mg/400mg/275mg", med_type: "tablet", unit: "box" },
  { med_name: "Lagundi [Vitex Negundo L. (Fam. Verbenaceae)", med_dosage: "300mg/5mL 120mL", med_type: "syrup", unit: "bottle" },
  { med_name: "Lamotrigine", med_dosage: "100mg", med_type: "tablet", unit: "box" },
  { med_name: "Levetiracetam", med_dosage: "500mg", med_type: "tablet", unit: "box" },
  { med_name: "Levofloxacin", med_dosage: "500mg", med_type: "tablet", unit: "box" },
  { med_name: "Lidocaine Hydrochloride", med_dosage: "2% 50mL", med_type: "injection", unit: "vial" },
  { med_name: "Linezolid", med_dosage: "600mg", med_type: "tablet", unit: "box" },
  { med_name: "Loperamide", med_dosage: "2mg", med_type: "capsule", unit: "box" },
  { med_name: "Losartan", med_dosage: "50mg", med_type: "tablet", unit: "box" },
  { med_name: "Losartan Potassium", med_dosage: "50mg", med_type: "tablet", unit: "box" },
  { med_name: "Mebendazole", med_dosage: "500mg", med_type: "tablet", unit: "box" },
  { med_name: "Medroxyprogesterone", med_dosage: "150mg/mL 1mL", med_type: "injection", unit: "vial" },
  { med_name: "Mefenamic Acid", med_dosage: "500mg", med_type: "tablet", unit: "box" },
  { med_name: "Mefenamic Acid", med_dosage: "500mg", med_type: "capsule", unit: "box" },
  { med_name: "Mefenamic Acid", med_dosage: "50mg/5mL", med_type: "powder", unit: "bottle" },
  { med_name: "Metformin", med_dosage: "500mg", med_type: "tablet", unit: "box" },
  { med_name: "Metoprolol", med_dosage: "50mg", med_type: "tablet", unit: "box" },
  { med_name: "Metronidazole", med_dosage: "125mg/5mL 60mL", med_type: "powder", unit: "bottle" },
  { med_name: "Metronidazole", med_dosage: "500mg", med_type: "tablet", unit: "box" },
  { med_name: "Montelukast", med_dosage: "10mg", med_type: "tablet", unit: "box" },
  { med_name: "Multivitamins", med_dosage: "", med_type: "capsule", unit: "box" },
  { med_name: "Multivitamins", med_dosage: "60mL", med_type: "syrup", unit: "bottle" },
  { med_name: "Multivitamins", med_dosage: "15mL", med_type: "drop", unit: "bottle" },
  { med_name: "Multivitamins", med_dosage: "", med_type: "tablet", unit: "box" },
  { med_name: "Mupirocin", med_dosage: "20mg/g (2%) 15g", med_type: "ointment", unit: "tube" },
  { med_name: "Ofloxacin", med_dosage: "3mg/mL (0.3%) 5mL", med_type: "drop", unit: "bottle" },
  { med_name: "Olanzapine", med_dosage: "10mg", med_type: "tablet", unit: "box" },
  { med_name: "Omeprazole", med_dosage: "20mg", med_type: "capsule", unit: "box" },
  { med_name: "Oral Rehydration Salts", med_dosage: "20.5g", med_type: "powder", unit: "sachet" },
  { med_name: "Oseltamivir Phosphate", med_dosage: "75mg", med_type: "capsule", unit: "box" },
  { med_name: "Oxytocin", med_dosage: "10IU/mL 1mL", med_type: "injection", unit: "ampule" },
  { med_name: "Paliperidone Palmitate", med_dosage: "150mg/1.5mL", med_type: "injection", unit: "syringe" },
  { med_name: "Paracetamol", med_dosage: "100mg/mL 10mL", med_type: "drop", unit: "bottle" },
  { med_name: "Paracetamol", med_dosage: "250mg/5mL 15mL", med_type: "syrup", unit: "bottle" },
  { med_name: "Paracetamol", med_dosage: "500mg", med_type: "tablet", unit: "box" },
  { med_name: "Pentavalent Vaccine (DPT-Hepatitis B-HiB)", med_dosage: "1 dose", med_type: "vaccine", unit: "vial" },
  { med_name: "Phenylpropanolamine HCl + Brompheniramine Maleate", med_dosage: "6.25mg/2mg per 5mL 15mL", med_type: "drop/syrup", unit: "bottle" },
  { med_name: "Phytomenadione 10mg/ml Solution for Injection", med_dosage: "10mg/mL", med_type: "injection", unit: "ampule" },
  { med_name: "Pneumococcal Conjugate", med_dosage: "4 doses", med_type: "vaccine", unit: "vial" },
  { med_name: "Poliomyelitis Bivalent Type", med_dosage: "20 doses", med_type: "vaccine", unit: "vial" },
  { med_name: "Prednisone", med_dosage: "10mg", med_type: "tablet", unit: "box" },
  { med_name: "Pretomanid", med_dosage: "200mg", med_type: "tablet", unit: "box" },
  { med_name: "Purified Vero Cell Rabies", med_dosage: "2.5IU/0.5mL 1mL", med_type: "vaccine", unit: "vial" },
  { med_name: "Pyrazinamide", med_dosage: "250mg/5mL 120mL", med_type: "syrup", unit: "bottle" },
  { med_name: "Pyrazinamide", med_dosage: "500mg", med_type: "tablet", unit: "box" },
  { med_name: "Pyridoxine", med_dosage: "50mg", med_type: "tablet", unit: "box" },
  { med_name: "Ranitidine", med_dosage: "300mg", med_type: "tablet", unit: "box" },
  { med_name: "Regular Insulin Human", med_dosage: "100IU/mL 10mL", med_type: "injection", unit: "vial" },
  { med_name: "Rifampicin", med_dosage: "200mg/5mL 120mL", med_type: "syrup", unit: "bottle" },
  { med_name: "Rifapentine + Isoniazid", med_dosage: "300mg/300mg", med_type: "tablet", unit: "box" },
  { med_name: "Risperidone", med_dosage: "2mg", med_type: "tablet", unit: "box" },
  { med_name: "Salbutamol", med_dosage: "2mg/5mL 60mL", med_type: "syrup", unit: "bottle" },
  { med_name: "Salbutamol", med_dosage: "4mg", med_type: "tablet", unit: "box" },
  { med_name: "Salbutamol Nebule", med_dosage: "1mg", med_type: "liquid", unit: "nebule" },
  { med_name: "Salmeterol + Fluticasone", med_dosage: "25mcg/125mcg", med_type: "inhaler", unit: "box" },
  { med_name: "Sertraline", med_dosage: "50mg", med_type: "tablet", unit: "box" },
  { med_name: "Silver Sulfadiazin", med_dosage: "10mg/g (1%)", med_type: "cream", unit: "tube" },
  { med_name: "Simvastatin", med_dosage: "20mg", med_type: "tablet", unit: "box" },
  { med_name: "Spironolactone", med_dosage: "50mg", med_type: "tablet", unit: "box" },
  { med_name: "Telmisartan", med_dosage: "40mg", med_type: "tablet", unit: "box" },
  { med_name: "Tetanus-Diphtheria", med_dosage: "10 doses", med_type: "vaccine", unit: "vial" },
  { med_name: "Tobramycin", med_dosage: "0.3% 5mL", med_type: "drop", unit: "bottle" },
  { med_name: "Tranexamic Acid", med_dosage: "500mg", med_type: "capsule", unit: "box" },
  { med_name: "Tranexamic Acid", med_dosage: "500mg", med_type: "tablet", unit: "box" },
  { med_name: "Trimetazidine", med_dosage: "35mg", med_type: "tablet", unit: "box" },
  { med_name: "Tuberculin Purified Protein Derivative", med_dosage: "2TU/0.1mL", med_type: "injection", unit: "vial" },
  { med_name: "Valproic Acid", med_dosage: "250mg/5mL", med_type: "syrup", unit: "bottle" },
  { med_name: "Vitamin B1 + Vitamin B12 + Vitamin B6", med_dosage: "100mg/5mg/50mcg", med_type: "capsule", unit: "box" },
  { med_name: "Vitex Negundo L.", med_dosage: "300mg", med_type: "tablet", unit: "box" },
];

const SUPPLIES_DATA: MedEntry[] = [
  { med_name: "1cc Syringe", med_dosage: "25g", med_type: "medical supply", unit: "box" },
  { med_name: "3cc Syringe", med_dosage: "23g", med_type: "medical supply", unit: "box" },
  { med_name: "Auto Disable Syringes", med_dosage: "1ml", med_type: "medical supply", unit: "box" },
  { med_name: "Cartridge-Based Nucleic Acid Amplification Test Reagent for MTB/RIF", med_dosage: "", med_type: "test kit", unit: "box" },
  { med_name: "Clean Gloves - Large", med_dosage: "", med_type: "medical supply", unit: "bottle" },
  { med_name: "Clothiadin + Deltamethrin", med_dosage: "", med_type: "powder", unit: "sachet" },
  { med_name: "Deltamethrin + S-Bioallethrin + Piperonyl Butoxide", med_dosage: "5g/7.5/100g", med_type: "Liquid", unit: "bottle" },
  { med_name: "Diflubenzuron", med_dosage: "200g", med_type: "granules", unit: "bottle" },
  { med_name: "Disposable Syringe with Needle", med_dosage: "", med_type: "medical supply", unit: "box" },
  { med_name: "Etofenprox", med_dosage: "", med_type: "Liquid", unit: "bottle" },
  { med_name: "Etonogestrel Progestin Subdermal Implant (PSI)", med_dosage: "", med_type: "medical device", unit: "box" },
  { med_name: "Glass Slide (boxes)", med_dosage: "", med_type: "laboratory supply", unit: "box" },
  { med_name: "HIV Rapid Diagnostic Test with Consumables", med_dosage: "", med_type: "test kit", unit: "kit" },
  { med_name: "Insecticides for Space Spraying", med_dosage: "1L", med_type: "liquid", unit: "bottle" },
  { med_name: "Insulin Syringe", med_dosage: "1mL", med_type: "medical supply", unit: "piece" },
  { med_name: "Isopropyl Alcohol", med_dosage: "70% 500mL", med_type: "liquid", unit: "bottle" },
  { med_name: "Long Lasting Insecticide Treated Screen", med_dosage: "", med_type: "medical supply", unit: "piece" },
  { med_name: "Lubricating Jelly Sachet", med_dosage: "", med_type: "medical supply", unit: "sachet" },
  { med_name: "Male Condom - Plain and Flavored", med_dosage: "", med_type: "medical supply", unit: "box" },
  { med_name: "Mixing Reconstitution Syringe with Needle", med_dosage: "5mL", med_type: "medical supply", unit: "box" },
  { med_name: "N95 Mask", med_dosage: "", med_type: "medical supply", unit: "box" },
  { med_name: "Permethrin + S-bioallethrin + Piperonyl Butoxide", med_dosage: "102.7g/1.42g/98.4g per L", med_type: "liquid", unit: "bottle" },
  { med_name: "Poliomyelitis Bivalent Type", med_dosage: "", med_type: "medical supply", unit: "piece" },
  { med_name: "Pyriproxyfen", med_dosage: "5g", med_type: "powder", unit: "sachet" },
  { med_name: "Ready-to-Use-Supplementary Food", med_dosage: "", med_type: "food supplement", unit: "sachet" },
  { med_name: "Sputum Cup - Disposable Plastic with Screw Cap", med_dosage: "", med_type: "laboratory supply", unit: "piece" },
  { med_name: "Surgical Mask", med_dosage: "", med_type: "medical supply", unit: "box" },
  { med_name: "Surgical Tape", med_dosage: "1in x 10yd", med_type: "medical supply", unit: "roll" },
  { med_name: "Vacuum Blood Collection Tube - Purple Top", med_dosage: "2mL", med_type: "laboratory supply", unit: "piece" },
];

// ── SVG icons ──────────────────────────────────────────────────────────────────
const DrugIcon = () => (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <rect x="2" y="9" width="20" height="6" rx="3"/>
    <line x1="12" y1="9" x2="12" y2="15"/>
  </svg>
);
const SupplyIcon = () => (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M11 2a2 2 0 0 0-2 2v5H4a2 2 0 0 0-2 2v2c0 1.1.9 2 2 2h5v5a2 2 0 0 0 2 2h2a2 2 0 0 0 2-2v-5h5a2 2 0 0 0 2-2v-2a2 2 0 0 0-2-2h-5V4a2 2 0 0 0-2-2h-2z"/>
  </svg>
);

// ── Box-unit detection — SAME logic used in MedicineStockPage.tsx and
// RestockConfirmListener.tsx. Kept identical across all three files since
// they must all agree on which units are "box" units. ──
const IS_BOX_UNIT = (unit: string) =>
  unit?.toLowerCase().includes("box") || unit?.toLowerCase() === "boxes";

// ── Types ──────────────────────────────────────────────────────────────────────
type ListItem = {
  medicine:      string;
  dosage:        string;
  type:          string;
  unit:          string;
  qty:           number;   // boxes if isBoxUnit, else flat pieces
  isBoxUnit:     boolean;
  piecesPerBox:  number;   // only meaningful when isBoxUnit
};

export default function RestockModal({ onClose, onToast, onSaved, medicineId, requestType }: Props) {
  const { t } = useTheme();

  const dataset = requestType === "supplies" ? SUPPLIES_DATA : DRUGS_DATA;

  // Build unique name list for the dropdown (names can repeat with diff dosage — show all)
  const nameOptions = useMemo(() => dataset.map((d, i) => ({ ...d, _idx: i })), [dataset]);

  // ── Form state ─────────────────────────────────────────────────────────────
  const [selectedIdx, setSelectedIdx] = useState<number | "">("");
  const [qty, setQty]                 = useState(1);
  // ── NEW: pieces-per-box for the currently selected box-unit medicine.
  // Defaults to 10 (same fallback used everywhere else in the app) but the
  // pharmacist can correct it if they know the real carton size — this
  // value gets snapshotted onto the restock_requests row so the listener
  // converts "N boxes" into the correct total piece count even if the
  // live pharma_medicines row doesn't exist yet (first-time stock). ──
  const [piecesPerBox, setPiecesPerBox] = useState(10);
  const [items, setItems]             = useState<ListItem[]>([]);
  const [saving, setSaving]           = useState(false);

  // ── Search UI state (display-only — does not change what gets saved).
  // searchQuery filters nameOptions for the dropdown; searchOpen toggles
  // the visibility of the filtered results panel. ──
  const [searchQuery, setSearchQuery] = useState("");
  const [searchOpen, setSearchOpen]   = useState(false);

  // Resolved entry from dropdown selection
  const selectedEntry = selectedIdx !== "" ? dataset[selectedIdx] : null;
  const selectedIsBoxUnit = selectedEntry ? IS_BOX_UNIT(selectedEntry.unit) : false;

  // Filtered options for the searchable dropdown — same nameOptions array,
  // just narrowed down by what the pharmacist has typed so far.
  const filteredOptions = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    if (!q) return nameOptions;
    return nameOptions.filter(entry =>
      entry.med_name.toLowerCase().includes(q) ||
      (entry.med_dosage || "").toLowerCase().includes(q) ||
      (entry.med_type || "").toLowerCase().includes(q)
    );
  }, [nameOptions, searchQuery]);

  // Selecting an entry from the search results — sets the SAME selectedIdx
  // state the rest of the form already relies on (addItem, locked fields,
  // box-unit detection, etc. are all untouched).
  const selectEntry = (idx: number) => {
    setSelectedIdx(idx);
    setSearchQuery(dataset[idx].med_name);
    setSearchOpen(false);
  };

  // Label helpers
  const isSupplyMode      = requestType === "supplies";
  const nameLabel         = isSupplyMode ? "Supply Name"    : "Medicine Name";
  const dosageLabel       = isSupplyMode ? "Specification"  : "Mg / Dosage";
  const modalTitle        = requestType === "drugs"
    ? "Restock — Medicine Drugs"
    : requestType === "supplies"
    ? "Restock — Supplies"
    : "Restock Request";

  // ── Add item ───────────────────────────────────────────────────────────────
  const addItem = () => {
    if (!selectedEntry) return;
    setItems(prev => [...prev, {
      medicine:     selectedEntry.med_name,
      dosage:       selectedEntry.med_dosage,
      type:         selectedEntry.med_type,
      unit:         selectedEntry.unit,
      qty,
      isBoxUnit:    selectedIsBoxUnit,
      piecesPerBox: selectedIsBoxUnit ? piecesPerBox : 10,
    }]);
    setSelectedIdx("");
    setQty(1);
    setPiecesPerBox(10);
    setSearchQuery("");
  };

  const removeItem = (i: number) => setItems(prev => prev.filter((_, idx) => idx !== i));

  // ── Send request ───────────────────────────────────────────────────────────
  const handleSendRequest = async () => {
    if (items.length === 0) {
      onToast("Add at least one item to the list.", "error");
      return;
    }
    setSaving(true);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      const uid = session?.user?.id;
      let pharmacistName = "Pharmacist";
      if (uid) {
        const { data: u } = await supabase.from("users").select("username").eq("user_id", uid).maybeSingle();
        if (u?.username) pharmacistName = u.username;
      }

      for (const item of items) {
        const totalPieces = item.isBoxUnit
          ? item.qty * item.piecesPerBox
          : item.qty;

        const { error } = await supabase.from("restock_requests").insert([{
          pharmacist_name: pharmacistName,
          medicine_name:   item.medicine,
          dosage:          item.dosage,
          medicine_type:   item.type,
          unit:            item.unit,
          quantity:        totalPieces,
          requested_boxes:           item.isBoxUnit ? item.qty : 0,
          requested_partial_pieces:  item.isBoxUnit ? 0        : item.qty,
          pieces_per_box_snapshot:   item.isBoxUnit ? item.piecesPerBox : null,
          status:          "pending",
        }]);
        if (error) throw error;
      }

      if (medicineId) {
        await supabase.from("pharma_medicines").update({ archived: true }).eq("id", medicineId);
      }

      onToast(`Restock request sent (${items.length} item${items.length > 1 ? "s" : ""}).`, "success");
      onSaved?.();
      onClose();
    } catch (err: any) {
      onToast(err.message || "Failed to send request.", "error");
    } finally {
      setSaving(false);
    }
  };

  // ── Shared styles ──────────────────────────────────────────────────────────
  const inp: CSSProperties = {
    border: `1.5px solid ${t.inputBorder}`, borderRadius: 8,
    padding: "8px 10px", fontSize: 12.5, fontFamily: "inherit",
    outline: "none", background: t.modalBg, color: t.modalText,
    width: "100%", height: 36, boxSizing: "border-box",
  };
  const sel: CSSProperties = {
    ...inp, appearance: "none", WebkitAppearance: "none", cursor: "pointer",
  };
  const locked: CSSProperties = {
    ...inp, background: t.surface2, color: t.text2,
    cursor: "not-allowed", border: `1.5px solid ${t.border2}`,
    display: "flex", alignItems: "center",
  };
  const lbl: CSSProperties = {
    fontSize: 11, fontWeight: 700, color: t.text3,
    textTransform: "uppercase", letterSpacing: "0.06em",
    marginBottom: 5, display: "block",
  };
  const col: CSSProperties = { display: "flex", flexDirection: "column" };

  const AutoTag = () => (
    <span style={{
      fontSize: 9, color: t.text3, fontWeight: 700,
      background: t.tableRowBorder, borderRadius: 4,
      padding: "1px 5px", marginLeft: "auto", flexShrink: 0,
    }}>AUTO</span>
  );

  return (
    <div style={{
      position: "fixed", inset: 0, background: "rgba(0,0,0,0.55)",
      display: "flex", alignItems: "center", justifyContent: "center", zIndex: 1000,
    }} onClick={onClose}>
      <div style={{
        background: t.modalBg, borderRadius: 18, width: 640,
        padding: "34px 40px 32px", boxShadow: "0 24px 70px rgba(0,0,0,0.42)",
        maxHeight: "90vh", overflowY: "auto",
      }} onClick={e => e.stopPropagation()}>

        {/* Header */}
        <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 24 }}>
          {requestType && (
            <span style={{
              width: 42, height: 42, borderRadius: 12,
              background: `${t.green}18`,
              display: "flex", alignItems: "center", justifyContent: "center",
              color: t.green, flexShrink: 0,
            }}>
              {requestType === "drugs" ? <DrugIcon /> : <SupplyIcon />}
            </span>
          )}
          <h2 style={{ fontSize: 24, fontWeight: 900, color: t.green, margin: 0 }}>
            {modalTitle}
          </h2>
        </div>

        {/* ── Input fields ── */}
        <div style={{ display: "flex", flexDirection: "column", gap: 12, marginBottom: 12 }}>

          {/* Name — SEARCHABLE DROPDOWN */}
          <div style={{ ...col, position: "relative" }}>
            <label style={lbl}>{nameLabel}</label>
            <div style={{ position: "relative" }}>
              <span style={{
                position: "absolute", left: 11, top: "50%", transform: "translateY(-50%)",
                color: t.text3, display: "flex", pointerEvents: "none",
              }}>
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/>
                </svg>
              </span>
              <input
                type="text"
                value={searchQuery}
                placeholder={`Search ${nameLabel.toLowerCase()}…`}
                onFocus={() => setSearchOpen(true)}
                onChange={e => {
                  setSearchQuery(e.target.value);
                  setSearchOpen(true);
                  // typing again clears a previous selection until they
                  // pick a new match — keeps selectedEntry truthful
                  if (selectedIdx !== "") setSelectedIdx("");
                }}
                onBlur={() => setTimeout(() => setSearchOpen(false), 120)}
                style={{ ...inp, paddingLeft: 32 }}
              />
              {searchQuery && (
                <button
                  type="button"
                  onMouseDown={e => e.preventDefault()}
                  onClick={() => { setSearchQuery(""); setSelectedIdx(""); setSearchOpen(true); }}
                  style={{
                    position: "absolute", right: 10, top: "50%", transform: "translateY(-50%)",
                    border: "none", background: "none", cursor: "pointer",
                    color: t.text3, display: "flex", padding: 0,
                  }}
                >
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>
                  </svg>
                </button>
              )}
            </div>

            {searchOpen && (
              <div style={{
                position: "absolute", top: "calc(100% + 4px)", left: 0, right: 0, zIndex: 50,
                background: t.modalBg, border: `1.5px solid ${t.green}`,
                borderRadius: 10, boxShadow: "0 14px 34px rgba(0,0,0,0.25)",
                maxHeight: 260, overflowY: "auto",
              }}>
                {filteredOptions.length === 0 ? (
                  <div style={{ padding: "14px 14px", fontSize: 12.5, color: t.text3, textAlign: "center" }}>
                    No matches found
                  </div>
                ) : (
                  filteredOptions.map(entry => (
                    <button
                      key={entry._idx}
                      type="button"
                      onMouseDown={() => selectEntry(entry._idx)}
                      style={{
                        width: "100%", textAlign: "left", border: "none",
                        background: selectedIdx === entry._idx ? `${t.green}14` : "transparent",
                        cursor: "pointer", padding: "9px 14px",
                        borderBottom: `1px solid ${t.border2}`,
                        display: "flex", flexDirection: "column", gap: 1,
                        fontFamily: "inherit",
                      }}
                      onMouseEnter={e => (e.currentTarget.style.background = `${t.green}14`)}
                      onMouseLeave={e => (e.currentTarget.style.background = selectedIdx === entry._idx ? `${t.green}14` : "transparent")}
                    >
                      <span style={{ fontSize: 13, fontWeight: 600, color: t.modalText }}>
                        {entry.med_name}
                      </span>
                      <span style={{ fontSize: 10.5, color: t.text3 }}>
                        {entry.med_dosage ? `${entry.med_dosage} · ` : ""}{entry.med_type} · {entry.unit}
                      </span>
                    </button>
                  ))
                )}
              </div>
            )}
          </div>

          {/* Dosage / Specification — LOCKED */}
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
            <div style={col}>
              <label style={lbl}>{dosageLabel}</label>
              <div style={locked}>
                <span style={{ flex: 1 }}>{selectedEntry?.med_dosage || "—"}</span>
                <AutoTag />
              </div>
            </div>

            {/* Type — LOCKED */}
            <div style={col}>
              <label style={lbl}>Type</label>
              <div style={locked}>
                <span style={{ flex: 1 }}>{selectedEntry?.med_type || "—"}</span>
                <AutoTag />
              </div>
            </div>
          </div>

          {/* Unit — LOCKED */}
          <div style={col}>
            <label style={lbl}>Unit</label>
            <div style={locked}>
              <span style={{ flex: 1 }}>{selectedEntry?.unit || "—"}</span>
              <AutoTag />
            </div>
          </div>

          {/* ── NEW: Pieces per Box */}
          {selectedIsBoxUnit && (
            <div style={col}>
              <label style={lbl}>Pieces per Box</label>
              <input
                type="number"
                min={1}
                value={piecesPerBox}
                onChange={e => {
                  const v = parseInt(e.target.value, 10);
                  setPiecesPerBox(isNaN(v) || v <= 0 ? 1 : v);
                }}
                style={inp}
              />
            </div>
          )}

          {/* Qty */}
          <div style={col}>
            <label style={lbl}>{selectedIsBoxUnit ? "Boxes to Request" : "Qty"}</label>
            <div style={{
              display: "flex", alignItems: "stretch",
              border: `1.5px solid ${t.inputBorder}`, borderRadius: 8,
              overflow: "hidden", background: t.modalBg, height: 36,
            }}>
              <span style={{
                flex: 1, display: "flex", alignItems: "center", justifyContent: "center",
                fontSize: 13, fontWeight: 700, color: t.modalText,
              }}>
                {qty}
              </span>
              <div style={{
                display: "flex", flexDirection: "column",
                borderLeft: `1px solid ${t.inputBorder}`, flexShrink: 0,
              }}>
                <button onClick={() => setQty(q => q + 1)} style={{
                  border: "none", background: "none", cursor: "pointer",
                  padding: "0 12px", fontSize: 9, color: t.text2,
                  flex: 1, lineHeight: 1, borderBottom: `1px solid ${t.inputBorder}`,
                }}>▲</button>
                <button onClick={() => setQty(q => Math.max(1, q - 1))} style={{
                  border: "none", background: "none", cursor: "pointer",
                  padding: "0 12px", fontSize: 9, color: t.text2,
                  flex: 1, lineHeight: 1,
                }}>▼</button>
              </div>
            </div>
            {selectedIsBoxUnit && (
              <span style={{ fontSize: 11, color: t.text3, marginTop: 4 }}>
                = {qty * piecesPerBox} pieces total ({qty} box{qty !== 1 ? "es" : ""} × {piecesPerBox}/box)
              </span>
            )}
          </div>
        </div>

        {/* Add to list */}
        <button
          onClick={addItem}
          disabled={!selectedEntry}
          style={{
            width: "100%", padding: "8px", borderRadius: 8,
            border: `1.5px dashed ${selectedEntry ? t.green : t.border2}`,
            background: "transparent",
            color: selectedEntry ? t.green : t.text3,
            fontSize: 13, fontWeight: 700,
            cursor: selectedEntry ? "pointer" : "not-allowed",
            fontFamily: "inherit", marginBottom: 14,
            opacity: selectedEntry ? 1 : 0.5,
          }}
        >
          + Add to list
        </button>

        {/* ── Items list ── */}
        <div style={{
          minHeight: 60, maxHeight: 200, overflowY: "auto", marginBottom: 22,
          borderRadius: 10, border: `1.5px solid ${t.border2}`, background: t.surface2,
        }}>
          {items.length === 0 ? (
            <div style={{ padding: "18px 16px", textAlign: "center", color: t.text3, fontSize: 13 }}>
              No items added yet
            </div>
          ) : (
            <>
              <div style={{
                display: "grid", gridTemplateColumns: "2fr 1fr 1fr 1fr 70px 28px",
                padding: "6px 14px", borderBottom: `1px solid ${t.border2}`,
                fontSize: 10, fontWeight: 800, color: t.text3,
                textTransform: "uppercase", letterSpacing: "0.06em",
              }}>
                <span>Name</span>
                <span>{isSupplyMode ? "Spec" : "Dosage"}</span>
                <span>Type</span><span>Unit</span><span>Qty</span><span />
              </div>
              {items.map((item, i) => (
                <div key={i} style={{
                  display: "grid", gridTemplateColumns: "2fr 1fr 1fr 1fr 70px 28px",
                  alignItems: "center", padding: "8px 14px",
                  borderBottom: i < items.length - 1 ? `1px solid ${t.border2}` : "none",
                  fontSize: 12.5,
                }}>
                  <span style={{ fontWeight: 600, color: t.modalText, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{item.medicine}</span>
                  <span style={{ color: t.text2 }}>{item.dosage || "—"}</span>
                  <span style={{ color: t.text2 }}>{item.type}</span>
                  <span style={{ color: t.text2 }}>{item.unit}</span>
                  <span style={{ color: t.modalText, fontWeight: 700 }}>
                    {item.isBoxUnit ? `${item.qty} box${item.qty !== 1 ? "es" : ""}` : item.qty}
                  </span>
                  <button onClick={() => removeItem(i)} style={{
                    border: "none", background: "none", cursor: "pointer",
                    color: "#d63031", fontSize: 16, lineHeight: 1, padding: 0,
                  }}>×</button>
                </div>
              ))}
            </>
          )}
        </div>

        {/* Action buttons */}
        <div style={{ display: "flex", gap: 14 }}>
          <button onClick={onClose} style={{
            flex: 1, padding: "11px 0", borderRadius: 8, border: "none",
            background: "#d63031", color: "#fff", fontSize: 14, fontWeight: 900,
            cursor: "pointer", fontFamily: "inherit", letterSpacing: "0.06em",
          }}>
            CANCEL
          </button>
          <button onClick={handleSendRequest} disabled={saving} style={{
            flex: 1, padding: "11px 0", borderRadius: 8,
            border: `2.5px solid ${t.green}`, background: "transparent",
            color: t.green, fontSize: 14, fontWeight: 900, cursor: "pointer",
            fontFamily: "inherit", letterSpacing: "0.06em",
            opacity: saving ? 0.6 : 1,
          }}>
            {saving ? "SENDING…" : "SEND REQUEST"}
          </button>
        </div>
      </div>
    </div>
  );
}