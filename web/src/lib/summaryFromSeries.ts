import { latestPerSeries } from '@/lib/seriesTransforms';
import type { SeriesRow } from '@/types/metric';

export type SummaryBullet = { text: string };

const EPS = 1e-9;

function avgLatestNonNational(rows: SeriesRow[]): number | null {
  const latest = latestPerSeries(rows);
  const nn = latest.filter((r) => r.entity_value !== '__NATIONAL__');
  if (!nn.length) return null;
  const sum = nn.reduce((a, r) => a + r.value, 0);
  return sum / nn.length;
}

export function buildSummaryFromSeries(
  rows: SeriesRow[],
  opts: { interpretation: string; hasNational: boolean },
): SummaryBullet[] {
  if (!rows.length) return [{ text: 'No series loaded yet.' }];

  const years = [...new Set(rows.map((r) => r.year))].sort((a, b) => a - b);
  const yMin = years[0]!;
  const yMax = years[years.length - 1]!;
  const latest = latestPerSeries(rows);
  const national = latest.find((r) => r.entity_value === '__NATIONAL__');

  const bullets: SummaryBullet[] = [
    {
      text: `You are looking at ${years.length} reporting year${years.length === 1 ? '' : 's'} (${yMin}${yMin !== yMax ? `–${yMax}` : ''}). ${latest.length} series (each facility, state, or national line) appear after rolling each series up to its latest year for cross-sectional comparisons in the table.`,
    },
  ];

  const avgLn = avgLatestNonNational(rows);
  if (avgLn != null) {
    bullets.push({
      text: `Across non-national entities, the simple average of latest-year values is ${avgLn.toFixed(3)}. This is a descriptive summary only—not a target or benchmark.`,
    });
  }

  const nonNat = latest.filter((r) => r.entity_value !== '__NATIONAL__');
  if (nonNat.length) {
    const vals = nonNat.map((r) => r.value);
    const minV = Math.min(...vals);
    const maxV = Math.max(...vals);
    const minRow = nonNat.find((r) => Math.abs(r.value - minV) < EPS);
    const maxRow = nonNat.find((r) => Math.abs(r.value - maxV) < EPS);
    if (minRow && maxRow && minRow.label !== maxRow.label) {
      bullets.push({
        text: `At the latest reporting year, the lowest observed value is ${minV.toFixed(3)} (${minRow.label}); the highest is ${maxV.toFixed(3)} (${maxRow.label}). The gap is ${(maxV - minV).toFixed(3)} on the same measure scale.`,
      });
    } else if (minRow) {
      bullets.push({ text: `At the latest reporting year, the value is ${minV.toFixed(3)} (${minRow.label}).` });
    }
  }

  if (national && nonNat.length) {
    const nv = national.value;
    const above = nonNat.filter((r) => r.value > nv + EPS).length;
    const below = nonNat.filter((r) => r.value < nv - EPS).length;
    const tie = nonNat.length - above - below;
    bullets.push({
      text: `National series (latest year ${nv.toFixed(3)}): among non-national entities, ${above} are strictly above, ${below} strictly below, and ${tie} approximately equal—counting only latest-year values.`,
    });
  }

  bullets.push({
    text: `Measure direction / meaning (from CMS glossary for this id): ${opts.interpretation || 'Context dependent'}. Use that when reading “higher vs lower” in the charts; we do not invert colors automatically.`,
  });

  if (!opts.hasNational) {
    bullets.push({
      text: 'National benchmark is not in this view (checkbox off, or no national series in the API for this measure).',
    });
  }

  bullets.push({
    text: 'These numbered items are template-generated from the same numbers that power the plots and table. They are not clinical recommendations; use them to verify exact figures alongside the optional narrative above.',
  });

  return bullets;
}
