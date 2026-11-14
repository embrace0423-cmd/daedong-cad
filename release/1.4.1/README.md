# 대동 CAD 1.4.1 받은 묶음 (참고 보관)

1.4.1은 대표님 PC의 ChatGPT 작업 환경에서 만들고 시험한 판입니다. 2026-11-13 대표님이 첨부 ZIP 7개로 보내 주셨고, 이 저장소에 옮겨 왔습니다.
**앞으로의 방식(2026-11-13 대표님)**: 기능 추가·보완·업데이트는 ChatGPT에서 하고, 끝난 판을 이 저장소로 옮겨 옵니다. 실제 사용은 이 저장소의 판으로 합니다.

## 받은 것과 확인한 것

- 받은 묶음: `00-먼저읽기.zip`(안내·도구·검토 기록·도면)과 `01-data.zip`~`06-data.zip`(제품 ZIP 조각 6개)
- 조각 6개의 크기와 SHA-256이 묶음 안 `transfer-manifest.json`과 모두 맞았습니다. 합친 제품 ZIP `DaedongCAD-1.4.1-product-v2.zip`도 148,913,742바이트, SHA-256 `5bcbfd3edb5eff495843f58ddf950a0a1696f301118983d5cc3fbdbc411b7f1e`로 안내와 같았고, ZIP CRC 검사도 통과했습니다.
- 받은 복원 도구(`scripts/restore_backup.py`)는 실행하지 않았습니다. 같은 검사를 따로 했습니다.

## 저장소에 옮긴 방법

| 1.4.1 제품 ZIP | 이 저장소 |
|---|---|
| `src/app/daedong-cad.html` (한 파일) | 파일 안의 `// ---- js/… ----` 표시로 나누어 `index.html`, `js/app.js`, `js/dxf-read.js`, `js/dxf-write.js`, `js/images.js`에 넣음. 나머지 `js/`·`css/`는 1.4.0과 같았음. `node build.js`로 다시 만든 `dist/daedong-cad.html`을 다시 나눠 비교하면 1.4.1과 같습니다(`safety.js`를 안에 넣은 것만 다름) |
| `src/app/safety.js` | `js/safety.js` (한 파일판 안에 함께 넣고, 데스크톱 `desktop/app/`에도 복사) |
| `src/main.js`, `src/preload.js`, `src/atomic-store.cjs` | `desktop/` |
| `tests/`, `fixtures/` | `test/v141/` 그대로. `node test/v141/run.js`로 돌림 |
| `docs/`, `packaging/`, `scripts/`, `build-evidence/` 일부, `PRODUCT-MANIFEST.json` | 이 폴더 (참고) |

이 폴더에 넣지 않은 것:
- 설치 파일 `DaedongCAD-Setup-1.4.1.exe`(약 145MB): 크기 때문에 넣지 않았습니다. 받은 묶음에서 복원할 수 있습니다.
- `packaging/build-tools-offline.zip`(약 3.4MB, NSIS·asar 도구)
- 빌드 기록 중 대표님 PC 폴더 경로가 적힌 6개 파일(`payload.nsh`, `installer.nsi`, `nsis-build.log`, `build-evidence.json`, `reproducible-builds-v2.json`, `toolchain-lock.json`). 원본은 받은 묶음과 대표님 PC에 있습니다.
- 검토 보고서 원본(`REVIEW-RESULT`), 검증 자료 ZIP, 도면 ZIP: 대표님 PC 경로가 들어 있어 넣지 않았습니다. 요지: ChatGPT 쪽 종합검토 판정은 '통과'. 앱·설치 파일은 서명이 없고, 자동 화면 캡처는 미해결로 종료한 상태입니다.

## 두 가지 설치 방법의 차이

| | 1.4.1 원본 설치 파일 (ChatGPT, NSIS) | 이 저장소에서 만드는 설치 파일 (`desktop/`, electron-builder) |
|---|---|---|
| 설치 위치 | `%LOCALAPPDATA%\Programs\DaedongCAD-Release` (1.4.0과 따로) | `%LOCALAPPDATA%\Programs\daedong-cad` (1.4.0 위에 덮어 설치) |
| 바탕화면 아이콘·DXF 연결 | 만들지 않음 | 만듦 |
| 사용자 자료 | `%APPDATA%\DaedongCAD-Release` | 같음. 둘 다 1.4.1 `main.js`를 씁니다 |

두 방법 모두 1.4.0의 자료 폴더(`%APPDATA%\대동 CAD`)를 옮기거나 지우지 않습니다. 그래서 1.4.1을 처음 켜면 1.4.0의 '최근 ▾' 목록과 '다시 켜면 이어서' 보관본은 보이지 않습니다. 작업 파일은 파일로 열면 됩니다.

## 1.4.0과 달라진 사용법 (중요)

- **Ctrl+S는 언제나 작업 파일(`.dcad.json`)로 저장합니다.** DXF는 위쪽 [DXF 내보내기] 단추로만 만들고, 내보내기 전에 바뀌는 내용(밑그림 제외, 치수·해치 분해 등)을 확인 창으로 알려 줍니다.
- 받은 DXF를 열면 작업 파일로 저장하기 전까지 ●(저장 안 함) 표시가 붙습니다. Ctrl+S를 누르면 원본 DXF는 그대로 두고 작업 파일 위치를 묻습니다.
- **DXF 단위**: 단위가 mm(4)면 그대로, 인치(1)면 25.4배 변환을 묻고, 단위가 없으면(0) 고르게 합니다. **그 밖의 단위 코드(예: 6 = m)는 열지 않습니다.** ezdxf 등 일부 프로그램은 기본값이 6이라, 실제 mm 도면이어도 열리지 않을 수 있습니다. 대표님이 ChatGPT 쪽에서 고쳐 다음 판으로 들여오기로 하셨습니다(2026-11-14).
- 저장할 때 같은 폴더에 `…dcad-backup-…` 백업이 생기고, 복구 보관본은 최근 3개까지 [복구 보관본] 단추로 엽니다.
- 작업 파일은 그림을 포함해 64MiB까지입니다.
