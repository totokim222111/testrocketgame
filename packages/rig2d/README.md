# Rig2D

투명 아틀라스 한 장으로 눈·입·손을 바꾸고 고개와 머리카락을 움직이는 2D 초상 엔진이다. 시간 단위는 초, 각도는 도, 음량은 0~1이다. WebGL에서는 인물 하나를 메시 하나로 그린다.

## 다른 프로젝트에서 사용

이 폴더를 TypeScript 또는 Vite 프로젝트에 복사하고 `npm install ./packages/rig2d`로 로컬 패키지를 연결한다. Three 렌더러를 사용할 프로젝트에는 `three`도 설치한다. Canvas2D는 브라우저의 2D 컨텍스트로 동작한다. 리그 JSON과 아틀라스를 같은 정적 디렉터리에 제공한다. 아래 예제는 `<canvas id="portrait" width="360" height="480"></canvas>`에 그린다.

```ts
import { RigAnimator } from '@rig2d/engine';
import { CanvasPortrait } from '@rig2d/engine/canvas';

const canvas = document.querySelector<HTMLCanvasElement>('#portrait')!;
const view = await CanvasPortrait.load(canvas, '/my-character/rig.json');
const actor = new RigAnimator(view.art.definition.animation);
let request = 0;
function frame(ms: number) {
  view.apply(actor.update(ms / 1000));
  request = requestAnimationFrame(frame);
}
request = requestAnimationFrame(frame);
actor.play('greet', performance.now() / 1000);

// 화면을 해제할 때 호출한다.
function dispose() { cancelAnimationFrame(request); view.dispose(); }
```

Three에서는 `import { Portrait } from '@rig2d/engine/three'`로 가져온다. `new Portrait(url)`의 `ready`를 기다리고 `status === 'ready'`이면 `scene.add(view.mesh)`로 추가한다. 실패 원인은 `view.error`에 있다. `view.definition.animation`으로 애니메이터를 만들고 렌더링 전에 `view.apply(actor.update(seconds))`를 호출한다. 기본 초상의 세로 길이는 월드 좌표 1, 너비는 0.75다. 같은 URL의 인스턴스는 지오메트리와 텍스처를 공유하고 마지막 `dispose()`가 자원을 반환한다.

## 애니메이션과 음성

| API | 작동 방식 |
| --- | --- |
| `loadDefinition(url, signal?)` | JSON 형식, 프레임 경계, 깊이 격자, 키프레임 시간·값을 검사한다. |
| `loadRig(url, signal?)` | 정의와 디코딩한 아틀라스를 `{ definition, atlas }`로 반환한다. |
| `new RigAnimator(profile?)` | 기본 동작과 리그의 클립을 합친다. 사용 가능한 이름과 길이는 `actor.library`에 있다. |
| `play(id, time, priority?)` | 같은 우선순위 이상이면 진행 중인 클립을 교체한다. |
| `enqueue(id, priority?)` | 진행 중인 동작이 끝나면 우선순위 순으로 재생한다. 동점은 입력 순서다. |
| `overlayClip(id, time)` | 현재 동작 위에 클립에 기록된 매개변수만 덮어쓴다. |
| `controls`, `idle`, `update(time)` | 수동 자세, 자동 대기 동작, 프레임 계산. `delete actor.controls.yaw`처럼 수동 입력을 놓을 수 있다. 반환 자세 객체는 다음 프레임에 재사용한다. |
| `speak(text, time)` | 자막의 한글 모음·공백·문장부호에 맞춰 입을 움직인다. 예상 재생 길이를 반환한다. |
| `setMouthOpen(level)` | 외부 음량을 최우선으로 사용한다. 무음은 0, 재생 종료는 null이다. 입은 닫힘·작게·크게·활짝 네 단계다. |
| `reset()` | 진행 중인 클립, 대기열, 음성 입력과 스프링을 초기화한다. 수동 컨트롤 값은 유지한다. |
| `Portrait.setFraming(scale,y,halfWidth,vignette?)`, `setBrightness(gain)` | 호스트가 지정한 프레이밍과 표시 밝기를 반영한다. |

음성 재생기의 Web Audio 그래프에서 `AnalyserNode`를 연결한 뒤 프레임마다 RMS를 전달한다. 배열은 한 번만 만든다. 파일 재생과 자막에 같은 시계를 사용하면 음성 입력을 놓았을 때 자막의 현재 위치로 이어진다.

```ts
const samples = new Float32Array(analyser.fftSize);
function applyAudio() {
  analyser.getFloatTimeDomainData(samples);
  let energy = 0;
  for (const sample of samples) energy += sample * sample;
  actor.setMouthOpen(Math.min(1, 4 * Math.sqrt(energy / samples.length)));
}
audio.addEventListener('ended', () => actor.setMouthOpen(null));
audio.addEventListener('pause', () => actor.setMouthOpen(null));
```

스튜디오의 **음성 파일 열기**에서 로컬 음원을 선택하면 재생기의 실제 파형으로 입을 움직인다. 파일은 브라우저의 객체 URL로 재생한다.

재생 중인 프레임에서만 `applyAudio()`를 부른다. 녹음 레벨에 따라 예시의 입력 게인 4를 조정한다.

## 새 캐릭터 만들기

1. 정면 흉상을 투명 레이어로 준비한다. 이 프로젝트의 기준 캔버스는 1086×1448이다. 눈을 닫았을 때 드러나는 피부와 고개를 돌렸을 때 드러나는 목·머리카락까지 그린다.
2. 같은 부위의 프레임을 왼쪽부터 수평으로 배치한다. 가장자리 색을 여백에 연장하고 아틀라스를 RGBA PNG 또는 무손실 WebP로 저장한다.
3. `rig.json`에 아래 필드를 기록한다. `layers` 순서대로 뒤에서 앞으로 그린다. 캐릭터별 선택 동작과 대기 자세는 `animation`에 넣는다.
4. `validateDefinition(json)`으로 검사한다. 작은 창에서 눈·입 전환, 양 끝 회전, 손 포즈, 밝고 어두운 배경을 확인한다.

| 필드 | 좌표·의미 |
| --- | --- |
| `version, canvas, atlas, size` | 버전 1, 원화 폭·높이, JSON 기준 아틀라스 URL, 실제 텍셀 폭·높이. |
| `layers[].rect` | 원화 좌측 상단 기준 `[x,y,w,h]`. 몸 아래쪽은 캔버스 밖까지 연장할 수 있다. |
| `tile, frames, stride` | 첫 프레임의 아틀라스 `[x,y,w,h]`, 프레임 수, 다음 프레임까지의 수평 텍셀 거리. |
| `grid, depth` | `[열,행]`과 0~255 깊이. 정점 수는 `(열+1)×(행+1)`, 위에서 아래로 행 우선이다. |
| `continuous, handRect` | 긴 머리와 몸이 이어진 원화용 연속 변형, 네 번째 손 프레임의 원화 배치. |
| `armFrames` | 각 팔 프레임의 원화 좌표 `rect: [x,y,w,h]`와 회전축 `elbow: [x,y]`. 두 렌더러가 같은 팔꿈치를 사용한다. |
| `bustFade` | 선택 필드. 원화 Y좌표로 흉상 페이드의 완전 불투명 지점과 완전 투명 지점을 지정한다. |
| `animation.parameters` | 기본 자세를 재정의하는 매개변수값. 키와 범위, 기본값은 스키마의 `$defs.parameters`에 있다. |
| `animation.idle` | 호흡 Hz, 고개 진폭, 간헐적 끄덕임 주기, 자세 오프셋과 `[매개변수,진폭,Hz,위상(라디안)]` 목록. |
| `animation.clips[id]` | 표시 이름 `label`, 전체 길이 `duration`, 유지값 `constants`, 매개변수별 `tracks`. 각 트랙은 시간이 증가하는 `[초,값]` 배열이다. |

기준 레이어 순서는 `rear, neck, body, face, blush, eyeL, eyeR, brows, mouth, fringe, locks, hand, spark`다. 간단한 리그는 일부 레이어만 넣어도 된다. 눈 프레임은 닫힘·반쯤·기본·웃음·놀람·조금 크게, 눈썹은 기본·올림·화남·처짐, 입은 다묾·작게·크게·활짝·웃음·삐죽 순이다. 입의 일곱 번째는 고유 표정용이며, 여덟 번째는 처진 눈썹과 감기는 눈을 함께 쓰는 하품이다. 손은 손바닥·검지·엄지·고유 손 포즈 순이다. 다섯 번째 손이 있으면 고유 손동작 중 `wrist`가 −0.15보다 낮을 때 선택한다. 두 번째 `fringe` 프레임을 제공하면 놀람 눈과 함께 그린다. `wink`는 보는 사람 기준 왼쪽 눈에 적용된다.

등록된 팔(`armFrames`)은 손바닥·검지·엄지·응원 주먹 순이다. 다섯 번째는 고유 손동작이고, 여섯 번째는 같은 동작에서 `wrist < -0.15`일 때의 손 모양이다.

```json
{
  "animation": {
    "idle": { "breathHz": 0.2, "oscillators": [["locks", 0.45, 0.18, 0]] },
    "clips": {
      "ack": {
        "label": "끄덕임",
        "duration": 1,
        "tracks": { "pitch": [[0.18, 4], [0.5, -9], [0.82, 1]] }
      }
    }
  }
}
```

전체 형식은 [JSON 스키마](rig.schema.json)에 있다. `example/dummy.ts`는 캔버스에 직접 그린 아틀라스와 리그를 만든다. Vite에서 `/packages/rig2d/example/`를 열면 같은 더미로 Canvas2D와 Three 렌더러를 비교하고 표정·음량·클립을 조작할 수 있다. 게임 빌드에 들어가는 예제 주소는 `coach-rig-lab.html?example=1`이다. Canvas2D는 해상도에 맞춰 레이어를 합성한 후 가로 띠를 변형한다. Three는 정점 깊이와 셰이더로 눈동자와 얼굴 원근을 더 세밀하게 표현한다.

