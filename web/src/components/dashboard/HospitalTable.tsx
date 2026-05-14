import {
  createColumnHelper,
  flexRender,
  getCoreRowModel,
  getFilteredRowModel,
  getPaginationRowModel,
  getSortedRowModel,
  type PaginationState,
  type SortingState,
  useReactTable,
} from '@tanstack/react-table';
import { ArrowDownRight, ArrowUpRight, Minus } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { buildHospitalMetricRows, type HospitalMetricRow, type TrendKind } from '@/lib/hospitalSeriesMetrics';
import { inferLowerIsBetter, valueChangeQuality, type ValueChangeQuality } from '@/lib/metricDirection';
import type { SeriesRow } from '@/types/metric';

type Row = HospitalMetricRow;

const columnHelper = createColumnHelper<Row>();

function TrendIcon({ trend, quality }: { trend: TrendKind; quality: ValueChangeQuality }) {
  const common = { className: 'h-4 w-4 shrink-0', 'aria-hidden': true as const };
  if (trend === 'flat') return <Minus {...common} style={{ color: 'var(--color-text-tertiary)' }} />;
  const color =
    quality === 'good'
      ? 'var(--color-accent-success)'
      : quality === 'bad'
        ? 'var(--color-accent-danger)'
        : 'var(--color-text-tertiary)';
  if (trend === 'up') return <ArrowUpRight {...common} style={{ color }} />;
  return <ArrowDownRight {...common} style={{ color }} />;
}

type Props = {
  rows: SeriesRow[];
  /** Glossary interpretation; used to color Net Δ / highest fluctuation (lower vs higher is better). */
  interpretation?: string;
};

function qualityColor(q: ValueChangeQuality): string {
  if (q === 'good') return 'var(--color-accent-success)';
  if (q === 'bad') return 'var(--color-accent-danger)';
  return 'var(--color-text-secondary)';
}

export function HospitalTable({ rows, interpretation = '' }: Props) {
  const [sorting, setSorting] = useState<SortingState>([{ id: 'name', desc: false }]);
  const [globalFilter, setGlobalFilter] = useState('');
  const [pagination, setPagination] = useState<PaginationState>({ pageIndex: 0, pageSize: 12 });
  const lowerIsBetter = useMemo(() => inferLowerIsBetter(interpretation), [interpretation]);

  const data = useMemo(() => buildHospitalMetricRows(rows), [rows]);

  useEffect(() => {
    setPagination((p) => ({ ...p, pageIndex: 0 }));
  }, [globalFilter, data.length]);

  const columns = useMemo(
    () => [
      columnHelper.accessor('name', {
        header: 'Facility / geography',
        cell: (info) => (
          <span style={{ color: 'var(--color-text-primary)' }}>{info.getValue()}</span>
        ),
      }),
      columnHelper.accessor('nYears', {
        header: 'Years',
        cell: (info) => (
          <span className="tabular-nums" style={{ color: 'var(--color-text-secondary)' }}>
            {info.getValue()}
          </span>
        ),
      }),
      columnHelper.accessor('mean', {
        header: 'Mean',
        cell: (info) => {
          const v = info.getValue();
          return (
            <span className="tabular-nums" style={{ color: 'var(--color-text-secondary)' }}>
              {v == null ? '—' : v.toFixed(3)}
            </span>
          );
        },
      }),
      columnHelper.accessor('netChange', {
        header: 'Net Δ',
        cell: (info) => {
          const v = info.getValue();
          if (v == null) return <span style={{ color: 'var(--color-text-tertiary)' }}>—</span>;
          const q = valueChangeQuality(v, lowerIsBetter);
          return (
            <span className="tabular-nums font-medium" style={{ color: qualityColor(q) }}>
              {v > 0 ? '+' : ''}
              {v.toFixed(3)}
            </span>
          );
        },
      }),
      columnHelper.accessor('upStepsLast5', {
        header: 'Up steps',
        cell: (info) => {
          const n = info.row.original.windowLen;
          return (
            <span className="tabular-nums text-xs" style={{ color: 'var(--color-text-tertiary)' }} title="Year-over-year increases within the last reporting years (max 5)">
              {info.getValue()} / {n}
            </span>
          );
        },
      }),
      columnHelper.accessor('lastYear', {
        header: 'Latest yr',
        cell: (info) => (
          <span style={{ color: 'var(--color-text-secondary)' }}>{info.getValue() ?? '—'}</span>
        ),
      }),
      columnHelper.accessor('lastValue', {
        header: 'Latest',
        cell: (info) => {
          const v = info.getValue();
          return (
            <span className="font-semibold tabular-nums" style={{ color: 'var(--color-text-primary)' }}>
              {v == null ? '—' : v.toFixed(3)}
            </span>
          );
        },
      }),
      columnHelper.accessor('maxFluctDelta', {
        id: 'maxFluct',
        header: 'Y Max Change',
        sortingFn: (rowA, rowB) => {
          const a = rowA.original.maxFluctDelta;
          const b = rowB.original.maxFluctDelta;
          if (a == null && b == null) return 0;
          if (a == null) return 1;
          if (b == null) return -1;
          return Math.abs(b) - Math.abs(a);
        },
        cell: (info) => {
          const v = info.getValue();
          const yr = info.row.original.maxFluctEndYear;
          const t = info.row.original.maxFluctTrend;
          if (v == null || yr == null) return <span style={{ color: 'var(--color-text-tertiary)' }}>—</span>;
          const q = valueChangeQuality(v, lowerIsBetter);
          return (
            <div className="flex items-center justify-end gap-1.5 tabular-nums">
              <TrendIcon trend={t} quality={q} />
              <span className="font-medium" style={{ color: qualityColor(q) }}>
                {v > 0 ? '+' : ''}
                {v.toFixed(3)}
              </span>
              <span className="text-xs" style={{ color: 'var(--color-text-tertiary)' }}>
                ({yr})
              </span>
            </div>
          );
        },
      }),
    ],
    [lowerIsBetter],
  );

  const table = useReactTable({
    data,
    columns,
    state: { sorting, globalFilter, pagination },
    onSortingChange: setSorting,
    onGlobalFilterChange: setGlobalFilter,
    onPaginationChange: setPagination,
    getCoreRowModel: getCoreRowModel(),
    getSortedRowModel: getSortedRowModel(),
    getFilteredRowModel: getFilteredRowModel(),
    getPaginationRowModel: getPaginationRowModel(),
    globalFilterFn: (row, _columnId, filterValue) => {
      const q = String(filterValue).trim().toLowerCase();
      if (!q) return true;
      const o = row.original;
      return (
        o.name.toLowerCase().includes(q) ||
        String(o.lastYear ?? '').includes(q) ||
        (o.lastValue != null && String(o.lastValue).includes(q)) ||
        (o.mean != null && String(o.mean).includes(q)) ||
        (o.maxFluctEndYear != null && String(o.maxFluctEndYear).includes(q)) ||
        (o.maxFluctDelta != null && String(o.maxFluctDelta).includes(q))
      );
    },
  });

  return (
    <div
      className="overflow-hidden rounded-2xl border"
      style={{
        borderColor: 'var(--color-border-strong)',
        background: 'var(--color-panel-solid)',
        boxShadow: 'var(--shadow-panel)',
      }}
    >
      <div
        className="flex flex-col gap-3 border-b px-4 py-3 sm:flex-row sm:flex-wrap sm:items-center sm:justify-between"
        style={{ borderColor: 'var(--color-border)' }}
      >
        <div>
          <h3 className="text-sm font-semibold" style={{ color: 'var(--color-text-primary)' }}>
            Comparison table
          </h3>
          <p className="text-[11px]" style={{ color: 'var(--color-text-tertiary)' }}>
            Net Δ = latest minus earliest year. Up steps = count of year-over-year increases in the last ≤5 points. Highest fluct. = the
            consecutive year-pair with the largest absolute change; arrow shows direction and the year in parentheses is the end of that
            step.
            {lowerIsBetter !== null
              ? ' Green/red on Net Δ and highest fluctuation follow this measure’s interpretation (lower vs higher is better).'
              : ' When interpretation does not state lower/higher is better, changes are shown without good/bad coloring.'}
          </p>
        </div>
        <label className="flex min-w-[200px] flex-1 items-center gap-2 sm:max-w-xs">
          <span className="sr-only">Filter table</span>
          <input
            type="search"
            value={globalFilter}
            onChange={(e) => setGlobalFilter(e.target.value)}
            placeholder="Filter by name…"
            className="w-full rounded-xl border px-3 py-2 text-sm outline-none"
            style={{
              borderColor: 'var(--color-border-strong)',
              background: 'var(--color-panel-alt)',
              color: 'var(--color-text-primary)',
            }}
          />
        </label>
        <label className="flex items-center gap-2 text-[11px]" style={{ color: 'var(--color-text-tertiary)' }}>
          <span className="whitespace-nowrap">Rows / page</span>
          <select
            className="rounded-lg border px-2 py-1 text-xs outline-none"
            style={{
              borderColor: 'var(--color-border-strong)',
              background: 'var(--color-panel-alt)',
              color: 'var(--color-text-primary)',
            }}
            value={pagination.pageSize}
            onChange={(e) => {
              const pageSize = Number(e.target.value);
              setPagination({ pageIndex: 0, pageSize });
            }}
          >
            {[8, 12, 25, 50, 100].map((n) => (
              <option key={n} value={n}>
                {n}
              </option>
            ))}
          </select>
        </label>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full min-w-[760px] border-collapse text-left text-sm">
          <thead>
            {table.getHeaderGroups().map((hg) => (
              <tr key={hg.id} style={{ background: 'var(--color-panel-alt)', borderBottom: '1px solid var(--color-border)' }}>
                {hg.headers.map((h) => (
                  <th
                    key={h.id}
                    className="cursor-pointer select-none px-4 py-2.5 font-medium transition-opacity hover:opacity-90"
                    style={{ color: 'var(--color-text-tertiary)' }}
                    onClick={h.column.getToggleSortingHandler()}
                  >
                    <span className="inline-flex items-center gap-1">
                      {flexRender(h.column.columnDef.header, h.getContext())}
                      {{
                        asc: ' ▲',
                        desc: ' ▼',
                      }[h.column.getIsSorted() as string] ?? null}
                    </span>
                  </th>
                ))}
              </tr>
            ))}
          </thead>
          <tbody>
            {table.getRowModel().rows.map((row, i) => (
              <tr
                key={row.id}
                style={{
                  borderBottom: '1px solid var(--color-border)',
                  background: i % 2 === 0 ? 'transparent' : 'var(--color-panel-alt)',
                }}
              >
                {row.getVisibleCells().map((cell) => (
                  <td key={cell.id} className="px-4 py-2.5">
                    {flexRender(cell.column.columnDef.cell, cell.getContext())}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div
        className="flex flex-wrap items-center justify-between gap-2 border-t px-4 py-2 text-xs"
        style={{ borderColor: 'var(--color-border)' }}
      >
        <span style={{ color: 'var(--color-text-tertiary)' }}>
          Page {table.getState().pagination.pageIndex + 1} of {table.getPageCount() || 1} ·{' '}
          {table.getFilteredRowModel().rows.length} row(s)
        </span>
        <div className="flex flex-wrap gap-1">
          <button
            type="button"
            className="rounded-lg border px-2 py-1 transition-opacity disabled:opacity-40"
            style={{ borderColor: 'var(--color-border-strong)', color: 'var(--color-text-secondary)' }}
            onClick={() => table.setPageIndex(0)}
            disabled={!table.getCanPreviousPage()}
          >
            First
          </button>
          <button
            type="button"
            className="rounded-lg border px-2 py-1 transition-opacity disabled:opacity-40"
            style={{ borderColor: 'var(--color-border-strong)', color: 'var(--color-text-secondary)' }}
            onClick={() => table.previousPage()}
            disabled={!table.getCanPreviousPage()}
          >
            Prev
          </button>
          <button
            type="button"
            className="rounded-lg border px-2 py-1 transition-opacity disabled:opacity-40"
            style={{ borderColor: 'var(--color-border-strong)', color: 'var(--color-text-secondary)' }}
            onClick={() => table.nextPage()}
            disabled={!table.getCanNextPage()}
          >
            Next
          </button>
          <button
            type="button"
            className="rounded-lg border px-2 py-1 transition-opacity disabled:opacity-40"
            style={{ borderColor: 'var(--color-border-strong)', color: 'var(--color-text-secondary)' }}
            onClick={() => table.setPageIndex(table.getPageCount() - 1)}
            disabled={!table.getCanNextPage()}
          >
            Last
          </button>
        </div>
      </div>
    </div>
  );
}
