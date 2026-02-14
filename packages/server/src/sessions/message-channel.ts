// AsyncIterable bridge for pushing user messages into the Agent SDK.
// The SDK consumes this as its streaming input source.

import type { SDKUserMessage } from '@anthropic-ai/claude-agent-sdk';

interface Waiter {
  resolve: (value: IteratorResult<SDKUserMessage>) => void;
}

export class MessageChannel {
  private queue: SDKUserMessage[] = [];
  private waiters: Waiter[] = [];
  private closed = false;

  push(message: SDKUserMessage): void {
    if (this.closed) return;

    if (this.waiters.length > 0) {
      const waiter = this.waiters.shift()!;
      waiter.resolve({ value: message, done: false });
    } else {
      this.queue.push(message);
    }
  }

  close(): void {
    this.closed = true;
    for (const waiter of this.waiters) {
      waiter.resolve({ value: undefined as any, done: true });
    }
    this.waiters = [];
  }

  [Symbol.asyncIterator](): AsyncIterator<SDKUserMessage> {
    return {
      next: (): Promise<IteratorResult<SDKUserMessage>> => {
        if (this.queue.length > 0) {
          return Promise.resolve({ value: this.queue.shift()!, done: false });
        }

        if (this.closed) {
          return Promise.resolve({ value: undefined as any, done: true });
        }

        return new Promise<IteratorResult<SDKUserMessage>>((resolve) => {
          this.waiters.push({ resolve });
        });
      },
    };
  }
}
