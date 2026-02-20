export interface DiffLine {
  type: 'same' | 'add' | 'del';
  line: string;
}

const MAX_LCS_LINES = 500;

/**
 * Simple line-by-line diff for large files where the full LCS DP table
 * would use too much memory. Matches equal lines at the same index,
 * then marks the rest as adds/deletes.
 */
function simpleDiff(oldLines: string[], newLines: string[]): DiffLine[] {
  const result: DiffLine[] = [];
  const max = Math.max(oldLines.length, newLines.length);
  for (let i = 0; i < max; i++) {
    const oldLine = i < oldLines.length ? oldLines[i] : undefined;
    const newLine = i < newLines.length ? newLines[i] : undefined;
    if (oldLine !== undefined && newLine !== undefined && oldLine === newLine) {
      result.push({ type: 'same', line: oldLine });
    } else {
      if (oldLine !== undefined) result.push({ type: 'del', line: oldLine });
      if (newLine !== undefined) result.push({ type: 'add', line: newLine });
    }
  }
  return result;
}

export function computeLineDiff(oldText: string, newText: string): DiffLine[] {
  const oldLines = oldText.split('\n');
  const newLines = newText.split('\n');
  const m = oldLines.length, n = newLines.length;

  // Guard against O(n*m) memory for large files
  if (m > MAX_LCS_LINES && n > MAX_LCS_LINES) {
    return simpleDiff(oldLines, newLines);
  }

  // LCS table
  const dp: number[][] = Array.from({ length: m + 1 }, () => new Array(n + 1).fill(0));
  for (let i = 1; i <= m; i++)
    for (let j = 1; j <= n; j++)
      dp[i][j] = oldLines[i - 1] === newLines[j - 1] ? dp[i - 1][j - 1] + 1 : Math.max(dp[i - 1][j], dp[i][j - 1]);

  // Backtrack
  const result: DiffLine[] = [];
  let i = m, j = n;
  while (i > 0 || j > 0) {
    if (i > 0 && j > 0 && oldLines[i - 1] === newLines[j - 1]) {
      result.push({ type: 'same', line: oldLines[i - 1] });
      i--; j--;
    } else if (j > 0 && (i === 0 || dp[i][j - 1] >= dp[i - 1][j])) {
      result.push({ type: 'add', line: newLines[j - 1] });
      j--;
    } else {
      result.push({ type: 'del', line: oldLines[i - 1] });
      i--;
    }
  }
  return result.reverse();
}
