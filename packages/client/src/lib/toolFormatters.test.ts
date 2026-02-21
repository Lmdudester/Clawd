import { describe, it, expect } from 'vitest';
import {
  str,
  getToolConfig,
  getToolSummary,
  isUnifiedDiff,
  isErrorResult,
  getLanguageFromPath,
} from './toolFormatters';

describe('str', () => {
  it('returns empty string for null', () => {
    expect(str(null)).toBe('');
  });

  it('returns empty string for undefined', () => {
    expect(str(undefined)).toBe('');
  });

  it('passes through strings unchanged', () => {
    expect(str('hello')).toBe('hello');
  });

  it('converts numbers to strings', () => {
    expect(str(42)).toBe('42');
  });

  it('extracts .text from objects', () => {
    expect(str({ text: 'content' })).toBe('content');
  });

  it('converts boolean to string', () => {
    expect(str(true)).toBe('true');
  });
});

describe('getToolConfig', () => {
  it('returns correct config for known tools', () => {
    const config = getToolConfig('Bash');
    expect(config.label).toBe('Bash');
    expect(config.borderClass).toContain('emerald');
  });

  it('returns default config for unknown tool with tool name as label', () => {
    const config = getToolConfig('UnknownTool');
    expect(config.label).toBe('UnknownTool');
    expect(config.borderClass).toContain('slate');
  });

  it('returns default config for undefined', () => {
    const config = getToolConfig(undefined);
    expect(config.label).toBe('Tool');
  });

  it('parses Playwright tool names into readable labels', () => {
    const config = getToolConfig('mcp__playwright__browser_click');
    expect(config.label).toBe('browser click');
    expect(config.borderClass).toContain('sky');
  });

  it('returns Read config with blue theme', () => {
    const config = getToolConfig('Read');
    expect(config.label).toBe('Read');
    expect(config.borderClass).toContain('blue');
  });
});

describe('getToolSummary', () => {
  it('returns empty string for missing input or toolName', () => {
    expect(getToolSummary(undefined, undefined)).toBe('');
    expect(getToolSummary('Bash', undefined)).toBe('');
    expect(getToolSummary(undefined, {})).toBe('');
  });

  it('returns description for Bash when available', () => {
    expect(getToolSummary('Bash', { description: 'List files', command: 'ls -la' })).toBe('List files');
  });

  it('falls back to command for Bash without description', () => {
    expect(getToolSummary('Bash', { command: 'ls -la' })).toBe('ls -la');
  });

  it('formats Read with file path and line range', () => {
    const result = getToolSummary('Read', { file_path: '/a/b/c/d/e/file.ts', offset: 10, limit: 20 });
    expect(result).toContain('file.ts');
    expect(result).toContain('10');
    expect(result).toContain('29'); // offset + limit - 1
  });

  it('formats Grep with pattern and path', () => {
    const result = getToolSummary('Grep', { pattern: 'TODO', path: '/src' });
    expect(result).toContain('/TODO/');
    expect(result).toContain('/src');
  });

  it('formats TodoWrite with singular count', () => {
    expect(getToolSummary('TodoWrite', { todos: [{ content: 'a' }] })).toBe('1 item');
  });

  it('formats TodoWrite with plural count', () => {
    expect(getToolSummary('TodoWrite', { todos: [{ content: 'a' }, { content: 'b' }, { content: 'c' }] })).toBe('3 items');
  });

  it('returns URL for Playwright navigate', () => {
    expect(getToolSummary('mcp__playwright__browser_navigate', { url: 'https://example.com' })).toBe('https://example.com');
  });

  it('returns element for Playwright click', () => {
    expect(getToolSummary('mcp__playwright__browser_click', { element: 'Submit button' })).toBe('Submit button');
  });

  it('returns text for Playwright type', () => {
    expect(getToolSummary('mcp__playwright__browser_type', { text: 'hello' })).toBe('hello');
  });

  it('returns empty string for Playwright snapshot', () => {
    expect(getToolSummary('mcp__playwright__browser_snapshot', {})).toBe('');
  });

  it('returns empty string for unknown tool', () => {
    expect(getToolSummary('CompletelyUnknown', { foo: 'bar' })).toBe('');
  });

  it('returns skill name for Skill tool', () => {
    expect(getToolSummary('Skill', { skill: 'commit' })).toBe('commit');
  });

  it('returns query for WebSearch', () => {
    expect(getToolSummary('WebSearch', { query: 'vitest docs' })).toBe('vitest docs');
  });
});

describe('isUnifiedDiff', () => {
  it('detects diff with diff --git header and @@ hunks', () => {
    const diff = `diff --git a/file.ts b/file.ts
--- a/file.ts
+++ b/file.ts
@@ -1,3 +1,3 @@
 line1
-old
+new`;
    expect(isUnifiedDiff(diff)).toBe(true);
  });

  it('detects diff with --- header variant', () => {
    const diff = `--- a/file.ts
+++ b/file.ts
@@ -1,3 +1,3 @@
 line1`;
    expect(isUnifiedDiff(diff)).toBe(true);
  });

  it('returns false for plain text', () => {
    expect(isUnifiedDiff('just some regular text output')).toBe(false);
  });

  it('returns false for text with @@ but no diff header', () => {
    expect(isUnifiedDiff('@@ -1,3 +1,3 @@ without headers')).toBe(false);
  });
});

describe('isErrorResult', () => {
  it('detects "Error:" prefix', () => {
    expect(isErrorResult('Error: something went wrong')).toBe(true);
  });

  it('detects "Error -" prefix', () => {
    expect(isErrorResult('Error - connection refused')).toBe(true);
  });

  it('detects "command failed"', () => {
    expect(isErrorResult('The command failed with exit code 1')).toBe(true);
  });

  it('detects "No such file"', () => {
    expect(isErrorResult('No such file or directory: /foo/bar')).toBe(true);
  });

  it('detects "Permission denied"', () => {
    expect(isErrorResult('Permission denied (publickey)')).toBe(true);
  });

  it('detects Python traceback', () => {
    expect(isErrorResult('Traceback (most recent call last):\n  File "test.py"')).toBe(true);
  });

  it('detects errno', () => {
    expect(isErrorResult('ENOENT: errno 2, no such file')).toBe(true);
  });

  it('returns false for normal output', () => {
    expect(isErrorResult('Successfully compiled 42 files.')).toBe(false);
  });

  it('only checks first 300 characters', () => {
    const longNormal = 'a'.repeat(301) + 'Error: should not be detected';
    expect(isErrorResult(longNormal)).toBe(false);
  });
});

describe('getLanguageFromPath', () => {
  it('maps .ts to typescript', () => {
    expect(getLanguageFromPath('file.ts')).toBe('typescript');
  });

  it('maps .tsx to typescript', () => {
    expect(getLanguageFromPath('component.tsx')).toBe('typescript');
  });

  it('maps .py to python', () => {
    expect(getLanguageFromPath('script.py')).toBe('python');
  });

  it('maps .sh to bash', () => {
    expect(getLanguageFromPath('run.sh')).toBe('bash');
  });

  it('maps .json to json', () => {
    expect(getLanguageFromPath('data.json')).toBe('json');
  });

  it('maps .rs to rust', () => {
    expect(getLanguageFromPath('main.rs')).toBe('rust');
  });

  it('returns undefined for unknown extension', () => {
    expect(getLanguageFromPath('file.xyz')).toBeUndefined();
  });

  it('returns undefined for no extension', () => {
    expect(getLanguageFromPath('Makefile')).toBeUndefined();
  });
});
