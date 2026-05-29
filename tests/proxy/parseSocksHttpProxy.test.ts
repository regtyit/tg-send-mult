import { describe, expect, it } from 'vitest';
import {
  coerceSocksHttpImportFields,
  parseSocksHttpProxyLine,
} from '../../src/modules/proxy/parseSocksHttpProxy';

describe('parseSocksHttpProxy', () => {
  it('parses host:port:login:password', () => {
    expect(parseSocksHttpProxyLine('203.0.113.10:8080:myuser:mypass')).toEqual({
      host: '203.0.113.10',
      port: 8080,
      login: 'myuser',
      password: 'mypass',
    });
  });

  it('parses hostname:port:login:password', () => {
    expect(parseSocksHttpProxyLine('proxy.example.com:3128:u:p')).toEqual({
      host: 'proxy.example.com',
      port: 3128,
      login: 'u',
      password: 'p',
    });
  });

  it('parses host:port only', () => {
    expect(parseSocksHttpProxyLine('1.2.3.4:1080')).toEqual({
      host: '1.2.3.4',
      port: 1080,
      login: '',
      password: '',
    });
  });

  it('coerces from host field on import', () => {
    const c = coerceSocksHttpImportFields({ host: '10.0.0.1:8888:alice:secret', port: 443 });
    expect(c).toEqual({
      host: '10.0.0.1',
      port: 8888,
      login: 'alice',
      password: 'secret',
    });
  });
});
