export function StreamingText({ text }: { text: string }) {
  if (!text) return null;
  return (
    <div className="flex justify-start mx-4 my-2">
      <div className="px-4 py-3 rounded-2xl rounded-bl-md bg-slate-800 border border-slate-700/50 flex items-center gap-1">
        <span className="w-2 h-2 bg-blue-400 rounded-full animate-[bounce_1.4s_ease-in-out_infinite]" />
        <span className="w-2 h-2 bg-blue-400 rounded-full animate-[bounce_1.4s_ease-in-out_0.2s_infinite]" />
        <span className="w-2 h-2 bg-blue-400 rounded-full animate-[bounce_1.4s_ease-in-out_0.4s_infinite]" />
      </div>
    </div>
  );
}
