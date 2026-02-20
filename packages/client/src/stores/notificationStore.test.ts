import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';

// We need to import the store fresh. Zustand stores are singletons.
import { useNotificationStore } from './notificationStore';

describe('notificationStore', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    useNotificationStore.setState({ notifications: [] });
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('adds a notification with incrementing ID', () => {
    useNotificationStore.getState().addNotification('info', 'First');
    useNotificationStore.getState().addNotification('error', 'Second');

    const notifications = useNotificationStore.getState().notifications;
    expect(notifications).toHaveLength(2);
    expect(notifications[0].id).not.toBe(notifications[1].id);
    expect(notifications[0].message).toBe('First');
    expect(notifications[1].message).toBe('Second');
  });

  it('dismisses a notification by ID', () => {
    useNotificationStore.getState().addNotification('info', 'To dismiss');
    const id = useNotificationStore.getState().notifications[0].id;

    useNotificationStore.getState().dismissNotification(id);
    expect(useNotificationStore.getState().notifications).toHaveLength(0);
  });

  it('auto-dismisses after timeout', () => {
    useNotificationStore.getState().addNotification('info', 'Auto dismiss');
    expect(useNotificationStore.getState().notifications).toHaveLength(1);

    vi.advanceTimersByTime(8000);
    expect(useNotificationStore.getState().notifications).toHaveLength(0);
  });

  it('keeps other notifications when one is auto-dismissed', () => {
    useNotificationStore.getState().addNotification('info', 'First');
    vi.advanceTimersByTime(4000); // 4s into first timer
    useNotificationStore.getState().addNotification('info', 'Second');

    vi.advanceTimersByTime(4000); // First should auto-dismiss at 8s total
    const notifications = useNotificationStore.getState().notifications;
    expect(notifications).toHaveLength(1);
    expect(notifications[0].message).toBe('Second');
  });
});
