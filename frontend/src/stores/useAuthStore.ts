import { create } from 'zustand';
import { api, setAuthToken } from '../services/api';
import type { User } from '../types';

interface AuthState {
  currentUser: User | null;
  showAuthModal: boolean;

  login: (credentials: { email: string; password: string }) => Promise<void>;
  register: (credentials: { name: string; email: string; password: string }) => Promise<void>;
  logout: () => void;
  setShowAuthModal: (show: boolean) => void;
  checkAuth: () => Promise<void>;
}

export const useAuthStore = create<AuthState>((set) => ({
  currentUser: null,
  showAuthModal: false,

  login: async (credentials) => {
    const user = await api.login(credentials);
    set({ currentUser: user, showAuthModal: false });
  },

  register: async (credentials) => {
    const user = await api.register(credentials);
    set({ currentUser: user, showAuthModal: false });
  },

  logout: () => {
    api.logout();
    setAuthToken(null);
    set({ currentUser: null });
  },

  setShowAuthModal: (show) => set({ showAuthModal: show }),

  checkAuth: async () => {
    try {
      const user = await api.getMe();
      set({ currentUser: user });
    } catch {
      // Not authenticated - leave currentUser as null
    }
  },
}));
