// lib/diagnosisMapper.ts

export type CategoryCode = 'RESP' | 'CARDIO' | 'GI' | 'DENTAL' | 'DERM' | 'INFECT' | 'MUSCULO' | 'OTHERS';

const DIAGNOSIS_MAP: Record<string, CategoryCode> = {
  // ── RESPIRATORY ──────────────────────────────────────────
  "fever": "RESP", "influenza": "RESP", "flu": "RESP",
  "cough": "RESP", "colds": "RESP", "cold": "RESP",
  "pneumonia": "RESP", "asthma": "RESP", "bronchitis": "RESP",
  "tuberculosis": "RESP", "ptb": "RESP", "urti": "RESP",
  "upper respiratory tract infection": "RESP",
  "acute respiratory infection": "RESP", "ari": "RESP",
  "pharyngitis": "RESP", "tonsillitis": "RESP",
  "sinusitis": "RESP", "rhinitis": "RESP",
  "covid": "RESP", "covid-19": "RESP",

  // ── CARDIOVASCULAR ───────────────────────────────────────
  "hypertension": "CARDIO", "htn": "CARDIO",
  "heart disease": "CARDIO", "heart failure": "CARDIO",
  "coronary artery disease": "CARDIO", "cad": "CARDIO",
  "stroke": "CARDIO", "cerebrovascular disease": "CARDIO",
  "chest pain": "CARDIO", "palpitations": "CARDIO",
  "hyperlipidemia": "CARDIO", "hypercholesterolemia": "CARDIO",
  "atrial fibrillation": "CARDIO", "arrhythmia": "CARDIO",

  // ── GASTROINTESTINAL ──────────────────────────────────────
  "diarrhea": "GI", "gastroenteritis": "GI", "lbm": "GI",
  "vomiting": "GI", "nausea": "GI", "abdominal pain": "GI",
  "peptic ulcer": "GI", "gerd": "GI", "acid reflux": "GI",
  "typhoid": "GI", "typhoid fever": "GI",
  "cholera": "GI", "hepatitis": "GI", "hepatitis a": "GI",
  "hepatitis b": "GI", "hepatitis c": "GI",
  "constipation": "GI", "irritable bowel syndrome": "GI",
  "appendicitis": "GI",

  // ── DENTAL ────────────────────────────────────────────────
  "dental caries": "DENTAL", "caries": "DENTAL",
  "tooth decay": "DENTAL", "toothache": "DENTAL",
  "gingivitis": "DENTAL", "periodontitis": "DENTAL",
  "dental abscess": "DENTAL", "abscess": "DENTAL",
  "tooth extraction": "DENTAL", "oral thrush": "DENTAL",
  "dental": "DENTAL", "oral health": "DENTAL",
  "malocclusion": "DENTAL", "tooth pain": "DENTAL",

  // ── DERMATOLOGICAL ────────────────────────────────────────
  "skin rash": "DERM", "rash": "DERM",
  "dermatitis": "DERM", "eczema": "DERM",
  "psoriasis": "DERM", "acne": "DERM",
  "scabies": "DERM", "fungal infection": "DERM",
  "tinea": "DERM", "ringworm": "DERM",
  "urticaria": "DERM", "hives": "DERM",
  "wound": "DERM", "laceration": "DERM",
  "cellulitis": "DERM", "impetigo": "DERM",

  // ── INFECTIOUS / VECTOR-BORNE ─────────────────────────────
  "dengue": "INFECT", "dengue fever": "INFECT",
  "malaria": "INFECT", "leptospirosis": "INFECT",
  "rabies": "INFECT", "measles": "INFECT",
  "chicken pox": "INFECT", "chickenpox": "INFECT",
  "varicella": "INFECT", "mumps": "INFECT",
  "uti": "INFECT", "urinary tract infection": "INFECT",
  "sexually transmitted infection": "INFECT", "sti": "INFECT",
  "hiv": "INFECT", "aids": "INFECT",

  // ── MUSCULOSKELETAL ───────────────────────────────────────
  "arthritis": "MUSCULO", "rheumatoid arthritis": "MUSCULO",
  "osteoarthritis": "MUSCULO", "gout": "MUSCULO",
  "back pain": "MUSCULO", "low back pain": "MUSCULO",
  "neck pain": "MUSCULO", "joint pain": "MUSCULO",
  "muscle pain": "MUSCULO", "myalgia": "MUSCULO",
  "fracture": "MUSCULO", "sprain": "MUSCULO",
  "strain": "MUSCULO", "osteoporosis": "MUSCULO",
};

export function getCategoryCode(diagnosisName: string): CategoryCode {
  if (!diagnosisName) return 'OTHERS';
  const key = diagnosisName.toLowerCase().trim();

  // Exact match first
  if (DIAGNOSIS_MAP[key]) return DIAGNOSIS_MAP[key];

  // Partial match — checks if any keyword is contained in the diagnosis
  for (const [keyword, code] of Object.entries(DIAGNOSIS_MAP)) {
    if (key.includes(keyword) || keyword.includes(key)) return code;
  }

  return 'OTHERS';
}

export function getDiseaseCategoryName(code: CategoryCode): string {
  const map: Record<CategoryCode, string> = {
    RESP:    'Respiratory & Influenza-Like Illness',
    CARDIO:  'Cardiovascular Diseases',
    GI:      'Gastrointestinal & Water-borne',
    DENTAL:  'Dental & Oral Health',
    DERM:    'Dermatological & Skin',
    INFECT:  'Infectious & Vector-borne',
    MUSCULO: 'Musculoskeletal & Pain',
    OTHERS:  'Others',
  };
  return map[code] ?? 'Others';
}