import { describe, expect, it, vi } from 'vitest';
import type { ContactDoc } from '../../src/db/models/Contact';
import { renderTemplateBody } from '../../src/modules/template/render';

function makeContact(partial: Partial<ContactDoc>): ContactDoc {
  return {
    phoneE164: partial.phoneE164 ?? '+10000000000',
    firstName: partial.firstName ?? '',
    lastName: partial.lastName ?? '',
    username: partial.username ?? '',
    extras: partial.extras ?? {},
    ...partial,
  } as ContactDoc;
}

describe('renderTemplateBody', () => {
  it('replaces placeholders from contact', () => {
    const c = makeContact({ firstName: 'Alex', phoneE164: '+79991234567' });
    const out = renderTemplateBody('Hi {name}, phone {phone}', c);
    expect(out).toBe('Hi Alex, phone +79991234567');
  });

  it('spintax picks option based on Math.random', () => {
    vi.spyOn(Math, 'random').mockReturnValue(0);
    const c = makeContact({});
    const out = renderTemplateBody('{A|B|C}', c);
    expect(out).toBe('A');
    vi.restoreAllMocks();
  });

  it('comma choices pick option based on Math.random', () => {
    vi.spyOn(Math, 'random').mockReturnValue(0.99);
    const c = makeContact({});
    const out = renderTemplateBody('{Joe, Moe}', c);
    expect(out).toBe('Moe');
    vi.restoreAllMocks();
  });

  it('leaves unknown placeholder as literal', () => {
    const c = makeContact({});
    expect(renderTemplateBody('x {missing} y', c)).toBe('x {missing} y');
  });
});
