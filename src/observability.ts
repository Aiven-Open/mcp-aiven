import { randomUUID } from 'node:crypto';
import { redactSensitiveData } from './security.js';

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
    const wrapped = { reasoning: stringified };
    const redacted = redactSensitiveData(wrapped) as { reasoning: string };
    return redacted.reasoning;
  }
  if (reasoning.length === 0) {
    return reasoning;
  }
  const wrapped = { reasoning };
  const redacted = redactSensitiveData(wrapped) as { reasoning: string };
  return redacted.reasoning;
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
