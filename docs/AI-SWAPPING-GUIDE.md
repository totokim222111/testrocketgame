# TESTROCKET 콘텐츠 교체 가이드

`public/content/manifest.yaml`에서 활성 팩 ID를 고릅니다. 기존 팩과 나란히 새 폴더와 미션 파일을 추가한 뒤 ID로 전환하면 됩니다. `schemas/`의 JSON Schema를 기준으로 필드 이름과 값을 확인하세요.

## 팩 배치

```text
public/content/
  manifest.yaml
  heroines/<heroine-id>/
    heroine.yaml
    dialogue.yaml
    events.yaml
    rig/
    audio/
  housings/<housing-id>/
    housing.yaml
    environment.yaml
    backgrounds/
  missions/<mission-id>.yaml
```

## 히로인

1. `heroine.yaml`에 새 폴더와 같은 `id`를 넣습니다. 표시 이름, 카드 테마, 배치, 프레이밍, 음성 게인을 이 파일에서 조정합니다. `rig.rigJson`과 `rig.atlas`는 이 폴더 기준 경로입니다. Rig2D JSON 안의 `atlas`는 JSON 파일 기준으로 같은 파일을 가리켜야 합니다.
2. `dialogue.yaml`의 `heroineId`를 맞춥니다. 각 대사에 고유한 `id`, `event`, `text`, `emotion`, 시간과 우선순위를 둡니다. `clip`을 생략하면 `emotionClips`의 매핑을 사용합니다. `audio`는 `voice.audioDir` 기준 파일명입니다. 음성을 배포하지 않는 줄은 `audio` 필드를 빼면 자막으로 립싱크합니다. 사용자 지정 모드 표기는 `heroine.yaml`의 선택 필드 `modeLabels`로 지정할 수 있습니다.
3. `events.yaml`에서 관찰 각도와 유지 시간, 빠른 회전, 대기, 실수 연속 횟수와 진행 이정표를 조정합니다. 이벤트마다 `dialogue.yaml`의 대사가 필요합니다. 이정표 단계 인덱스는 0부터 시작합니다. 경도가 360°를 가로지르면 `yawMinDeg`를 `yawMaxDeg`보다 크게 지정합니다.
4. 시작, 수리, 발사 연출에서 사용하는 표준 이벤트 ID는 기존 팩의 `dialogue.yaml`을 기준으로 유지합니다. 임무별 시작·힌트·완료 ID는 미션의 `startEvent`, `hintEvent`, `completeEvent`와 맞춥니다.

## 하우징과 격납고

1. `housing.yaml`의 `id`를 폴더명과 일치시킵니다. `lengthCm`과 `circumferenceCm`는 센티미터입니다. `noseconeRatio`, `bodyRatio`, `nozzleRatio`의 합은 1입니다. 기본 점검은 실물 크기이고 확대 버튼은 `magnifierScale`을 사용합니다.
2. `palette`와 `lineArtTexture`에서 외피색, 눈금, 스텐실, 회로선을 조정합니다. `mounts`의 높이 0은 노즐 바닥, 1은 노즈콘 끝입니다. 정면은 0°, 오른쪽은 90°, 뒤는 180°, 왼쪽은 270°입니다. 미션에서 참조하는 마운트 ID를 정의합니다.
3. `environment.yaml`의 `housingId`를 맞춥니다. SVG의 `src`는 팩 폴더 기준입니다. 원통 배경은 `heightMeters`가 필요하며, 구름처럼 회전하는 레이어는 `driftSpeedRadPerSec`를 둡니다. 조명, 아이리스 속도, 상승 시간과 발사 색감은 `lighting`, `launchColumn`에서 조정합니다.

## 미션

`missions/<mission-id>.yaml`의 파일명과 `id`를 맞춥니다. 단계마다 고유한 `id`, `order`, `mountId`, `mechanicType`, `startEvent`, `hintEvent`를 둡니다. `order` 순서로 진행하며 `nosecone_arm`을 넣는 경우 마지막에 배치합니다. 새 미션은 아래 기계 유형과 각 스키마의 `params`를 조합할 수 있습니다.

| `mechanicType` | 검토할 값 |
| --- | --- |
| `fastener_unlock` | 볼트 수, 잠금 각도, 오차 |
| `vernier_ring` | 시작 각도, 목표, 오차, 유지 시간 |
| `coupled_valves` | 시작·정답 밸브값과 3×3 행렬. 각 안전 구간 중심은 행렬에 정답 벡터를 곱한 값 |
| `wire_patch` | 케이블 ID, 라벨, 색, 대상 소켓. `note`가 있는 경로에는 우회와 그을림을 표시 |
| `seam_weld` | 체크포인트 수, 파형 높이. 시작 위치는 마운트 각도, 호의 길이는 `spanDeg` 또는 미션 각도 차이 |
| `wave_sliders` | 축별 라벨, 초기값, 목표, 공통 오차 |
| `nozzle_trim` | 두 축의 초기 오프셋, 중심 허용 반지름, 플러그 삽입 조건 |
| `nosecone_arm` | 잠금 회전 각도, 오차, 안전 덮개 조건 |

## 검증

1. 새 팩을 `manifest.yaml`의 `active`로 지정합니다.
2. `npm run content:validate`를 실행합니다. 스키마, ID·마운트·이벤트 참조, 리그와 SVG·음성 파일을 검사합니다.
3. 제작 중인 음성·배경의 누락만 허용하려면 `npm run content:validate -- --allow-missing-audio --allow-missing-svg`를 사용합니다. 공개 빌드는 기본 검증으로 확인합니다.
4. 개발 서버에서 URL의 `?heroine=<id>&housing=<id>&mission=<id>`도 확인합니다. `allowQueryOverride: true`인 경우 선택한 팩을 불러옵니다. 여러 조합을 배포한다면 조합별로 미션 이벤트와 파트의 실제 배치를 점검합니다.
