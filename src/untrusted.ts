import { randomUUID } from 'node:crypto';
import { UNTRUSTED_DATA_WARNING } from './prompts.js';

/**
 * Wraps a tool response in a randomized boundary so the LLM treats
 * user-controlled fields (service names, tags, logs, user_config values, …)
 * as data, not as instructions. The UUID prevents payloads from forging
 * a closing tag.
 */
const BOUNDARY_TAG = 'untrusted-aiven-response';

export function wrapUntrustedResponse(data: unknown): string {
  const uuid = randomUUID();
  const body = typeof data === 'string' ? data : JSON.stringify(data, null, 2);
  return [
    UNTRUSTED_DATA_WARNING,
    `<${BOUNDARY_TAG}-${uuid}>`,
    body,
    `</${BOUNDARY_TAG}-${uuid}>`,
  ].join('\n');
}

/**
 * Places server-authored guidance before an untrusted response boundary.
 *
 * Guidance must not contain values copied from API responses or user input.
 */
export function wrapUntrustedResponseWithGuidance(
  guidance: unknown,
  data: unknown
): string {
  const body =
    typeof guidance === 'string' ? guidance : JSON.stringify(guidance, null, 2);
  return [`Trusted server guidance:\n${body}`, wrapUntrustedResponse(data)].join(
    '\n\n'
  );
}

/**
 * Strips the untrusted-data warning and boundary tags, returning just the body.
 * Used before security-scanning output so our own wrapper isn't mistaken for
 * an injection. Returns the input unchanged if it isn't a wrapped response.
 */
export function unwrapUntrustedResponse(text: string): string {
  const match = text.match(
    new RegExp(`<${BOUNDARY_TAG}-[^>]+>\\n([\\s\\S]*)\\n</${BOUNDARY_TAG}-[^>]+>`)
  );
  return match?.[1] ?? text;
}
