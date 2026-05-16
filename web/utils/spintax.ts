/** Preview-only spintax + placeholders (mirrors server logic). */
export function previewTemplate(body: string, sample: Record<string, string>): string {
  let out = body;
  out = out.replace(/\{([^{}]+)\}/g, (_m, inner: string) => {
    const trimmed = inner.trim();
    if (trimmed.includes('|')) {
      const parts = trimmed
        .split('|')
        .map((p) => p.trim())
        .filter(Boolean);
      if (!parts.length) return '';
      return parts[Math.floor(Math.random() * parts.length)]!;
    }
    return sample[trimmed] ?? `{${trimmed}}`;
  });
  return out.replace(/\s+/g, ' ').trim();
}
