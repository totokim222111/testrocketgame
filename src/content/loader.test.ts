import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';
import { loadContent } from './loader';
import { assertSchema, selectContent } from './validate.mjs';

const base = new URL('https://game.test/deployment/');
const disk = new URL('../../public/', import.meta.url);

const fetchFiles = (changed: Record<string, string> = {}): typeof fetch => async input => {
  const url = new URL(String(input));
  const relative = url.pathname.replace(/^\/deployment\//, '');
  if (Object.hasOwn(changed, relative)) return new Response(changed[relative]);
  try {
    return new Response(await readFile(new URL(relative, disk), 'utf8'));
  } catch {
    return new Response(null, { status: 404 });
  }
};

describe('YAML content loader', () => {
  it('loads the actual seven documents beneath a deployment prefix', async () => {
    const bundle = await loadContent(base, new URLSearchParams(), fetchFiles());
    expect(bundle.mission.steps.map(step => step.order)).toEqual([1, 2, 3, 4, 5, 6, 7, 8]);
    expect(bundle.housing.dimensions.lengthCm).toBe(15);
    expect(bundle.housing.dimensions.circumferenceCm).toBe(13);
    expect(bundle.dialogue.lines.length).toBeGreaterThan(30);
    expect(bundle.housingBase.pathname).toBe('/deployment/content/housings/' + bundle.housing.id + '/');
  });

  it('requests explicit query packs and reports the affected URL on HTTP errors', async () => {
    await expect(loadContent(base, new URLSearchParams('mission=unlisted'), fetchFiles())).rejects.toThrow('/unlisted.yaml — HTTP 404');
  });

  it('ignores query overrides when disabled and rejects traversal when enabled', async () => {
    const { manifest } = await loadContent(base, new URLSearchParams(), fetchFiles());
    expect(selectContent({ ...manifest, allowQueryOverride: false }, new URLSearchParams('mission=other'))).toEqual(manifest.active);
    await expect(loadContent(base, new URLSearchParams('heroine=../other'), fetchFiles())).rejects.toThrow('Invalid heroine ID');
  });

  it('rejects mechanic-specific parameter mismatches and local path traversal', async () => {
    const { mission, heroine } = await loadContent(base, new URLSearchParams(), fetchFiles());
    const wrongKind = { ...mission, steps: [{ ...mission.steps[0], mechanicType: 'vernier_ring' }] };
    expect(() => assertSchema('mission', wrongKind, 'mission test')).toThrow('/steps/0/params');
    expect(() => assertSchema('heroine', { ...heroine, rig: { ...heroine.rig, rigJson: '../rig.json' } }, 'heroine test')).toThrow('/rig/rigJson');
  });

  it('rejects valid YAML that references a missing mount or dialogue event', async () => {
    const { manifest, mission } = await loadContent(base, new URLSearchParams(), fetchFiles());
    mission.steps[0].mountId = 'missing_mount';
    mission.steps[0].hintEvent = 'missing_hint';
    const file = manifest.paths.missionsDir + '/' + manifest.active.mission + '.yaml';
    await expect(loadContent(base, new URLSearchParams(), fetchFiles({ [file]: JSON.stringify(mission) })))
      .rejects.toThrow(/missing_mount[\s\S]*missing_hint/);
  });
});
