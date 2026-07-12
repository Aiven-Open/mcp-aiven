import { describe, it, expect } from 'vitest';
import { readOnlyInstructions } from '../../src/prompts.js';

describe('readOnlyInstructions', () => {
  describe('without a write allowlist', () => {
    it('states no writes are possible', () => {
      const text = readOnlyInstructions('http');
      expect(text).toContain('READ-ONLY mode');
      expect(text).toContain('CANNOT create, update, or delete any resources');
    });

    it('treats an empty allowlist the same as none', () => {
      const text = readOnlyInstructions('http', new Set());
      expect(text).toContain('CANNOT create, update, or delete any resources');
      expect(text).not.toContain('write allowlist');
    });

    it('gives the http reconnect hint', () => {
      const text = readOnlyInstructions('http');
      expect(text).toContain('reconnect without the `read_only=true` query parameter');
    });

    it('gives the stdio env-var hint', () => {
      const text = readOnlyInstructions('stdio');
      expect(text).toContain('AIVEN_READ_ONLY=false');
    });
  });

  describe('with a write allowlist', () => {
    it('names the re-enabled write tools and does not claim writes are impossible', () => {
      const text = readOnlyInstructions('http', new Set(['aiven_service_create']));
      expect(text).toContain('write allowlist');
      expect(text).toContain('aiven_service_create');
      expect(text).toContain('you CAN use');
      expect(text).not.toContain('CANNOT create, update, or delete any resources');
    });

    it('lists multiple allowlisted tools sorted for stable output', () => {
      const text = readOnlyInstructions('http', new Set(['aiven_service_create', 'aiven_kafka_topic_create']));
      expect(text).toContain('aiven_kafka_topic_create, aiven_service_create');
    });

    it('still explains how to fully disable read-only mode', () => {
      const text = readOnlyInstructions('stdio', new Set(['aiven_service_create']));
      expect(text).toContain('AIVEN_READ_ONLY=false');
    });
  });
});
