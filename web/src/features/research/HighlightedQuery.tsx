import { useMemo } from 'react';
import type { HighlightSpan } from '@/services/researchApi';

type Props = {
  text: string;
  spans: HighlightSpan[];
};

/** Keyword emphasis from server-provided spans (no client LLM). */
export function HighlightedQuery({ text, spans }: Props) {
  const terms = useMemo(() => {
    const seen = new Set<string>();
    const out: HighlightSpan[] = [];
    for (const sp of spans) {
      const t = sp.term.trim();
      if (t.length < 2 || seen.has(t.toLowerCase())) continue;
      seen.add(t.toLowerCase());
      out.push({ ...sp, term: t });
    }
    return out.sort((a, b) => b.term.length - a.term.length);
  }, [spans]);

  const segments = useMemo(() => {
    if (!text) return [] as { text: string; role?: HighlightSpan['role'] }[];
    let remaining = text;
    const parts: { text: string; role?: HighlightSpan['role'] }[] = [];
    while (remaining.length) {
      let idx = -1;
      let hit: HighlightSpan | null = null;
      for (const sp of terms) {
        const i = remaining.toLowerCase().indexOf(sp.term.toLowerCase());
        if (i >= 0 && (idx < 0 || i < idx)) {
          idx = i;
          hit = sp;
        }
      }
      if (idx < 0 || !hit) {
        parts.push({ text: remaining });
        break;
      }
      if (idx > 0) parts.push({ text: remaining.slice(0, idx) });
      parts.push({ text: remaining.slice(idx, idx + hit.term.length), role: hit.role });
      remaining = remaining.slice(idx + hit.term.length);
    }
    return parts;
  }, [text, terms]);

  return (
    <p className="text-lg font-semibold leading-snug md:text-xl" style={{ color: 'var(--color-text-primary)' }}>
      {segments.map((p, i) =>
        p.role ? (
          <mark
            key={i}
            className="rounded px-0.5"
            style={{
              background: 'var(--color-panel-alt)',
              color: 'var(--color-accent-cyan)',
              boxDecorationBreak: 'clone',
            }}
          >
            {p.text}
          </mark>
        ) : (
          <span key={i}>{p.text}</span>
        ),
      )}
    </p>
  );
}
