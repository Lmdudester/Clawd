import { create } from 'zustand';
import type { SessionInfo, SessionMessage, PendingApproval, PendingQuestion } from '@clawd/shared';

interface SessionState {
  sessions: SessionInfo[];
  currentSessionId: string | null;
  messages: Map<string, SessionMessage[]>;
  streamingTokens: Map<string, string>;
  pendingApproval: PendingApproval | null;
  pendingQuestion: PendingQuestion | null;

  setSessions: (sessions: SessionInfo[]) => void;
  updateSession: (session: SessionInfo) => void;
  addSession: (session: SessionInfo) => void;
  removeSession: (id: string) => void;
  setCurrentSession: (id: string | null) => void;
  addMessages: (sessionId: string, newMessages: SessionMessage[]) => void;
  setMessages: (sessionId: string, messages: SessionMessage[]) => void;
  appendStreamToken: (sessionId: string, messageId: string, token: string) => void;
  clearStreamTokens: (sessionId: string, messageId: string) => void;
  clearSessionStreamTokens: (sessionId: string) => void;
  setPendingApproval: (approval: PendingApproval | null) => void;
  setPendingQuestion: (question: PendingQuestion | null) => void;
}

export const useSessionStore = create<SessionState>((set, get) => ({
  sessions: [],
  currentSessionId: null,
  messages: new Map(),
  streamingTokens: new Map(),
  pendingApproval: null,
  pendingQuestion: null,

  setSessions: (sessions) => set({ sessions }),

  updateSession: (session) =>
    set((state) => ({
      sessions: state.sessions.map((s) => (s.id === session.id ? session : s)),
    })),

  addSession: (session) =>
    set((state) => ({
      sessions: [...state.sessions, session],
    })),

  removeSession: (id) =>
    set((state) => ({
      sessions: state.sessions.filter((s) => s.id !== id),
    })),

  setCurrentSession: (id) => set({ currentSessionId: id }),

  addMessages: (sessionId, newMessages) =>
    set((state) => {
      const messages = new Map(state.messages);
      const existing = messages.get(sessionId) ?? [];
      // Deduplicate by id
      const existingIds = new Set(existing.map((m) => m.id));
      const unique = newMessages.filter((m) => !existingIds.has(m.id));
      messages.set(sessionId, [...existing, ...unique]);
      return { messages };
    }),

  setMessages: (sessionId, msgs) =>
    set((state) => {
      const messages = new Map(state.messages);
      messages.set(sessionId, msgs);
      return { messages };
    }),

  appendStreamToken: (sessionId, messageId, token) =>
    set((state) => {
      const streamingTokens = new Map(state.streamingTokens);
      const key = `${sessionId}:${messageId}`;
      streamingTokens.set(key, (streamingTokens.get(key) ?? '') + token);
      return { streamingTokens };
    }),

  clearStreamTokens: (sessionId, messageId) =>
    set((state) => {
      const streamingTokens = new Map(state.streamingTokens);
      streamingTokens.delete(`${sessionId}:${messageId}`);
      return { streamingTokens };
    }),

  clearSessionStreamTokens: (sessionId) =>
    set((state) => {
      const streamingTokens = new Map(state.streamingTokens);
      for (const key of streamingTokens.keys()) {
        if (key.startsWith(`${sessionId}:`)) {
          streamingTokens.delete(key);
        }
      }
      return { streamingTokens };
    }),

  setPendingApproval: (approval) => set({ pendingApproval: approval }),
  setPendingQuestion: (question) => set({ pendingQuestion: question }),
}));
