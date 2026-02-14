import ReactMarkdown from 'react-markdown';
import rehypeHighlight from 'rehype-highlight';
import { CodeBlock } from './CodeBlock';

export function MarkdownRenderer({ content }: { content: string }) {
  return (
    <ReactMarkdown
      rehypePlugins={[rehypeHighlight]}
      components={{
        code({ className, children, ...props }) {
          const match = /language-(\w+)/.exec(className || '');
          const isInline = !match;
          if (isInline) {
            return (
              <code className="bg-slate-700/50 px-1.5 py-0.5 rounded text-sm text-blue-300" {...props}>
                {children}
              </code>
            );
          }
          return <CodeBlock language={match![1]}>{String(children).replace(/\n$/, '')}</CodeBlock>;
        },
        p({ children }) {
          return <p className="mb-2 last:mb-0">{children}</p>;
        },
        ul({ children }) {
          return <ul className="list-disc list-inside mb-2 space-y-1">{children}</ul>;
        },
        ol({ children }) {
          return <ol className="list-decimal list-inside mb-2 space-y-1">{children}</ol>;
        },
        a({ href, children }) {
          return (
            <a href={href} className="text-blue-400 hover:underline" target="_blank" rel="noopener noreferrer">
              {children}
            </a>
          );
        },
        h1({ children }) { return <h1 className="text-xl font-bold mb-2">{children}</h1>; },
        h2({ children }) { return <h2 className="text-lg font-bold mb-2">{children}</h2>; },
        h3({ children }) { return <h3 className="text-base font-bold mb-1">{children}</h3>; },
        blockquote({ children }) {
          return <blockquote className="border-l-2 border-slate-600 pl-3 italic text-slate-400">{children}</blockquote>;
        },
      }}
    >
      {content}
    </ReactMarkdown>
  );
}
