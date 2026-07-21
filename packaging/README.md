# 에이전트 배포 패키징 (Windows exe + 서비스)

로컬 변환 에이전트를 **단일 실행파일(exe)** 로 빌드하고, **포터블 LibreOffice를
동반한 설치 프로그램**으로 Windows 서비스로 상주시키는 절차입니다.

```
브라우저(웹페이지)  ──fetch──▶  http://127.0.0.1:7391  ──▶  mv-agent.exe (서비스)  ──▶  soffice → PDF
```

## 1. 에이전트 exe 빌드 (Node SEA)

Node의 공식 SEA로 Node 런타임까지 포함한 단일 실행파일을 만듭니다. **대상 PC에
Node 설치가 필요 없습니다.**

```bash
# 호스트 플랫폼용 (리눅스/맥에서 테스트용)
npm run build:agent

# Windows 타깃 (어느 OS에서든 크로스 빌드 가능)
#   1) win-x64 node.exe 준비: https://nodejs.org/dist/v22.x/win-x64/node.exe
#   2) 크로스 빌드
node packaging/build-agent.mjs --node ./node.exe --out build/mv-agent.exe
```

빌드 과정: esbuild가 에이전트(ESM)를 단일 CJS로 번들 → SEA blob 생성 → 대상 node
바이너리에 postject로 주입. postject는 순수 JS라 호스트 OS와 무관하게 동작합니다.

> 참고: 산출물은 약 100MB대(Node 런타임 포함)입니다.

## 2. 동반 바이너리 자동 다운로드 (LibreOffice + NSSM)

수동으로 받을 필요 없이 스크립트로 내려받습니다.

```bash
npm run fetch:vendor
# 또는 버전 지정 / 개별 다운로드
node packaging/fetch-vendor.mjs --lo-version 25.2.5
node packaging/fetch-vendor.mjs --only nssm
```

- **NSSM**: zip을 받아 `packaging/vendor/nssm.exe` 로 추출(OS 무관, 완전 자동).
- **LibreOffice**: 공식 Windows MSI를 받습니다.
  - Windows에서 실행하면 `msiexec /a` 로 자동 추출 →
    `packaging/vendor/LibreOffice/program/soffice.exe`
  - 다른 OS에서 실행하면 MSI만 받고, Windows에서 실행할 추출 명령을 안내합니다.
  - HWP import에는 JRE가 필요할 수 있으니, 서비스 환경에 JRE가 있는지 확인하세요.

> 프록시로 외부 다운로드가 막힌 CI/샌드박스에서는 이 단계가 실패할 수 있습니다.
> 실제 빌드 머신(또는 사내망 미러)에서 실행하세요.

## 3. 설치 프로그램 컴파일 (Inno Setup)

Windows에서 [Inno Setup](https://jrsoftware.org/isinfo.php)으로 컴파일합니다.
서비스가 호출을 허용할 **웹페이지 Origin**을 반드시 지정하세요.

```bat
iscc /DAllowedOrigins="https://myapp.company.com" packaging\mv-agent.iss
```

생성된 `mv-agent-setup.exe` 를 배포하면:
- `mv-agent.exe` + 포터블 LibreOffice 설치
- `MvAgent` 서비스 등록(자동 시작) + `SOFFICE_PATH`/`MV_PORT`/`MV_ALLOWED_ORIGINS`
  환경 설정 후 서비스 시작

## 4. 웹페이지 연동

```js
new MultiViewer({
  container: '#app',
  assetsPath: '/viewer/',
  converter: { url: 'http://127.0.0.1:7391', formats: ['doc', 'ppt'] },
});
```

배포 시 `MV_ALLOWED_ORIGINS` 에 넣은 도메인 = 이 페이지의 Origin 이어야 CORS가
통과합니다. (localhost 는 개발용 기본 허용)

## 동작 확인

```bat
curl http://127.0.0.1:7391/health
```
`{"ok":true,"soffice":true,...}` 이면 정상. `soffice:false` 면 `SOFFICE_PATH` 를
확인하세요.

## 주의

- 이 저장소의 CI/샌드박스에서는 리눅스 exe 빌드·실행까지 검증되었습니다. Windows
  exe·Inno Setup 컴파일은 Windows(또는 win node.exe 크로스 빌드) 환경에서
  수행/검증하세요.
- 관리자 권한 설치(서비스 등록)가 필요합니다.
