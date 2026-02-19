import { describe, it, expect } from 'vitest';
import { parseOwnerRepo } from './repos.js';

describe('parseOwnerRepo', () => {
  it('parses HTTPS GitHub URL', () => {
    expect(parseOwnerRepo('https://github.com/anthropics/claude-code')).toEqual({
      owner: 'anthropics',
      repo: 'claude-code',
    });
  });

  it('parses HTTPS GitHub URL with .git suffix', () => {
    expect(parseOwnerRepo('https://github.com/owner/repo.git')).toEqual({
      owner: 'owner',
      repo: 'repo',
    });
  });

  it('parses SSH-style GitHub URL', () => {
    expect(parseOwnerRepo('git@github.com:owner/repo')).toEqual({
      owner: 'owner',
      repo: 'repo',
    });
  });

  it('returns null for non-GitHub URL', () => {
    expect(parseOwnerRepo('https://gitlab.com/foo/bar')).toBeNull();
  });

  it('returns null for empty string', () => {
    expect(parseOwnerRepo('')).toBeNull();
  });

  it('handles URL with extra path segments', () => {
    const result = parseOwnerRepo('https://github.com/owner/repo/tree/main');
    expect(result).toEqual({ owner: 'owner', repo: 'repo' });
  });
});
