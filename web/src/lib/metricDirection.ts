/**
 * Infer whether lower numeric values are better for a measure, from glossary
 * interpretation text (aligned with ``dashboard.rankings._lower_is_better``).
 */
export function inferLowerIsBetter(interpretation: string): boolean | null {
  const il = interpretation.trim().toLowerCase();
  if (!il) return null;
  if (il.includes('lower') && il.includes('better')) return true;
  if (il.includes('higher') && il.includes('better')) return false;
  return null;
}

export type ValueChangeQuality = 'good' | 'bad' | 'neutral';

const EPS = 1e-6;

/** Map a signed value change to good/bad for the patient given lower vs higher is better. */
export function valueChangeQuality(delta: number | null, lowerIsBetter: boolean | null): ValueChangeQuality {
  if (delta == null || Number.isNaN(delta)) return 'neutral';
  if (Math.abs(delta) <= EPS) return 'neutral';
  if (lowerIsBetter === null) return 'neutral';
  if (lowerIsBetter) {
    if (delta < -EPS) return 'good';
    if (delta > EPS) return 'bad';
    return 'neutral';
  }
  if (delta > EPS) return 'good';
  if (delta < -EPS) return 'bad';
  return 'neutral';
}
