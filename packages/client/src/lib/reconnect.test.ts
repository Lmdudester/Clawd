import { describe, it, expect } from 'vitest';
import { getReconnectDelay } from './reconnect';

describe('getReconnectDelay', () => {
  it('returns a value near the base delay for attempt 0', () => {
    const delay = getReconnectDelay(0);
    // base=1000, ±25% jitter → [750, 1250]
    expect(delay).toBeGreaterThanOrEqual(750);
    expect(delay).toBeLessThanOrEqual(1250);
  });

  it('roughly doubles delay for each attempt', () => {
    // Run multiple times to account for jitter
    for (let i = 0; i < 10; i++) {
      const d1 = getReconnectDelay(1);
      const d2 = getReconnectDelay(2);
      const d3 = getReconnectDelay(3);
      expect(d1).toBeGreaterThanOrEqual(1500);
      expect(d1).toBeLessThanOrEqual(2500);
      expect(d2).toBeGreaterThanOrEqual(3000);
      expect(d2).toBeLessThanOrEqual(5000);
      expect(d3).toBeGreaterThanOrEqual(6000);
      expect(d3).toBeLessThanOrEqual(10000);
    }
  });

  it('caps at max delay', () => {
    for (let i = 0; i < 10; i++) {
      const d5 = getReconnectDelay(5);
      const d10 = getReconnectDelay(10);
      const d100 = getReconnectDelay(100);
      // max=30000, ±25% jitter → [22500, 37500] but capped at max before jitter
      expect(d5).toBeLessThanOrEqual(37500);
      expect(d10).toBeGreaterThanOrEqual(22500);
      expect(d10).toBeLessThanOrEqual(37500);
      expect(d100).toBeGreaterThanOrEqual(22500);
      expect(d100).toBeLessThanOrEqual(37500);
    }
  });

  it('uses custom base and max', () => {
    for (let i = 0; i < 10; i++) {
      const d0 = getReconnectDelay(0, 500, 10000);
      const d3 = getReconnectDelay(3, 500, 10000);
      const d5 = getReconnectDelay(5, 500, 10000);
      // base=500, ±25% jitter → [375, 625]
      expect(d0).toBeGreaterThanOrEqual(375);
      expect(d0).toBeLessThanOrEqual(625);
      // 500*2^3=4000, ±25% → [3000, 5000]
      expect(d3).toBeGreaterThanOrEqual(3000);
      expect(d3).toBeLessThanOrEqual(5000);
      // 500*2^5=16000, capped at 10000, ±25% → [7500, 12500]
      expect(d5).toBeGreaterThanOrEqual(7500);
      expect(d5).toBeLessThanOrEqual(12500);
    }
  });

  it('never returns a negative value', () => {
    for (let i = 0; i < 100; i++) {
      expect(getReconnectDelay(0)).toBeGreaterThanOrEqual(0);
    }
  });
});
