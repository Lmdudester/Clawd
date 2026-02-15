import { readFileSync, writeFileSync } from 'fs';
import webPush from 'web-push';
import { config } from '../config.js';
import type { VapidStore } from './vapid-store.js';

interface StoredSubscription {
  endpoint: string;
  keys: {
    p256dh: string;
    auth: string;
  };
}

export class PushManager {
  private subscriptions = new Map<string, StoredSubscription>();
  private filePath: string;

  constructor(vapidStore: VapidStore) {
    const keys = vapidStore.getKeys();
    webPush.setVapidDetails(
      'mailto:clawd@localhost',
      keys.publicKey,
      keys.privateKey,
    );

    // Persist subscriptions next to VAPID keys
    this.filePath = config.vapidKeysPath.replace('vapid-keys.json', 'push-subscriptions.json');
    this.load();
  }

  private load(): void {
    try {
      const raw = readFileSync(this.filePath, 'utf-8');
      const entries: StoredSubscription[] = JSON.parse(raw);
      for (const sub of entries) {
        this.subscriptions.set(sub.endpoint, sub);
      }
      if (entries.length > 0) {
        console.log(`Push: loaded ${entries.length} subscription(s) from disk`);
      }
    } catch {
      // No file yet — that's fine
    }
  }

  private save(): void {
    writeFileSync(this.filePath, JSON.stringify([...this.subscriptions.values()], null, 2));
  }

  subscribe(subscription: StoredSubscription): void {
    this.subscriptions.set(subscription.endpoint, subscription);
    this.save();
    console.log(`Push: subscription added (${this.subscriptions.size} total)`);
  }

  unsubscribe(endpoint: string): void {
    this.subscriptions.delete(endpoint);
    this.save();
    console.log(`Push: subscription removed (${this.subscriptions.size} total)`);
  }

  async sendNotification(title: string, body: string, url?: string): Promise<void> {
    if (this.subscriptions.size === 0) return;

    console.log(`Push: sending "${title}" to ${this.subscriptions.size} subscriber(s)`);
    const payload = JSON.stringify({ title, body, url });

    const expired: string[] = [];

    await Promise.allSettled(
      [...this.subscriptions.values()].map(async (sub) => {
        try {
          await webPush.sendNotification(sub, payload);
        } catch (err: any) {
          if (err.statusCode === 410 || err.statusCode === 404) {
            expired.push(sub.endpoint);
          } else {
            console.error('Push notification failed:', err.statusCode ?? err.message);
          }
        }
      }),
    );

    if (expired.length > 0) {
      for (const endpoint of expired) {
        this.subscriptions.delete(endpoint);
      }
      this.save();
      console.log(`Push: removed ${expired.length} expired subscription(s)`);
    }
  }

  hasSubscriptions(): boolean {
    return this.subscriptions.size > 0;
  }
}
