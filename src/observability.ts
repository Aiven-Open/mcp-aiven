import { randomUUID } from 'node:crypto';
import { scrubReasoning } from './security.js';

export function generateRequestId(): string {
  return randomUUID();
}

export function redactReasoningField(reasoning: unknown): string | null {
  if (reasoning === undefined || reasoning === null) {
    return null;
  }
  if (typeof reasoning !== 'string') {
    let stringified: string;
    try {
      stringified = JSON.stringify(reasoning);
    } catch {
      // eslint-disable-next-line @typescript-eslint/no-base-to-string
      stringified = String(reasoning);
    }
    return scrubReasoning(stringified);
  }
  if (reasoning.length === 0) {
    return reasoning;
  }
  return scrubReasoning(reasoning);
}

export function createObservabilityContext(reasoning?: string): {
  requestId: string;
  toolReasoning: string | null;
} {
  return {
    requestId: generateRequestId(),
    toolReasoning: redactReasoningField(reasoning),
  };
}
