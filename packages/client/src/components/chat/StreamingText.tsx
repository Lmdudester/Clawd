export function StreamingText({ text }: { text: string }) {
  if (!text) return null;
  return (
    <div className="flex justify-start mx-4 my-2">
      <div className="max-w-[85%] px-4 py-2.5 rounded-2xl rounded-bl-md bg-slate-800 border border-slate-700/50 text-sm text-slate-100 leading-relaxed">
        <span className="whitespace-pre-wrap">{text}</span>
        <span className="inline-block w-2 h-4 bg-blue-400 ml-0.5 animate-pulse" />
      </div>
    </div>
  );
}
