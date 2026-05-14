import { US_STATE_NAMES } from '@/lib/usStateNames';

/**
 * Pointy-top axial hex tiling for US jurisdictions (50 states + DC).
 * Screen projection uses standard axial → pixel math (see https://www.redblobgames.com/grids/hexagons/).
 * Topology follows the NPR Apps “hex tile” / uniform-state cartogram idea
 * (https://blog.apps.npr.org/2015/05/11/hex-tile-maps.html): one tile per USPS code with approximate
 * geographic neighbors. `assertHexLayoutComplete()` enforces one unique (q,r) per key at import time.
 */
export const STATE_HEX_AXIAL: Record<string, { q: number; r: number }> = {  AK: { q: -7, r: 3 },
  HI: { q: -4, r: 9 },
  WA: { q: 0, r: 0 },
  OR: { q: 0, r: 1 },
  CA: { q: 0, r: 2 },
  NV: { q: 1, r: 2 },
  AZ: { q: 1, r: 3 },
  UT: { q: 2, r: 3 },
  CO: { q: 2, r: 4 },
  NM: { q: 2, r: 5 },
  TX: { q: 3, r: 6 },
  OK: { q: 3, r: 5 },
  KS: { q: 4, r: 5 },
  NE: { q: 4, r: 4 },
  SD: { q: 4, r: 3 },
  ND: { q: 4, r: 2 },
  MT: { q: 3, r: 1 },
  WY: { q: 3, r: 2 },
  ID: { q: 2, r: 1 },
  MN: { q: 5, r: 2 },
  IA: { q: 5, r: 3 },
  MO: { q: 5, r: 4 },
  AR: { q: 5, r: 5 },
  LA: { q: 5, r: 6 },
  WI: { q: 6, r: 2 },
  IL: { q: 6, r: 3 },
  MI: { q: 7, r: 2 },
  IN: { q: 6, r: 4 },
  OH: { q: 7, r: 3 },
  KY: { q: 6, r: 5 },
  TN: { q: 6, r: 6 },
  MS: { q: 6, r: 7 },
  AL: { q: 7, r: 7 },
  GA: { q: 8, r: 7 },
  FL: { q: 8, r: 8 },
  SC: { q: 8, r: 6 },
  NC: { q: 8, r: 5 },
  VA: { q: 8, r: 4 },
  WV: { q: 7, r: 4 },
  PA: { q: 8, r: 3 },
  NY: { q: 8, r: 2 },
  VT: { q: 9, r: 1 },
  NH: { q: 10, r: 1 },
  ME: { q: 11, r: 1 },
  MA: { q: 10, r: 2 },
  RI: { q: 11, r: 2 },
  CT: { q: 10, r: 3 },
  NJ: { q: 9, r: 3 },
  DE: { q: 9, r: 4 },
  MD: { q: 9, r: 5 },
  DC: { q: 9, r: 6 },
};

/** Pointy-top hex: center from axial (q, r). `size` = distance from center to vertex. */
export function axialToPixel(q: number, r: number, size: number): { x: number; y: number } {
  const x = size * Math.sqrt(3) * (q + r / 2);
  const y = size * (3 / 2) * r;
  return { x, y };
}

/** Six vertices for pointy-top hex centered at (cx, cy). */
export function hexPolygonPoints(cx: number, cy: number, radius: number): string {
  const pts: string[] = [];
  for (let i = 0; i < 6; i++) {
    const angleRad = ((60 * i - 30) * Math.PI) / 180;
    const x = cx + radius * Math.cos(angleRad);
    const y = cy + radius * Math.sin(angleRad);
    pts.push(`${x.toFixed(3)},${y.toFixed(3)}`);
  }
  return pts.join(' ');
}

export function getHexLayoutBounds(size: number): { minX: number; minY: number; maxX: number; maxY: number } {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const code of Object.keys(STATE_HEX_AXIAL)) {
    const { q, r } = STATE_HEX_AXIAL[code]!;
    const { x, y } = axialToPixel(q, r, size);
    minX = Math.min(minX, x - size);
    maxX = Math.max(maxX, x + size);
    minY = Math.min(minY, y - size);
    maxY = Math.max(maxY, y + size);
  }
  return { minX, minY, maxX, maxY };
}

/** Dev-only: ensure layout covers every USPS key exactly once with unique slots. */
export function assertHexLayoutComplete(): void {
  const keys = Object.keys(US_STATE_NAMES).sort();
  const seen = new Set<string>();
  for (const k of keys) {
    const ax = STATE_HEX_AXIAL[k];
    if (!ax) throw new Error(`STATE_HEX_AXIAL missing ${k}`);
    const sig = `${ax.q},${ax.r}`;
    if (seen.has(sig)) throw new Error(`Duplicate axial slot ${sig} for ${k}`);
    seen.add(sig);
  }
}

assertHexLayoutComplete();
