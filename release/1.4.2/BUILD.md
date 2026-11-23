# 정식 Windows 빌드와 안전한 설치 범위

이 제품은 JavaScript 앱 소스와 사전에 검증한 Windows x64 Electron 런타임을 패키징한다. Electron 엔진 자체를 소스에서 컴파일한 것은 아니다. 최초 런타임 EXE SHA256은 `44369e5970d7d29d3bb8fe69914278d3ae981256bd54d28ec93315070b729515`이며 정적 원본 바이너리에서 `Electron/44.10.0`, `Chrome/152.0.7977.169` 문자열을 확인했다. 다른 프로젝트에 있는 Electron45 패키지를 이 런타임의 버전 근거로 사용하지 않는다.

`scripts/build-release.py`는 소스 스냅샷→ASAR→전체 파일/바이트 대조→복사 EXE의 VERSIONINFO 변경→NSIS 설치기 생성→PE 버전 확인을 수행한다. `src/package.json`, HTML 버전 표기, EXE 및 설치기 버전이 맞아야 완료된다. 실제 앱이나 설치기를 자동 실행하지 않는다. 원본 후보 런타임과 과거 통과본을 수정하지 않는다.

## 제품 ZIP과 원작업의 경로

별도 표시가 없으면 이 문서의 경로는 제품 ZIP을 푼 최상위 폴더 기준이다. 제품 ZIP에는 소스·빌드 도구·설치기 및 선택된 빌드 기록이 들어 있고, 전체 앱 실행 payload나 모든 기능/UI 검증 자료가 별도 폴더로 포함된 것은 아니다.

| 자료 | 제품 ZIP 내부 | 원작업 위치 |
| --- | --- | --- |
| 현재 설치기 재현성 | `build-evidence/reproducible-builds-v2.json` | `verification/reproducible-builds-v2.json` |
| 현재 빌드 기록 | `build-evidence/build-evidence.json` | `builds/smoke-build6/build-evidence.json` |
| 해당 런타임 입력 목록 | `build-evidence/runtime-base.lock.json` | `builds/smoke-build6/runtime-base.lock.json` |
| 기본 재빌드 런타임 목록 | `packaging/runtime-base.lock.json` | 동일 상대경로 |
| 도구/오류 코드 안내 | `packaging/toolchain-lock.json`, `packaging/INSTALLER_EXIT_CODES.md` | 동일 상대경로 |

개별 기능·외부 CAD·UI·설치 경계·종합검토 기록은 별도 검증자료 패키지의 목록을 확인한다. 원작업 경로를 제품 ZIP 안의 존재하는 경로로 혼동하지 않는다.

## 입력과 도구

- Windows x64, Python3.13.15, Node24.22.1이 실제 재현 시험의 사전 조건이다. Node/Python은 이 패키지에서 재배포하지 않는다. 실제 도구의 `--version`을 확인했으며 과거 REA 설치 요청의 Node22.23.4와 구분한다. 실제 Node 해시 및 파일 크기는 `packaging/toolchain-lock.json`에 있다.
- `packaging/build-tools-offline.zip`은 로컬에 이미 존재하는 @electron/asar4.2.0과 정확한 설치 의존성 폐쇄, NSIS3.0.4.1 Windows 도구/라이선스만 담는다. 패키지별 버전·전체 파일 크기·SHA256이 `packaging/toolchain-lock.json`과 도구 ZIP 내부 TOOLCHAIN-MANIFEST.json에 있다. 이 도구로 빌드할 때 네트워크 다운로드나 npm 설치 스크립트를 실행하지 않는다.
- 런타임 입력을 중복 대형 ZIP으로 만들지 않는다. 검증된 설치의 `app` 폴더 또는 원작업의 `builds/smoke-build6/payload` 폴더가 재빌드 런타임 입력이다. 제품 ZIP에는 압축 해제된 payload 폴더를 별도로 넣지 않는다. 제품 ZIP의 `build-evidence/runtime-base.lock.json`으로 해당 입력의 런타임 파일을 확인한다. 앱 ASAR와 생성 release-manifest.json은 런타임 입력 비교에서 제외하고 새 소스로 재생성한다.
- 최초 빌드는 보존된 candidate.6 런타임을 기본 입력으로 사용한다. 다른 PC/경로에서는 아래 명시 옵션을 사용하며 원래 candidate 절대경로가 필요하지 않다. 파일/도구 해시는 무결성 증거이며 신뢰할 수 있는 배포 서명 대신으로 취급하지 않는다.

## 다른 폴더에서 같은 입력으로 빌드

소스·scripts·packaging 디렉터리 구조를 유지하고, `packaging/build-tools-offline.zip`을 별도 `tools` 폴더에 푼다. 제품 ZIP의 `build-evidence/runtime-base.lock.json`과 검증된 설치 `app` 폴더를 준비한다. 출력은 항상 소스 루트의 `builds/<새이름>`에 생성되며 기존 출력은 덮어쓰지 않는다.

```text
python scripts/build-release.py --edition reproduce-1 --runtime-base "C:/verified-install/app" --runtime-lock "build-evidence/runtime-base.lock.json" --node "C:/verified-node/node.exe" --asar "C:/tools/asar/node_modules/@electron/asar/bin/asar.mjs" --makensis "C:/tools/nsis/makensis.exe"
```

다른 edition 이름으로 두 번째 빌드를 하고 `build-evidence.json`의 installer/exe/asar SHA256과 전체 payload 파일 목록을 대조한다. 검증 범위는 같은 Windows·동일 도구·동일 소스/런타임 입력의 재현성이다. 다른 OS/API 구현에서도 동일 바이트라는 보장은 별도 시험 없이 하지 않는다. 각각의 evidence는 실제 사용한 packaging 소스와 생성 NSI/include 해시를 담으며, 빌드 도중 소스나 packaging이 바뀌면 실패한다.

## 설치 정책

- 제품ID: `com.daedongcad.desktop.release`. 기본 설치: `%LOCALAPPDATA%/Programs/DaedongCAD-Release`; 실행 파일: `app/DaedongCAD.exe`. 기존 `%LOCALAPPDATA%/Programs/daedong-cad` 및 그 제거정보와 분리된다. 기본 사용자 프로필도 `DaedongCAD-Release`로 분리된다. 테스트에서는 항상 `DCAD_TEST_PROFILE`을 명시한다.
- 현재 사용자 권한만 사용하며 관리자 승격, 재부팅, 앱 자동실행, 강제 프로세스 종료, 파일 연결, 기존 시작 메뉴/바탕화면 바로가기 변경을 하지 않는다. 바로가기를 만들지 않으므로 설치 후 위 실행 경로를 사용한다.
- 일반 설치는 별도 제품ID의 HKCU 제거 항목만 등록한다. `/TESTMODE`는 같은 설치기에서 레지스트리/바로가기 작성을 생략하고 marker에 시험 모드를 기록한다. 제거기도 기록된 모드를 따른다. `/D=절대경로`는 NSIS 명령행의 마지막에 둔다. 다른 모드로 기존 설치를 변경하거나 더 오래된 버전으로 덮어쓰는 것은 거부한다.
- 설치 표식 `.daedongcad-install`은 BOM 없는 UTF-16LE의 제품 magic/정규 설치경로/시험모드/버전 4줄이다. 잘린 표식, 연결 경로, 소유 확인이 안 되는 비어있지 않은 폴더를 거부한다. 알려진 제품 파일과 메타데이터의 변경 가능성을 사전 확인하며 사용 중인 파일은 직접 종료/잠금 해제 후 다시 시도해야 한다.
- 새 앱·제거기·표식을 준비한 뒤 기존 세 항목을 `.previous`로 보존하여 교체한다. 교체 중 실패하면 이동 플래그에 따라 기존 세 항목의 복원을 시도한다. 준비/보존 파일이 남으면 재설치가 이를 덮어쓰지 않고 중단한다. 이전 앱 정리는 고정 제품 파일 목록만 삭제하고 사용자 추가 파일은 남긴다.
- 제거는 고정 제품 파일 목록과 소유 메타데이터만 대상으로 하며 재귀 폴더 삭제를 사용하지 않는다. 실제 사용자 도면·사용자 프로필과 알 수 없는 추가 파일은 보존한다. 삭제 실패는 성공으로 표시하지 않는다. 모든 사전 확인 이후 외부 프로그램이 동시에 파일/권한/링크를 바꾸는 비협력 경쟁을 전부 막는 보장은 없다.

## 실패 시 복원 안내

설치 실패 메시지에 따라 `app.new`, `app.previous`, `.uninstall.new.exe`, `.uninstall.previous.exe`, `.marker.new`, `.marker.previous`를 삭제하지 말고 보관한다. 기존 앱/제거기/marker 자동 복원이 실패했다면 알려진 설치 루트와 소유 marker·백업 해시를 확인한 뒤 새 작업 사본에서 세 항목을 함께 복원한다. 일부 파일만 임의로 섞지 않는다. 시스템 디스크 포화·전원 중단 후 어떤 상태에서도 완전 자동 복원을 보장하는 설치기는 아니다. 정상 실검증과 오류 주입·미시험 항목은 최종 검증 보고서에서 구분한다.

배포 인증서가 없으므로 정식 버전 포장과 코드서명은 별개다. 현재 설치기와 실행 파일은 미서명이다. 보안 경고·승인 정책을 해제하거나 우회하지 않는다. 실제 서명/타기기/타 파일시스템 검증을 했다고 표시하지 않는다.

## 실제 재현 기록과 이전 시도

현재 설치기 근거는 제품 ZIP의 `build-evidence/reproducible-builds-v2.json`이며 원작업 위치는 `verification/reproducible-builds-v2.json`이다. `smoke-build6`와 `smoke-build7-reproduced`는 동일 소스·패키징 빌드 입력 및 서로 다른 런타임 입력 경로/도구 추출 경로로 생성했으며 payload20개, ASAR, EXE, 설치기 바이트가 모두 일치했다. 설치기145,229,852바이트의 SHA256은 `2c441f64bc547e4c925140e85ef2218a8ca041a69e4ae3805467feab72855f9f`이다. 이 기록은 빌드 재현성 증거이며 제품 동작·설치 경계 시험 판정과 구분한다. 재설치의 실제 확인은 같은 1.4.1 → 1.4.1이며 다른 이전 판본의 payload 업그레이드를 검증했다고 확대하지 않는다.

이전 `smoke-build1~5` 및 원작업의 `verification/reproducible-builds.json`은 이력이다. build4/5는 바이트 재현성만 통과했으나 실제 첫 설치 preflight에서 거부됐다. build6에서는 경로 오류값을 동일 Win32 호출 직후 수집하도록 수정하고 실패 지점을 고유 exit code로 구분했다. 대상 폴더에 진단 로그를 쓰지 않는다. 오류 코드 표는 제품 ZIP의 `packaging/INSTALLER_EXIT_CODES.md`이며, 수정 전 실패 증거와 최신 실제 설치/제거 결과는 별도 검증자료 패키지에서 확인한다.
