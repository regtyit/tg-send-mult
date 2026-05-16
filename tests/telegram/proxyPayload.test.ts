import { describe, expect, it } from 'vitest';
import { normalizeMtProxySecret, proxyDocToTelethonPayload } from '../../src/telegram/proxyPayload';

describe('normalizeMtProxySecret', () => {
  it('keeps classic 32-char secrets', () => {
    const s = 'ee49dc1068b452d2bf05d6e6028c74a4';
    expect(normalizeMtProxySecret(s)).toBe(s);
  });

  it('extracts secret from https t.me/proxy link and keeps full payload', () => {
    const link =
      'https://t.me/proxy?server=31.76.240.187&port=443&secret=ee49dc1068b452d2bf05d6e6028c74a4cd7765622e6d61782e7275';
    expect(normalizeMtProxySecret(link)).toBe(
      'ee49dc1068b452d2bf05d6e6028c74a4cd7765622e6d61782e7275',
    );
  });

  it('extracts secret from schemeless t.me/proxy link (must not corrupt with server IP digits)', () => {
    const link =
      't.me/proxy?server=31.76.240.187&port=443&secret=ee49dc1068b452d2bf05d6e6028c74a4cd7765622e6d61782e7275';
    expect(normalizeMtProxySecret(link)).toBe(
      'ee49dc1068b452d2bf05d6e6028c74a4cd7765622e6d61782e7275',
    );
  });

  it('extracts secret from tg://proxy link', () => {
    const link =
      'tg://proxy?server=31.76.240.187&port=443&secret=ee49dc1068b452d2bf05d6e6028c74a4cd7765622e6d61782e7275';
    expect(normalizeMtProxySecret(link)).toBe(
      'ee49dc1068b452d2bf05d6e6028c74a4cd7765622e6d61782e7275',
    );
  });

  it('supports dd-prefixed secrets from links', () => {
    const hex =
      'dd0000000000000000000000000000000000000000000000000000000000000000';
    expect(
      normalizeMtProxySecret(
        `t.me/proxy?server=1.1.1.1&port=443&secret=${hex}`,
      ),
    ).toBe(hex);
  });

  it('normalizes non-hex separators but does not truncate', () => {
    const raw = 'EE49DC1068B452D2-BF05D6E6028C74A4 cd7765622e6d61782e7275';
    expect(normalizeMtProxySecret(raw)).toBe(
      'ee49dc1068b452d2bf05d6e6028c74a4cd7765622e6d61782e7275',
    );
  });

  it('recovers real ee secret from previously corrupted hex-stripped link value', () => {
    const corrupted =
      'ee3176240187443ee49dc1068b452d2bf05d6e6028c74a4cd7765622e6d61782e7275';
    expect(normalizeMtProxySecret(corrupted)).toBe(
      'ee49dc1068b452d2bf05d6e6028c74a4cd7765622e6d61782e7275',
    );
  });
});

describe('proxyDocToTelethonPayload', () => {
  it('expands mtproto host when it is a schemeless share link', () => {
    const out = proxyDocToTelethonPayload({
      label: 'p',
      type: 'mtproto',
      host: 't.me/proxy?server=31.76.240.187&port=443&secret=ee49dc1068b452d2bf05d6e6028c74a4cd7765622e6d61782e7275',
      port: 9999,
      secret: '',
    } as Parameters<typeof proxyDocToTelethonPayload>[0]);
    expect(out).toEqual({
      type: 'mtproto',
      host: '31.76.240.187',
      port: 443,
      secret: 'ee49dc1068b452d2bf05d6e6028c74a4cd7765622e6d61782e7275',
    });
  });

  it('maps http proxy payload with credentials', () => {
    const out = proxyDocToTelethonPayload({
      label: 'http1',
      type: 'http',
      host: '127.0.0.1',
      port: 8080,
      login: 'u',
      password: 'p',
    } as Parameters<typeof proxyDocToTelethonPayload>[0]);
    expect(out).toEqual({
      type: 'http',
      host: '127.0.0.1',
      port: 8080,
      username: 'u',
      password: 'p',
    });
  });
});
