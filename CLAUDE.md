# CLAUDE.md

이 저장소는 **대동 CAD**입니다. 대동(大洞, Daedong Group)의 건설·외식 장비 일에 쓰는 2D 도면 프로그램(DXF)으로, 브라우저 한 파일판과 Windows 데스크톱 앱(Electron)이 있습니다. 2026-10-31 대표님 요청으로 대동 파트너십 저장소(`embrace0423-cmd/desktop-tutorial`)의 `tools/daedong-cad/`에서 커밋 이력과 함께 옮겨 왔습니다. 저장소는 비공개(private)입니다.

## 세션 시작

1. `README.md`의 맨 위(만든 날·고친 날), 7절(한계와 다음 할 일), 10절(바뀐 기록)을 읽고 지금 판에서 이어갑니다.
2. 대표님 PC는 Windows 10입니다. 클라우드 세션에서는 대표님 PC에 직접 설치·저장할 수 없으니, 설치 파일과 그림은 채팅으로 보내 드리고 받아서 저장하시게 안내합니다.

## 원칙

- 한국어 존댓말, 호칭은 "대표님".
- **클린룸**: 오토캐드 등 다른 CAD의 프로그램을 역분석하거나 코드·화면·아이콘을 베끼지 않습니다. 공개 DXF 형식과 여러 CAD에 공통인 일반 기능·관례만 씁니다. REA 같은 역공학 도구를 이 프로그램 개발에 쓰지 않습니다. 근거 기록: 대동 저장소 `daedong-legal/docket.md` G-21(2026-10-29).
- **복합 초벌 화덕·컨트롤러의 고유 설계는 이 저장소에 넣지 않습니다**(특허 검토 전 비공개, 대동 설계 기록 3-14). 화덕·식품기계 기호는 시중 일반 부품 모양만 둡니다.
- 타인의 실명·얼굴 사진·민감정보, 대표님 개인 정보는 저장소에 넣지 않습니다. 시험용 그림은 가상으로 새로 그립니다.
- 숫자·규격은 확인한 것만 쓰고, 확인하지 못한 것은 [확인 필요]로 둡니다.

## 만들기와 시험

- 한 파일판: `node build.js` → `dist/daedong-cad.html` (화면을 바꾸면 다시 만들어 함께 커밋)
- 단위 시험: `node --test test/unit.js`
- 브라우저 종단 시험: `LANG=C.UTF-8 node test/e2e.js <출력 폴더>` (Playwright Chromium)
- 데스크톱 앱: `cd desktop && npm install && npm run dist:dir`, 시험은 `xvfb-run -a node test/desktop.js <출력 폴더>`
- Windows 설치 파일: `cd desktop && npm run dist:win` → `desktop/out/DaedongCAD-Setup-<판>.exe`. 리눅스에서도 wine 없이 만들어집니다(`desktop/build-win.js`). 설치 파일(약 100MB)은 저장소에 넣지 않습니다.
- 저장한 DXF는 ezdxf `recover.readfile` 감사로 오류 0을 확인합니다.
- 판을 올릴 때: `desktop/package.json`의 version, README 맨 위와 10절 '바뀐 기록', 6절 시험 수.

## 커밋과 합치기

- 커밋 메시지와 PR에 모델 이름을 쓰지 않습니다. force push는 하지 않습니다.
- 지정 브랜치에 커밋·푸시하고 PR을 만들어 main에 합칩니다. 대동 저장소의 상시 승인(2026-10-05, PR을 묻지 않고 만들어 합치기)이 이 저장소에도 적용되는지는 [확인 필요]입니다. 확인 전에는 PR을 만든 뒤 합칠지 대표님께 여쭙습니다.
- 큰 판이 나오면 대동 저장소의 `daedong-academy/progress.md` 로그와 `daedong-hq/dashboard.md`의 '도구: 대동 CAD' 줄에도 남길 수 있게 대표님께 알립니다(그 저장소는 그쪽 세션이 고칩니다).
