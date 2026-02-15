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
          'Title': 'Clawd Update',
          'Tags': 'crab',
        },
      });

      if (!res.ok) {
        console.error(`ntfy: HTTP ${res.status} — ${await res.text()}`);
        return;
      }

      console.log(`ntfy: sent "${title}"`);
    } catch (err: any) {
      console.error('ntfy: send failed:', err.message);
    }
  }
}
