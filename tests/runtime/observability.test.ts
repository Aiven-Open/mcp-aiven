import { describe, it, expect } from 'vitest';
import { redactReasoningField } from '../../src/observability.js';

describe('redactReasoningField', () => {
  it('returns null for undefined', () => {
    expect(redactReasoningField(undefined)).toBeNull();
  });

  it('returns null for null', () => {
    expect(redactReasoningField(null)).toBeNull();
  });

  it('returns empty string as-is', () => {
    expect(redactReasoningField('')).toBe('');
  });

  it('returns plain string as-is', () => {
    expect(redactReasoningField('the user wants to list services')).toBe(
      'the user wants to list services'
    );
  });

  it('redacts string that is a bare sensitive URI', () => {
    expect(redactReasoningField('postgres://admin:secret@host:5432/db')).toBe('[REDACTED_URI]');
  });

  it('redacts a URI embedded in surrounding prose (substring-level)', () => {
    const result = redactReasoningField('connect to postgres://admin:secret@host:5432/db now');
    expect(result).toBe('connect to [REDACTED_URI] now');
  });

  it('serializes object reasoning via JSON.stringify', () => {
    const result = redactReasoningField({ key: 'value', count: 42 });
    expect(result).toBe('{"key":"value","count":42}');
  });

  it('serializes array reasoning via JSON.stringify', () => {
    expect(redactReasoningField([1, 2, 3])).toBe('[1,2,3]');
  });

  it('serializes number reasoning via JSON.stringify', () => {
    expect(redactReasoningField(42)).toBe('42');
  });

  it('serializes boolean reasoning via JSON.stringify', () => {
    expect(redactReasoningField(true)).toBe('true');
  });

  it('falls back to String() for circular references', () => {
    const circular: Record<string, unknown> = { a: 1 };
    circular.self = circular;
    const result = redactReasoningField(circular);
    expect(result).toBe('[object Object]');
  });
});
