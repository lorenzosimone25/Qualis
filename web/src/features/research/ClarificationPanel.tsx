type Props = {
  questions: string[];
  reply: string;
  busy: boolean;
  onReplyChange: (v: string) => void;
  onSubmit: () => void;
  onPickChip: (text: string) => void;
  resolutionNotes?: string[];
};

export function ClarificationPanel({
  questions,
  reply,
  busy,
  onReplyChange,
  onSubmit,
  onPickChip,
  resolutionNotes,
}: Props) {  return (
    <div
      className="rounded-2xl border p-4 text-left md:p-5"
      style={{
        borderColor: 'var(--color-accent-warning)',
        background: 'linear-gradient(165deg, rgba(255, 180, 84, 0.08) 0%, var(--color-panel-solid) 100%)',
        backdropFilter: 'var(--glass-blur)',
        boxShadow: '0 0 0 1px rgba(255, 180, 84, 0.25), var(--shadow-panel)',
      }}
    >
      <p className="text-xs font-semibold tracking-wide" style={{ color: 'var(--color-text-primary)' }}>
        Clarification needed
      </p>
      <ul className="mt-2 list-inside list-disc space-y-1 text-sm" style={{ color: 'var(--color-text-secondary)' }}>
        {questions.map((q) => (
          <li key={q}>{q}</li>
        ))}
      </ul>
      {resolutionNotes && resolutionNotes.length > 0 ? (
        <div className="mt-3 rounded-lg border px-3 py-2 text-[11px]" style={{ borderColor: 'var(--color-border)', color: 'var(--color-text-tertiary)' }}>
          <p className="font-semibold" style={{ color: 'var(--color-text-secondary)' }}>
            Planner notes
          </p>
          <ul className="mt-1 list-inside list-disc space-y-0.5">
            {resolutionNotes.map((n) => (
              <li key={n}>{n}</li>
            ))}
          </ul>
        </div>
      ) : null}
      <p className="mt-3 text-[11px]" style={{ color: 'var(--color-text-tertiary)' }}>
        Pick a quick reply or type your own, then continue planning.
      </p>
      <div className="mt-2 flex flex-wrap gap-2">
        {questions.map((q) => (
          <button
            key={`chip-${q}`}
            type="button"
            className="rounded-full border px-3 py-1.5 text-xs font-medium transition-opacity hover:opacity-90"
            style={{
              borderColor: 'var(--color-border-strong)',
              color: 'var(--color-text-secondary)',
            }}
            onClick={() => onPickChip(q)}
          >
            Use: {q.length > 48 ? `${q.slice(0, 47)}…` : q}
          </button>
        ))}
      </div>
      <textarea
        value={reply}
        onChange={(e) => onReplyChange(e.target.value)}
        rows={3}
        placeholder="Short answer…"
        className="mt-3 w-full resize-y rounded-xl border px-3 py-2 text-sm outline-none"
        style={{
          borderColor: 'var(--color-border-strong)',
          background: 'var(--color-panel-alt)',
          color: 'var(--color-text-primary)',
        }}
      />
      <button
        type="button"
        disabled={busy || !reply.trim()}
        onClick={onSubmit}
        className="mt-3 rounded-full border px-5 py-2.5 text-sm font-semibold transition-opacity disabled:cursor-not-allowed disabled:opacity-40"
        style={{
          borderColor: 'var(--color-border-strong)',
          background: 'linear-gradient(135deg, var(--color-accent-blue), var(--color-accent-violet))',
          color: '#fff',
        }}
      >
        Continue planning
      </button>
    </div>
  );
}
