import { describe, it, expect, vi, afterEach } from 'vitest';
import {
  INITIAL_BUILD_WINDOW_MS,
  isInitialProvisioning,
  enrichServiceRecord,
  enrichServiceResponse,
} from '../../src/shared/service-state.js';

describe('service-state', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  describe('isInitialProvisioning', () => {
    it('returns true for REBUILDING within the initial build window', () => {
      vi.useFakeTimers();
      vi.setSystemTime(new Date('2026-05-27T12:00:00Z'));
      const createTime = new Date('2026-05-27T11:45:00Z').toISOString();
      expect(isInitialProvisioning('REBUILDING', createTime)).toBe(true);
    });

    it('returns false for REBUILDING outside the initial build window', () => {
      vi.useFakeTimers();
      vi.setSystemTime(new Date('2026-05-27T12:00:00Z'));
      const createTime = new Date(
        Date.now() - INITIAL_BUILD_WINDOW_MS - 60_000
      ).toISOString();
      expect(isInitialProvisioning('REBUILDING', createTime)).toBe(false);
    });

    it('returns true when assumeRecent is set', () => {
      expect(isInitialProvisioning('REBUILDING', undefined, { assumeRecent: true })).toBe(true);
    });

    it('returns false for RUNNING', () => {
      expect(isInitialProvisioning('RUNNING', new Date().toISOString())).toBe(false);
    });
  });

  describe('enrichServiceRecord', () => {
    it('adds state_display BUILDING for recent REBUILDING services', () => {
      vi.useFakeTimers();
      vi.setSystemTime(new Date('2026-05-27T12:00:00Z'));
      const enriched = enrichServiceRecord({
        state: 'REBUILDING',
        create_time: new Date('2026-05-27T11:50:00Z').toISOString(),
      });
      expect(enriched).toEqual({
        state: 'REBUILDING',
        create_time: '2026-05-27T11:50:00.000Z',
        state_display: 'BUILDING',
      });
    });

    it('leaves state unchanged when not initial provisioning', () => {
      const service = { state: 'RUNNING', create_time: new Date().toISOString() };
      expect(enrichServiceRecord(service)).toBe(service);
    });
  });

  describe('enrichServiceResponse', () => {
    it('enriches nested service object', () => {
      const data = enrichServiceResponse(
        { service: { state: 'REBUILDING' } },
        { assumeRecent: true }
      );
      expect(data).toEqual({
        service: { state: 'REBUILDING', state_display: 'BUILDING' },
      });
    });
  });
});
