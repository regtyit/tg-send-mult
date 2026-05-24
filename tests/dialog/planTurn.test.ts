import { describe, expect, it } from 'vitest';
import { totalTurnsForScript } from '../../src/modules/dialog/planTurn';
import type { DialogScriptDoc } from '../../src/db/models/DialogScript';
import { Types } from 'mongoose';

describe('totalTurnsForScript', () => {
  it('counts manual turns', () => {
    const script = {
      mode: 'turns',
      turns: [{ side: 'a' }, { side: 'b' }],
    } as DialogScriptDoc;
    expect(totalTurnsForScript(script)).toBe(2);
  });

  it('counts template pair rounds', () => {
    const script = {
      mode: 'template_pairs',
      rounds: 3,
    } as DialogScriptDoc;
    expect(totalTurnsForScript(script)).toBe(6);
  });
});
