import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('./config.js', () => ({
  config: { hostDrivePrefix: '/host/c' },
}));

import { windowsToContainer, containerToWindows } from './path-translator.js';

describe('windowsToContainer', () => {
  it('converts C:\\ path to container path', () => {
    expect(windowsToContainer('C:\\Users\\dev\\project')).toBe('/host/c/Users/dev/project');
  });

  it('converts C:/ path to container path', () => {
    expect(windowsToContainer('C:/Users/dev/project')).toBe('/host/c/Users/dev/project');
  });

  it('converts lowercase drive letter', () => {
    expect(windowsToContainer('c:\\Users\\dev')).toBe('/host/c/Users/dev');
  });

  it('returns unix paths unchanged', () => {
    expect(windowsToContainer('/unix/path')).toBe('/unix/path');
  });

  it('returns plain text unchanged', () => {
    expect(windowsToContainer('no-path-here')).toBe('no-path-here');
  });
});

describe('containerToWindows', () => {
  it('converts container path back to Windows path', () => {
    expect(containerToWindows('/host/c/Users/dev/project')).toBe('C:\\Users\\dev\\project');
  });

  it('returns paths without prefix unchanged', () => {
    expect(containerToWindows('/other/path')).toBe('/other/path');
  });

  it('handles deeply nested paths', () => {
    expect(containerToWindows('/host/c/a/b/c/d')).toBe('C:\\a\\b\\c\\d');
  });
});

describe('round-trip', () => {
  it('windowsToContainer then containerToWindows preserves Windows path', () => {
    const original = 'C:\\Users\\dev\\workspace\\file.ts';
    const containerPath = windowsToContainer(original);
    const restored = containerToWindows(containerPath);
    expect(restored).toBe(original);
  });
});
