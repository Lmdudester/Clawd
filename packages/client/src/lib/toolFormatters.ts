// Tool-specific configuration, summaries, and formatting utilities

/** Safely convert any tool input value to a displayable string. */
export function str(value: unknown): string {
  if (value == null) return '';
  if (typeof value === 'string') return value;
  if (typeof value === 'object' && 'text' in (value as any)) return String((value as any).text);
  return String(value);
}

export interface ToolConfig {
  label: string;
  borderClass: string;
  bgClass: string;
  labelClass: string;
}

const TOOL_CONFIGS: Record<string, ToolConfig> = {
  Bash:       { label: 'Bash',       borderClass: 'border-l-emerald-500', bgClass: 'bg-emerald-950/30', labelClass: 'text-emerald-400' },
  Read:       { label: 'Read',       borderClass: 'border-l-blue-500',    bgClass: 'bg-blue-950/30',    labelClass: 'text-blue-400' },
  Edit:       { label: 'Edit',       borderClass: 'border-l-amber-500',   bgClass: 'bg-amber-950/30',   labelClass: 'text-amber-400' },
  Write:      { label: 'Write',      borderClass: 'border-l-violet-500',  bgClass: 'bg-violet-950/30',  labelClass: 'text-violet-400' },
  Grep:       { label: 'Grep',       borderClass: 'border-l-orange-500',  bgClass: 'bg-orange-950/30',  labelClass: 'text-orange-400' },
  Glob:       { label: 'Glob',       borderClass: 'border-l-cyan-500',    bgClass: 'bg-cyan-950/30',    labelClass: 'text-cyan-400' },
  Task:       { label: 'Task',       borderClass: 'border-l-pink-500',    bgClass: 'bg-pink-950/30',    labelClass: 'text-pink-400' },
  WebFetch:   { label: 'WebFetch',   borderClass: 'border-l-teal-500',    bgClass: 'bg-teal-950/30',    labelClass: 'text-teal-400' },
  WebSearch:  { label: 'WebSearch',  borderClass: 'border-l-teal-500',    bgClass: 'bg-teal-950/30',    labelClass: 'text-teal-400' },
  TodoWrite:  { label: 'TodoWrite',  borderClass: 'border-l-lime-500',    bgClass: 'bg-lime-950/30',    labelClass: 'text-lime-400' },
  Skill:      { label: 'Skill',      borderClass: 'border-l-fuchsia-500', bgClass: 'bg-fuchsia-950/30', labelClass: 'text-fuchsia-400' },
  NotebookEdit: { label: 'NotebookEdit', borderClass: 'border-l-indigo-500', bgClass: 'bg-indigo-950/30', labelClass: 'text-indigo-400' },
};

const DEFAULT_CONFIG: ToolConfig = {
  label: 'Tool',
  borderClass: 'border-l-slate-500',
  bgClass: 'bg-slate-900/30',
  labelClass: 'text-slate-400',
};

export function getToolConfig(toolName: string | undefined): ToolConfig {
  if (!toolName) return DEFAULT_CONFIG;
  if (toolName.startsWith('mcp__playwright__')) {
    const action = toolName.replace('mcp__playwright__', '').replace(/_/g, ' ');
    return { label: action, borderClass: 'border-l-sky-500', bgClass: 'bg-sky-950/30', labelClass: 'text-sky-400' };
  }
  return TOOL_CONFIGS[toolName] ?? { ...DEFAULT_CONFIG, label: toolName };
}

function shortenPath(path: string): string {
  const parts = path.replace(/\\/g, '/').split('/').filter(Boolean);
  if (parts.length <= 3) return path;
  return '.../' + parts.slice(-3).join('/');
}

function formatFilePath(path: string | undefined, offset?: number, limit?: number): string {
  if (!path) return '';
  let result = shortenPath(path);
  if (offset || limit) {
    const start = offset ?? 1;
    result += `:${start}`;
    if (limit) result += `-${start + limit - 1}`;
  }
  return result;
}

export function getToolSummary(
  toolName: string | undefined,
  toolInput: Record<string, unknown> | undefined,
): string {
  if (!toolInput || !toolName) return '';
  const inp = toolInput as Record<string, any>;

  switch (toolName) {
    case 'Bash':
      return inp.description || inp.command || '';
    case 'Read':
      return formatFilePath(inp.file_path, inp.offset, inp.limit);
    case 'Edit':
      return shortenPath(inp.file_path || '');
    case 'Write':
      return shortenPath(inp.file_path || '');
    case 'Grep':
      return `/${inp.pattern}/${inp.path ? ' in ' + shortenPath(inp.path) : ''}`;
    case 'Glob':
      return `${inp.pattern}${inp.path ? ' in ' + shortenPath(inp.path) : ''}`;
    case 'Task':
      return inp.description || '';
    case 'WebFetch':
      return inp.url || '';
    case 'WebSearch':
      return inp.query || '';
    case 'TodoWrite': {
      const count = Array.isArray(inp.todos) ? inp.todos.length : 0;
      return `${count} item${count !== 1 ? 's' : ''}`;
    }
    case 'Skill':
      return inp.skill || '';
    case 'NotebookEdit':
      return shortenPath(inp.notebook_path || '');
    default: {
      if (toolName.startsWith('mcp__playwright__')) {
        const action = toolName.replace('mcp__playwright__', '');
        if (action === 'browser_navigate') return inp.url || '';
        if (action === 'browser_click') return inp.element || inp.ref || '';
        if (action === 'browser_type') return inp.text || '';
        if (action === 'browser_snapshot' || action === 'browser_screenshot') return '';
        // Fallback: show first string-valued input
        const firstStr = Object.values(inp).find((v): v is string => typeof v === 'string');
        return firstStr || '';
      }
      return '';
    }
  }
}

export function isUnifiedDiff(content: string): boolean {
  return /^@@\s+-\d+/m.test(content) &&
         (/^diff --git /m.test(content) || /^--- /m.test(content));
}

export function isErrorResult(content: string): boolean {
  const lower = content.slice(0, 300).toLowerCase();
  return (
    lower.startsWith('error:') ||
    lower.startsWith('error -') ||
    lower.includes('command failed') ||
    lower.includes('no such file') ||
    lower.includes('permission denied') ||
    lower.includes('traceback (most recent call last)') ||
    lower.includes('errno')
  );
}

export function getLanguageFromPath(filePath: string): string | undefined {
  const ext = filePath.split('.').pop()?.toLowerCase();
  if (!ext) return undefined;
  const map: Record<string, string> = {
    ts: 'typescript', tsx: 'typescript', js: 'javascript', jsx: 'javascript',
    py: 'python', rs: 'rust', go: 'go', java: 'java', rb: 'ruby',
    css: 'css', html: 'html', json: 'json', yaml: 'yaml', yml: 'yaml',
    md: 'markdown', sh: 'bash', bash: 'bash', zsh: 'bash',
    sql: 'sql', xml: 'xml', toml: 'toml',
  };
  return map[ext];
}
