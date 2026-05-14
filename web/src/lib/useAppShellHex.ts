import { useEffect, useState } from 'react';

function parseCssColorToHex(input: string): string {
  const t = input.trim();
  if (t.startsWith('#')) {
    if (t.length === 4) {
      const r = t[1];
      const g = t[2];
      const b = t[3];
      return `#${r}${r}${g}${g}${b}${b}`;
    }
    return t.slice(0, 7);
  }
  const m = t.match(/rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)/i);
  if (m) {
    const r = Math.min(255, parseInt(m[1], 10));
    const g = Math.min(255, parseInt(m[2], 10));
    const b = Math.min(255, parseInt(m[3], 10));
    const to = (n: number) => n.toString(16).padStart(2, '0');
    return `#${to(r)}${to(g)}${to(b)}`;
  }
  return '#071426';
}

/** Hex for WebGL orb background blend — tracks `--color-app-shell`. */
export function useAppShellHex(): string {
  const [hex, setHex] = useState('#071426');

  useEffect(() => {
    const read = () => {
      const raw = getComputedStyle(document.documentElement).getPropertyValue('--color-app-shell').trim();
      setHex(parseCssColorToHex(raw || '#071426'));
    };
    read();
    const mo = new MutationObserver(read);
    mo.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });
    return () => mo.disconnect();
  }, []);

  return hex;
}
