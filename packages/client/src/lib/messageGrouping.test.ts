import { describe, it, expect } from 'vitest';
import { isPlanFileWrite, groupMessages } from './messageGrouping';
import type { SessionMessage } from '@clawd/shared';

function msg(overrides: Partial<SessionMessage>): SessionMessage {
  return {
    id: Math.random().toString(36),
    type: 'user',
    content: '',
    timestamp: Date.now(),
    ...overrides,
  } as SessionMessage;
}

describe('isPlanFileWrite', () => {
  it('returns true for Write to .claude/plans/', () => {
    expect(isPlanFileWrite(msg({
      type: 'tool_call',
      toolName: 'Write',
      toolInput: { file_path: '/home/user/.claude/plans/my-plan.md' },
    }))).toBe(true);
  });

  it('returns true for Edit to .claude/plans/', () => {
    expect(isPlanFileWrite(msg({
      type: 'tool_call',
      toolName: 'Edit',
      toolInput: { file_path: '/home/user/.claude/plans/my-plan.md' },
    }))).toBe(true);
  });

  it('returns true for Windows-style path with .claude\\plans\\', () => {
    expect(isPlanFileWrite(msg({
      type: 'tool_call',
      toolName: 'Write',
      toolInput: { file_path: 'C:\\Users\\.claude\\plans\\plan.md' },
    }))).toBe(true);
  });

  it('returns false for Write to non-plan path', () => {
    expect(isPlanFileWrite(msg({
      type: 'tool_call',
      toolName: 'Write',
      toolInput: { file_path: '/src/app.ts' },
    }))).toBe(false);
  });

  it('returns false for Read of plan file (wrong tool)', () => {
    expect(isPlanFileWrite(msg({
      type: 'tool_call',
      toolName: 'Read',
      toolInput: { file_path: '/home/.claude/plans/plan.md' },
    }))).toBe(false);
  });

  it('returns false for non-tool_call message', () => {
    expect(isPlanFileWrite(msg({ type: 'user', content: 'hello' }))).toBe(false);
  });
});

describe('groupMessages', () => {
  it('returns empty array for empty input', () => {
    expect(groupMessages([])).toEqual([]);
  });

  it('wraps user/assistant messages as individual message segments', () => {
    const messages = [
      msg({ type: 'user', content: 'hi' }),
      msg({ type: 'assistant', content: 'hello' }),
    ];
    const segments = groupMessages(messages);
    expect(segments).toHaveLength(2);
    expect(segments[0].kind).toBe('message');
    expect(segments[1].kind).toBe('message');
  });

  it('groups consecutive tool_call + tool_result into tool_group', () => {
    const messages = [
      msg({ type: 'tool_call', toolName: 'Bash', toolInput: { command: 'ls' } }),
      msg({ type: 'tool_result', content: 'file1\nfile2' }),
    ];
    const segments = groupMessages(messages);
    expect(segments).toHaveLength(1);
    expect(segments[0].kind).toBe('tool_group');
    if (segments[0].kind === 'tool_group') {
      expect(segments[0].messages).toHaveLength(2);
    }
  });

  it('extracts plan Write as plan_write segment with content', () => {
    const messages = [
      msg({
        type: 'tool_call',
        toolName: 'Write',
        toolInput: { file_path: '/home/.claude/plans/plan.md', content: '# My Plan' },
      }),
      msg({ type: 'tool_result', content: 'ok' }),
    ];
    const segments = groupMessages(messages);
    expect(segments).toHaveLength(1);
    expect(segments[0].kind).toBe('plan_write');
    if (segments[0].kind === 'plan_write') {
      expect(segments[0].fullContent).toBe('# My Plan');
      expect(segments[0].result).toBeDefined();
    }
  });

  it('applies Edit replacement on accumulated plan content', () => {
    const planPath = '/home/.claude/plans/plan.md';
    const messages = [
      msg({
        type: 'tool_call',
        toolName: 'Write',
        toolInput: { file_path: planPath, content: 'Hello World' },
      }),
      msg({ type: 'tool_result', content: 'ok' }),
      msg({
        type: 'tool_call',
        toolName: 'Edit',
        toolInput: { file_path: planPath, old_string: 'World', new_string: 'Clawd' },
      }),
      msg({ type: 'tool_result', content: 'ok' }),
    ];
    const segments = groupMessages(messages);
    const planSegments = segments.filter(s => s.kind === 'plan_write');
    expect(planSegments).toHaveLength(2);
    if (planSegments[1].kind === 'plan_write') {
      expect(planSegments[1].fullContent).toBe('Hello Clawd');
    }
  });

  it('splits mixed plan and non-plan tools correctly', () => {
    const messages = [
      msg({ type: 'tool_call', toolName: 'Bash', toolInput: { command: 'ls' } }),
      msg({ type: 'tool_result', content: 'files' }),
      msg({
        type: 'tool_call',
        toolName: 'Write',
        toolInput: { file_path: '/home/.claude/plans/p.md', content: 'plan' },
      }),
      msg({ type: 'tool_result', content: 'ok' }),
    ];
    const segments = groupMessages(messages);
    expect(segments.map(s => s.kind)).toEqual(['tool_group', 'plan_write']);
  });
});
