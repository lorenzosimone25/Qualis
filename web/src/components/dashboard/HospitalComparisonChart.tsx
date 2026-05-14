import { useId } from 'react';
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Legend,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { ChartCard } from '@/components/cards/ChartCard';
import { seriesPaletteColor } from '@/lib/chartPalette';
import {
  capRowsForChart,
  latestPerSeries,
  maxDistinctYearsPerSeries,
  pivotForLine,
} from '@/lib/seriesTransforms';
import type { SeriesRow } from '@/types/metric';

const tooltipStyle = {
  background: 'var(--color-panel-solid)',
  border: '1px solid var(--color-border-strong)',
  borderRadius: 12,
  fontSize: 12,
  color: 'var(--color-text-primary)',
};

const DEFAULT_MAX = 8;

type Props = {
  rows: SeriesRow[];
  title?: string;
  maxSeries?: number;
};

export function HospitalComparisonChart({ rows, title = 'Measure trend', maxSeries = DEFAULT_MAX }: Props) {
  const gradId = `barGrad-${useId().replace(/:/g, '')}`;
  const capped = capRowsForChart(rows, maxSeries);
  const plotRows = capped.rows;
  const crossSectional = plotRows.length > 0 && maxDistinctYearsPerSeries(plotRows) <= 1;
  const latest = latestPerSeries(plotRows);

  if (!rows.length) {
    return (
      <ChartCard title={title}>
        <div
          className="flex h-72 items-center justify-center rounded-xl border text-sm"
          style={{ borderColor: 'var(--color-border)', color: 'var(--color-text-tertiary)' }}
        >
          No series rows — pick a measure and at least one hospital or state.
        </div>
      </ChartCard>
    );
  }

  const capFooter = capped.capped ? (
    <span style={{ color: 'var(--color-text-tertiary)' }}>
      Showing first {maxSeries} of {capped.totalSeries} series.
    </span>
  ) : undefined;

  if (crossSectional) {
    const barData = latest.map((r) => ({
      name: r.label.length > 42 ? `${r.label.slice(0, 40)}…` : r.label,
      value: r.value,
    }));

    return (
      <ChartCard
        title={title}
        footer={
          capFooter ?? (
            <span style={{ color: 'var(--color-text-tertiary)' }}>
              Single reporting period per series — cross-sectional snapshot.
            </span>
          )
        }
      >
        <div className="h-80 w-full">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={barData} layout="vertical" margin={{ top: 8, right: 12, left: 8, bottom: 8 }}>
              <defs>
                <linearGradient id={gradId} x1="0" y1="0" x2="1" y2="0">
                  <stop offset="0%" stopColor="var(--color-accent-blue)" stopOpacity={0.95} />
                  <stop offset="100%" stopColor="var(--color-accent-violet)" stopOpacity={0.85} />
                </linearGradient>
              </defs>
              <CartesianGrid stroke="var(--color-border-strong)" strokeDasharray="4 4" />
              <XAxis type="number" tick={{ fill: 'var(--color-text-tertiary)', fontSize: 11 }} axisLine={false} tickLine={false} />
              <YAxis
                type="category"
                dataKey="name"
                width={180}
                tick={{ fill: 'var(--color-text-secondary)', fontSize: 10 }}
                axisLine={false}
                tickLine={false}
              />
              <Tooltip contentStyle={tooltipStyle} />
              <Legend wrapperStyle={{ fontSize: 11, color: 'var(--color-text-secondary)' }} />
              <Bar dataKey="value" name="Value" radius={[0, 10, 10, 0]} isAnimationActive={false}>
                {barData.map((_, i) => (
                  <Cell key={`cell-${i}`} fill={`url(#${gradId})`} fillOpacity={1 - i * 0.04} />
                ))}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </div>
      </ChartCard>
    );
  }

  const { data, keys } = pivotForLine(plotRows);

  return (
    <ChartCard title={title} footer={capFooter}>
      <div className="h-80 w-full">
        <ResponsiveContainer width="100%" height="100%">
          <LineChart data={data} margin={{ top: 8, right: 12, left: 0, bottom: 8 }}>
            <CartesianGrid stroke="var(--color-border-strong)" strokeDasharray="4 4" />
            <XAxis dataKey="yearLabel" tick={{ fill: 'var(--color-text-tertiary)', fontSize: 11 }} axisLine={false} tickLine={false} />
            <YAxis tick={{ fill: 'var(--color-text-tertiary)', fontSize: 11 }} axisLine={false} tickLine={false} />
            <Tooltip contentStyle={tooltipStyle} labelStyle={{ color: 'var(--color-text-secondary)' }} />
            <Legend wrapperStyle={{ fontSize: 11, color: 'var(--color-text-secondary)' }} />
            {keys.map(({ key, label }, i) => (
              <Line
                key={key}
                type="monotone"
                dataKey={key}
                name={label}
                stroke={seriesPaletteColor(i)}
                strokeWidth={2}
                dot={false}
                isAnimationActive={false}
                connectNulls
              />
            ))}
          </LineChart>
        </ResponsiveContainer>
      </div>
    </ChartCard>
  );
}
