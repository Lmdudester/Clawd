import { useState, memo } from 'react';
import type { SessionMessage } from '@clawd/shared';
import { getToolConfig, getToolSummary, isErrorResult, isUnifiedDiff, getLanguageFromPath, str } from '../../lib/toolFormatters';
import { computeLineDiff } from '../../lib/diffUtils';
import { ToolIcon } from './ToolIcon';
import { DiffRenderer } from '../common/DiffRenderer';

interface Props {
  message: SessionMessage;
  result?: SessionMessage;
}

export const ToolCallCard = memo(function ToolCallCard({ message, result }: Props) {
  const [expanded, setExpanded] = useState(false);
  const config = getToolConfig(message.toolName);
  const summary = getToolSummary(message.toolName, message.toolInput);
  const hasError = result ? isErrorResult(result.content) : false;

  return (
    <div className="mx-4 my-1">
      <div
        className={`border-l-[3px] ${config.borderClass} ${config.bgClass} border border-slate-700/50 rounded-r-lg overflow-hidden`}
      >
        {/* Header — always visible */}
        <button
          onClick={() => setExpanded(!expanded)}
          className="w-full flex items-center gap-2 px-3 py-2 hover:bg-white/5 transition-colors text-left min-w-0"
        >
          <ToolIcon
            toolName={message.toolName ?? ''}
            className={`w-4 h-4 ${config.labelClass} shrink-0`}
          />
          <span className={`text-xs font-semibold ${config.labelClass} shrink-0`}>
            {config.label}
          </span>
          {summary && (
            <span className="text-sm text-slate-200 truncate min-w-0">{summary}</span>
          )}
          {result && !expanded && (
            <span
              className={`ml-auto text-xs shrink-0 ${hasError ? 'text-red-400' : 'text-emerald-400'}`}
            >
              {hasError ? 'failed' : 'done'}
            </span>
          )}
          <svg
            className={`w-3.5 h-3.5 text-slate-500 shrink-0 transition-transform ${expanded ? 'rotate-90' : ''}`}
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
            strokeWidth={2}
          >
            <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
          </svg>
        </button>

        {/* Expanded content */}
        {expanded && (
          <div className="border-t border-slate-700/30">
            <ToolDetail toolName={message.toolName} toolInput={message.toolInput} />
            {result && (
              <ToolResultInline content={result.content} toolName={message.toolName} />
            )}
          </div>
        )}
      </div>
    </div>
  );
});

// --- Tool-specific detail rendering ---

function ToolDetail({
  toolName,
  toolInput,
}: {
  toolName?: string;
  toolInput?: Record<string, unknown>;
}) {
  if (!toolInput || !toolName) return null;
  const inp = toolInput as Record<string, any>;

  switch (toolName) {
    case 'Bash':
      return <BashDetail input={inp} />;
    case 'Read':
      return <ReadDetail input={inp} />;
    case 'Edit':
      return <EditDetail input={inp} />;
    case 'Write':
      return <WriteDetail input={inp} />;
    case 'Grep':
      return <GrepDetail input={inp} />;
    case 'Glob':
      return <GlobDetail input={inp} />;
    case 'Task':
      return <TaskDetail input={inp} />;
    case 'WebFetch':
      return <WebFetchDetail input={inp} />;
    case 'WebSearch':
      return <WebSearchDetail input={inp} />;
    default: {
      if (toolName.startsWith('mcp__playwright__')) {
        return <PlaywrightDetail toolName={toolName} input={inp} />;
      }
      return <DefaultDetail input={inp} />;
    }
  }
}

function BashDetail({ input }: { input: Record<string, any> }) {
  return (
    <div className="px-3 py-2 space-y-1">
      {input.description && (
        <p className="text-xs text-slate-400">{str(input.description)}</p>
      )}
      <pre className="text-sm font-mono text-slate-200 bg-slate-900/60 rounded p-2 overflow-x-auto whitespace-pre-wrap">
        <code>{str(input.command)}</code>
      </pre>
    </div>
  );
}

function ReadDetail({ input }: { input: Record<string, any> }) {
  const range =
    input.offset || input.limit
      ? ` (lines ${input.offset ?? 1}${input.limit ? `-${(input.offset ?? 1) + input.limit}` : ''})`
      : '';
  return (
    <div className="px-3 py-2">
      <p className="text-sm font-mono text-slate-300 truncate">
        {str(input.file_path)}
        {range && <span className="text-slate-500">{range}</span>}
      </p>
    </div>
  );
}

function EditDetail({ input }: { input: Record<string, any> }) {
  const oldStr = str(input.old_string);
  const newStr = str(input.new_string);
  const showLineDiff = oldStr && newStr;

  return (
    <div className="px-3 py-2 space-y-2">
      <p className="text-xs font-mono text-slate-400 truncate">{str(input.file_path)}</p>
      {showLineDiff ? (
        <pre className="text-sm font-mono overflow-x-auto whitespace-pre-wrap rounded p-2 bg-slate-900/60">
          {computeLineDiff(oldStr, newStr).map((d, i) => {
            if (d.type === 'del')
              return <div key={i} className="text-red-400 bg-red-950/30">- {d.line}</div>;
            if (d.type === 'add')
              return <div key={i} className="text-green-400 bg-green-950/30">+ {d.line}</div>;
            return <div key={i} className="text-slate-400">  {d.line}</div>;
          })}
        </pre>
      ) : (
        <>
          {oldStr && (
            <div className="bg-red-950/30 border border-red-900/30 rounded p-2 overflow-x-auto">
              <div className="text-xs text-red-400 mb-1 font-medium">removed</div>
              <pre className="text-sm text-red-200 whitespace-pre-wrap font-mono">
                <code>{oldStr}</code>
              </pre>
            </div>
          )}
          {newStr && (
            <div className="bg-green-950/30 border border-green-900/30 rounded p-2 overflow-x-auto">
              <div className="text-xs text-green-400 mb-1 font-medium">added</div>
              <pre className="text-sm text-green-200 whitespace-pre-wrap font-mono">
                <code>{newStr}</code>
              </pre>
            </div>
          )}
        </>
      )}
    </div>
  );
}

function WriteDetail({ input }: { input: Record<string, any> }) {
  const content = str(input.content);
  const lang = getLanguageFromPath(str(input.file_path));
  const preview = content.length > 500 ? content.slice(0, 500) + '\n...' : content;

  return (
    <div className="px-3 py-2 space-y-1">
      <p className="text-xs font-mono text-slate-400 truncate">{str(input.file_path)}</p>
      <pre className="text-sm font-mono text-slate-300 bg-slate-900/60 rounded p-2 overflow-x-auto max-h-40 overflow-y-auto whitespace-pre-wrap">
        <code>{preview}</code>
      </pre>
      {lang && <p className="text-xs text-slate-500">{lang}</p>}
    </div>
  );
}

function GrepDetail({ input }: { input: Record<string, any> }) {
  return (
    <div className="px-3 py-2 space-y-1">
      <p className="text-sm text-slate-200">
        <code className="bg-slate-800 px-1.5 py-0.5 rounded text-orange-300 font-mono text-xs">
          {str(input.pattern)}
        </code>
        {input.path && (
          <span className="text-slate-400 ml-2 text-xs">in {str(input.path)}</span>
        )}
      </p>
      <div className="flex gap-2 flex-wrap">
        {input.glob && (
          <span className="text-xs bg-slate-800 text-slate-300 px-1.5 py-0.5 rounded">
            glob: {str(input.glob)}
          </span>
        )}
        {input.type && (
          <span className="text-xs bg-slate-800 text-slate-300 px-1.5 py-0.5 rounded">
            type: {str(input.type)}
          </span>
        )}
        {input.output_mode && (
          <span className="text-xs bg-slate-800 text-slate-300 px-1.5 py-0.5 rounded">
            {str(input.output_mode)}
          </span>
        )}
      </div>
    </div>
  );
}

function GlobDetail({ input }: { input: Record<string, any> }) {
  return (
    <div className="px-3 py-2">
      <p className="text-sm text-slate-200">
        <code className="bg-slate-800 px-1.5 py-0.5 rounded text-cyan-300 font-mono text-xs">
          {str(input.pattern)}
        </code>
        {input.path && (
          <span className="text-slate-400 ml-2 text-xs">in {str(input.path)}</span>
        )}
      </p>
    </div>
  );
}

function TaskDetail({ input }: { input: Record<string, any> }) {
  return (
    <div className="px-3 py-2 space-y-1">
      {input.subagent_type && (
        <span className="text-xs bg-pink-900/40 text-pink-300 px-1.5 py-0.5 rounded">
          {str(input.subagent_type)}
        </span>
      )}
      {input.description && (
        <p className="text-sm text-slate-300">{str(input.description)}</p>
      )}
      {input.prompt && (
        <p className="text-xs text-slate-400 line-clamp-3">{str(input.prompt)}</p>
      )}
    </div>
  );
}

function WebFetchDetail({ input }: { input: Record<string, any> }) {
  return (
    <div className="px-3 py-2 space-y-1">
      {input.url && (
        <p className="text-sm font-mono text-teal-300 truncate">{str(input.url)}</p>
      )}
      {input.prompt && (
        <p className="text-xs text-slate-400">{str(input.prompt)}</p>
      )}
    </div>
  );
}

function WebSearchDetail({ input }: { input: Record<string, any> }) {
  return (
    <div className="px-3 py-2">
      <p className="text-sm text-slate-200">{str(input.query)}</p>
    </div>
  );
}

function PlaywrightDetail({ toolName, input }: { toolName: string; input: Record<string, any> }) {
  const action = toolName.replace('mcp__playwright__', '');

  if (action === 'browser_navigate') {
    return (
      <div className="px-3 py-2 space-y-1">
        {input.url && (
          <p className="text-sm font-mono text-sky-300 truncate">{str(input.url)}</p>
        )}
      </div>
    );
  }

  if (action === 'browser_click') {
    return (
      <div className="px-3 py-2 space-y-1">
        {(input.element || input.ref) && (
          <p className="text-sm text-slate-200">
            <code className="bg-slate-800 px-1.5 py-0.5 rounded text-sky-300 font-mono text-xs">
              {str(input.element || input.ref)}
            </code>
          </p>
        )}
      </div>
    );
  }

  if (action === 'browser_type') {
    return (
      <div className="px-3 py-2 space-y-1">
        {(input.element || input.ref) && (
          <p className="text-sm text-slate-200">
            <code className="bg-slate-800 px-1.5 py-0.5 rounded text-sky-300 font-mono text-xs">
              {str(input.element || input.ref)}
            </code>
          </p>
        )}
        {input.text && (
          <p className="text-sm text-slate-300">"{str(input.text)}"</p>
        )}
      </div>
    );
  }

  if (action === 'browser_snapshot') {
    return (
      <div className="px-3 py-2">
        <p className="text-sm text-slate-400">Capturing page snapshot</p>
      </div>
    );
  }

  if (action === 'browser_screenshot') {
    return (
      <div className="px-3 py-2">
        <p className="text-sm text-slate-400">Capturing screenshot</p>
      </div>
    );
  }

  // Unknown Playwright action — show key params as chips, fall back to DefaultDetail
  const entries = Object.entries(input).filter(([, v]) => v != null);
  if (entries.length === 0) return <DefaultDetail input={input} />;

  return (
    <div className="px-3 py-2">
      <div className="flex gap-2 flex-wrap">
        {entries.map(([key, value]) => (
          <span key={key} className="text-xs bg-slate-800 text-slate-300 px-1.5 py-0.5 rounded">
            {key}: {typeof value === 'string' ? value : JSON.stringify(value)}
          </span>
        ))}
      </div>
    </div>
  );
}

function DefaultDetail({ input }: { input: Record<string, any> }) {
  return (
    <div className="px-3 py-2">
      <pre className="text-sm font-mono text-slate-300 overflow-x-auto whitespace-pre-wrap">
        {JSON.stringify(input, null, 2)}
      </pre>
    </div>
  );
}

// --- Inline result rendering ---

function ToolResultInline({
  content,
  toolName,
}: {
  content: string;
  toolName?: string;
}) {
  const [resultExpanded, setResultExpanded] = useState(false);
  const hasError = isErrorResult(content);
  const isDiff = !hasError && isUnifiedDiff(content);
  const isLong = content.length > 300;
  const preview = isLong
    ? content.slice(0, 300).replace(/\n/g, ' ') + '...'
    : content;

  return (
    <div
      className={`px-3 py-2 border-t border-slate-700/20 ${hasError ? 'bg-red-950/20' : 'bg-slate-900/20'}`}
    >
      <div className="flex items-center gap-2 mb-1">
        <span
          className={`text-xs font-medium ${hasError ? 'text-red-400' : 'text-emerald-400'}`}
        >
          {hasError ? 'Error' : isDiff ? 'Diff' : 'Result'}
        </span>
        {isLong && (
          <button
            onClick={() => setResultExpanded(!resultExpanded)}
            className="text-xs text-slate-500 hover:text-slate-300 transition-colors"
          >
            {resultExpanded ? 'collapse' : 'expand'}
          </button>
        )}
      </div>
      <div className={`${resultExpanded ? 'max-h-96' : 'max-h-32'} overflow-y-auto`}>
        {isDiff && (resultExpanded || !isLong) ? (
          <DiffRenderer diff={content} />
        ) : (
          <pre className="text-sm font-mono text-slate-300 overflow-x-auto whitespace-pre-wrap">
            {resultExpanded || !isLong ? content : preview}
          </pre>
        )}
      </div>
    </div>
  );
}
