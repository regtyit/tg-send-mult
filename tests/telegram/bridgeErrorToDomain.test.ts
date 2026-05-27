import { describe, expect, it } from 'vitest';
import { bridgeErrorToDomain } from '../../src/telegram/errors';

describe('bridgeErrorToDomain', () => {
  it('maps AUTH_KEY_UNREGISTERED via code even when message is descriptive', () => {
    const e = bridgeErrorToDomain({
      code: 'AUTH_KEY_UNREGISTERED',
      message: 'The key is not registered in the system',
    });
    expect(e.kind).toBe('auth_invalid');
    expect(e.code).toBe('AUTH_KEY_UNREGISTERED');
    expect(e.retryable).toBe(false);
    expect(e.message).toContain('AUTH_KEY_UNREGISTERED');
    expect(e.message).toContain('The key is not registered');
  });

  it('maps SESSION_REVOKED via code', () => {
    const e = bridgeErrorToDomain({
      code: 'SESSION_REVOKED',
      message: 'The session has been revoked from another device',
    });
    expect(e.kind).toBe('auth_invalid');
    expect(e.retryable).toBe(false);
  });

  it('maps PEER_FLOOD via code', () => {
    const e = bridgeErrorToDomain({
      code: 'PEER_FLOOD',
      message: 'Too many requests from this user',
    });
    expect(e.kind).toBe('peer_flood');
    expect(e.retryable).toBe(false);
  });

  it('maps PHONE_NUMBER_BANNED via code', () => {
    const e = bridgeErrorToDomain({
      code: 'PHONE_NUMBER_BANNED',
      message: 'The phone number has been banned',
    });
    expect(e.kind).toBe('phone_banned');
    expect(e.retryable).toBe(false);
  });

  it('maps USER_PRIVACY_RESTRICTED via code', () => {
    const e = bridgeErrorToDomain({
      code: 'USER_PRIVACY_RESTRICTED',
      message: 'Cannot message this user due to privacy settings',
    });
    expect(e.kind).toBe('peer_blocked');
  });

  it('maps FLOOD_WAIT_X via code prefix', () => {
    const e = bridgeErrorToDomain({ code: 'FLOOD_WAIT_30', message: 'wait' });
    expect(e.kind).toBe('flood_wait');
    expect(e.waitSeconds).toBe(30);
    expect(e.retryable).toBe(true);
  });

  it('uses waitSeconds when provided even if code is unknown', () => {
    const e = bridgeErrorToDomain({ code: 'UNKNOWN_CODE', message: 'x', waitSeconds: 17 });
    expect(e.kind).toBe('flood_wait');
    expect(e.waitSeconds).toBe(17);
  });

  it('falls back to message-based classification when code is non-standard', () => {
    const e = bridgeErrorToDomain({
      code: 'RPC_ERROR',
      message: 'PEER_ID_INVALID',
    });
    expect(e.kind).toBe('peer_invalid');
  });

  it('classifies Telethon cannot-find-entity as peer_invalid', () => {
    const e = bridgeErrorToDomain({
      code: 'INVALID_INPUT',
      message: 'Cannot find any entity corresponding to "+14786079026"',
    });
    expect(e.kind).toBe('peer_invalid');
    expect(e.retryable).toBe(false);
  });

  it('classifies network-ish errors as retryable', () => {
    const e = bridgeErrorToDomain({
      code: 'CONNECTION_FAILED',
      message: 'ECONNRESET while connecting to dc',
    });
    expect(e.kind).toBe('network');
    expect(e.retryable).toBe(true);
  });

  it('classifies IncompleteRead / bytes-read mismatch as retryable network', () => {
    const e = bridgeErrorToDomain({
      code: 'INCOMPLETEREADERROR',
      message: '0 bytes read on a total of 138 expected bytes',
    });
    expect(e.kind).toBe('network');
    expect(e.retryable).toBe(true);
  });

  it('classifies FakeTLS digest mismatch as retryable network failure', () => {
    const e = bridgeErrorToDomain({
      code: 'EXCEPTION',
      message: 'FakeTLS server hello verification failed.',
    });
    expect(e.kind).toBe('network');
    expect(e.code).toBe('NETWORK');
    expect(e.retryable).toBe(true);
  });

  it('falls back to unknown when nothing matches', () => {
    const e = bridgeErrorToDomain({
      code: 'SOMETHING_WEIRD',
      message: 'totally unexpected condition',
    });
    expect(e.kind).toBe('unknown');
    expect(e.retryable).toBe(false);
  });
});
