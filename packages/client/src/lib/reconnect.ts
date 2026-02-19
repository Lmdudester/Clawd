export function getReconnectDelay(
  attempt: number,
  base = 1000,
  max = 30000,
): number {
  return Math.min(base * Math.pow(2, attempt), max);
}
