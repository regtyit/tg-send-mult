import type { ContactDoc } from '../../db/models/Contact';

/**
 * Renders `{a|b|c}` or `{a,b,c}` spintax and `{field}` placeholders
 * from contact.extras + built-ins.
 */
export function renderTemplateBody(body: string, contact: ContactDoc): string {
  const vars: Record<string, string> = {
    name: contact.firstName || '',
    firstName: contact.firstName || '',
    lastName: contact.lastName || '',
    phone: contact.phoneE164 || '',
    username: contact.username || '',
    ...(typeof contact.extras === 'object' && contact.extras && !Array.isArray(contact.extras)
      ? (contact.extras as Record<string, string>)
      : {}),
  };

  let out = body;
  out = out.replace(/\{([^{}]+)\}/g, (_m, inner: string) => {
    const trimmed = inner.trim();
    const delimiter = trimmed.includes('|') ? '|' : trimmed.includes(',') ? ',' : '';
    if (delimiter) {
      const parts = trimmed.split(delimiter).map((p) => p.trim()).filter(Boolean);
      if (parts.length === 0) return '';
      return parts[Math.floor(Math.random() * parts.length)]!;
    }
    return vars[trimmed] ?? `{${trimmed}}`;
  });

  return out.replace(/\s+/g, ' ').trim();
}
