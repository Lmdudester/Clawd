import { useState, useEffect, useCallback } from 'react';
import { api } from '../lib/api';

type PermissionState = NotificationPermission | 'unsupported';

function urlBase64ToUint8Array(base64String: string): Uint8Array {
  const padding = '='.repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/');
  const rawData = atob(base64);
  const outputArray = new Uint8Array(rawData.length);
  for (let i = 0; i < rawData.length; i++) {
    outputArray[i] = rawData.charCodeAt(i);
  }
  return outputArray;
}

export function useNotifications() {
  const [permission, setPermission] = useState<PermissionState>(() => {
    if (typeof Notification === 'undefined') return 'unsupported';
    return Notification.permission;
  });
  const [loading, setLoading] = useState(false);

  // Sync permission state on visibility change (user may change in browser settings)
  useEffect(() => {
    if (typeof Notification === 'undefined') return;

    const handler = () => setPermission(Notification.permission);
    document.addEventListener('visibilitychange', handler);
    return () => document.removeEventListener('visibilitychange', handler);
  }, []);

  const requestPermission = useCallback(async () => {
    if (typeof Notification === 'undefined') return;

    setLoading(true);
    try {
      const result = await Notification.requestPermission();
      setPermission(result);
      if (result !== 'granted') return;

      // Get VAPID public key from server
      const { publicKey } = await api.getVapidPublicKey();

      // Get service worker registration
      const registration = await navigator.serviceWorker.ready;

      // Subscribe to push
      const subscription = await registration.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: urlBase64ToUint8Array(publicKey) as BufferSource,
      });

      // Send subscription to server
      await api.subscribePush(subscription.toJSON());
      localStorage.setItem('clawd_push_enabled', '1');
    } catch (err) {
      console.error('Failed to enable push notifications:', err);
    } finally {
      setLoading(false);
    }
  }, []);

  const unsubscribe = useCallback(async () => {
    setLoading(true);
    try {
      const registration = await navigator.serviceWorker.ready;
      const subscription = await registration.pushManager.getSubscription();
      if (subscription) {
        await api.unsubscribePush(subscription.endpoint);
        await subscription.unsubscribe();
      }
      localStorage.removeItem('clawd_push_enabled');
      setPermission(Notification.permission);
    } catch (err) {
      console.error('Failed to unsubscribe from push:', err);
    } finally {
      setLoading(false);
    }
  }, []);

  const enabled = permission === 'granted' && localStorage.getItem('clawd_push_enabled') === '1';

  return { permission, enabled, loading, requestPermission, unsubscribe };
}
