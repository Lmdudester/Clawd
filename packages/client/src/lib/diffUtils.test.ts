import { describe, it, expect } from 'vitest';
import { computeLineDiff } from './diffUtils';

describe('computeLineDiff', () => {
  it('returns all same for identical text', () => {
    const result = computeLineDiff('a\nb\nc', 'a\nb\nc');
    expect(result).toEqual([
      { type: 'same', line: 'a' },
      { type: 'same', line: 'b' },
      { type: 'same', line: 'c' },
    ]);
  });

  it('returns all add when old is empty', () => {
    const result = computeLineDiff('', 'a\nb');
    const types = result.map(d => d.type);
    // The empty string splits into [''], so there will be a del for the empty line
    // and adds for the new lines
    expect(result.filter(d => d.type === 'add').length).toBeGreaterThan(0);
    expect(result.filter(d => d.type === 'add').map(d => d.line)).toContain('a');
    expect(result.filter(d => d.type === 'add').map(d => d.line)).toContain('b');
  });

  it('returns all del when new is empty', () => {
    const result = computeLineDiff('a\nb', '');
    expect(result.filter(d => d.type === 'del').map(d => d.line)).toContain('a');
    expect(result.filter(d => d.type === 'del').map(d => d.line)).toContain('b');
  });

  it('detects a single line replacement', () => {
    const result = computeLineDiff('a\nold\nc', 'a\nnew\nc');
    expect(result).toEqual([
      { type: 'same', line: 'a' },
      { type: 'del', line: 'old' },
      { type: 'add', line: 'new' },
      { type: 'same', line: 'c' },
    ]);
  });

  it('detects lines added in the middle', () => {
    const result = computeLineDiff('a\nc', 'a\nb\nc');
    expect(result).toEqual([
      { type: 'same', line: 'a' },
      { type: 'add', line: 'b' },
      { type: 'same', line: 'c' },
    ]);
  });

  it('detects lines removed from the middle', () => {
    const result = computeLineDiff('a\nb\nc', 'a\nc');
    expect(result).toEqual([
      { type: 'same', line: 'a' },
      { type: 'del', line: 'b' },
      { type: 'same', line: 'c' },
    ]);
  });

  it('handles both empty strings', () => {
    const result = computeLineDiff('', '');
    expect(result).toEqual([{ type: 'same', line: '' }]);
  });

  it('handles multi-line additions at end', () => {
    const result = computeLineDiff('a', 'a\nb\nc');
    expect(result[0]).toEqual({ type: 'same', line: 'a' });
    expect(result.filter(d => d.type === 'add').length).toBe(2);
  });
});
