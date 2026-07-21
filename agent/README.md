# MultiViewer 로컬 변환 에이전트

브라우저가 직접 처리하기 어려운 문서(구형 `doc`/`ppt`, 필요 시 office/HWP 전반)를
**LibreOffice headless로 PDF 변환**해주는 로컬 HTTP 서비스입니다. 뷰어는 반환된
PDF를 pdf.js로 렌더링합니다. 변환이 실패하거나 에이전트가 꺼져 있으면 클라이언트
뷰어로 자동 폴백합니다.

## 요구 사항

- Node.js 18+ (의존성 없음, 표준 라이브러리만 사용)
- LibreOffice (`soffice`) 설치 — `doc/ppt/docx/xlsx/pptx/hwp/hwpx` import 지원
  - HWP import에는 LibreOffice의 Java 런타임(JRE)이 필요할 수 있습니다.

## 실행

```bash
# 저장소 루트에서
npm run agent
# 또는
node agent/server.mjs
```

기본적으로 `http://127.0.0.1:7391` 에서 대기합니다. 시작 시 soffice 탐지 결과와
CORS 정책을 로그로 출력합니다.

## 설정 (환경 변수)

| 변수 | 기본값 | 설명 |
| --- | --- | --- |
| `MV_PORT` | `7391` | 포트 |
| `SOFFICE_PATH` | `soffice` | LibreOffice 실행 파일 경로 |
| `MV_ALLOWED_ORIGINS` | (없음) | 추가 허용 Origin(쉼표 구분). `*`이면 전체 허용 |
| `MV_TOKEN` | (없음) | 설정 시 `X-MV-Token` 헤더 필수 |
| `MV_MAX_BYTES` | `104857600` | 요청 본문 최대 크기(100MB) |
| `MV_CONCURRENCY` | `2` | 동시 변환 수 |
| `MV_CACHE_DIR` | OS 임시 폴더 | 변환 결과 캐시 위치 |
| `MV_TIMEOUT_MS` | `120000` | 변환 타임아웃 |

## 보안 (로컬 에이전트 기준)

- **127.0.0.1 에만 바인딩** — 외부에서 접근 불가
- **CORS는 기본적으로 localhost/127.0.0.1 Origin만 허용** — 다른 Origin은 403
  (프리플라이트 포함). `MV_ALLOWED_ORIGINS`로 확장 가능
- **Host 헤더 검증** — `localhost`/`127.0.0.1`이 아니면 403 (DNS 리바인딩 완화)
- 선택적 공유 토큰(`MV_TOKEN`), 본문 크기 제한

## API

### `GET /health`

```json
{ "ok": true, "soffice": true, "version": "LibreOffice 24.2", "formats": ["doc","ppt","docx", "..."], "concurrency": 2 }
```

### `POST /convert`

- 본문: 파일 바이너리(raw)
- 헤더: `X-Filename: <원본파일명>` (확장자로 import 필터 결정), 선택 `X-MV-Token`
- 응답: `application/pdf` (헤더 `X-MV-Cache: hit|miss`)

```bash
curl -X POST --data-binary @sample.doc \
  -H 'X-Filename: sample.doc' \
  http://127.0.0.1:7391/convert -o out.pdf
```

## 클라이언트 연동

```js
new MultiViewer({
  container: '#app',
  assetsPath: './dist/',
  converter: {
    url: 'http://127.0.0.1:7391',
    formats: ['doc', 'ppt'],   // 이 형식만 에이전트로; 실패 시 클라이언트 폴백
    // token: '...',           // MV_TOKEN을 설정한 경우
  },
});
```

`demo/viewer.html` 은 쿼리로도 설정할 수 있습니다:
`viewer.html?agent=http://127.0.0.1:7391&convert=doc,ppt`
