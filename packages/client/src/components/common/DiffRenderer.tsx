export function DiffRenderer({ diff }: { diff: string }) {
  const lines = diff.split('\n');

  return (
    <pre className="text-sm font-mono overflow-x-auto whitespace-pre-wrap">
      {lines.map((line, i) => {
        let className = 'text-slate-300';
        if (line.startsWith('+') && !line.startsWith('+++')) {
          className = 'text-green-400 bg-green-950/30';
        } else if (line.startsWith('-') && !line.startsWith('---')) {
          className = 'text-red-400 bg-red-950/30';
        } else if (line.startsWith('@@')) {
          className = 'text-cyan-400';
        } else if (line.startsWith('diff --git')) {
          className = 'text-yellow-300 font-bold';
        } else if (line.startsWith('---') || line.startsWith('+++')) {
          className = 'text-slate-400 font-bold';
        }
        return (
          <div key={i} className={className}>
            {line}
          </div>
        );
      })}
    </pre>
  );
}
