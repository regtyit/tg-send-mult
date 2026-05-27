import { describe, expect, it } from 'vitest';
import { isTransportProxyError } from '../../src/modules/proxy/assign';
import { TgDomainError } from '../../src/telegram/errors';

describe('isTransportProxyError', () => {
  it('treats network TgDomainError as transport', () => {
    expect(
      isTransportProxyError(
        new TgDomainError({ kind: 'network', code: 'NETWORK', message: 'fail', retryable: true }),
      ),
    ).toBe(true);
  });

  it('treats auth errors as non-transport', () => {
    expect(
      isTransportProxyError(
        new TgDomainError({ kind: 'auth_invalid', code: 'AUTH', message: 'bad session', retryable: false }),
      ),
    ).toBe(false);
  });
});
