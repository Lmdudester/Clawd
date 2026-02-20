import { config } from '../config.js';

export class Notifier {
  get enabled(): boolean {
    return !!config.ntfyTopic;
  }

  async sendNotification(title: string, body: string): Promise<void> {
    if (!this.enabled) return;

    const url = `${config.ntfyServer}/${config.ntfyTopic}`;

    try {
      const res = await fetch(url, {
        method: 'POST',
        body,
        headers: {
          'Title': title,
          'Tags': 'crab',
        },
        signal: AbortSignal.timeout(10_000),
      });

      if (!res.ok) {
        const text = await res.text().catch(() => '(unreadable body)');
        console.error(`ntfy: HTTP ${res.status} — ${text}`);
        return;
      }

      console.log(`ntfy: sent "${title}"`);
    } catch (err: any) {
      if (err.name === 'TimeoutError') {
        console.error('ntfy: request timed out after 10s');
      } else {
        console.error('ntfy: send failed:', err.message ?? err);
      }
    }
  }
}
