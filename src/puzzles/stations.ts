import type { Targets } from '../input/targets';
import type { RocketModel } from '../rocket/model';
import { hatch, valves, vernier, wires } from './frontStations';
import { nosecone, nozzle, seam, sliders } from './precisionStations';
import { StationContext, type StationView } from './stationCommon';
import type { PuzzleEngine } from './engine';

export function buildStations(model: RocketModel, engine: PuzzleEngine, targets: Targets): StationView[] {
  return engine.steps.map((step, i) => {
    const station = new StationContext(model, engine, targets, step, i);
    const view = create(station, step);
    const { zone, angleDeg } = station.mount;
    const azimuth = T.MathUtils.degToRad(angleDeg);
    const normal = zone === 'top' || zone === 'bottom' ? new T.Vector3(0, zone === 'top' ? 1 : -1, 0)
      : new T.Vector3(Math.sin(azimuth), 0, Math.cos(azimuth));
    return {
      sparkPoint: view.sparkPoint,
      update(dt, time, viewer) {
        if (viewer) station.group.visible = step.mechanicType === 'seam_weld' || viewer.dot(normal) > -.34;
        view.update(dt, time);
      },
    };
  });
}
import * as T from 'three';

function create(station: StationContext, step: PuzzleEngine['steps'][number]): StationView {
  switch (step.mechanicType) {
    case 'fastener_unlock': return hatch(station, step);
    case 'vernier_ring': return vernier(station, step);
    case 'coupled_valves': return valves(station, step);
    case 'wire_patch': return wires(station, step);
    case 'seam_weld': return seam(station, step);
    case 'wave_sliders': return sliders(station, step);
    case 'nozzle_trim': return nozzle(station, step);
    case 'nosecone_arm': return nosecone(station, step);
  }
}
