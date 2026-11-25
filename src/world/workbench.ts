import * as T from 'three';
import type { Environment, Housing, Step } from '../content/types';
import { Targets } from '../input/targets';
import { batch, box, chamfer, cylinder, damp, display, light, mesh, toon, unitBox } from '../render/graphics';

interface BenchActions { hint(): void; zoom(): void; reset(): void; guard(): void; launch(): void; replay(): void; inspect(): void }

export class Workbench {
  readonly group = new T.Group();
  private readonly deck = new T.Group();
  private readonly console = new T.Group();
  private readonly guard = new T.Group();
  private readonly guardHandle: T.Mesh;
  private readonly screen;
  private readonly launchMaterial;
  private readonly cradle;
  private readonly cradleLight;
  private readonly controls: ReturnType<Workbench['button']>[];
  private cached = '';

  constructor(readonly housing: Housing, env: Environment, targets: Targets, actions: BenchActions, offsetY: number) {
    const { palette: p } = housing;
    const { launchColumn: col } = env;
    const base = toon(col.pedestalColor), deck = toon(col.gantryColor);
    const ink = toon(p.inkLine), amber = toon(col.gantryAccent), trim = toon(p.metalTrim);
    const indicator = light(col.beamColor);
    const body = new T.Group();
    this.group.add(this.deck, body, this.console);
    this.deck.position.y = offsetY;
    box(this.deck, ink, 1.08, .053, .39, -.027, -.034, -.025);
    box(this.deck, base, 1.03, .029, .36, -.027, -.018, -.025);
    box(this.deck, deck, 1.012, .012, .337, -.027, -.005, -.025);
    box(this.deck, trim, .43, .004, .227, -.108, .004, -.036);
    box(this.deck, base, .286, .005, .19, -.011, .004, -.016);
    box(this.deck, amber, .98, .007, .006, -.028, -.035, .173);
    box(this.deck, indicator, .22, .004, .003, -.025, -.009, .146);
    batch(this.deck, unitBox, ink, 27, (i, part) => {
      part.position.set(-.44 + .0312 * i, .0028, .137);
      part.scale.set(.002, .00145, i % 5 === 0 ? .019 : .009);
    });
    body.position.y = offsetY;
    for (const x of [-.411, .448]) {
      box(body, base, .14, 1.25, .22, x, -.65, -.09);
      box(body, trim, .032, 1.19, .012, x + .027, -.65, .024);
      box(body, amber, .076, .109, .012, x, -.135, .025);
    }
    this.cradle = new T.Group();
    this.deck.add(this.cradle);
    cylinder(this.cradle, base, .079, .095, .013, 0, .01);
    cylinder(this.cradle, trim, .064, .075, .015, 0, .023);
    this.cradleLight = mesh(this.cradle, new T.TorusGeometry(.054, .0018, 5, 40), indicator, 0, .033);
    this.cradleLight.rotation.x = -Math.PI / 2;
    cylinder(this.cradle, ink, .044, .049, .008, 0, .031);
    cylinder(this.cradle, trim, .025, .031, .008, 0, .035);
    batch(this.cradle, unitBox, amber, 3, (i, part) => {
      const angle = i * Math.PI * 2 / 3;
      part.position.set(Math.sin(angle) * .063, .028, Math.cos(angle) * .063);
      part.rotation.y = angle;
      part.scale.set(.019, .006, .012);
    });

    this.console.position.set(.222, .005, -.023);
    this.console.scale.setScalar(.91);
    this.console.rotation.set(-.24, -.16, 0);
    chamfer(this.console, ink, .254, .19, .028, .014, -.021);
    chamfer(this.console, trim, .245, .181, .013, .012, .003);
    chamfer(this.console, base, .231, .169, .004, .010, .016);
    this.screen = display(this.console, .211, .096, 768, 350, 0, .031, .022);
    const c = { hint: -0.073, zoom: -.014, reset: .046 };
    this.controls = [
      this.button(this.console, targets, c.hint, -.043, '힌트', actions.hint, p, 'inspect', actions.inspect),
      this.button(this.console, targets, c.zoom, -.043, '확대', actions.zoom, p, 'replay', actions.replay),
      this.button(this.console, targets, c.reset, -.043, '각도 초기화', actions.reset, p),
    ];
    this.launchMaterial = light(p.glowWarning);
    const launch = cylinder(this.console, this.launchMaterial, .016, .016, .007, .096, -.047, .026, 16);
    launch.rotation.x = Math.PI / 2;
    const launchLabel = display(this.console, .042, .012, 256, 72, .096, -.074, .022);
    const ctx = launchLabel.ctx;
    ctx.font = '700 52px system-ui,sans-serif';
    ctx.fillStyle = p.hullBase;
    ctx.textAlign = 'center';
    ctx.fillText('발사', 128, 57);
    launchLabel.refresh();
    this.guard.position.set(.096, -.027, .028);
    this.console.add(this.guard);
    const safety = new T.MeshBasicMaterial({ color: col.gantryAccent, transparent: true, opacity: .70, depthWrite: false });
    this.guardHandle = box(this.guard, safety, .035, .025, .006, 0, -.017, .01);
    box(this.guard, amber, .035, .004, .011, 0, -.029, .008);
    targets.add({ object: this.guardHandle, normal: this.console, enabled: () => this.sealed && !this.armed && !this.launched,
      nearRadius: .017, press: actions.guard });
    targets.add({ object: launch, normal: this.console, enabled: () => this.armed && !this.launched,
      nearRadius: .019, press: actions.launch });
  }

  private launched = false;
  private armed = false;
  private sealed = false;
  private finished = false;

  private button(parent: T.Object3D, targets: Targets, x: number, y: number, text: string, callback: () => void,
    colors: Housing['palette'], alternative?: 'inspect' | 'replay', after?: () => void) {
    const alternateLabel = alternative === 'inspect' ? '자유 점검' : '다시 시작';
    const key = box(parent, toon(colors.metalTrim), .051, .024, .011, x, y, .025);
    const surface = display(parent, .049, .022, 256, 112, x, y, .032);
    const paint = (label: string) => {
      surface.ctx.clearRect(0, 0, 256, 112);
      surface.ctx.font = '700 52px system-ui,sans-serif';
      surface.ctx.textAlign = 'center';
      surface.ctx.fillStyle = colors.hullBase;
      surface.ctx.fillText(label, 128, 75, 226);
      surface.refresh();
    };
    paint(text);
    targets.add({ object: key, normal: parent, nearRadius: .022, press: () => {
      if (this.finished && after) after(); else callback();
    } });
    return { update: (finished: boolean) => paint(finished && alternative ? alternateLabel : text) };
  }

  update(dt: number, step: Step | undefined, index: number, total: number, status: {
    zoom: boolean; sealed: boolean; armed: boolean; guard: boolean; launched: boolean; ended: boolean; elapsed: string; count: number;
  }) {
    const p = this.housing.palette;
    if (this.finished !== status.ended) this.controls.forEach(control => control.update(status.ended));
    this.launched = status.launched;
    this.armed = status.armed;
    this.sealed = status.sealed;
    this.finished = status.ended;
    this.guard.rotation.x = damp(this.guard.rotation.x, status.guard ? -1.82 : 0, 12, dt);
    this.console.position.x = damp(this.console.position.x, status.launched && !status.ended ? .36 : .222, 6, dt);
    this.console.position.y = damp(this.console.position.y, status.launched && !status.ended ? -.068 : .005, 6, dt);
    this.launchMaterial.color.set(status.armed ? p.glowActive : p.glowWarning);
    this.cradleLight.visible = !status.launched;
    const label = status.ended ? '임무 완료' : status.count > 0 ? String(status.count) : status.launched ? '발사 시퀀스' :
      status.armed ? '발사 준비 완료' : status.sealed ? '안전 덮개를 여세요' : (step?.shortLabel ?? '자유 점검');
    const key = [label, status.zoom, index, status.ended ? status.elapsed : ''].join('|');
    if (this.cached === key) return;
    this.cached = key;
    const { ctx, canvas } = this.screen;
    ctx.fillStyle = p.inkLine;
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.fillStyle = p.accentPrimary;
    ctx.fillRect(0, 0, 14, canvas.height);
    ctx.textAlign = 'left';
    ctx.fillStyle = p.hullBase;
    ctx.font = '700 63px system-ui,sans-serif';
    ctx.fillText(label, 51, 144, 664);
    ctx.font = '500 44px system-ui,sans-serif';
    ctx.fillStyle = p.rimLight;
    const size = status.zoom ? this.housing.dimensions.magnifierScale + '× 확대' : '1× 실물';
    ctx.fillText(status.ended ? status.elapsed : size, 53, 217);
    for (let i = 0; i < total; i++) {
      const width = 657 / total;
      ctx.fillStyle = i < index ? p.glowActive : i === index ? p.accentSecondary : p.metalTrim;
      ctx.fillRect(54 + i * width, 274, Math.max(2, width - 9), 14);
    }
    this.screen.refresh();
  }
}
