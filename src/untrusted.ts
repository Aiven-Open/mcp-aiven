import { randomUUID } from 'node:crypto';
import { UNTRUSTED_DATA_WARNING } from './prompts.js';

/**
 * Wraps a tool response in a randomized boundary so the LLM treats
 * user-controlled fields (service names, tags, logs, user_config values, …)
 * as data, not as instructions. The UUID prevents payloads from forging
 * a closing tag.
 */
export function wrapUntrustedResponse(data: unknown): string {
  const uuid = randomUUID();
  const body = typeof data === 'string' ? data : JSON.stringify(data, null, 2);
  return [
    UNTRUSTED_DATA_WARNING,
    `<untrusted-aiven-response-${uuid}>`,
    body,
    `</untrusted-aiven-response-${uuid}>`,
  ].join('\n');
}
