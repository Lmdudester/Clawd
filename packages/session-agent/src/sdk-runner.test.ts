import { describe, it, expect } from 'vitest';
import { isReadOnlyBash, getEditFilePath } from './sdk-runner.js';

describe('isReadOnlyBash', () => {
  it('approves gh pr list', () => {
    expect(isReadOnlyBash('Bash', { command: 'gh pr list' })).toBe(true);
  });

  it('approves gh repo view', () => {
    expect(isReadOnlyBash('Bash', { command: 'gh repo view owner/repo' })).toBe(true);
  });

  it('approves gh api (GET by default)', () => {
    expect(isReadOnlyBash('Bash', { command: 'gh api /repos/owner/repo' })).toBe(true);
  });

  it('rejects gh api with --method POST', () => {
    expect(isReadOnlyBash('Bash', { command: 'gh api --method POST /repos/owner/repo' })).toBe(false);
  });

  it('approves gh api with --method GET', () => {
    expect(isReadOnlyBash('Bash', { command: 'gh api --method GET /repos/owner/repo' })).toBe(true);
  });

  it('approves curl', () => {
    expect(isReadOnlyBash('Bash', { command: 'curl https://example.com' })).toBe(true);
  });

  it('approves sleep', () => {
    expect(isReadOnlyBash('Bash', { command: 'sleep 5' })).toBe(true);
  });

  it('approves head', () => {
    expect(isReadOnlyBash('Bash', { command: 'head -n 10 file.txt' })).toBe(true);
  });

  it('approves tail', () => {
    expect(isReadOnlyBash('Bash', { command: 'tail -f log.txt' })).toBe(true);
  });

  it('rejects rm -rf', () => {
    expect(isReadOnlyBash('Bash', { command: 'rm -rf /' })).toBe(false);
  });

  it('rejects git push', () => {
    expect(isReadOnlyBash('Bash', { command: 'git push origin main' })).toBe(false);
  });

  it('rejects npm install', () => {
    expect(isReadOnlyBash('Bash', { command: 'npm install' })).toBe(false);
  });

  it('returns false for non-Bash tool', () => {
    expect(isReadOnlyBash('Read', { command: 'anything' })).toBe(false);
  });

  it('returns false when command is missing', () => {
    expect(isReadOnlyBash('Bash', {})).toBe(false);
  });

  it('approves gh issue list', () => {
    expect(isReadOnlyBash('Bash', { command: 'gh issue list --state open' })).toBe(true);
  });

  it('approves gh search repos', () => {
    expect(isReadOnlyBash('Bash', { command: 'gh search repos vitest' })).toBe(true);
  });

  it('rejects gh api with --method DELETE', () => {
    expect(isReadOnlyBash('Bash', { command: 'gh api --method DELETE /repos/owner/repo' })).toBe(false);
  });
});

describe('getEditFilePath', () => {
  it('returns file_path for Edit tool', () => {
    expect(getEditFilePath('Edit', { file_path: '/foo/bar.ts' })).toBe('/foo/bar.ts');
  });

  it('returns file_path for Write tool', () => {
    expect(getEditFilePath('Write', { file_path: '/foo/bar.ts' })).toBe('/foo/bar.ts');
  });

  it('returns file_path for Read tool', () => {
    expect(getEditFilePath('Read', { file_path: '/foo/bar.ts' })).toBe('/foo/bar.ts');
  });

  it('returns notebook_path for NotebookEdit tool', () => {
    expect(getEditFilePath('NotebookEdit', { notebook_path: '/foo/nb.ipynb' })).toBe('/foo/nb.ipynb');
  });

  it('returns null for Bash tool', () => {
    expect(getEditFilePath('Bash', { command: 'ls' })).toBeNull();
  });

  it('returns null when file_path is missing', () => {
    expect(getEditFilePath('Edit', {})).toBeNull();
  });
});
