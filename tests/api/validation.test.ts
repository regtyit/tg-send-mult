import { describe, expect, it } from 'vitest';
import {
  accountCreateBody,
  accountImportTdataBody,
  accountPatchBody,
  campaignCreateBody,
  contactsImportBody,
  contactsQuery,
  idParams,
  messagesQuery,
  proxyCreateBody,
  proxyPatchBody,
  templateCreateBody,
} from '../../src/apps/api/validation';

const VALID_ID = '507f1f77bcf86cd799439011';

describe('idParams', () => {
  it('accepts valid 24-char hex ObjectId', () => {
    expect(idParams.parse({ id: VALID_ID })).toEqual({ id: VALID_ID });
  });

  it('rejects malformed ids', () => {
    expect(() => idParams.parse({ id: 'too-short' })).toThrow();
    expect(() => idParams.parse({ id: 'zzzzzzzzzzzzzzzzzzzzzzzz' })).toThrow();
    expect(() => idParams.parse({})).toThrow();
  });
});

describe('accountCreateBody', () => {
  it('accepts a minimal body', () => {
    const out = accountCreateBody.parse({ phone: '+14155552671' });
    expect(out.phone).toBe('+14155552671');
    expect(out.label).toBe('');
  });

  it('accepts api_id+api_hash together', () => {
    const out = accountCreateBody.parse({
      phone: '+14155552671',
      telegramApiId: 12345,
      telegramApiHash: 'deadbeef',
    });
    expect(out.telegramApiId).toBe(12345);
    expect(out.telegramApiHash).toBe('deadbeef');
  });

  it('rejects unknown fields (strict)', () => {
    expect(() =>
      accountCreateBody.parse({ phone: '+14155552671', sneaky: 'x' }),
    ).toThrow();
  });

  it('rejects bad phones', () => {
    expect(() => accountCreateBody.parse({ phone: 'abc' })).toThrow();
    expect(() => accountCreateBody.parse({ phone: '' })).toThrow();
    expect(() => accountCreateBody.parse({ phone: '+1' })).toThrow();
  });
});

describe('accountPatchBody', () => {
  it('accepts known status values', () => {
    expect(accountPatchBody.parse({ status: 'active' }).status).toBe('active');
    expect(accountPatchBody.parse({ status: 'banned' }).status).toBe('banned');
  });

  it('rejects unknown status', () => {
    expect(() => accountPatchBody.parse({ status: 'mystery' })).toThrow();
  });

  it('accepts proxyId: null to clear assignment', () => {
    expect(accountPatchBody.parse({ proxyId: null }).proxyId).toBeNull();
  });
});

describe('proxyCreateBody', () => {
  it('accepts mtproto proxy', () => {
    const out = proxyCreateBody.parse({
      label: 'us-1',
      type: 'mtproto',
      host: 'mtp.example.com',
      port: 443,
      country: 'US',
      secret: 'feedface',
    });
    expect(out.type).toBe('mtproto');
    expect(out.country).toBe('US');
  });

  it('rejects port outside 1..65535', () => {
    expect(() =>
      proxyCreateBody.parse({ label: 'a', type: 'socks5', host: 'h', port: 0 }),
    ).toThrow();
    expect(() =>
      proxyCreateBody.parse({ label: 'a', type: 'socks5', host: 'h', port: 70000 }),
    ).toThrow();
  });

  it('rejects unknown type', () => {
    expect(() =>
      proxyCreateBody.parse({ label: 'a', type: 'weird', host: 'h', port: 80 }),
    ).toThrow();
  });

  it('accepts http proxy type', () => {
    const out = proxyCreateBody.parse({ label: 'h', type: 'http', host: 'h.example', port: 8080 });
    expect(out.type).toBe('http');
  });
});

describe('proxyPatchBody', () => {
  it('accepts partial patch including type/login/password', () => {
    const out = proxyPatchBody.parse({
      type: 'socks5',
      login: 'user',
      password: 'pass',
    });
    expect(out.type).toBe('socks5');
    expect(out.login).toBe('user');
  });
});

describe('accountImportTdataBody', () => {
  it('requires jsonPath together with tdataPath', () => {
    expect(() =>
      accountImportTdataBody.parse({
        phone: '+14155552671',
        tdataPath: '/tmp/tdata',
      }),
    ).toThrow();
  });

  it('accepts tdata+json payload without phone when JSON will supply it', () => {
    const out = accountImportTdataBody.parse({
      tdataPath: '/tmp/tdata',
      jsonPath: '/tmp/info.json',
    });
    expect(out.phone).toBeUndefined();
    expect(out.jsonPath).toBe('/tmp/info.json');
  });

  it('accepts full tdata+json payload', () => {
    const out = accountImportTdataBody.parse({
      phone: '+14155552671',
      tdataPath: '/tmp/tdata',
      jsonPath: '/tmp/info.json',
      role: 'test_recipient',
    });
    expect(out.jsonPath).toBe('/tmp/info.json');
    expect(out.role).toBe('test_recipient');
  });
});

describe('contactsImportBody', () => {
  it('requires either csv or json', () => {
    expect(() => contactsImportBody.parse({})).toThrow();
    expect(contactsImportBody.parse({ csv: 'phone\n+1' })).toBeTruthy();
    expect(contactsImportBody.parse({ json: '[{"phone":"+1"}]' })).toBeTruthy();
  });
});

describe('templateCreateBody', () => {
  it('accepts a minimal body', () => {
    const out = templateCreateBody.parse({ name: 'welcome', body: 'hi' });
    expect(out.name).toBe('welcome');
  });

  it('rejects empty body', () => {
    expect(() => templateCreateBody.parse({ name: 'a', body: '' })).toThrow();
  });
});

describe('campaignCreateBody', () => {
  it('accepts a minimal body', () => {
    const out = campaignCreateBody.parse({
      name: 'newsletter',
      templateId: VALID_ID,
      accountPool: ['+14155552671'],
    });
    expect(out.accountPool).toEqual(['+14155552671']);
  });

  it('requires non-empty accountPool', () => {
    expect(() =>
      campaignCreateBody.parse({
        name: 'a',
        templateId: VALID_ID,
        accountPool: [],
      }),
    ).toThrow();
  });
});

describe('messagesQuery', () => {
  it('coerces strings to numbers', () => {
    const out = messagesQuery.parse({ limit: '50', skip: '10' });
    expect(out.limit).toBe(50);
    expect(out.skip).toBe(10);
  });

  it('caps and floors limit/skip', () => {
    expect(() => messagesQuery.parse({ limit: '0' })).toThrow();
    expect(() => messagesQuery.parse({ limit: '1000' })).toThrow();
    expect(() => messagesQuery.parse({ skip: '-1' })).toThrow();
  });

  it('rejects unknown status values', () => {
    expect(() => messagesQuery.parse({ status: 'mystery' })).toThrow();
  });

  it('accepts paginated as boolean string', () => {
    const out = messagesQuery.parse({ paginated: 'true' });
    expect(out.paginated).toBe(true);
  });
});

describe('contactsQuery', () => {
  it('accepts q + tag filters', () => {
    const out = contactsQuery.parse({ q: 'alex', tag: 'us', limit: '25' });
    expect(out.q).toBe('alex');
    expect(out.tag).toBe('us');
    expect(out.limit).toBe(25);
  });

  it('rejects very long q', () => {
    expect(() => contactsQuery.parse({ q: 'x'.repeat(300) })).toThrow();
  });
});
