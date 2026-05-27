import { describe, expect, it } from 'vitest';
import { bridgeErrorToDomain, mapTgError, TgDomainError } from '../../src/telegram/errors';

describe('mapTgError', () => {
  it('maps FLOOD_WAIT with seconds', () => {
    const e = mapTgError({ errorMessage: 'FLOOD_WAIT_42' });
    expect(e).toBeInstanceOf(TgDomainError);
    expect(e.kind).toBe('flood_wait');
    expect(e.waitSeconds).toBe(42);
    expect(e.retryable).toBe(true);
  });

  it('maps PEER_FLOOD', () => {
    const e = mapTgError({ errorMessage: 'PEER_FLOOD' });
    expect(e.kind).toBe('peer_flood');
    expect(e.retryable).toBe(false);
  });

  it('maps USER_PRIVACY_RESTRICTED', () => {
    const e = mapTgError({ errorMessage: 'USER_PRIVACY_RESTRICTED' });
    expect(e.kind).toBe('peer_blocked');
  });

  it('maps AUTH_KEY_UNREGISTERED', () => {
    const e = mapTgError({ errorMessage: 'AUTH_KEY_UNREGISTERED' });
    expect(e.kind).toBe('auth_invalid');
  });

  it('maps network-ish errors as retryable', () => {
    const e = mapTgError(new Error('ECONNRESET'));
    expect(e.kind).toBe('network');
    expect(e.retryable).toBe(true);
  });

  it('maps asyncio IncompleteRead text as network', () => {
    const e = mapTgError({ errorMessage: '0 bytes read on a total of 138 expected bytes' });
    expect(e.kind).toBe('network');
    expect(e.retryable).toBe(true);
  });

  it('maps PYTHON_EXCEPTION bridge payload when message is IncompleteRead', () => {
    const e = bridgeErrorToDomain({
      code: 'PYTHON_EXCEPTION',
      message: '0 bytes read on a total of 138 expected bytes',
    });
    expect(e.kind).toBe('network');
    expect(e.retryable).toBe(true);
  });

  it('passes through TgDomainError', () => {
    const orig = new TgDomainError({
      kind: 'flood_wait',
      code: 'X',
      message: 'm',
      waitSeconds: 1,
    });
    expect(mapTgError(orig)).toBe(orig);
  });
});
