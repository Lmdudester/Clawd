import type { PermissionMode } from '@clawd/shared';

export const MODE_THEME: Record<PermissionMode, { toggle: string; banner: string; icon: string }> = {
  normal: {
    toggle: 'bg-slate-500 text-white',
    banner: '',
    icon: '',
  },
  plan: {
    toggle: 'bg-sky-600 text-white',
    banner: 'bg-sky-900/60 border-t border-sky-500/50 text-sky-200',
    icon: 'text-sky-400',
  },
  auto_edits: {
    toggle: 'bg-purple-600 text-white',
    banner: 'bg-purple-900/60 border-t border-purple-500/50 text-purple-200',
    icon: 'text-purple-400',
  },
  dangerous: {
    toggle: 'bg-red-600 text-white',
    banner: 'bg-red-900/60 border-t border-red-500/50 text-red-200',
    icon: 'text-red-400',
  },
};
