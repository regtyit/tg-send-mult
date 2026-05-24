import { describe, expect, it } from 'vitest';
import {
  HUMAN_DIALOG_PRESETS,
  getHumanDialogPreset,
  humanDialogPresetSummary,
} from '../../src/modules/dialog/humanDialogTemplates';

describe('humanDialogTemplates', () => {
  it('exposes at least five presets with human-like turns', () => {
    expect(HUMAN_DIALOG_PRESETS.length).toBeGreaterThanOrEqual(5);
    for (const p of HUMAN_DIALOG_PRESETS) {
      expect(p.slug).toMatch(/^[a-z0-9-]+$/);
      expect(p.turns.length).toBeGreaterThanOrEqual(4);
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
