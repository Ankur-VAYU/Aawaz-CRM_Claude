import type { FastifyBaseLogger } from 'fastify';

export interface OutgoingMessage {
  to: string; // E.164
  body: string;
  kind: 'otp' | 'receipt' | 'reminder' | 'daily_summary';
}

/**
 * Delivers a text message to a phone (WhatsApp, SMS, ...). Swap in a real provider implementation
 * (e.g. WhatsApp Business Cloud API) in `server.ts`; tests and local development use the log sender.
 */
export interface MessageSender {
  send(message: OutgoingMessage): Promise<void>;
}

export class LogSender implements MessageSender {
  constructor(private readonly log: Pick<FastifyBaseLogger, 'info'>) {}
  async send(message: OutgoingMessage) {
    this.log.info({ to: message.to, kind: message.kind }, `[message] ${message.body}`);
  }
}

/** Keeps messages in memory; used by tests. */
export class MemorySender implements MessageSender {
  sent: OutgoingMessage[] = [];
  failNext = 0;
  async send(message: OutgoingMessage) {
    if (this.failNext > 0) {
      this.failNext--;
      throw new Error('simulated delivery failure');
    }
    this.sent.push(message);
  }
}
