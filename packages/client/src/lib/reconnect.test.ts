import { describe, it, expect } from 'vitest';
import { getReconnectDelay } from './reconnect';

describe('getReconnectDelay', () => {
  it('returns base delay for attempt 0', () => {
    expect(getReconnectDelay(0)).toBe(1000);
  });

  it('doubles delay for each attempt', () => {
    expect(getReconnectDelay(1)).toBe(2000);
    expect(getReconnectDelay(2)).toBe(4000);
    expect(getReconnectDelay(3)).toBe(8000);
  });

  it('caps at max delay', () => {
    expect(getReconnectDelay(5)).toBe(30000); // 2^5 * 1000 = 32000, capped at 30000
    expect(getReconnectDelay(10)).toBe(30000);
    expect(getReconnectDelay(100)).toBe(30000);
  });

  it('uses custom base and max', () => {
    expect(getReconnectDelay(0, 500, 10000)).toBe(500);
    expect(getReconnectDelay(3, 500, 10000)).toBe(4000);
    expect(getReconnectDelay(5, 500, 10000)).toBe(10000);
  });
});
