export function getReconnectDelay(
  attempt: number,
  base = 1000,
  max = 30000,
): number {
  const delay = Math.min(base * Math.pow(2, attempt), max);
  // Add ±25% jitter to prevent thundering herd on reconnect
  const jitter = delay * 0.25 * (Math.random() * 2 - 1);
  return Math.max(0, Math.round(delay + jitter));
}
