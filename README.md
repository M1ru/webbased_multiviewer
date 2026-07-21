# webbased-multiviewer

브라우저에서 동작하는 **스탠드얼론 멀티파일 뷰어**. 파일 바이너리를 입력받아
형식(매직넘버 + 확장자)을 판별하고, 각 형식에 맞는 뷰어로 렌더링합니다.

지원 형식: **pdf, txt, csv, xls, xlsx, docx, pptx, hwp, hwpx** (구형 `doc`,
`ppt`는 제한적 텍스트 미리보기).

## 특징

- **순수 클라이언트** — 서버 변환 없이 브라우저 안에서 렌더 (100% 오프라인 가능)
- **형식 자동 판별** — 확장자를 신뢰하지 않고 바이너리 시그니처로 감지
  (ZIP/OLE2 컨테이너는 내부까지 확인해 docx·xlsx·pptx·hwpx / doc·xls·ppt·hwp 구분)
- **구형 임베디드 Chromium 대응** — `Uint8Array.toHex`, `Map.getOrInsertComputed`
  등 최신 브라우저 전용 API를 자체 폴리필로 대체 (메인 스레드 + pdf.js 워커 모두)
- **iframe 친화** — 스타일이 `.mv-root`로 스코프됨. 한 칸(iframe)당 인스턴스 1개
- **ESM + UMD** 두 형태로 배포

## 형식별 렌더링 엔진

| 형식 | 엔진 | 출력 |
| --- | --- | --- |
| pdf | pdf.js v5 (워커에 폴리필 주입) | canvas |
| txt | 내장 `TextDecoder` + EUC-KR/CP949 폴백 | 텍스트 |
| csv | PapaParse → x-data-spreadsheet | 엑셀형 그리드 |
| xls / xlsx | SheetJS → x-data-spreadsheet | 엑셀형 그리드 |
| docx | docx-preview | HTML |
| pptx | pptx-viewer | 슬라이드 SVG |
| hwp / hwpx | @rhwp/core (Rust+WASM) | 페이지 SVG |
| doc / ppt | 자체 OLE2 텍스트 추출 | 제한적 텍스트 |

## 설치 & 빌드

```bash
npm install
npm run build      # dist/ 생성 (아래 산출물)
npm test           # 감지 유닛 테스트 + 브라우저 스모크 테스트
```

빌드 산출물(`dist/`):

```
multiviewer.js          ESM 엔트리
multiviewer.umd.cjs     UMD (standalone <script>)
multiviewer.css         스타일시트
rhwp_bg.wasm            HWP/HWPX 렌더용 WASM (약 7MB, 별도 호스팅)
mv-pdf.worker.js        폴리필이 주입된 pdf.js 워커 (별도 호스팅)
assets/, *-<hash>.js    형식별 lazy-load 청크
```

> `rhwp_bg.wasm`, `mv-pdf.worker.js`, 청크 파일들은 `multiviewer.js`와 **같은
> 폴더**에 함께 배포하세요. 위치가 다르면 `assetsPath` 옵션으로 지정합니다.

## 사용법

### ESM

```js
import { MultiViewer } from './dist/multiviewer.js';
import './dist/multiviewer.css';

const viewer = new MultiViewer({
  container: '#app',
  assetsPath: './dist/',      // rhwp_bg.wasm / mv-pdf.worker.js 위치 (기본 './')
});

// input: File | Blob | ArrayBuffer | Uint8Array
const info = await viewer.render(file);   // { format, via }
```

### Standalone `<script>` (UMD)

```html
<link rel="stylesheet" href="dist/multiviewer.css" />
<script src="dist/multiviewer.umd.cjs"></script>
<script>
  const { MultiViewer } = window.MultiViewer;
  const viewer = new MultiViewer({ container: '#app', assetsPath: 'dist/' });
  viewer.render(file);
</script>
```

### iframe 그리드 (2×3 등)

각 칸을 iframe(`demo/viewer.html`)으로 두고, 부모가 `postMessage`로 파일을
전달하는 패턴입니다. 동작하는 예시는 `demo/index.html` 참고.

```js
iframe.contentWindow.postMessage({ type: 'mv:render', file }, '*');
```

## API

### `new MultiViewer(options)`

| 옵션 | 설명 |
| --- | --- |
| `container` | 렌더 대상. CSS 선택자 또는 `HTMLElement` (필수) |
| `assetsPath` | `rhwp_bg.wasm` / `mv-pdf.worker.js` 폴더 (기본 `'./'`) |
| `rhwpWasmUrl` | WASM 바이너리 URL 직접 지정 (`assetsPath`보다 우선) |

### 메서드

- `render(input, { filename })` → `Promise<{ format, via }>` — 렌더링
- `detect(input)` → `Promise<{ format, via, ext }>` — 렌더 없이 형식만 판별
- `clear()` — 내용 제거

## 브라우저 호환성

임베디드 Chromium **80~99** 기준으로 빌드/폴리필합니다.

- 문법: esbuild `es2018` 타깃으로 다운레벨
- 빠진 빌트인 메서드: `src/polyfills.js`가 런타임에 자체구현 주입
  - `Uint8Array.prototype.toHex/fromHex/toBase64/fromBase64` (최신 브라우저 전용)
  - `Map/WeakMap.prototype.getOrInsert/getOrInsertComputed` (pdf.js v5 사용)
  - `structuredClone`, `Object.hasOwn`, `Promise.allSettled/any`,
    `String/Array.prototype.at`, `findLast(Index)`, `replaceAll` 등
- 폴리필은 모두 feature-detect라 최신 브라우저에서는 no-op
- **pdf.js 워커에도 동일 폴리필을 주입**(`mv-pdf.worker.js`)해 워커 내부의
  `toHex/fromBase64`까지 대체
- WASM(HWP/HWPX)은 Chromium 57+에서 동작

## 한계

- **doc / ppt (구형 OLE2 바이너리)**: 신뢰할 만한 순수 JS 렌더러가 없어 서식
  그대로의 렌더링은 미지원. OLE2 스트림에서 텍스트만 추출해 보여주고 원본
  다운로드를 제공합니다.
- hwp/hwpx·pptx 재현도는 문서 구조에 따라 편차가 있을 수 있습니다.

## 라이선스

MIT. 각 의존 라이브러리는 해당 라이선스(대부분 MIT/Apache-2.0)를 따릅니다.
