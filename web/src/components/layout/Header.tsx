type HeaderProps = {
  title?: string;
  subtitle?: string;
};

export function Header({
  title = 'CMS Quality Pulse',
  subtitle = 'GPT-style query bar below — ranked metrics & hospitals from processed CMS artifacts',
}: HeaderProps) {
  return (
    <header className="flex flex-wrap items-center justify-between gap-4 border-b border-cyan-500/15 bg-navy-900/40 px-6 py-4 backdrop-blur-md">
      <div className="text-left">
        <h1 className="font-sans text-xl font-semibold tracking-tight text-slate-50 md:text-2xl">{title}</h1>
        <p className="mt-1 max-w-xl text-sm text-slate-400">{subtitle}</p>
      </div>
    </header>
  );
}
