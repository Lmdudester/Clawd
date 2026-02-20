import { describe, it, expect } from 'vitest';
import { pairToolMessages } from './ToolGroup';
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

describe('pairToolMessages', () => {
  it('pairs a tool_call followed by tool_result', () => {
    const call = msg({ type: 'tool_call', toolName: 'Bash' });
    const result = msg({ type: 'tool_result', content: 'output' });
    const pairs = pairToolMessages([call, result]);
    expect(pairs).toHaveLength(1);
    expect('call' in pairs[0]).toBe(true);
    if ('call' in pairs[0]) {
      expect(pairs[0].call).toBe(call);
      expect(pairs[0].result).toBe(result);
    }
  });

  it('returns unpaired call when no result follows', () => {
    const call = msg({ type: 'tool_call', toolName: 'Bash' });
    const pairs = pairToolMessages([call]);
    expect(pairs).toHaveLength(1);
    if ('call' in pairs[0]) {
      expect(pairs[0].call).toBe(call);
      expect(pairs[0].result).toBeUndefined();
    }
  });

  it('returns orphaned tool_result as standalone message', () => {
    const result = msg({ type: 'tool_result', content: 'orphan' });
    const pairs = pairToolMessages([result]);
    expect(pairs).toHaveLength(1);
    expect('call' in pairs[0]).toBe(false);
    expect((pairs[0] as SessionMessage).type).toBe('tool_result');
  });

  it('handles two consecutive calls followed by one result', () => {
    const call1 = msg({ type: 'tool_call', toolName: 'Read' });
    const call2 = msg({ type: 'tool_call', toolName: 'Bash' });
    const result = msg({ type: 'tool_result', content: 'output' });
    const pairs = pairToolMessages([call1, call2, result]);
    expect(pairs).toHaveLength(2);
    // First call is unpaired
    if ('call' in pairs[0]) {
      expect(pairs[0].result).toBeUndefined();
    }
    // Second call is paired with result
    if ('call' in pairs[1]) {
      expect(pairs[1].result).toBe(result);
    }
  });

  it('returns empty array for empty input', () => {
    expect(pairToolMessages([])).toEqual([]);
  });
});
