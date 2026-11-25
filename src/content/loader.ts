import { load } from 'js-yaml';
import { assertBundle, assertSchema, selectContent } from './validate.mjs';
import type { ContentBundle, Manifest } from './types';

export async function loadContent(base: URL, query = new URLSearchParams(), read: typeof fetch = fetch): Promise<ContentBundle> {
  async function yaml<T>(url: URL, kind: string): Promise<T> {
    try {
      const response = await read(url);
      if (!response.ok) throw new Error('HTTP ' + response.status);
      const parsed: unknown = load(await response.text(), { filename: url.pathname });
      assertSchema(kind, parsed, kind);
      return parsed as T;
    } catch (error) {
      throw new Error(url.pathname + ' — ' + (error instanceof Error ? error.message : String(error)));
    }
  }
  const manifest = await yaml<Manifest>(new URL('content/manifest.yaml', base), 'manifest');
  const choice = selectContent(manifest, query);
  const heroineBase = new URL(manifest.paths.heroinesDir + '/' + choice.heroine + '/', base);
  const housingBase = new URL(manifest.paths.housingsDir + '/' + choice.housing + '/', base);
  const [heroine, dialogue, events, housing, environment, mission] = await Promise.all([
    yaml<ContentBundle['heroine']>(new URL('heroine.yaml', heroineBase), 'heroine'),
    yaml<ContentBundle['dialogue']>(new URL('dialogue.yaml', heroineBase), 'dialogue'),
    yaml<ContentBundle['events']>(new URL('events.yaml', heroineBase), 'events'),
    yaml<ContentBundle['housing']>(new URL('housing.yaml', housingBase), 'housing'),
    yaml<ContentBundle['environment']>(new URL('environment.yaml', housingBase), 'environment'),
    yaml<ContentBundle['mission']>(new URL(manifest.paths.missionsDir + '/' + choice.mission + '.yaml', base), 'mission'),
  ]);
  const bundle = { manifest, heroine, dialogue, events, housing, environment, mission, heroineBase, housingBase };
  assertBundle(bundle, choice);
  mission.steps.sort((a, b) => a.order - b.order);
  return bundle;
}
