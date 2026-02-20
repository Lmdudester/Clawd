import type { SessionMessage } from '@clawd/shared';

export type Segment =
  | { kind: 'message'; message: SessionMessage }
  | { kind: 'tool_group'; messages: SessionMessage[] }
  | { kind: 'plan_write'; toolCall: SessionMessage; result?: SessionMessage; fullContent: string };

export function isPlanFileWrite(msg: SessionMessage): boolean {
  if (msg.type !== 'tool_call') return false;
  if (msg.toolName !== 'Write' && msg.toolName !== 'Edit') return false;
  const filePath = String((msg.toolInput as Record<string, unknown>)?.file_path ?? '');
  return filePath.includes('.claude/plans/') || filePath.includes('.claude\\plans\\');
}

export function groupMessages(messages: SessionMessage[]): Segment[] {
  const segments: Segment[] = [];
  // Track accumulated plan content per file path for Edit support
  const planContent = new Map<string, string>();
  let i = 0;
  while (i < messages.length) {
    const msg = messages[i];
    if (msg.type === 'tool_call' || msg.type === 'tool_result') {
      // Collect the full consecutive tool_call/tool_result sequence
      const group: SessionMessage[] = [];
      while (i < messages.length && (messages[i].type === 'tool_call' || messages[i].type === 'tool_result')) {
        group.push(messages[i]);
        i++;
      }

      // Split into plan_write segments and remaining tool_group segments
      const nonPlan: SessionMessage[] = [];
      for (let j = 0; j < group.length; j++) {
        const m = group[j];
        if (isPlanFileWrite(m)) {
          // Flush any accumulated non-plan messages as a tool_group
          if (nonPlan.length > 0) {
            segments.push({ kind: 'tool_group', messages: [...nonPlan] });
            nonPlan.length = 0;
          }
          // Check if the next message is the corresponding tool_result
          let result: SessionMessage | undefined;
          if (j + 1 < group.length && group[j + 1].type === 'tool_result') {
            result = group[j + 1];
            j++; // skip the result in the loop
          }

          // Build full plan content by applying writes/edits
          const input = m.toolInput as Record<string, unknown> | undefined;
          const filePath = String(input?.file_path ?? '');
          let fullContent: string;
          if (m.toolName === 'Write') {
            fullContent = String(input?.content ?? '');
          } else {
            // Edit: apply replacement on accumulated content
            const prev = planContent.get(filePath) ?? '';
            const oldStr = String(input?.old_string ?? '');
            const newStr = String(input?.new_string ?? '');
            fullContent = oldStr ? prev.replace(oldStr, newStr) : prev;
          }
          planContent.set(filePath, fullContent);

          segments.push({ kind: 'plan_write', toolCall: m, result, fullContent });
        } else {
          nonPlan.push(m);
        }
      }
      // Flush remaining non-plan messages
      if (nonPlan.length > 0) {
        segments.push({ kind: 'tool_group', messages: nonPlan });
      }
    } else {
      segments.push({ kind: 'message', message: msg });
      i++;
    }
  }
  return segments;
}
