import { describe, expect, it } from 'vitest';
import {
  HUMAN_DIALOG_PRESETS,
  getHumanDialogPreset,
  humanDialogPresetSummary,
} from '../../src/modules/dialog/humanDialogTemplates';

describe('humanDialogTemplates', () => {
  it('exposes many presets with unique slugs and human-like turns', () => {
    expect(HUMAN_DIALOG_PRESETS.length).toBeGreaterThanOrEqual(15);
    const slugs = HUMAN_DIALOG_PRESETS.map((p) => p.slug);
    expect(new Set(slugs).size).toBe(slugs.length);
    for (const p of HUMAN_DIALOG_PRESETS) {
      expect(p.slug).toMatch(/^[a-z0-9-]+$/);
      expect(['en', 'ru']).toContain(p.lang);
      expect(['social', 'work', 'support', 'logistics']).toContain(p.category);
      expect(p.turns.length).toBeGreaterThanOrEqual(3);
      expect(p.turns[0]?.side).toBe('a');
      for (const t of p.turns) {
        expect(t.text.trim().length).toBeGreaterThan(5);
        expect(['a', 'b']).toContain(t.side);
      }
    }
  });

  it('resolves slug and builds summary', () => {
    const p = getHumanDialogPreset('coffee-catchup');
    expect(p?.name).toContain('coffee');
    const s = humanDialogPresetSummary(p!);
    expect(s.turnCount).toBe(p!.turns.length);
    expect(s.preview.length).toBeGreaterThan(0);
  });
});
