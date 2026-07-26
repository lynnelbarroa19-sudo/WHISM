export type Medicine = {
  id: string;
  med_name: string;
  med_dosage: string;
  med_type: string;
  exp_date: string;
  quantity: number;
  unit: string;
  archived: boolean;
  created_at: string;
  updated_at: string;
};

export type Prescription = {
  id: number;
  doctor: string;
  patient: string;
  medicine: string;
  dosage: string;
  type: string;
  qty: number;
  date: string;
  status: "pending" | "confirmed" | "cancelled";
};

export type RestockItem = {
  medicine: string;
  dosage: string;
  type: string;
  unit: string;
  qty: number;
};

export const MEDICINE_TYPES = [
  "Tablet", "Capsule", "Syrup", "Injectable", "Drops", "Ointment", "Powder",
];

export const SUPPLY_TYPES = [
  "Lab Supply", "Medical Form", "Medical Tape", "PPE", "Insecticide",
  "Bandage", "Gauze", "Gloves", "Syringe", "Cotton", "Alcohol",
  "Mask", "Dressing", "IV", "Catheter", "Equipment", "Other Supply",
];

export const UNITS = [
  "Pieces", "Bottles", "Boxes", "Vials", "Sachets", "Strips",
  "Rolls", "Packs", "Sets", "Pairs",
];

export const SAMPLE_PRESCRIPTIONS: Prescription[] = [
  { id: 1, doctor: "Dr. Santos",  patient: "Juan dela Cruz", medicine: "Amoxicillin", dosage: "500mg", type: "Capsule", qty: 10, date: "May 1, 2026", status: "pending" },
  { id: 2, doctor: "Dr. Reyes",   patient: "Maria Garcia",   medicine: "Paracetamol", dosage: "500mg", type: "Tablet",  qty: 20, date: "May 2, 2026", status: "pending" },
  { id: 3, doctor: "Dr. Mendoza", patient: "Pedro Bautista", medicine: "Ibuprofen",   dosage: "400mg", type: "Tablet",  qty: 15, date: "May 2, 2026", status: "confirmed" },
  { id: 4, doctor: "Dr. Santos",  patient: "Ana Reyes",      medicine: "Cetirizine",  dosage: "10mg",  type: "Tablet",  qty: 7,  date: "May 3, 2026", status: "pending" },
];