import { Building2 } from 'lucide-react';
import { useCallback, useMemo, useState } from 'react';
import type { PointerEvent as ReactPointerEvent } from 'react';
import { US_STATE_NAMES } from '@/lib/usStateNames';
import {
  axialToPixel,
  getHexLayoutBounds,
  hexPolygonPoints,
  STATE_HEX_AXIAL,
} from '@/lib/usStateHexLayout';

const HEX_SIZE = 15;
const VIEW_PAD = HEX_SIZE * 1.35;

export type StateHoneyCombMapProps = {
  counts: Record<string, number>;
  selectedState: string;
  onSelectState: (code: string) => void;
  className?: string;
  loading?: boolean;
};

/** Compact US honeycomb heatmap (hospital counts); theme tokens + floating tooltip. */
export function StateHoneyCombMap({
  counts,
  selectedState,
  onSelectState,
  className,
  loading,
}: StateHoneyCombMapProps) {
  const sel = selectedState.trim().toUpperCase().slice(0, 2);

  const [hoverCode, setHoverCode] = useState<string | null>(null);
  const [tip, setTip] = useState<{ x: number; y: number; visible: boolean }>({
    x: 0,
    y: 0,
    visible: false,
  });

  const { minX, minY, maxX, maxY } = useMemo(() => getHexLayoutBounds(HEX_SIZE), []);
  const pad = VIEW_PAD;
  const vbW = maxX - minX + pad * 2;
  const vbH = maxY - minY + pad * 2;

  const norm = useMemo(() => {
    const vals = Object.keys(US_STATE_NAMES).map((k) => counts[k] ?? 0);
    const hi = Math.max(...vals, 1);
    const lo = Math.min(...vals);
    const span = hi - lo;
    return { hi, lo, span: span <= 0 ? 1 : span };
  }, [counts]);

  const fillFor = useCallback(
    (count: number) => {
      if (count <= 0) {
        return 'color-mix(in srgb, var(--color-map-base) 26%, var(--color-panel-solid))';
      }
      const u = Math.min(1, Math.max(0, (count - norm.lo) / norm.span));
      return `color-mix(in srgb, var(--color-map-selected) ${Math.round(u * 100)}%, var(--color-map-cell))`;
    },
    [norm.lo, norm.span],
  );

  const codes = useMemo(() => Object.keys(STATE_HEX_AXIAL).sort(), []);

  const onEnter = useCallback(
    (code: string) => (e: ReactPointerEvent<SVGPolygonElement>) => {
      setHoverCode(code);
      setTip({ x: e.clientX, y: e.clientY, visible: true });
    },
    [],
  );

  const onMove = useCallback((e: ReactPointerEvent<SVGPolygonElement>) => {
    setTip((t0) => (t0.visible ? { x: e.clientX, y: e.clientY, visible: true } : t0));
  }, []);

  const onLeave = useCallback(() => {
    setHoverCode(null);
    setTip((t0) => ({ ...t0, visible: false }));
  }, []);

  const tipCount = hoverCode ? (counts[hoverCode] ?? 0) : 0;
  const tipName = hoverCode ? (US_STATE_NAMES[hoverCode] ?? hoverCode) : '';

  return (
    <div className={`relative min-w-0 w-full ${className ?? ''}`}>
      <div
        className="mx-auto w-full max-h-[min(280px,32vh)] overflow-hidden rounded-lg"
        style={{
          background: 'transparent',
        }}
      >
        {loading ? (
          <div
            className="flex min-h-[180px] items-center justify-center text-sm"
            style={{ color: 'var(--color-text-tertiary)' }}
          >
            Loading map…
          </div>
        ) : (
          <svg
            viewBox={`${minX - pad} ${minY - pad} ${vbW} ${vbH}`}
            className="h-auto w-full max-h-[min(280px,32vh)]"
            preserveAspectRatio="xMidYMid meet"
            role="img"
            aria-label="US states honeycomb; pale map blue when no hospitals, deeper blues when more hospitals in the dataset"
          >
            <title>US hospital count by state — sequential blue map scale</title>
            {codes.map((code) => {
              const ax = STATE_HEX_AXIAL[code];
              if (!ax) return null;
              const { x, y } = axialToPixel(ax.q, ax.r, HEX_SIZE);
              const count = counts[code] ?? 0;
              const fill = fillFor(count);
              const isSel = code === sel;
              const isHover = code === hoverCode;
              const strokeUnsel = 'color-mix(in srgb, var(--color-border-strong) 48%, transparent)';
              const stroke = isSel
                ? 'var(--color-map-selected)'
                : isHover
                  ? 'color-mix(in srgb, var(--color-map-selected) 55%, var(--color-border-strong))'
                  : strokeUnsel;
              const strokeW = isSel ? 2.5 : isHover ? 1.5 : 0.75;
              const pts = hexPolygonPoints(x, y, HEX_SIZE * 0.92);
              return (
                <polygon
                  key={code}
                  points={pts}
                  fill={fill}
                  stroke={stroke}
                  strokeWidth={strokeW}
                  strokeLinejoin="round"
                  className="cursor-pointer transition-[stroke,filter,transform] duration-150 hover:brightness-[1.04]"
                  style={{
                    filter: isSel
                      ? 'drop-shadow(0 0 0 1px color-mix(in srgb, var(--color-map-selected) 50%, transparent)) drop-shadow(0 0 8px color-mix(in srgb, var(--color-map-glow) 65%, transparent))'
                      : undefined,
                  }}
                  onPointerEnter={onEnter(code)}
                  onPointerMove={onMove}
                  onPointerLeave={onLeave}
                  onPointerDown={(e) => {
                    e.preventDefault();
                    onSelectState(code);
                  }}
                />
              );
            })}
          </svg>
        )}
      </div>

      {tip.visible && hoverCode ? (
        <div
          className="pointer-events-none fixed z-[100] flex max-w-[min(18rem,calc(100vw-2rem))] gap-3 rounded-2xl border px-4 py-3 text-left shadow-xl"
          style={{
            left: tip.x + 16,
            top: tip.y + 16,
            background: 'var(--color-panel-solid)',
            borderColor: 'var(--color-border-strong)',
            boxShadow: 'var(--shadow-panel)',
          }}
        >
          <div
            className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl"
            style={{
              background:
                'linear-gradient(145deg, var(--color-map-cell), color-mix(in srgb, var(--color-map-selected) 72%, var(--color-map-cell)))',
              boxShadow: '0 4px 14px var(--color-map-glow)',
            }}
          >
            <Building2 className="h-5 w-5 text-white" aria-hidden />
          </div>
          <div className="min-w-0">
            <p className="text-[10px] font-semibold uppercase tracking-wider" style={{ color: 'var(--color-text-tertiary)' }}>
              {hoverCode}
            </p>
            <p className="truncate text-sm font-bold leading-tight" style={{ color: 'var(--color-text-primary)' }}>
              {tipName}
            </p>
            <p className="mt-1 font-mono text-lg font-semibold tabular-nums leading-none" style={{ color: 'var(--color-map-selected)' }}>
              {tipCount.toLocaleString()}
            </p>
            <p className="mt-0.5 text-[10px]" style={{ color: 'var(--color-text-tertiary)' }}>
              hospitals in dataset
            </p>
          </div>
        </div>
      ) : null}
    </div>
  );
}
