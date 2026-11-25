import type { ContentBundle, DialogueLine, Step } from './content/types';

export function byId<T extends HTMLElement = HTMLElement>(id: string) {
  return document.getElementById(id) as T;
}
export const button = (id: string) => byId<HTMLButtonElement>(id);
function hidden(id: string, value: boolean) { byId(id).hidden = value; }
function text(id: string, value: string) { byId(id).textContent = value; }

export class Hud {
  private readonly bars: HTMLElement[];
  private previous = '';
  private flight = '';
  private elapsed = '';
  private readonly desktop: HTMLButtonElement;
  ready = false;
  xrSupported = false;

  constructor(readonly content: ContentBundle) {
    const { manifest, mission, housing } = content;
    const [brand, ...subtitle] = manifest.title.split('·').map(part => part.trim());
    text('game-title', brand);
    text('entry-subtitle', subtitle.join(' · '));
    text('entry-description', manifest.subtitle);
    text('mission-label', housing.displayName);
    text('ending-mission', mission.displayName);
    document.title = manifest.title;
    document.documentElement.lang = manifest.defaultLanguage;
    const specs = [
      ['기체 길이', housing.dimensions.lengthCm + ' cm'],
      ['정비 단계', String(mission.steps.length)],
      ['예상 시간', mission.targetDurationMinutes + '분'],
    ];
    byId('entry-specs').replaceChildren(...specs.map(([label, value]) => {
      const section = document.createElement('div');
      const term = document.createElement('dt');
      const definition = document.createElement('dd');
      term.textContent = label;
      definition.textContent = value;
      section.append(term, definition);
      return section;
    }));
    this.bars = mission.steps.map(step => {
      const bar = document.createElement('li');
      bar.setAttribute('aria-label', step.shortLabel);
      bar.title = step.shortLabel;
      return bar;
    });
    byId('step-strip').replaceChildren(...this.bars);
    this.desktop = button('play-desktop');
  }

  status(message: string) { text('entry-status', message); }
  loaded() { this.ready = true; this.desktop.disabled = false; this.applySupport(); }
  support(value: boolean) { this.xrSupported = value; this.applySupport(); }
  private applySupport() {
    button('play-xr').disabled = !this.xrSupported || !this.ready;
    hidden('resume-xr', !this.xrSupported);
    if (this.ready) this.status(this.xrSupported ? '' : 'WebXR을 지원하는 헤드셋에서는 VR로 시작할 수 있습니다.');
  }

  mode(mode: 'entry' | 'desktop' | 'xr') {
    hidden('entry', mode !== 'entry');
    hidden('hud', mode !== 'desktop');
    if (mode === 'desktop') (document.activeElement as HTMLElement | null)?.blur();
  }

  step(step: Step | undefined, index: number, armed: boolean, sealed: boolean, launched: boolean, inspect: boolean) {
    const id = [index, armed, sealed, launched, inspect].join('/');
    if (id === this.previous) return;
    this.previous = id;
    const total = this.bars.length;
    text('step-count', String(Math.min(index + 1, total)).padStart(2, '0') + ' / ' + String(total).padStart(2, '0'));
    this.bars.forEach((bar, i) => {
      bar.dataset.state = i < index ? 'done' : i === index ? 'current' : 'next';
      if (i === index) bar.setAttribute('aria-current', 'step');
      else bar.removeAttribute('aria-current');
    });
    text('step-title', inspect ? '자유 점검' : launched ? '발사 시퀀스' : armed ? '발사 준비 완료' : step?.title ?? '정비 완료');
    text('step-instructions', inspect || launched ? '' : armed ? '발사 버튼 또는 Space를 누르세요.' :
      sealed ? '오른쪽 콘솔의 주황색 안전 덮개를 열어 주세요.' : step?.instruction ?? '');
  }
  scale(zoom: boolean) {
    const d = this.content.housing.dimensions;
    text('magnifier-status', zoom ? d.magnifierScale + '× 확대 정밀 점검' : '1× 실물 (' + d.lengthCm + 'cm)');
    button('magnify').setAttribute('aria-pressed', String(zoom));
  }
  mute(value: boolean) {
    const control = button('mute');
    control.setAttribute('aria-pressed', String(value));
    control.querySelector('span')!.textContent = value ? '음소거' : '소리';
  }
  line(line?: DialogueLine) {
    text('subtitles', line?.text ?? '');
    hidden('subtitles', !line);
  }
  launchStatus(active: boolean, count: number, altitude: number) {
    const value = active ? count ? String(count) : altitude > 12 ? '궤도 비행' : altitude > 0 ? '점화 · 상승' : '발사대로 이동 중' : '';
    if (value === this.flight) return;
    this.flight = value;
    hidden('flight', !value);
    text('flight', value);
  }
  ending(visible: boolean, elapsed: string) {
    hidden('ending', !visible);
    if (this.elapsed === elapsed) return;
    this.elapsed = elapsed;
    text('ending-time', '소요 시간 ' + elapsed);
  }
}
