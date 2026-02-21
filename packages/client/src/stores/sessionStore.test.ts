import { describe, it, expect, beforeEach } from 'vitest';
import { useSessionStore } from './sessionStore';
import type { SessionInfo, SessionMessage } from '@clawd/shared';

function session(overrides: Partial<SessionInfo> = {}): SessionInfo {
  return {
    id: Math.random().toString(36),
    name: 'Test Session',
    repoUrl: 'https://github.com/test/repo',
    branch: 'main',
    status: 'idle',
    permissionMode: 'normal',
    createdAt: Date.now(),
    lastMessageAt: null,
    lastMessagePreview: null,
    notificationsEnabled: false,
    ...overrides,
  } as SessionInfo;
}

function message(overrides: Partial<SessionMessage> = {}): SessionMessage {
  return {
    id: Math.random().toString(36),
    type: 'assistant',
    content: 'test',
    timestamp: Date.now(),
    ...overrides,
  } as SessionMessage;
}

describe('sessionStore', () => {
  beforeEach(() => {
    useSessionStore.setState({
      sessions: [],
      currentSessionId: null,
      messages: new Map(),
      streamingTokens: new Map(),
      pendingApprovals: new Map(),
      pendingQuestions: new Map(),
      availableModels: [],
    });
  });

  describe('updateSession', () => {
    it('does not add a session that is not already in the store', () => {
      const s = session({ id: 'new-1' });
      useSessionStore.getState().updateSession(s);
      expect(useSessionStore.getState().sessions).toHaveLength(0);
    });

    it('replaces existing session by ID', () => {
      const s = session({ id: 'existing', name: 'Original' });
      useSessionStore.getState().addSession(s);
      useSessionStore.getState().updateSession(session({ id: 'existing', name: 'Updated' }));

      const sessions = useSessionStore.getState().sessions;
      expect(sessions).toHaveLength(1);
      expect(sessions[0].name).toBe('Updated');
    });
  });

  describe('addSession', () => {
    it('appends new session', () => {
      const s = session({ id: 'add-1' });
      useSessionStore.getState().addSession(s);
      expect(useSessionStore.getState().sessions).toHaveLength(1);
    });

    it('does not create duplicate when session already exists', () => {
      const s = session({ id: 'dup-1', name: 'First' });
      useSessionStore.getState().addSession(s);
      useSessionStore.getState().addSession(session({ id: 'dup-1', name: 'Second' }));

      const sessions = useSessionStore.getState().sessions;
      expect(sessions).toHaveLength(1);
      expect(sessions[0].name).toBe('Second');
    });
  });

  describe('removeSession', () => {
    it('removes session by ID', () => {
      useSessionStore.getState().addSession(session({ id: 'rm-1' }));
      useSessionStore.getState().addSession(session({ id: 'rm-2' }));
      useSessionStore.getState().removeSession('rm-1');

      const sessions = useSessionStore.getState().sessions;
      expect(sessions).toHaveLength(1);
      expect(sessions[0].id).toBe('rm-2');
    });
  });

  describe('addMessages', () => {
    it('appends new messages to session', () => {
      const m1 = message({ id: 'msg-1' });
      const m2 = message({ id: 'msg-2' });
      useSessionStore.getState().addMessages('s1', [m1, m2]);

      const msgs = useSessionStore.getState().messages.get('s1');
      expect(msgs).toHaveLength(2);
    });

    it('deduplicates messages by ID against existing', () => {
      const m1 = message({ id: 'msg-1' });
      useSessionStore.getState().addMessages('s1', [m1]);
      useSessionStore.getState().addMessages('s1', [m1, message({ id: 'msg-2' })]);

      const msgs = useSessionStore.getState().messages.get('s1');
      expect(msgs).toHaveLength(2);
    });

    it('deduplicates messages within the same batch', () => {
      const m1 = message({ id: 'msg-1' });
      const m1dup = message({ id: 'msg-1', content: 'duplicate' });
      useSessionStore.getState().addMessages('s1', [m1, m1dup, message({ id: 'msg-2' })]);

      const msgs = useSessionStore.getState().messages.get('s1')!;
      expect(msgs).toHaveLength(2);
      expect(msgs[0].content).toBe(m1.content);
    });
  });

  describe('setMessages', () => {
    it('sets messages directly when no existing messages', () => {
      const m1 = message({ id: 'msg-1' });
      const m2 = message({ id: 'msg-2' });
      useSessionStore.getState().setMessages('s1', [m1, m2]);

      const msgs = useSessionStore.getState().messages.get('s1');
      expect(msgs).toHaveLength(2);
    });

    it('merges with existing messages without duplicates', () => {
      const m1 = message({ id: 'msg-1' });
      const m2 = message({ id: 'msg-2' });
      const m3 = message({ id: 'msg-3' });
      // Simulate WebSocket delivering m1 and m2 first
      useSessionStore.getState().addMessages('s1', [m1, m2]);
      // Simulate REST fallback delivering m1 and m3
      useSessionStore.getState().setMessages('s1', [m1, m3]);

      const msgs = useSessionStore.getState().messages.get('s1')!;
      expect(msgs).toHaveLength(3);
      expect(msgs.map((m) => m.id)).toEqual(['msg-1', 'msg-2', 'msg-3']);
    });

    it('preserves messages added via WebSocket when REST arrives later', () => {
      const m1 = message({ id: 'msg-1', type: 'user' as any, content: 'hello' });
      const m2 = message({ id: 'msg-2', type: 'assistant' as any, content: 'hi' });
      // WebSocket delivers both
      useSessionStore.getState().addMessages('s1', [m1, m2]);
      // REST response contains only m1 (stale data)
      useSessionStore.getState().setMessages('s1', [m1]);

      const msgs = useSessionStore.getState().messages.get('s1')!;
      expect(msgs).toHaveLength(2);
      expect(msgs[1].id).toBe('msg-2');
    });
  });

  describe('streaming tokens', () => {
    it('accumulates tokens via appendStreamToken', () => {
      const { appendStreamToken } = useSessionStore.getState();
      appendStreamToken('s1', 'msg-1', 'Hello');
      appendStreamToken('s1', 'msg-1', ' World');

      const tokens = useSessionStore.getState().streamingTokens.get('s1:msg-1');
      expect(tokens).toBe('Hello World');
    });

    it('clears specific token via clearStreamTokens', () => {
      useSessionStore.getState().appendStreamToken('s1', 'msg-1', 'data');
      useSessionStore.getState().clearStreamTokens('s1', 'msg-1');

      expect(useSessionStore.getState().streamingTokens.has('s1:msg-1')).toBe(false);
    });

    it('clears all session tokens via clearSessionStreamTokens', () => {
      const { appendStreamToken } = useSessionStore.getState();
      appendStreamToken('s1', 'msg-1', 'a');
      appendStreamToken('s1', 'msg-2', 'b');
      appendStreamToken('s2', 'msg-3', 'c');

      useSessionStore.getState().clearSessionStreamTokens('s1');

      const tokens = useSessionStore.getState().streamingTokens;
      expect(tokens.has('s1:msg-1')).toBe(false);
      expect(tokens.has('s1:msg-2')).toBe(false);
      expect(tokens.has('s2:msg-3')).toBe(true);
    });
  });

  describe('pending state', () => {
    it('sets and clears pendingApproval per session', () => {
      const approval = { approvalId: 'a1', toolName: 'Bash', toolInput: {} };
      useSessionStore.getState().setPendingApproval('s1', approval as any);
      expect(useSessionStore.getState().pendingApprovals.get('s1')).toBeDefined();

      useSessionStore.getState().setPendingApproval('s1', null);
      expect(useSessionStore.getState().pendingApprovals.has('s1')).toBe(false);
    });

    it('sets and clears pendingQuestion per session', () => {
      const question = { questionId: 'q1', question: 'Choose one' };
      useSessionStore.getState().setPendingQuestion('s1', question as any);
      expect(useSessionStore.getState().pendingQuestions.get('s1')).toBeDefined();

      useSessionStore.getState().setPendingQuestion('s1', null);
      expect(useSessionStore.getState().pendingQuestions.has('s1')).toBe(false);
    });

    it('isolates pending state between sessions', () => {
      const approval1 = { approvalId: 'a1', toolName: 'Bash', toolInput: {} };
      const approval2 = { approvalId: 'a2', toolName: 'Edit', toolInput: {} };
      useSessionStore.getState().setPendingApproval('s1', approval1 as any);
      useSessionStore.getState().setPendingApproval('s2', approval2 as any);

      expect(useSessionStore.getState().pendingApprovals.get('s1')).toEqual(approval1);
      expect(useSessionStore.getState().pendingApprovals.get('s2')).toEqual(approval2);

      useSessionStore.getState().setPendingApproval('s1', null);
      expect(useSessionStore.getState().pendingApprovals.has('s1')).toBe(false);
      expect(useSessionStore.getState().pendingApprovals.get('s2')).toEqual(approval2);
    });
  });
});
