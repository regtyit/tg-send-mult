import { describe, expect, it } from 'vitest';
import { suggestWarmupPreset } from '../../src/modules/dialog/suggestWarmupPreset';

describe('suggestWarmupPreset', () => {
  const baseAccount = {
    warmingScriptDaysCompleted: 0,
    warmingUsedPresetSlugs: [] as string[],
    deviceProfile: { langCode: 'en' },
  };

  it('picks first unused preset for slot 1', () => {
    const s = suggestWarmupPreset(baseAccount);
    expect(s?.slug).toBeTruthy();
  });

  it('excludes batch-assigned slugs so pairs get different templates', () => {
    const first = suggestWarmupPreset(baseAccount);
    expect(first).not.toBeNull();
    const second = suggestWarmupPreset(baseAccount, { excludeSlugs: [first!.slug] });
    expect(second).not.toBeNull();
    expect(second!.slug).not.toBe(first!.slug);
  });

  it('respects account warmingUsedPresetSlugs', () => {
    const used = suggestWarmupPreset(baseAccount)?.slug;
    expect(used).toBeTruthy();
    const next = suggestWarmupPreset({
      ...baseAccount,
      warmingUsedPresetSlugs: [used!],
    });
    expect(next?.slug).not.toBe(used);
  });
});
