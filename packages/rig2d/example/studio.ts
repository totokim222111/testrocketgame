import './studio.css';
import markup from './studio.html?raw';
import { speechTrack, parameters, keys, neutralPose, browNames, mouthNames, expressions } from '../src/core';
import type { RigAnimator, Param, Pose } from '../src/core';
type Motion = string;
const id = <E extends HTMLElement>(key: string) => document.getElementById(key) as E;
const clamp = (n: number, min: number, max: number) => Math.max(min, Math.min(max, n));
interface View {
  resize(w: number, h: number): void;
  draw(p: Pose): void;
  dispose(): void;
  stats?(): Record<string, number>;
}
interface Studio {
  title: string;
  choices: Record<string, string>;
  selection: string;
  name: string;
  sampleLine?: string;
  facePresets?: Partial<Record<keyof typeof expressions, Partial<Pose>>>;
  select(value: string): void;
  makeActor(): RigAnimator;
  play(actor: RigAnimator, motion: string, time: number): void;
  view(canvas: HTMLCanvasElement): Promise<View>;
}
export async function mountStudio(options: Studio) {
  const facePresets = { ...expressions, ...options.facePresets };
  document.body.insertAdjacentHTML('afterbegin', markup);
  document.title = options.title;
  document.querySelector('h1')!.textContent = options.title;
  const canvas = id<HTMLCanvasElement>('portrait'),
    stage = id('stage'),
    viewport = id('viewport');
  const selector = id<HTMLSelectElement>('coach');
  selector.setAttribute('aria-label', '미리보기 선택');
  for (const [k, label] of Object.entries(options.choices)) selector.add(new Option(label, k));
  selector.value = options.selection;
  selector.onchange = () => options.select(selector.value);
  id('coachName').textContent = options.name;
  canvas.setAttribute('aria-label', options.name + ' 실시간 초상');
  const actor = options.makeActor(),
    clips = actor.library;
  const volume = id<HTMLInputElement>('volume'),
    useVolume = id<HTMLInputElement>('useVolume');
  function volumeInput() {
    volume.disabled = !useVolume.checked;
    actor.setMouthOpen(useVolume.checked ? Number(volume.value) : null);
  }
  volume.oninput = useVolume.onchange = volumeInput;
  const player = id<HTMLAudioElement>('audioPreview'),
    file = id<HTMLInputElement>('audioFile');
  let context: AudioContext | undefined,
    analyser: AnalyserNode | undefined,
    objectURL = '';
  const samples = new Float32Array(512);
  id('pickAudio').onclick = () => file.click();
  file.onchange = () => {
    const recording = file.files?.[0];
    if (!recording) return;
    player.pause();
    if (objectURL) URL.revokeObjectURL(objectURL);
    objectURL = URL.createObjectURL(recording);
    player.src = objectURL;
    player.hidden = false;
    player.load();
    player.setAttribute('aria-label', recording.name);
    file.value = '';
  };
  player.onplay = () => {
    if (!context) {
      context = new AudioContext();
      analyser = context.createAnalyser();
      analyser.fftSize = samples.length;
      context.createMediaElementSource(player).connect(analyser).connect(context.destination);
    }
    useVolume.checked = false;
    useVolume.disabled = true;
    volumeInput();
    void context.resume().catch(() => player.pause());
  };
  player.onpause = player.onended = () => {
    useVolume.disabled = false;
    volumeInput();
  };
  player.onerror = () => {
    useVolume.disabled = false;
    volumeInput();
    id('status').textContent = '음성 파일을 재생할 수 없습니다';
  };
  let view: View;
  try {
    view = await options.view(canvas);
  } catch (error) {
    id('status').textContent = '리그 연결 실패 · ' + String(error);
    return;
  }
  const start = performance.now() / 1000,
    time = () => performance.now() / 1000 - start;
  let tracking = false,
    point: { x: number; y: number } | null = null,
    until = 0,
    frozen = false;
  let selectedFace: string | null = '기본',
    active: Motion | null = null;
  const fields = new Map<Param, { slider: HTMLInputElement; value: HTMLOutputElement }>();
  const faces = new Map<string, HTMLButtonElement>(),
    motions = new Map<Motion, HTMLButtonElement>();
  const bars = Array.from(id('meter').children) as HTMLElement[];
  const pressed = (el: HTMLElement, on: boolean) => el.setAttribute('aria-pressed', String(on));
  const line = id<HTMLInputElement>('line');
  if (options.sampleLine) line.value = options.sampleLine;

  function resize() {
    const box = viewport.getBoundingClientRect(),
      ratio = Math.min(devicePixelRatio, 2);
    view.resize(Math.max(1, Math.round(box.width * ratio)), Math.max(1, Math.round(box.height * ratio)));
  }
  const observer = new ResizeObserver(resize);
  observer.observe(viewport);
  resize();
  function draw(p: Pose) {
    view.draw(p);
  }
  function clearControls() {
    for (const k of keys) delete actor.controls[k];
  }
  function nameValue(key: Param, n: number) {
    if (key === 'brow') return browNames[Math.round(n)];
    if (key === 'gesture') return ['손바닥', '검지', '엄지'][Math.round(n)];
    if (key === 'mouth') return mouthNames[Math.round(n)];
    return ['yaw', 'pitch', 'roll'].includes(key) ? Math.round(n) + '°' : n.toFixed(2);
  }
  function updateFields() {
    for (const [k, { slider, value }] of fields) {
      const v = actor.controls[k] ?? parameters[k][3];
      slider.value = String(v);
      value.textContent = nameValue(k, v);
    }
    for (const [name, b] of faces) {
      b.classList.toggle('active', name === selectedFace);
      pressed(b, name === selectedFace);
    }
  }
  function say(text: string, t: number) {
    actor.speak(text, t);
    const speech = id('speech');
    speech.textContent = text;
    speech.hidden = !text;
    until = t + (speechTrack(text).at(-1)?.end ?? 0);
  }
  function play(m: Motion, text?: string) {
    frozen = false;
    actor.reset();
    volumeInput();
    clearControls();
    selectedFace = null;
    updateFields();
    const t = time();
    options.play(actor, m, t);
    say(text ?? (m === 'talk' ? line.value.trim() : ''), t);
  }
  function chooseFace(name: keyof typeof expressions) {
    frozen = false;
    actor.reset();
    volumeInput();
    clearControls();
    Object.assign(actor.controls, facePresets[name]);
    selectedFace = name;
    until = 0;
    updateFields();
  }
  function btn(label: string, action: () => void) {
    const b = document.createElement('button');
    b.type = 'button';
    b.textContent = label;
    b.onclick = action;
    return b;
  }
  for (const [key, clip] of Object.entries(clips)) {
    const m = key as Motion,
      b = btn(clip.label, () => play(m));
    motions.set(m, b);
    id('motions').append(b);
  }
  const groups: Array<[string, Param[]]> = [
    ['고개와 몸', ['yaw', 'pitch', 'roll', 'lean', 'forward', 'breath', 'bounce']],
    ['눈과 입', ['eye', 'happy', 'gazeX', 'gazeY', 'brow', 'mouth', 'cheek', 'blush']],
    [
      '머리카락과 손',
      [
        'fringe',
        'locks',
        'rear',
        'wink',
        'shrug',
        'specialLip',
        'specialHand',
        'gesture',
        'wave',
        'wrist',
        'sparkle',
      ],
    ],
  ];
  for (const [group, list] of groups) {
    const details = document.createElement('details'),
      summary = document.createElement('summary');
    details.open = group === groups[0][0];
    summary.textContent = group;
    details.append(summary);
    for (const k of list) {
      const [label, min, max, initial] = parameters[k],
        row = document.createElement('label');
      row.className = 'slider';
      row.append(document.createTextNode(label));
      const slider = document.createElement('input'),
        value = document.createElement('output');
      slider.type = 'range';
      slider.min = String(min);
      slider.max = String(max);
      slider.value = String(initial);
      slider.step = ['brow', 'mouth', 'gesture', 'yaw', 'pitch', 'roll'].includes(k) ? '1' : '.01';
      slider.setAttribute('aria-label', label);
      slider.oninput = () => {
        frozen = false;
        actor.controls[k] = +slider.value;
        selectedFace = null;
        updateFields();
      };
      fields.set(k, { slider, value });
      row.append(slider, value);
      details.append(row);
    }
    id('sliders').append(details);
  }
  function tab(params: boolean) {
    id('faces').hidden = params;
    id('sliders').hidden = !params;
    pressed(id('facesTab'), !params);
    pressed(id('slidersTab'), params);
  }
  id('slidersTab').onclick = () => tab(true);
  id('facesTab').onclick = () => tab(false);
  id('lineForm').onsubmit = (e) => {
    e.preventDefault();
    const text = line.value.trim();
    if (!text) return;
    frozen = false;
    const t = time();
    if (!actor.motion) actor.play('talk', t);
    say(text, t);
  };
  id('track').onclick = () => {
    tracking = !tracking;
    point = null;
    pressed(id('track'), tracking);
    id('track').textContent = tracking ? '마우스 추적 켜짐' : '마우스 추적 꺼짐';
  };
  stage.onpointermove = (e) => {
    const r = stage.getBoundingClientRect();
    point = {
      x: clamp(((e.clientX - r.left) / r.width) * 2 - 1, -1, 1),
      y: clamp(1 - ((e.clientY - r.top) / r.height) * 2, -1, 1),
    };
  };
  stage.onpointerleave = () => {
    point = null;
  };
  id('light').onclick = () => pressed(id('light'), stage.classList.toggle('light'));
  id('idle').onclick = () => {
    actor.idle = !actor.idle;
    pressed(id('idle'), actor.idle);
  };
  id('reset').onclick = () => {
    chooseFace('기본');
    actor.idle = true;
    pressed(id('idle'), true);
    tracking = false;
    point = null;
    pressed(id('track'), false);
    id('track').textContent = '마우스 추적 꺼짐';
  };

  function previewFrame(name: keyof typeof expressions) {
    draw({ ...neutralPose(), ...actor.profile.parameters, ...facePresets[name] });
    const thumb = document.createElement('canvas');
    thumb.width = 148;
    thumb.height = 126;
    const ctx = thumb.getContext('2d')!;
    ctx.drawImage(
      canvas,
      canvas.width * 0.145,
      canvas.height * 0.16,
      canvas.width * 0.71,
      canvas.height * 0.454,
      0,
      0,
      148,
      126,
    );
    return thumb.toDataURL();
  }
  function frame() {
    if (!frozen) {
      const t = time();
      const manual = tracking && point ? { ...actor.controls } : null;
      if (tracking && point)
        Object.assign(actor.controls, {
          yaw: point.x * 15,
          pitch: point.y * 15,
          gazeX: point.x,
          gazeY: point.y,
        });
      if (analyser && !player.paused && !player.ended) {
        analyser.getFloatTimeDomainData(samples);
        let energy = 0;
        for (const sample of samples) energy += sample * sample;
        actor.setMouthOpen(Math.min(1, 4 * Math.sqrt(energy / samples.length)));
      }
      draw(actor.update(t));
      if (manual) {
        clearControls();
        Object.assign(actor.controls, manual);
      }
      bars.forEach((b, i) => {
        b.style.height = 3 + actor.level * (4 + 8 * Math.abs(Math.sin(t * 16 + i))) + 'px';
      });
      id('speech').hidden = t >= until;
      if (active !== actor.motion) {
        active = actor.motion;
        id('motionStatus').textContent = active ? clips[active].label + ' 재생 중' : '대기';
        for (const [m, b] of motions) {
          b.classList.toggle('active', active === m);
          pressed(b, active === m);
        }
      }
    }
  }
  {
    for (const key of Object.keys(expressions) as (keyof typeof expressions)[]) {
      const b = btn(key, () => chooseFace(key));
      b.className = 'face';
      const img = new Image();
      img.alt = '';
      img.src = previewFrame(key);
      b.prepend(img);
      faces.set(key, b);
      id('faces').append(b);
    }
    updateFields();
    id('status').textContent = '리그 연결됨';
    canvas.dataset.ready = 'true';
    let request = 0;
    function animate() {
      frame();
      request = requestAnimationFrame(animate);
    }
    animate();
    window.addEventListener(
      'pagehide',
      (e) => {
        if (!e.persisted) {
          cancelAnimationFrame(request);
          observer.disconnect();
          player.pause();
          if (objectURL) URL.revokeObjectURL(objectURL);
          if (context) void context.close();
          view.dispose();
        }
      },
      { once: true },
    );
    if (import.meta.env.DEV) {
      // Render deterministic samples through the same mesh, shader and animator as the live controls.
      const sample = (pose: Partial<Pose>, motion?: Motion, age = 0, text = '') => {
        frozen = true;
        const sampler = options.makeActor();
        sampler.idle = false;
        Object.assign(sampler.controls, pose);
        if (motion) options.play(sampler, motion, 0);
        if (text) sampler.speak(text, 0);
        for (let t = 0; t < age; t += 1 / 72) sampler.update(t);
        draw(sampler.update(age));
        return canvas.toDataURL('image/png');
      };
      Object.assign(window, {
        rigStudio: {
          sample,
          expressions: facePresets,
          clips,
          resume: () => {
            frozen = false;
          },
          state: () => ({
            pose: { ...actor.pose },
            level: actor.level,
            motion: actor.motion,
            ...view.stats?.(),
            tracking,
          }),
        },
      });
    }
  }
}
