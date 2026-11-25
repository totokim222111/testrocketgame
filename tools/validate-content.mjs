import { readFile, stat } from 'node:fs/promises';
import { load } from 'js-yaml';
import Ajv2020 from 'ajv/dist/2020.js';
import rigSchema from '@rig2d/engine/rig.schema.json' with { type: 'json' };
import { assertBundle, assertSchema, selectContent } from '../src/content/validate.mjs';

const args = new Set(process.argv.slice(2));
const supported = ['--allow-missing-audio', '--allow-missing-svg'];
if ([...args].some(flag => !supported.includes(flag))) {
  console.error('Usage: npm run content:validate -- [--allow-missing-audio] [--allow-missing-svg]');
  process.exit(2);
}

const root = new URL('../public/', import.meta.url);
const errors = [];
const missing = { audio: [], svg: [] };
async function yaml(url, kind) {
  const data = load(await readFile(url, 'utf8'), { filename: url.pathname });
  assertSchema(kind, data, url.pathname);
  return data;
}
async function asset(base, relative, kind) {
  const url = new URL(relative, base);
  try {
    if (!url.href.startsWith(base.href)) throw new Error('Path leaves its content pack');
    const info = await stat(url);
    if (!info.isFile() || info.size === 0) throw new Error('Asset is empty or is not a file');
  } catch (error) {
    if (error.code === 'ENOENT' && args.has('--allow-missing-' + kind)) missing[kind].push(url.pathname);
    else errors.push(url.pathname + ' — ' + error.message);
  }
}
try {
  const manifest = await yaml(new URL('content/manifest.yaml', root), 'manifest');
  const selected = selectContent(manifest, new URLSearchParams());
  const heroineBase = new URL(manifest.paths.heroinesDir + '/' + selected.heroine + '/', root);
  const housingBase = new URL(manifest.paths.housingsDir + '/' + selected.housing + '/', root);
  const [heroine, dialogue, events, housing, environment, mission] = await Promise.all([
    yaml(new URL('heroine.yaml', heroineBase), 'heroine'),
    yaml(new URL('dialogue.yaml', heroineBase), 'dialogue'),
    yaml(new URL('events.yaml', heroineBase), 'events'),
    yaml(new URL('housing.yaml', housingBase), 'housing'),
    yaml(new URL('environment.yaml', housingBase), 'environment'),
    yaml(new URL(manifest.paths.missionsDir + '/' + selected.mission + '.yaml', root), 'mission'),
  ]);
  assertBundle({ manifest, heroine, dialogue, events, housing, environment, mission, heroineBase, housingBase }, selected);
  await Promise.all([
    asset(heroineBase, heroine.rig.rigJson, 'rig'), asset(heroineBase, heroine.rig.atlas, 'rig'),
    ...[...new Set(dialogue.lines.map(line => line.audio).filter(Boolean))]
      .map(file => asset(heroineBase, heroine.voice.audioDir + '/' + file, 'audio')),
    ...environment.svgLayers.map(layer => asset(housingBase, layer.src, 'svg')),
  ]);
  const rigUrl = new URL(heroine.rig.rigJson, heroineBase);
  const rig = JSON.parse(await readFile(rigUrl, 'utf8'));
  const validateRig = new Ajv2020({ allErrors: true }).compile(rigSchema);
  if (!validateRig(rig)) {
    errors.push(...validateRig.errors.map(error => rigUrl.pathname + error.instancePath + ' ' + error.message));
  } else if (new URL(rig.atlas, rigUrl).href !== new URL(heroine.rig.atlas, heroineBase).href) {
    errors.push('Rig JSON atlas must match the atlas declared in heroine YAML');
  }
  console.log(selected.heroine + ' / ' + selected.housing + ' / ' + selected.mission +
    ' · ' + mission.steps.length + ' steps · ' + dialogue.lines.length + ' lines');
} catch (error) {
  errors.push(error.message);
}
for (const [kind, paths] of Object.entries(missing)) {
  if (paths.length) console.log('Allowed missing ' + kind + ': ' + paths.length);
}
for (const error of errors) console.error(error);
console.log(errors.length + ' content validation error(s)');
process.exitCode = errors.length ? 1 : 0;
