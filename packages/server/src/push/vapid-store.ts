import { readFileSync, writeFileSync } from 'fs';
import webPush from 'web-push';
import { config } from '../config.js';

interface VapidKeys {
  publicKey: string;
  privateKey: string;
}

export class VapidStore {
  private keys: VapidKeys;

  constructor() {
    this.keys = this.load();
  }

  private load(): VapidKeys {
    try {
      const raw = readFileSync(config.vapidKeysPath, 'utf-8');
      return JSON.parse(raw);
    } catch {
      const keys = webPush.generateVAPIDKeys();
      const vapidKeys: VapidKeys = {
        publicKey: keys.publicKey,
        privateKey: keys.privateKey,
      };
      writeFileSync(config.vapidKeysPath, JSON.stringify(vapidKeys, null, 2));
      console.log('Generated new VAPID keys');
      return vapidKeys;
    }
  }

  getPublicKey(): string {
    return this.keys.publicKey;
  }

  getKeys(): VapidKeys {
    return this.keys;
  }
}
