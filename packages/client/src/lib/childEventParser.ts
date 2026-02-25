// Parser for structured child session event messages

export type ChildEvent =
  | {
      kind: 'approval_request';
      sessionName: string;
      sessionId: string;
      toolName: string;
      toolInput: string;
      reasoning?: string;
      approvalId: string;
    }
  | {
      kind: 'session_ready';
      sessionName: string;
      sessionId: string;
      body: string;
    }
  | {
      kind: 'session_completed';
      sessionName: string;
      sessionId: string;
      childOutput: string;
    }
  | {
      kind: 'session_error';
      sessionName: string;
      sessionId: string;
      body: string;
    }
  | {
      kind: 'session_stale';
      sessionName: string;
      sessionId: string;
      body: string;
    };

const SESSION_LINE_RE = /^Session:\s*"(.+?)"\s*\(ID:\s*(.+?)\)\s*$/m;

function parseSessionLine(text: string): { sessionName: string; sessionId: string } | null {
  const m = SESSION_LINE_RE.exec(text);
  if (!m) return null;
  return { sessionName: m[1], sessionId: m[2] };
}

function parseApprovalRequest(text: string): ChildEvent | null {
  const session = parseSessionLine(text);
  if (!session) return null;

  // Tool line
  const toolMatch = /^Tool:\s*(.+)$/m.exec(text);
  if (!toolMatch) return null;

  // Input block: everything between "Input:\n" and either "Child's reasoning:" or "Review the tool"
  const inputStart = text.indexOf('Input:\n');
  if (inputStart === -1) return null;
  const inputContent = text.slice(inputStart + 'Input:\n'.length);

  let toolInput: string;
  let reasoning: string | undefined;

  const reasoningMatch = inputContent.indexOf("Child's reasoning:");
  if (reasoningMatch !== -1) {
    toolInput = inputContent.slice(0, reasoningMatch).trim();
    const afterReasoning = inputContent.slice(reasoningMatch + "Child's reasoning:".length);
    const reviewIdx = afterReasoning.indexOf('Review the tool');
    reasoning = (reviewIdx !== -1 ? afterReasoning.slice(0, reviewIdx) : afterReasoning).trim();
  } else {
    const reviewIdx = inputContent.indexOf('Review the tool');
    toolInput = (reviewIdx !== -1 ? inputContent.slice(0, reviewIdx) : inputContent).trim();
  }

  // Approval ID
  const approvalMatch = /^Approval ID:\s*(.+)$/m.exec(text);
  if (!approvalMatch) return null;

  return {
    kind: 'approval_request',
    ...session,
    toolName: toolMatch[1].trim(),
    toolInput,
    reasoning,
    approvalId: approvalMatch[1].trim(),
  };
}

function parseSessionReady(text: string): ChildEvent | null {
  const session = parseSessionLine(text);
  if (!session) return null;

  // Body is everything after the session line
  const sessionLineEnd = text.indexOf('\n', text.indexOf('(ID:'));
  const body = sessionLineEnd !== -1 ? text.slice(sessionLineEnd + 1).trim() : '';

  return { kind: 'session_ready', ...session, body };
}

function parseSessionCompleted(text: string): ChildEvent | null {
  const session = parseSessionLine(text);
  if (!session) return null;

  // Extract content between --- Child Output --- and --- End Child Output ---
  const startMarker = '--- Child Output ---';
  const endMarker = '--- End Child Output ---';
  const startIdx = text.indexOf(startMarker);
  const endIdx = text.indexOf(endMarker);

  let childOutput: string;
  if (startIdx !== -1 && endIdx !== -1) {
    childOutput = text.slice(startIdx + startMarker.length, endIdx).trim();
  } else {
    // Fallback: everything after the session line
    const sessionLineEnd = text.indexOf('\n', text.indexOf('(ID:'));
    childOutput = sessionLineEnd !== -1 ? text.slice(sessionLineEnd + 1).trim() : '';
  }

  return { kind: 'session_completed', ...session, childOutput };
}

function parseSessionError(text: string): ChildEvent | null {
  const session = parseSessionLine(text);
  if (!session) return null;

  const sessionLineEnd = text.indexOf('\n', text.indexOf('(ID:'));
  const body = sessionLineEnd !== -1 ? text.slice(sessionLineEnd + 1).trim() : '';

  return { kind: 'session_error', ...session, body };
}

function parseSessionStale(text: string): ChildEvent | null {
  const session = parseSessionLine(text);
  if (!session) return null;

  const sessionLineEnd = text.indexOf('\n', text.indexOf('(ID:'));
  const body = sessionLineEnd !== -1 ? text.slice(sessionLineEnd + 1).trim() : '';

  return { kind: 'session_stale', ...session, body };
}

function parseSingleEvent(segment: string): ChildEvent | null {
  const trimmed = segment.trim();
  if (trimmed.startsWith('[CHILD APPROVAL REQUEST]')) {
    return parseApprovalRequest(trimmed);
  }
  if (trimmed.startsWith('[CHILD SESSION READY]')) {
    return parseSessionReady(trimmed);
  }
  if (trimmed.startsWith('[CHILD SESSION COMPLETED]')) {
    return parseSessionCompleted(trimmed);
  }
  if (trimmed.startsWith('[CHILD SESSION ERROR]')) {
    return parseSessionError(trimmed);
  }
  if (trimmed.startsWith('[CHILD SESSION STALE]')) {
    return parseSessionStale(trimmed);
  }
  return null;
}

/** Parse a child_event message content. Returns null if any segment fails to parse. */
export function parseChildEvents(content: string): ChildEvent[] | null {
  const segments = content.split('\n\n---\n\n');
  const events: ChildEvent[] = [];

  for (const segment of segments) {
    const parsed = parseSingleEvent(segment);
    if (!parsed) return null;
    events.push(parsed);
  }

  return events.length > 0 ? events : null;
}
