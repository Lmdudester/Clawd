import { useMemo, memo } from 'react';
import type { SessionMessage } from '@clawd/shared';
import { ToolCallCard } from './ToolCallCard';
import { ToolResultCard } from './ToolResultCard';

interface Props {
  messages: SessionMessage[];
}

interface ToolPair {
  call: SessionMessage;
  result?: SessionMessage;
}

function pairToolMessages(messages: SessionMessage[]): (ToolPair | SessionMessage)[] {
  const pairs: (ToolPair | SessionMessage)[] = [];
  let i = 0;
  while (i < messages.length) {
    const msg = messages[i];
    if (msg.type === 'tool_call') {
      const pair: ToolPair = { call: msg };
      if (i + 1 < messages.length && messages[i + 1].type === 'tool_result') {
        pair.result = messages[i + 1];
        i += 2;
      } else {
        i++;
      }
      pairs.push(pair);
    } else if (msg.type === 'tool_result') {
      // Orphaned result — render standalone
      pairs.push(msg);
      i++;
    } else {
      i++;
    }
  }
  return pairs;
}

export const ToolGroup = memo(function ToolGroup({ messages }: Props) {
  const pairs = useMemo(() => pairToolMessages(messages), [messages]);

  return (
    <div className="space-y-1">
      {pairs.map((item) => {
        if ('call' in item) {
          return (
            <ToolCallCard
              key={item.call.id}
              message={item.call}
              result={item.result}
            />
          );
        }
        // Orphaned tool_result
        return <ToolResultCard key={item.id} message={item} />;
      })}
    </div>
  );
});
