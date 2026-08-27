/**
 * What a lens is keyed by, against a real database. The list is a JSON array in
 * `global_settings` rather than a table, so there is no schema to migrate and
 * nothing but this to catch an id that fails to survive a round trip.
 */

import { describe, test, expect, beforeEach } from 'vitest';
import { setGlobalSetting, getDiffLens, saveDiffLens, _resetCacheForTesting } from '../../db';
import { listLenses, saveLens, deleteLens, lensesKey } from '../../lens/config';

const PROJECT = '/work/alpha';

/** Lenses as a database written before ids held them. */
async function seedWithoutIds(): Promise<void> {
  await setGlobalSetting(
    lensesKey(PROJECT),
    JSON.stringify([
      { name: 'By layer', instruction: 'data model first' },
      { name: 'Risk first', instruction: 'the riskiest changes first' },
      { name: 'Setup and payoff', instruction: 'the groundwork, then the change it was for' },
    ]),
  );
}

beforeEach(async () => {
  _resetCacheForTesting();
  await setGlobalSetting(lensesKey(PROJECT), '');
});

describe('a lens is its id', () => {
  test('lenses stored before ids are given them once, and keep them', async () => {
    await seedWithoutIds();

    const first = await listLenses(PROJECT);
    expect(first.map((lens) => lens.name)).toEqual(['By layer', 'Risk first', 'Setup and payoff']);
    expect(first.every((lens) => lens.id)).toBe(true);

    // Minted once and written back. An id made fresh on every read would key
    // nothing, and every grouping already stored would be orphaned by a reload.
    expect((await listLenses(PROJECT)).map((lens) => lens.id)).toEqual(first.map((lens) => lens.id));
  });

  test('a rename keeps the id, the place in the list, and the reading already done', async () => {
    await seedWithoutIds();
    const [, risk] = await listLenses(PROJECT);

    await saveDiffLens(PROJECT, 'pr:5', 'head-1', JSON.stringify({ groups: [] }), { id: risk.id, name: risk.name });
    const renamed = await saveLens(PROJECT, {
      id: risk.id,
      name: 'Risk, then the rest',
      instruction: risk.instruction,
    });

    expect(renamed.id).toBe(risk.id);
    // Still second. Sending a renamed lens to the bottom would make renaming
    // feel like deleting and adding.
    const after = await listLenses(PROJECT);
    expect(after.map((lens) => lens.name)).toEqual(['By layer', 'Risk, then the rest', 'Setup and payoff']);

    // Nothing chased the grouping: it points at the lens, not at its name.
    expect((await getDiffLens(PROJECT, 'pr:5'))?.lens_id).toBe(risk.id);
  });

  test('two lenses may share a name, and deleting one leaves the other', async () => {
    const first = await saveLens(PROJECT, { name: 'Narrative', instruction: 'group by story' });
    const second = await saveLens(PROJECT, { name: 'Narrative', instruction: 'group by risk' });

    expect(second.id).not.toBe(first.id);
    await deleteLens(PROJECT, first.id);

    expect(await listLenses(PROJECT)).toEqual([second]);
  });
});
