import { useNotificationStore } from '../../stores/notificationStore';

export function ToastContainer() {
  const notifications = useNotificationStore((s) => s.notifications);
  const dismiss = useNotificationStore((s) => s.dismissNotification);

  if (notifications.length === 0) return null;

  return (
    <div className="fixed top-4 right-4 z-50 flex flex-col gap-2 max-w-sm">
      {notifications.map((n) => (
        <div
          key={n.id}
          className={`rounded-lg px-4 py-3 shadow-lg border text-sm flex items-start gap-2 animate-in slide-in-from-right ${
            n.type === 'error'
              ? 'bg-red-900/90 border-red-700 text-red-200'
              : n.type === 'success'
              ? 'bg-green-900/90 border-green-700 text-green-200'
              : 'bg-slate-800/90 border-slate-600 text-slate-200'
          }`}
        >
          <span className="flex-1">{n.message}</span>
          <button
            onClick={() => dismiss(n.id)}
            className="text-current opacity-60 hover:opacity-100 shrink-0 ml-2"
          >
            &times;
          </button>
        </div>
      ))}
    </div>
  );
}
