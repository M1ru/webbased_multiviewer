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
| `MV_ALLOWED_ORIGINS` | (없음) | 허용 Origin 목록(쉼표/공백 구분). **와일드카드 패턴 지원**. `*`이면 전체 허용 |
| `MV_ALLOWED_ORIGINS_URL` | (없음) | 중앙 허용목록 엔드포인트(A). 켜면 여기서 목록을 받아 합침 |
| `MV_ALLOWED_ORIGINS_TOKEN` | (없음) | 위 엔드포인트 호출 시 `Authorization: Bearer` 토큰 |
| `MV_ORIGINS_REFRESH_MS` | `300000` | 중앙 목록 갱신 주기(5분) |
| `MV_TOKEN` | (없음) | 설정 시 `X-MV-Token` 헤더 필수 |
| `MV_MAX_BYTES` | `104857600` | 요청 본문 최대 크기(100MB) |
| `MV_CONCURRENCY` | `2` | 동시 변환 수 |
| `MV_CACHE_DIR` | OS 임시 폴더 | 변환 결과 캐시 위치 |
| `MV_TIMEOUT_MS` | `120000` | 변환 타임아웃 |

## 허용 Origin — 와일드카드(B) & 중앙 관리(A)

로컬 에이전트는 한 번 설치하면 오래 쓰므로, 서비스가 늘 때마다 재설정하지 않도록
두 가지를 제공합니다.

**B. 와일드카드 패턴 (메인)** — `MV_ALLOWED_ORIGINS` 에 패턴을 넣습니다.

| 패턴 | 매칭 | 비고 |
| --- | --- | --- |
| `https://app.company.com` | 정확히 그 Origin | |
| `https://*.company.com` | `a.company.com` (한 라벨) | 점은 넘지 않음 |
| `https://**.company.com` | `a.b.company.com` (임의 깊이) | |
| `http://*.corp` | 내부망 http | 스킴까지 매칭(http↔https 구분) |
| `http://intra.corp:*` | 임의 포트 | 포트가 있어야 매칭 |
| `*` | 전체 허용 | 지양(탈출구) |

> `http://*` 처럼 부모 도메인이 없는 광범위 패턴은 지양하세요. 부모 도메인은 고정.

**A. 중앙 허용목록 (선택, 나중에 켜기)** — `MV_ALLOWED_ORIGINS_URL` 을 설정하면
`{ "origins": ["https://*.company.com", ...] }` 를 반환하는 엔드포인트에서 목록을
주기적으로 받아 와일드카드 매칭에 합칩니다. 디스크 캐시로 오프라인/서버 다운 시
마지막 목록을 사용합니다. **DB에 직접 붙지 말고 이 엔드포인트(그 뒤 DB)를 두세요.**
엔드포인트는 HTTPS + 인증(`MV_ALLOWED_ORIGINS_TOKEN`)을 권장합니다.

## 보안 (로컬 에이전트 기준)

- **127.0.0.1 에만 바인딩** — 외부에서 접근 불가
- **CORS는 localhost + 지정 패턴만 허용** — 그 외 Origin은 403(프리플라이트 포함)
- **Host 헤더 검증** — `localhost`/`127.0.0.1`이 아니면 403 (DNS 리바인딩 완화)
- 선택적 공유 토큰(`MV_TOKEN`), 본문 크기 제한

## API

### `GET /health`

```json
{ "ok": true, "soffice": true, "version": "LibreOffice 24.2", "formats": ["doc","ppt","docx", "..."],
  "concurrency": 2, "origins": { "static": 1, "remote": 0, "remoteEnabled": false } }
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
