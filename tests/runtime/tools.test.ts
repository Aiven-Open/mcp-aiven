import { describe, it, expect } from 'vitest';
import {
  toolSuccess,
  toolError,
  READ_ONLY_ANNOTATIONS,
  CREATE_ANNOTATIONS,
  DELETE_ANNOTATIONS,
} from '../../src/types.js';

function firstTextContent(
  content: Array<{ type: string; text?: string }> | undefined
): string | undefined {
  const c = content?.[0];
  return c?.type === 'text' ? c.text : undefined;
}

describe('toolSuccess', () => {
  it('should create success result with compact JSON by default', () => {
    const data = { name: 'test', value: 123 };
    const result = toolSuccess(data);

    expect(result.content).toHaveLength(1);
    expect(result.content[0]?.type).toBe('text');
    expect(firstTextContent(result.content)).toBe(JSON.stringify(data));
    expect(result.isError).toBeUndefined();
  });

  it('should pass through strings without JSON-wrapping', () => {
    const result = toolSuccess('plain text');

    expect(firstTextContent(result.content)).toBe('plain text');
  });

  it('should handle complex objects with compact JSON', () => {
    const data = {
      services: [
        { name: 'pg-1', state: 'RUNNING' },
        { name: 'kafka-1', state: 'RUNNING' },
      ],
    };
    const result = toolSuccess(data);

    expect(firstTextContent(result.content)).toBe(JSON.stringify(data));
  });
});

describe('toolError', () => {
  it('should create error result', () => {
    const result = toolError('Something went wrong');

    expect(result.content).toHaveLength(1);
    expect(firstTextContent(result.content)).toBe('Something went wrong');
    expect(result.isError).toBe(true);
  });
});

describe('Tool annotations', () => {
  it('should have correct read-only annotations', () => {
    expect(READ_ONLY_ANNOTATIONS).toEqual({
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: true,
    });
  });

  it('should have correct create annotations', () => {
    expect(CREATE_ANNOTATIONS).toEqual({
      readOnlyHint: false,
      destructiveHint: false,
      idempotentHint: false,
      openWorldHint: true,
    });
  });

  it('should have correct delete annotations', () => {
    expect(DELETE_ANNOTATIONS).toEqual({
      readOnlyHint: false,
      destructiveHint: true,
      idempotentHint: true,
      openWorldHint: true,
    });
  });
});
