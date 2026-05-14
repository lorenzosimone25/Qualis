"""Build the measure-id glossary used by the dashboard.

For every measure_id that appears anywhere in the harmonised pipeline output,
assemble:

    - ``meaning``: a short human-readable description.
        Layered from four sources, picking the most informative:
        1. **Curated override** — a small hand-tuned dictionary used only
           where the CMS-published text is too jargon-heavy to be useful in
           a tooltip (EDAC, HVBP variants, HAI SIRs). Wins ties.
        2. **Measure_Dates.csv ``Measure Name``** — CMS's canonical
           sentence-form name shipped with each year's data archive.
        3. **columnMetadata ``details``** — text extracted by the pipeline
           from the data-dictionary headers (`Hospital_Data_Dictionary.pdf`
           file column descriptions are surfaced here for many measures).
        4. **PDF mining** — phrases pulled from the ``data/<year>/*.pdf``
           data dictionaries (handles HVBP / HRRP / HAC variants that
           aren't in Measure_Dates.csv). See :mod:`dashboard.pdf_mining`.
    - ``intervals``: sorted list of unique ``interval_months`` values
        observed across all years for that measure.
    - ``interpretation``: "Higher is better", "Lower is better", or
        "Context dependent". See note below.

**Interpretation column — clinical heuristic, not parsed from PDFs.**
We verified the local CMS data dictionaries do not contain machine-readable
direction-of-better text (zero hits across all years for phrases like
"higher percentages are better"). Direction-of-better is published by CMS
in measure-specification methodology manuals (separate documents, on
cms.gov), and by AHRQ for the PSI family. We encode that clinical /
methodological knowledge as a rule table below
(:data:`_INTERPRETATION_RULES`) — every rule is documented and individual
measure ids are easy to override.

The result is a single :class:`pandas.DataFrame` with one row per
measure_id, suitable for the dashboard's glossary table and for tooltip
lookups in the chart callbacks.
"""

from __future__ import annotations

import re
from dataclasses import dataclass
from functools import lru_cache
from pathlib import Path

import pandas as pd

from .data import PROCESSED, PROJECT_ROOT, get_store
from .pdf_mining import load_or_build as load_pdf_mapping

DATA_ROOT = PROJECT_ROOT / "data"


# ---------------------------------------------------------------------------
# Curated explanations for the most common measure families.
#
# Format: regex pattern -> explanation. Patterns are matched in order; the
# first match wins. Use to override or amplify the CMS-published name when it
# would be opaque to a non-specialist user (e.g. "EDAC_30_AMI" -> "Excess
# days in acute care").
# ---------------------------------------------------------------------------
_CURATED_OVERRIDES: list[tuple[re.Pattern, str]] = [
    # --- Mortality (30-day risk-standardised) ---
    (re.compile(r"^MORT_30_AMI$"),
     "30-day risk-standardised mortality rate after acute myocardial infarction (heart attack) admission"),
    (re.compile(r"^MORT_30_HF$"),
     "30-day risk-standardised mortality rate after heart failure admission"),
    (re.compile(r"^MORT_30_PN$"),
     "30-day risk-standardised mortality rate after pneumonia admission"),
    (re.compile(r"^MORT_30_COPD$"),
     "30-day risk-standardised mortality rate after COPD admission"),
    (re.compile(r"^MORT_30_STK$"),
     "30-day risk-standardised mortality rate after ischemic stroke admission"),
    (re.compile(r"^MORT_30_CABG$"),
     "30-day risk-standardised mortality rate after isolated coronary artery bypass graft (CABG) surgery"),
    (re.compile(r"^MORT_(\d+)_HWR$"),
     "Hospital-wide risk-standardised mortality rate (all-cause)"),
    (re.compile(r"^PSI_4_SURG_COMP$"),
     "PSI 04: Death rate among surgical inpatients with serious treatable complications (failure-to-rescue)"),

    # --- Readmission (30-day risk-standardised) ---
    (re.compile(r"^READM_30_AMI$"),
     "30-day risk-standardised readmission rate after AMI admission"),
    (re.compile(r"^READM_30_HF$"),
     "30-day risk-standardised readmission rate after heart failure admission"),
    (re.compile(r"^READM_30_PN$"),
     "30-day risk-standardised readmission rate after pneumonia admission"),
    (re.compile(r"^READM_30_COPD$"),
     "30-day risk-standardised readmission rate after COPD admission"),
    (re.compile(r"^READM_30_STK$"),
     "30-day risk-standardised readmission rate after ischemic stroke admission"),
    (re.compile(r"^READM_30_HIP_KNEE$"),
     "30-day risk-standardised readmission rate after elective hip / knee replacement"),
    (re.compile(r"^READM_30_CABG$"),
     "30-day risk-standardised readmission rate after isolated CABG surgery"),
    (re.compile(r"^READM_30_HOSP_WIDE$"),
     "Hospital-wide all-cause unplanned 30-day readmission rate"),

    # --- HRRP excess readmission ratios ---
    (re.compile(r"^EXCESS_READM_(\w+)$|.*_HRRP_ERR$"),
     "HRRP Excess Readmission Ratio (ERR): ratio of predicted to expected unplanned 30-day readmissions; >1.0 = worse than expected, <1.0 = better."),
    (re.compile(r".*_HRRP_EXP_RATE$"),
     "HRRP expected 30-day readmission rate (model-predicted, given the hospital's case mix)."),
    (re.compile(r".*_HRRP_PRED_RATE$"),
     "HRRP predicted 30-day readmission rate (hospital-specific risk-adjusted prediction)."),
    (re.compile(r".*_HRRP_N_READM$"),
     "HRRP unplanned 30-day readmission count (numerator)."),
    (re.compile(r".*_HRRP$"),
     "Hospital Readmissions Reduction Program output for this condition; lower / closer to 1.0 is better."),

    # --- EDAC ---
    (re.compile(r"^EDAC_30_AMI$"),
     "Excess days in acute care after AMI: observed minus expected days in hospital, ED, or observation in the 30 days post-discharge. Negative = fewer extra days (better)."),
    (re.compile(r"^EDAC_30_HF$"),
     "Excess days in acute care after heart failure: observed minus expected days. Negative is better."),
    (re.compile(r"^EDAC_30_PN$"),
     "Excess days in acute care after pneumonia: observed minus expected days. Negative is better."),

    # --- HAI SIRs ---
    (re.compile(r"^HAI_1(_SIR)?$"),
     "Central line-associated bloodstream infection (CLABSI) Standardised Infection Ratio. <1.0 is better."),
    (re.compile(r"^HAI_2(_SIR)?$"),
     "Catheter-associated urinary tract infection (CAUTI) Standardised Infection Ratio. <1.0 is better."),
    (re.compile(r"^HAI_3(_SIR)?$"),
     "Surgical site infection from colon surgery (SSI-Colon) Standardised Infection Ratio. <1.0 is better."),
    (re.compile(r"^HAI_4(_SIR)?$"),
     "Surgical site infection from abdominal hysterectomy (SSI-Hysterectomy) Standardised Infection Ratio. <1.0 is better."),
    (re.compile(r"^HAI_5(_SIR)?$"),
     "MRSA bacteremia Standardised Infection Ratio. <1.0 is better."),
    (re.compile(r"^HAI_6(_SIR)?$"),
     "Clostridioides difficile (C. diff) infection Standardised Infection Ratio. <1.0 is better."),
    (re.compile(r"^CAUTI_SIR$"),
     "Catheter-associated UTI (CAUTI) Standardised Infection Ratio. <1.0 is better."),
    (re.compile(r"^CLABSI_SIR$"),
     "Central line-associated bloodstream infection (CLABSI) Standardised Infection Ratio. <1.0 is better."),
    (re.compile(r"^MRSA_SIR$"),
     "MRSA bacteremia Standardised Infection Ratio. <1.0 is better."),
    (re.compile(r"^CDIFF_SIR$"),
     "Clostridioides difficile (C. diff) infection Standardised Infection Ratio. <1.0 is better."),

    # --- PSI ---
    (re.compile(r"^PSI_90$"),
     "AHRQ Patient Safety and Adverse Events Composite (PSI-90); risk-adjusted weighted average of 10 component indicators. <1.0 is better."),
    (re.compile(r"^PSI_03$"),
     "PSI-03: Pressure ulcer rate per 1,000 admissions. Lower is better."),
    (re.compile(r"^PSI_06$"),
     "PSI-06: Iatrogenic pneumothorax rate per 1,000 admissions. Lower is better."),
    (re.compile(r"^PSI_08$"),
     "PSI-08: In-hospital fall with hip fracture rate per 1,000 admissions. Lower is better."),
    (re.compile(r"^PSI_09$"),
     "PSI-09: Postoperative hemorrhage / hematoma rate per 1,000 admissions. Lower is better."),
    (re.compile(r"^PSI_10$"),
     "PSI-10: Postoperative acute kidney injury rate per 1,000 admissions. Lower is better."),
    (re.compile(r"^PSI_11$"),
     "PSI-11: Postoperative respiratory failure rate per 1,000 admissions. Lower is better."),
    (re.compile(r"^PSI_12$"),
     "PSI-12: Perioperative pulmonary embolism / DVT rate per 1,000 admissions. Lower is better."),
    (re.compile(r"^PSI_13$"),
     "PSI-13: Postoperative sepsis rate per 1,000 admissions. Lower is better."),
    (re.compile(r"^PSI_14$"),
     "PSI-14: Postoperative wound dehiscence rate per 1,000 admissions. Lower is better."),
    (re.compile(r"^PSI_15$"),
     "PSI-15: Accidental puncture or laceration rate per 1,000 admissions. Lower is better."),

    # --- COMP / hip-knee / complication composites ---
    (re.compile(r"^COMP_HIP_KNEE$"),
     "Risk-standardised complication rate following elective primary total hip and/or total knee arthroplasty"),

    # --- Spending ---
    (re.compile(r"^MSPB_1$"),
     "Medicare Spending Per Beneficiary (MSPB-1): price-standardised, risk-adjusted ratio of hospital spending to national average. <1.0 is below national."),

    # --- Imaging efficiency ---
    (re.compile(r"^OP_8$"),
     "MRI Lumbar Spine for Low Back Pain — % of outpatients who got an MRI without trying conservative therapy first. Lower is better."),
    (re.compile(r"^OP_10$"),
     "Abdomen CT — % of outpatient studies done with both contrast and non-contrast (often unnecessary). Lower is better."),
    (re.compile(r"^OP_13$"),
     "Cardiac imaging for low-risk preoperative patients undergoing low-risk surgery. Lower is better."),
    (re.compile(r"^OP_22$"),
     "Patients who left the ED without being seen. Lower is better."),
    (re.compile(r"^OP_23$"),
     "Stroke patients who got a head CT or MRI within 45 minutes of ED arrival. Higher is better."),

    # --- Timely & effective care ---
    (re.compile(r"^IMM_3$"),
     "Healthcare workers given influenza vaccination. Higher is better."),
    (re.compile(r"^SEP_1$"),
     "Severe sepsis and septic shock — 3- and 6-hour bundle compliance. Higher is better."),

    # --- HCAHPS top / middle / bottom box ---
    (re.compile(r"^H_COMP_1_A_P$"), "HCAHPS: Nurses always communicated well (top-box %). Higher is better."),
    (re.compile(r"^H_COMP_1_U_P$"), "HCAHPS: Nurses usually communicated well (middle-box %)."),
    (re.compile(r"^H_COMP_1_SN_P$"), "HCAHPS: Nurses sometimes / never communicated well (bottom-box %). Lower is better."),
    (re.compile(r"^H_COMP_2_A_P$"), "HCAHPS: Doctors always communicated well (top-box %). Higher is better."),
    (re.compile(r"^H_COMP_2_U_P$"), "HCAHPS: Doctors usually communicated well (middle-box %)."),
    (re.compile(r"^H_COMP_2_SN_P$"), "HCAHPS: Doctors sometimes / never communicated well (bottom-box %). Lower is better."),
    (re.compile(r"^H_COMP_3_A_P$"), "HCAHPS: Patients always received help as soon as wanted (top-box %). Higher is better."),
    (re.compile(r"^H_COMP_3_U_P$"), "HCAHPS: Patients usually received help as soon as wanted."),
    (re.compile(r"^H_COMP_3_SN_P$"), "HCAHPS: Patients sometimes / never received help as soon as wanted. Lower is better."),
    (re.compile(r"^H_COMP_5_A_P$"), "HCAHPS: Staff always explained medicines clearly (top-box %). Higher is better."),
    (re.compile(r"^H_COMP_5_SN_P$"), "HCAHPS: Staff sometimes / never explained medicines clearly. Lower is better."),
    (re.compile(r"^H_CLEAN_HSP_A_P$"), "HCAHPS: Room and bathroom always clean (top-box %). Higher is better."),
    (re.compile(r"^H_QUIET_HSP_A_P$"), "HCAHPS: Area around room always quiet at night (top-box %). Higher is better."),
    (re.compile(r"^H_HSP_RATING_9_10$"), "HCAHPS: Patients who rated the hospital 9 or 10 (top-box %). Higher is better."),
    (re.compile(r"^H_RECMND_DY$"), "HCAHPS: Patients who would definitely recommend the hospital. Higher is better."),

    # --- HVBP / HAC payment programs ---
    (re.compile(r"^.*_Achievement_Points$"),
     "HVBP achievement points awarded for this measure (0-10). Higher is better."),
    (re.compile(r"^.*_Improvement_Points$"),
     "HVBP improvement points awarded for this measure (0-10). Higher is better."),
    (re.compile(r"^.*_Performance_Rate$"),
     "Hospital's measured performance rate during the HVBP performance period."),
    (re.compile(r"^.*_Achievement_Threshold$"),
     "HVBP achievement threshold (50th percentile of national performance during baseline)."),
    (re.compile(r"^.*_Benchmark$"),
     "HVBP benchmark value (mean of top decile of national performance during baseline)."),
    (re.compile(r"^.*_Floor$"),
     "HVBP performance floor (worst-of-the-nation cutoff during baseline)."),
    (re.compile(r"^.*_HVBP_Baseline$"),
     "Measure value during the HVBP baseline period (used to compute improvement points)."),
    (re.compile(r"^.*_HVBP_Performance$"),
     "Measure value during the HVBP performance period (used to compute achievement points)."),
    (re.compile(r"^.*_W_Z_Score$"),
     "Winsorised Z-score for HAC Reduction Program."),

    # --- Volumes (catch-all) ---
    (re.compile(r"^(?P<base>.+)_VOLUME$"),
     "Number of patients / cases that contributed to the base measure (the denominator)."),

    # --- ASC outpatient ---
    (re.compile(r"^ASC_1$"),
     "ASC-1: Patient burn during ASC visit (per 1,000). Lower is better."),
    (re.compile(r"^ASC_2$"),
     "ASC-2: Patient fall during ASC visit (per 1,000). Lower is better."),
    (re.compile(r"^ASC_3$"),
     "ASC-3: Wrong site, wrong side, wrong patient, wrong procedure, wrong implant (per 1,000). Lower is better."),
    (re.compile(r"^ASC_4$"),
     "ASC-4: All-cause hospital transfer / admission within 1 day of an ASC visit (per 1,000). Lower is better."),
    (re.compile(r"^ASC_9$"),
     "ASC-9: Appropriate follow-up colonoscopy interval. Higher is better."),
    (re.compile(r"^ASC_11$"),
     "ASC-11: Improvement in visual function within 90 days of cataract surgery. Higher is better."),
    (re.compile(r"^ASC_12$"),
     "ASC-12: Unplanned hospital visit within 7 days of an ASC procedure. Lower is better."),
    (re.compile(r"^ASC_13$"),
     "ASC-13: Normothermia maintained perioperatively for outpatient surgery. Higher is better."),

    # --- Hospital structural / general ---
    (re.compile(r"^GENINFO_HOSPITAL_OVERALL_RATING$"),
     "CMS Hospital Compare overall star rating (1 = lowest, 5 = highest)."),
    (re.compile(r"^Hospital_Overall_Rating$"),
     "CMS Hospital Compare overall star rating (1 = lowest, 5 = highest)."),
    (re.compile(r"^GENINFO_Count_of_(.+)_Measures_Better$"),
     "Hospital General Information: count of this hospital's measures performing better than national for the noted family."),
    (re.compile(r"^GENINFO_Count_of_(.+)_Measures_Worse$"),
     "Hospital General Information: count of this hospital's measures performing worse than national for the noted family."),
    (re.compile(r"^GENINFO_Count_of_(.+)_Measures_No_Different$"),
     "Hospital General Information: count of this hospital's measures statistically no different from national for the noted family."),
    (re.compile(r"^GENINFO_Count_of_Facility_(.+)_Measures$"),
     "Hospital General Information: number of measures the facility reports for this group."),
    (re.compile(r"^GENINFO_(.+)_Group_Measure_Count$"),
     "Hospital General Information: number of measures used to compute this group's star rating."),
    (re.compile(r"^GENINFO_(.+)$"),
     "Hospital General Information field extracted from `Hospital_General_Information.csv`."),

    # --- IPFQR (Inpatient Psychiatric Facility Quality Reporting) ---
    (re.compile(r"^IPFQR_FAPH_30$"),
     "Follow-up After Psychiatric Hospitalization (FAPH-30): % of patients with a follow-up mental-health visit within 30 days of discharge. Higher is better."),
    (re.compile(r"^IPFQR_FAPH_7$"),
     "Follow-up After Psychiatric Hospitalization (FAPH-7): % of patients with a follow-up mental-health visit within 7 days of discharge. Higher is better."),
    (re.compile(r"^IPFQR_FUH_30$"),
     "Follow-up After Hospitalization for Mental Illness (FUH-30): % within 30 days of discharge. Higher is better."),
    (re.compile(r"^IPFQR_FUH_7$"),
     "Follow-up After Hospitalization for Mental Illness (FUH-7): % within 7 days of discharge. Higher is better."),
    (re.compile(r"^IPFQR_HBIPS_.+"),
     "Hospital-Based Inpatient Psychiatric Services (HBIPS) measure component (e.g. seclusion / restraint hours)."),
    (re.compile(r"^IPFQR_SUB_.+"),
     "Substance use disorder treatment IPFQR component (screening / brief intervention / referral)."),
    (re.compile(r"^IPFQR_TOB_.+"),
     "Tobacco use treatment IPFQR component (screening / treatment offered / treatment provided)."),
    (re.compile(r"^IPFQR_IMM_.+"),
     "Inpatient psychiatric immunisation measure component."),
    (re.compile(r"^IPFQR_EHR$"),
     "IPFQR Electronic Health Record submission flag."),
    (re.compile(r"^IPFQR_READM_30_IPF$"),
     "READM-30-IPF: % of inpatient psychiatric discharges readmitted to any hospital within 30 days. Lower is better."),
    (re.compile(r"^IPFQR_.+_TOP10$"),
     "IPFQR ‘Top 10%’: 90th-percentile facility value among reporting IPFs (a benchmark, not the typical IPF)."),
    (re.compile(r"^IPFQR_.+"),
     "Inpatient Psychiatric Facility Quality Reporting (IPFQR) measure component."),

    # --- Maternal Health (PC = Perinatal Care) ---
    (re.compile(r"^PC_01$"),
     "PC-01: % of mothers with a non-medically-indicated early elective delivery (1-2 weeks early). Lower is better."),
    (re.compile(r"^PC_01_NINETIETH$"),
     "PC-01 ‘Top 10%’: 90th-percentile facility value for early elective delivery (a benchmark)."),

    # --- OAS CAHPS (wide-format 2021-2024 OQR + ASCQR all years) ---
    # The descriptions below mirror the source column headers and the
    # interpretation hints map onto _INTERPRETATION_RULES below.
    (re.compile(r"^(OQR|ASCQR)_OAS_FACILITY_CLEAN_DEFINITELY$"),
     "OAS CAHPS: % of patients reporting staff DEFINITELY gave care professionally and the facility was clean (top-box). Higher is better."),
    (re.compile(r"^(OQR|ASCQR)_OAS_FACILITY_CLEAN_SOMEWHAT$"),
     "OAS CAHPS: % of patients reporting staff SOMEWHAT gave care professionally / facility was somewhat clean (middle-box)."),
    (re.compile(r"^(OQR|ASCQR)_OAS_FACILITY_CLEAN_NOT$"),
     "OAS CAHPS: % of patients reporting staff did NOT give care professionally or facility was not clean (bottom-box). Lower is better."),
    (re.compile(r"^(OQR|ASCQR)_OAS_FACILITY_CLEAN_LINEAR$"),
     "OAS CAHPS: facilities-and-staff linear mean score (case-mix adjusted, scaled). Higher is better."),
    (re.compile(r"^(OQR|ASCQR)_OAS_COMM_DEFINITELY$"),
     "OAS CAHPS: % reporting staff DEFINITELY communicated about what to expect during/after the procedure (top-box). Higher is better."),
    (re.compile(r"^(OQR|ASCQR)_OAS_COMM_SOMEWHAT$"),
     "OAS CAHPS: % reporting staff SOMEWHAT communicated about the procedure (middle-box)."),
    (re.compile(r"^(OQR|ASCQR)_OAS_COMM_NOT$"),
     "OAS CAHPS: % reporting staff did NOT communicate about the procedure (bottom-box). Lower is better."),
    (re.compile(r"^(OQR|ASCQR)_OAS_COMM_LINEAR$"),
     "OAS CAHPS: communication-about-your-procedure linear mean score. Higher is better."),
    (re.compile(r"^(OQR|ASCQR)_OAS_RATING_9_10$"),
     "OAS CAHPS: % of patients giving the facility a rating of 9 or 10 (top-box on the 0-10 scale). Higher is better."),
    (re.compile(r"^(OQR|ASCQR)_OAS_RATING_7_8$"),
     "OAS CAHPS: % of patients giving the facility a rating of 7 or 8 (middle-box on the 0-10 scale)."),
    (re.compile(r"^(OQR|ASCQR)_OAS_RATING_0_6$"),
     "OAS CAHPS: % of patients giving the facility a rating of 0-6 (bottom-box on the 0-10 scale). Lower is better."),
    (re.compile(r"^(OQR|ASCQR)_OAS_RATING_LINEAR$"),
     "OAS CAHPS: patient-rating-of-the-facility linear mean score. Higher is better."),
    (re.compile(r"^(OQR|ASCQR)_OAS_RECMND_YES_DEFINITELY$"),
     "OAS CAHPS: % of patients who would DEFINITELY recommend the facility to family or friends. Higher is better."),
    (re.compile(r"^(OQR|ASCQR)_OAS_RECMND_YES_PROBABLY$"),
     "OAS CAHPS: % of patients who would PROBABLY recommend the facility (middle-box)."),
    (re.compile(r"^(OQR|ASCQR)_OAS_RECMND_NO$"),
     "OAS CAHPS: % of patients who would NOT recommend the facility. Lower is better."),
    (re.compile(r"^(OQR|ASCQR)_OAS_RECMND_LINEAR$"),
     "OAS CAHPS: patients-recommending-the-facility linear mean score. Higher is better."),
    (re.compile(r"^(OQR|ASCQR)_OAS_NUM_SAMPLED_VOLUME$"),
     "OAS CAHPS: number of patients sampled for the survey (volume)."),
    (re.compile(r"^(OQR|ASCQR)_OAS_NUM_COMPLETED_VOLUME$"),
     "OAS CAHPS: number of completed surveys (volume)."),
    (re.compile(r"^(OQR|ASCQR)_OAS_RESPONSE_RATE$"),
     "OAS CAHPS: survey response rate (% of sampled patients who completed)."),
    # OAS CAHPS 2025+ canonical (long-format) ids — short-letter-coded.
    (re.compile(r"^O_PATIENT_RATE_9_10(_S)?$"),
     "OAS CAHPS: % of patients rating the facility 9 or 10 (top-box). Higher is better."),
    (re.compile(r"^O_PATIENT_RATE_7_8(_S)?$"),
     "OAS CAHPS: % of patients rating the facility 7 or 8 (middle-box)."),
    (re.compile(r"^O_PATIENT_RATE_0_6(_S)?$"),
     "OAS CAHPS: % of patients rating the facility 0-6 (bottom-box). Lower is better."),

    # --- Aggregate ASC summary statistics (wide ASC_*National / State files) ---
    # Avg / Median ASC-N is the across-facility distribution of the rate.
    (re.compile(r"^ASC_\d+_AVG_NAT$"),
     "ASC measure: arithmetic mean of facility-level ASC-N values across the national cohort."),
    (re.compile(r"^ASC_\d+_AVG_STATE$"),
     "ASC measure: arithmetic mean of facility-level ASC-N values within the state."),
    (re.compile(r"^ASC_\d+_MEDIAN_NAT$"),
     "ASC measure: median facility-level ASC-N value across the national cohort."),
    (re.compile(r"^ASC_\d+_MEDIAN_STATE$"),
     "ASC measure: median facility-level ASC-N value within the state."),
]


# ---------------------------------------------------------------------------
# Interpretation rules — first match wins.
# Each entry is (predicate, label). predicate is callable measure_id -> bool.
# ---------------------------------------------------------------------------
def _starts_or_contains(*needles: str):
    def _f(m: str) -> bool:
        return any(n in m for n in needles)
    return _f


def _equals(*values: str):
    s = set(values)
    return lambda m: m in s


def _suffix(*sfx: str):
    return lambda m: any(m.endswith(x) for x in sfx)


def _prefix(*pfx: str):
    return lambda m: any(m.startswith(x) for x in pfx)


# Order matters: most-specific first.
_INTERPRETATION_RULES: list[tuple[callable, str]] = [
    # Volumes — neutral.
    (_suffix("_VOLUME"), "Context dependent (count / volume)"),

    # Achievement / improvement points & higher-better HVBP outputs.
    (_suffix("_Achievement_Points", "_Improvement_Points", "_Performance_Points",
             "_Domain_Score", "_Total_Performance_Score", "_Weighted_Score"),
     "Higher is better"),
    (_suffix("_HVBP_Baseline", "_HVBP_Performance",
             "_Performance_Rate", "_Baseline_Rate"),
     "Context dependent (raw value; interpretation depends on parent measure)"),
    (_suffix("_Achievement_Threshold", "_Benchmark", "_Floor"),
     "Reference value (not a hospital outcome)"),

    # HAC W-Z scores: higher = worse (penalty cohort).
    (_suffix("_W_Z_Score"), "Lower is better (higher Z = worse)"),

    # HRRP / readmission ratios: lower / closer to 1.0 is better.
    (_starts_or_contains("_HRRP_ERR"), "Lower is better (>1.0 = worse than expected)"),
    (_suffix("_HRRP"), "Lower is better"),

    # SIR family: <1.0 is better.
    (_suffix("_SIR"), "Lower is better (<1.0 = better than national reference)"),
    (lambda m: re.fullmatch(r"HAI_\d+(_SIR)?", m) is not None,
     "Lower is better (<1.0 = better than national reference)"),

    # Mortality, readmission, complications, EDAC, MSPB.
    (_prefix("MORT_", "READM_", "EDAC_", "COMP_", "PSI_"),
     "Lower is better"),
    (_starts_or_contains("MSPB_"), "Context dependent (1.0 = at national average; <1.0 = below)"),

    # Imaging efficiency — most are "less is more".
    (_equals("OP_8", "OP_10", "OP_11", "OP_13", "OP_14", "OP_22"),
     "Lower is better"),
    (_equals("OP_3b", "OP_18b", "OP_18c", "OP_23", "OP_29", "OP_30",
             "OP_31", "OP_33", "OP_36"),
     "Higher is better"),

    # HCAHPS top-box (always / 9-10 / definitely yes).
    (_suffix("_A_P"), "Higher is better"),
    (_equals("H_HSP_RATING_9_10", "H_RECMND_DY"), "Higher is better"),

    # HCAHPS middle-box.
    (_suffix("_U_P"), "Context dependent (middle-box; usually responses)"),
    (_equals("H_HSP_RATING_7_8", "H_RECMND_PY"),
     "Context dependent (middle-box)"),

    # HCAHPS bottom-box.
    (_suffix("_SN_P"), "Lower is better (sometimes/never responses)"),
    (_equals("H_HSP_RATING_0_6", "H_RECMND_DN"),
     "Lower is better (negative responses)"),

    # Linear mean / star ratings.
    (_suffix("_LINEAR_SCORE"), "Higher is better"),
    (_suffix("_STAR_RATING"), "Higher is better"),
    (_equals("Hospital_Overall_Rating", "GENINFO_HOSPITAL_OVERALL_RATING"),
     "Higher is better"),

    # Immunisation.
    (_equals("IMM_2", "IMM_3", "IMM_3_OP_27_FAC_ADHPCT"),
     "Higher is better"),

    # Sepsis.
    (_equals("SEP_1", "SEP_SH_3HR", "SEP_SH_6HR", "SEP_SV_3HR", "SEP_SV_6HR"),
     "Higher is better"),

    # ASC compliance vs. adverse events (higher is better).
    (_equals("ASC_9", "ASC_11", "ASC_13", "ASC_14", "ASC_15a", "ASC_15b",
             "ASC_15c", "ASC_15d", "ASC_15e", "ASC_17"),
     "Higher is better"),
    # ASC distribution summaries: interpretation matches the parent ASC_<N>.
    # MUST go before the bare _prefix("ASC_1", ...) rule below, otherwise
    # ``ASC_11_AVG_NAT`` would be classified as Lower-is-better just
    # because it starts with ``ASC_1``.
    (lambda m: bool(re.match(r"^ASC_(9|11|13|14|15[a-e]?|17)_(AVG|MEDIAN)_(NAT|STATE)$", m)),
     "Higher is better"),
    (lambda m: bool(re.match(r"^ASC_(1|2|3|4|5|6|7|8|12)_(AVG|MEDIAN)_(NAT|STATE)$", m)),
     "Lower is better"),
    # ASC adverse events (lower is better).
    (_prefix("ASC_1", "ASC_2", "ASC_3", "ASC_4", "ASC_5", "ASC_6", "ASC_7",
             "ASC_8", "ASC_12"),
     "Lower is better"),

    # OAS CAHPS top-box / linear mean scores — higher is better.
    (lambda m: bool(re.match(
        r"^(OQR|ASCQR)_OAS_(FACILITY_CLEAN|COMM)_DEFINITELY$", m))
        or bool(re.match(r"^(OQR|ASCQR)_OAS_RATING_9_10$", m))
        or bool(re.match(r"^(OQR|ASCQR)_OAS_RECMND_YES_DEFINITELY$", m))
        or bool(re.match(r"^(OQR|ASCQR)_OAS_(.+)_LINEAR$", m)),
     "Higher is better"),
    # OAS CAHPS bottom-box — lower is better.
    (lambda m: bool(re.match(r"^(OQR|ASCQR)_OAS_(FACILITY_CLEAN|COMM)_NOT$", m))
        or bool(re.match(r"^(OQR|ASCQR)_OAS_RATING_0_6$", m))
        or bool(re.match(r"^(OQR|ASCQR)_OAS_RECMND_NO$", m)),
     "Lower is better"),
    # OAS CAHPS middle-box / volumes / response rate — neutral.
    (lambda m: bool(re.match(r"^(OQR|ASCQR)_OAS_", m)),
     "Context dependent (middle-box, volume, or response rate)"),

    # IPFQR rate-shaped components — most are higher-better compliance
    # measures; the HBIPS hours-of-restraint / seclusion are exceptions.
    (_prefix("IPFQR_HBIPS_2", "IPFQR_HBIPS_3"),
     "Lower is better (hours-of-restraint / seclusion per 1,000)"),
    (_equals("IPFQR_READM_30_IPF"), "Lower is better"),
    (lambda m: bool(re.match(r"^IPFQR_.+_TOP10$", m)),
     "Reference value (90th-percentile benchmark, not a hospital outcome)"),

    # CMS payments — neutral.
    (_starts_or_contains("PAYM_", "Payment_"),
     "Context dependent (dollar amount)"),

    # Maternal Health (PC_*) — early-elective-delivery rates: lower is better.
    # The CMS measure name itself states "Lower percentages are better".
    (_prefix("PC_"), "Lower is better"),

    # Anything else — neutral default.
]


def _interpret(measure_id: str) -> str:
    for predicate, label in _INTERPRETATION_RULES:
        try:
            if predicate(measure_id):
                return label
        except Exception:
            continue
    return "Context dependent"


def _normalise(measure_id: str) -> str:
    """Use the same canonicaliser as the pipeline so glossary keys join cleanly."""
    s = re.sub(r"[^A-Za-z0-9]+", "_", str(measure_id)).strip("_")
    return s


def _load_measure_dates() -> pd.DataFrame:
    """Concat every Measure_Dates.csv shipped with the raw data archives."""
    paths = sorted(DATA_ROOT.glob("20*_HOSPITALS_*/Measure_Dates.csv"))
    frames: list[pd.DataFrame] = []
    for p in paths:
        try:
            df = pd.read_csv(p, dtype=str)
        except Exception:
            continue
        if "Measure ID" not in df.columns or "Measure Name" not in df.columns:
            continue
        df["_year"] = int(p.parent.name[:4])
        frames.append(df[["Measure ID", "Measure Name", "_year"]])
    if not frames:
        return pd.DataFrame(columns=["Measure ID", "Measure Name", "_year"])
    out = pd.concat(frames, ignore_index=True)
    out["measure_id"] = out["Measure ID"].map(_normalise)
    out = out[(out["measure_id"] != "") & out["Measure Name"].notna()]
    out = out.sort_values("_year")  # so .last("year") picks newest
    return out


def _curated_text(measure_id: str) -> str | None:
    for pattern, text in _CURATED_OVERRIDES:
        if pattern.fullmatch(measure_id):
            return text
        if pattern.search(measure_id) and pattern.pattern.startswith("^") is False:
            return text
    return None


@dataclass
class GlossaryEntry:
    measure_id: str
    meaning: str
    intervals: list[int]
    interpretation: str
    is_volume: bool


def _format_intervals(values: pd.Series) -> list[int]:
    if values is None or len(values) == 0:
        return []
    nums = pd.to_numeric(values, errors="coerce").dropna().astype(int).unique()
    return sorted(int(x) for x in nums if x > 0)


def _best_phrase(*candidates: str | None) -> str:
    """Pick the most informative phrase from a set of candidates.

    Rules:
      - Drop empty / NaN / mid-only candidates.
      - Prefer the longest distinct phrase, with a small bonus for
        candidates that don't simply echo the measure id.
      - Tiebreak on the order they were passed (so curated overrides
        earlier in the call win ties).
    """
    cleaned: list[str] = []
    seen: set[str] = set()
    for c in candidates:
        if c is None:
            continue
        try:
            if isinstance(c, float) and pd.isna(c):
                continue
        except Exception:
            pass
        s = str(c).strip()
        if not s:
            continue
        norm = s.lower()
        if norm in seen:
            continue
        seen.add(norm)
        cleaned.append(s)
    if not cleaned:
        return ""
    return cleaned[0] if len(cleaned) == 1 else max(
        enumerate(cleaned),
        key=lambda kv: (
            min(len(kv[1]), 200),     # longer is better up to 200
            -kv[0],                   # earlier-supplied wins ties (curated first)
        ),
    )[1]


@lru_cache(maxsize=1)
def build_glossary() -> pd.DataFrame:
    """Build the full per-measure glossary table, cached."""
    store = get_store()

    md = _load_measure_dates()
    name_lookup = (
        md.groupby("measure_id")["Measure Name"].last().to_dict()
        if not md.empty else {}
    )

    # PDF-mined descriptions (cached on disk, see :mod:`dashboard.pdf_mining`).
    try:
        pdf_lookup = load_pdf_mapping()
    except Exception:
        pdf_lookup = {}

    # Concatenate every level's columnMetadata for the details corpus and intervals.
    col_meta = pd.concat(
        [store.column_meta_hospital, store.column_meta_state, store.column_meta_national],
        ignore_index=True,
    )
    if "measure_id" in col_meta.columns:
        col_meta["measure_id"] = col_meta["measure_id"].astype(str)
    else:
        col_meta = pd.DataFrame(columns=["measure_id", "interval_months", "details"])

    # Pre-compute longest details per measure once for speed.
    details_by_id: dict[str, str] = {}
    if "details" in col_meta.columns:
        for mid_, grp in col_meta.groupby("measure_id"):
            details_vals = [d for d in grp["details"].dropna().astype(str).tolist() if d.strip()]
            if details_vals:
                # Pick the longest distinct value.
                details_by_id[mid_] = max(details_vals, key=len)

    # Intervals — one groupby pass instead of scanning col_meta per measure.
    intervals_by_id: dict[str, list[int]] = {}
    if "interval_months" in col_meta.columns:
        for mid_, grp in col_meta.groupby("measure_id"):
            intervals_by_id[str(mid_)] = _format_intervals(grp["interval_months"])

    rows: list[dict] = []
    for mid in store.measure_ids:
        is_vol = mid.endswith("_VOLUME")

        ivals = intervals_by_id.get(mid, [])

        # Layer the four meaning sources. Order matters for ties; earlier wins.
        curated = _curated_text(mid)
        cms_name = name_lookup.get(mid)
        details = details_by_id.get(mid)
        pdf_phrase = pdf_lookup.get(mid)

        text = _best_phrase(curated, cms_name, details, pdf_phrase)

        # Special-case volumes: if no source matched, fabricate from the parent.
        if not text and is_vol:
            base = mid[:-len("_VOLUME")]
            base_text = _best_phrase(
                _curated_text(base),
                name_lookup.get(base),
                details_by_id.get(base),
                pdf_lookup.get(base),
            )
            text = (
                f"Volume for: {base_text}"
                if base_text
                else "Volume (denominator count) for the parent measure"
            )
        if not text:
            text = mid  # last-resort echo

        # Tidy footnote markers and stray spacing.
        text = re.sub(r"\s*\*+\s*$", "", str(text)).strip()

        rows.append(
            {
                "measure_id": mid,
                "meaning": text,
                "intervals": ivals,
                "interpretation": _interpret(mid),
                "is_volume": is_vol,
                "_sources": ",".join(
                    s for s, v in [
                        ("curated", curated),
                        ("measure_dates", cms_name),
                        ("column_metadata", details),
                        ("pdf_dictionary", pdf_phrase),
                    ] if v
                ),
            }
        )

    df = pd.DataFrame(rows)
    return df


def lookup_meaning(measure_id: str) -> str:
    """Return the meaning text for a single measure_id (fast path for tooltips)."""
    if not measure_id:
        return ""
    df = build_glossary()
    sub = df.loc[df["measure_id"] == measure_id, "meaning"]
    return sub.iloc[0] if len(sub) else measure_id


def lookup_interpretation(measure_id: str) -> str:
    if not measure_id:
        return ""
    df = build_glossary()
    sub = df.loc[df["measure_id"] == measure_id, "interpretation"]
    return sub.iloc[0] if len(sub) else "Context dependent"


def lookup_intervals(measure_id: str) -> list[int]:
    if not measure_id:
        return []
    df = build_glossary()
    sub = df.loc[df["measure_id"] == measure_id, "intervals"]
    return list(sub.iloc[0]) if len(sub) else []


__all__ = [
    "GlossaryEntry",
    "build_glossary",
    "lookup_meaning",
    "lookup_interpretation",
    "lookup_intervals",
]
