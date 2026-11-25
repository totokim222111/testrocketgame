# TESTROCKET

15 cm 소형 로켓을 돌려 보며 8단계 정비를 마치고 궤도에 올리는 3D 퍼즐 게임입니다. Quest 2 이상에서는 실물 크기 로켓을 손 가까이에서 점검할 수 있습니다. 데스크톱에서는 마우스와 키보드로 같은 임무를 플레이합니다.

## 로컬 실행

Node.js 24에서 아래 명령을 실행하고 `http://localhost:5173`을 엽니다.

```sh
npm install
npm run dev
```

| 기능 | 데스크톱 | Quest 2 이상 |
| --- | --- | --- |
| 로켓 회전 | 배경에서 왼쪽 버튼으로 드래그하거나 어디서나 오른쪽 버튼으로 드래그. `WASD`와 방향키도 지원 | 그립을 누른 채 손목 회전 또는 양쪽 스틱 |
| 부품 조작 | 왼쪽 클릭·드래그. `Shift`+클릭으로 반대 방향 한 칸 | 트리거로 선택·드래그. 도구 끝이나 손가락을 가까이 대고 선택 가능 |
| 배선·실링 | 케이블 선택 후 소켓 클릭 또는 드래그해서 연결. 실링 중 `WASD`로 회전 가능 | 케이블 선택 후 소켓에 놓기. 트리거를 누른 채 그립이나 스틱으로 회전하며 실링 |
| 확대·힌트 | `Z` 1×/2.25×, `H` 힌트, 휠로 거리 조절 | `A/X` 확대, `B/Y` 힌트, 또는 콘솔 버튼 |
| 초기화·발사 | `R` 각도 초기화, `M` 음소거. 덮개를 연 뒤 발사 버튼 또는 `Space` | 콘솔에서 각도 초기화. 덮개를 연 뒤 발사 버튼 |

Quest 브라우저에서 **HTTPS** 게임 주소를 열고 **헤드셋으로 시작**을 선택합니다. 진입할 때 현재 눈높이와 정면 방향을 기준으로 작업대를 맞춥니다. 발사 중 VR 시점은 플레이어의 헤드셋 움직임만 따릅니다.

## 검사와 빌드

```sh
npm run typecheck
npm run test
npm run content:validate
npm run build
npm run preview
```

음성이나 배경이 제작 중이면 `npm run content:validate -- --allow-missing-audio --allow-missing-svg`로 YAML과 리그를 검증할 수 있습니다. 누락된 음성은 자막 기반 립싱크로, 누락된 SVG는 절차적 배경으로 표시합니다. `window.__TESTROCKET__`에서 진행 상태, 드로우콜과 테스트용 조작을 확인할 수 있습니다.

## Cloudflare Pages

라이브 배포 주소: **https://testrocketgame.pages.dev**

GitHub 저장소를 Pages 프로젝트(`testrocketgame`)에 연결하고 루트 디렉터리를 이 프로젝트에 맞춥니다. 빌드 명령은 `npm run build`, 출력 디렉터리는 `dist`, 환경 변수는 `NODE_VERSION=24`로 설정합니다. 배포 후 Pages의 HTTPS 주소를 Quest 브라우저에서 열어 VR 진입과 컨트롤러를 점검합니다. [Pages 빌드 설정](https://developers.cloudflare.com/pages/configuration/build-configuration/) · [Node 버전 설정](https://developers.cloudflare.com/pages/configuration/build-image/)

## YAML로 콘텐츠 바꾸기

`public/content/manifest.yaml`의 `active`에서 히로인·하우징·미션을 고릅니다. URL의 `?heroine=...&housing=...&mission=...`으로 조합을 미리 볼 수 있습니다. 화면, 퍼즐 조건, 대사와 발사 연출 설정은 로딩한 YAML을 사용합니다. [AI 교체 가이드](docs/AI-SWAPPING-GUIDE.md)
