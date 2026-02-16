import { create } from 'zustand';

export interface Notification {
  id: string;
  type: 'success' | 'error' | 'info';
  message: string;
  timestamp: number;
}

interface NotificationState {
  notifications: Notification[];
  addNotification: (type: Notification['type'], message: string) => void;
  dismissNotification: (id: string) => void;
}

let nextId = 0;

export const useNotificationStore = create<NotificationState>((set) => ({
  notifications: [],
  addNotification: (type, message) => {
    const id = String(++nextId);
    set((state) => ({
      notifications: [...state.notifications, { id, type, message, timestamp: Date.now() }],
    }));
    // Auto-dismiss after 8 seconds
    setTimeout(() => {
      set((state) => ({
        notifications: state.notifications.filter((n) => n.id !== id),
      }));
    }, 8000);
  },
  dismissNotification: (id) =>
    set((state) => ({
      notifications: state.notifications.filter((n) => n.id !== id),
    })),
}));
