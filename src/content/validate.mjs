import Ajv from 'ajv';
import manifest from '../../schemas/manifest.schema.json' with { type: 'json' };
import heroine from '../../schemas/heroine.schema.json' with { type: 'json' };
import dialogue from '../../schemas/dialogue.schema.json' with { type: 'json' };
import events from '../../schemas/events.schema.json' with { type: 'json' };
import housing from '../../schemas/housing.schema.json' with { type: 'json' };
import environment from '../../schemas/environment.schema.json' with { type: 'json' };
import mission from '../../schemas/mission.schema.json' with { type: 'json' };

const ajv = new Ajv({ allErrors: true });
const validators = new Map(Object.entries({ manifest, heroine, dialogue, events, housing, environment, mission })
  .map(([key, schema]) => [key, ajv.compile(schema)]));

/** @param {string} kind @param {unknown} value @param {string} source */
export function assertSchema(kind, value, source) {
  const validate = validators.get(kind);
  if (!validate?.(value)) {
    const details = validate?.errors?.map(e => (e.instancePath || '/') + ' ' + e.message).join('; ');
    throw new Error(source + ': ' + (details || 'unknown schema'));
  }
}

/** @param {import('./types.js').ContentBundle} bundle @param {import('./types.js').Manifest['active']} selected */
export function assertBundle({ heroine, dialogue, events, housing, environment, mission }, selected) {
  const errors = [];
  function unique(values, label) {
    if (new Set(values).size !== values.length) errors.push(label + ' must be unique');
  }
  if (heroine.id !== selected.heroine || dialogue.heroineId !== heroine.id || events.heroineId !== heroine.id) {
    errors.push('Heroine, dialogue and events IDs must agree with the selected heroine');
  }
  if (housing.id !== selected.housing || environment.housingId !== housing.id) errors.push('Housing and environment IDs must agree with the selected housing');
  if (mission.id !== selected.mission) errors.push('Mission ID must agree with the selected mission');
  const sizes = housing.dimensions;
  if (Math.abs(sizes.bodyRatio + sizes.noseconeRatio + sizes.nozzleRatio - 1) > 0.00001) errors.push('Housing segment ratios must sum to 1');
  unique(mission.steps.map(step => step.id), 'Step IDs');
  unique(mission.steps.map(step => step.order), 'Step orders');
  unique(dialogue.lines.map(line => line.id), 'Dialogue line IDs');
  unique(environment.svgLayers.map(layer => layer.id), 'SVG layer IDs');
  unique(events.inspectionZones.map(zone => zone.id), 'Inspection zone IDs');
  for (const layer of environment.svgLayers) {
    if (layer.kind === 'cylinder' && !layer.heightMeters) errors.push(layer.id + ' needs heightMeters');
  }
  const lineEvents = new Set(dialogue.lines.map(line => line.event));
  const referencedEvents = [
    ...events.inspectionZones.map(zone => zone.emitEvent),
    events.kinematicTriggers.fastSpinEvent, events.idleTriggers.emitEvent, events.easterEggs.gemple38Event,
    events.milestoneEvents.halfwayEvent, events.milestoneEvents.almostDoneEvent,
  ];
  for (const step of mission.steps) {
    if (!Object.hasOwn(housing.mounts, step.mountId)) errors.push(step.id + ' references unknown mount ' + step.mountId);
    referencedEvents.push(step.startEvent, step.hintEvent);
    if (step.completeEvent) referencedEvents.push(step.completeEvent);
    if (step.mechanicType === 'wire_patch') {
      unique(step.params.wires.map(wire => wire.id), step.id + ' wire IDs');
      unique(step.params.wires.map(wire => wire.targetSocket), step.id + ' target sockets');
    }
    if (step.mechanicType === 'coupled_valves' && step.params.couplingMatrix.some(row => row.every(n => n === 0))) {
      errors.push(step.id + ' has a pressure gauge with no input');
    }
  }
  if (mission.steps.slice().sort((a, b) => a.order - b.order).some((step, index, steps) =>
    step.mechanicType === 'nosecone_arm' && index !== steps.length - 1)) errors.push('Nosecone arming must be the final mission step');
  if (environment.lighting.bayFogFar <= environment.lighting.bayFogNear) errors.push('bayFogFar must exceed bayFogNear');
  for (const event of new Set(referencedEvents)) {
    if (!lineEvents.has(event)) errors.push('No dialogue line for event ' + event);
  }
  if (errors.length) throw new Error(errors.join('\n'));
}

/** @param {import('./types.js').Manifest} manifest @param {URLSearchParams} query */
export function selectContent(manifest, query) {
  const selected = { ...manifest.active };
  if (manifest.allowQueryOverride) {
    for (const key of ['heroine', 'housing', 'mission']) {
      const value = query.get(key);
      if (value === null) continue;
      if (!/^[A-Za-z0-9][A-Za-z0-9_-]*$/.test(value)) throw new Error('Invalid ' + key + ' ID');
      selected[key] = value;
    }
  }
  return selected;
}
