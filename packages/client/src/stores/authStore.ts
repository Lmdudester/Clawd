import { create } from 'zustand';

interface AuthState {
  token: string | null;
  isAuthenticated: boolean;
  login: (token: string) => void;
  logout: () => void;
}

export const useAuthStore = create<AuthState>((set) => ({
  token: localStorage.getItem('clawd_token'),
  isAuthenticated: !!localStorage.getItem('clawd_token'),
  login: (token: string) => {
    localStorage.setItem('clawd_token', token);
    set({ token, isAuthenticated: true });
  },
  logout: () => {
    localStorage.removeItem('clawd_token');
    set({ token: null, isAuthenticated: false });
  },
}));
