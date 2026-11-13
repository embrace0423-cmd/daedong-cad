# 대동 CAD 1.4.1 이관 안내

작성일: 2026-11-11. Windows x64용 제품과 선택된 검증 자료의 사용 안내다. **최종 판정·접수증·최종 백업 근거는 동봉 `REVIEW-RESULT.md`에서 확인한다.** 이 안내 자체를 종합검토 통과 증명으로 사용하지 않는다. 같은 제품·설치기 해시의 실제 판정이 ‘통과’이고 백업 검증이 확인된 판본만 최종 전달한다. 결과 파일이 없거나 조건부 통과·보류·미실행이면 최종완료로 해석하지 않는다.

## 판본과 파일

| 구분 | 파일·식별값 |
| --- | --- |
| 제품 | `DaedongCAD-1.4.1-product-v2.zip`, **148,913,742바이트**, **69항목** |
| 제품 ZIP SHA256 | `5bcbfd3edb5eff495843f58ddf950a0a1696f301118983d5cc3fbdbc411b7f1e` |
| 설치기 | `DaedongCAD-Setup-1.4.1.exe`, **145,229,852바이트** |
| 설치기 SHA256 | `2c441f64bc547e4c925140e85ef2218a8ca041a69e4ae3805467feab72855f9f` |
| 검증 자료 | `DaedongCAD-1.4.1-evidence-v2.zip` — 최종 크기·SHA256은 동봉 `CHECKSUMS.sha256` 및 목록 확인 |
| 판정·백업 | `REVIEW-RESULT.md`가 가리키는 동일 판본 접수증·검토보고서·백업 검증 근거 |

제품 ZIP의 전체 CRC와 목록 68개 파일의 크기·SHA256을 확인했다. 목록 자체를 포함해 69항목이며 비압축 합계는 149,471,189바이트다. 여기에는 압축된 설치기가 포함되므로 설치 후 앱 크기나 필요한 총 여유 공간과 같지 않다. ZIP 내부 `PRODUCT-MANIFEST.json`이 구성 목록이다.

제품 ZIP에는 설치기·소스·재현 빌드 도구·선택된 빌드 기록이 있다. 검증자료 ZIP은 원작업 기준 상대경로를 유지한다. 원래 사용자 프로필·인증자료·실제 사용자 도면·QCAD 실행 파일·중복 시험 런타임·시험 정션은 이관 범위에 넣지 않는다. 기존 1.4.0 설치와 사용자 자료는 보존했으며 이전 후보의 통과 판정을 새 제품에 승계하지 않는다.

## 30MB 이하 전달 파일 복원

전달 파일은 각각 **30,000,000바이트 미만**인 목록으로 제공한다. 데이터 raw 조각은 29,000,000바이트이고 ZIP 포장까지 포함한 일반 조각은 29,000,126바이트다. 마지막 조각 크기와 최종 파일 수는 해당 `transfer-manifest.json`·`CHECKSUMS.sha256`을 따른다. 과거 10파일 preview는 이전 제품의 시험 기록이므로 최종 전달 목록으로 사용하지 않는다.

148,913,742바이트 제품 ZIP과 145,229,852바이트 설치기는 복원·압축 해제 결과물이다. 이 큰 파일들을 단일 전달 첨부로 사용하면 파일당 30MB 조건을 만족하지 않는다.

1. 전달 파일들을 같은 폴더에 둔다. `00-handoff.zip`만 풀어 `handoff` 폴더를 만든다. `01-data.zip` 이후 데이터 ZIP은 풀지 않는다.
2. Python **3.9 이상**의 표준 라이브러리로 아래 명령을 실행한다. Windows에서는 `python` 대신 `py -3`도 가능하다. 출력 상위 폴더는 미리 있어야 한다.

```text
python handoff/restore_backup.py --parts-dir . --verify-only
python handoff/restore_backup.py --parts-dir . --output "C:/복원/DaedongCAD-restored.zip"
```

Windows가 `00-handoff/handoff` 폴더를 만들었다면 스크립트 경로를 그에 맞춘다. `--parts-dir`은 데이터 ZIP 폴더다. 이번 조각의 복원 대상은 위 제품 ZIP 자체이며 manifest의 `original` 이름·크기·해시가 위 표와 같아야 한다. 복원 명령에 `--expect-sha256 5bcbfd3edb5eff495843f58ddf950a0a1696f301118983d5cc3fbdbc411b7f1e`를 추가해 대조할 수 있다. 별도 검증자료 ZIP은 조합할 필요 없이 직접 열며, 제품 ZIP과 함께 보관한다.

검증도 합본 크기의 임시 공간을 사용하며 압축 해제·설치 공간은 별도다. 기존 출력은 덮어쓰지 않는다. 복원 게시에는 NTFS 등 하드링크를 지원하는 파일시스템이 필요하다. 조각 누락·동일 크기 손상·순서·경로 오류를 거부하고 합본 SHA256과 원본 ZIP 전체 CRC를 검사한다. 실패 시 원본에서 올바른 조각을 다시 받는다. 강제 종료 후 남은 `.daedong-restore-*.partial`은 정상 백업으로 취급하지 않는다. 체크섬은 전자서명·발신자 인증이 아니다.

복원 도구는 앱 설치·실행을 하지 않는다. 이 안내 작성 시 외부 전송과 수신 PC 설치는 수행하지 않았다.

## 설치·시작·제거

최종 판정과 설치기 해시를 확인한 뒤 승인된 대상에서 설치기를 실행한다. 현재 사용자 권한으로 별도 설치하며 기본 실행 경로는 `%LOCALAPPDATA%/Programs/DaedongCAD-Release/app/DaedongCAD.exe`, 프로필은 `%APPDATA%/DaedongCAD-Release`다. 바로가기·파일 연결·앱 자동 실행·재부팅을 수행하지 않는다. 설치 후 위 EXE를 직접 실행한다. 앱 실행에 별도 Node/Python 설치는 필요 없다.

기존 `%LOCALAPPDATA%/Programs/daedong-cad` 1.4.0을 덮어쓰거나 기존 설정·최근 파일·복구 자료를 자동 이전하지 않는다. 실제 도면은 원본을 보관한 뒤 사본을 열어 확인한다. **재설치의 실제 검증은 동일 1.4.1 → 1.4.1에 한정**되며 다른 이전 제품 버전의 업그레이드 검증을 뜻하지 않는다.

제거는 Windows 설치된 앱의 **대동 CAD (정식)** 또는 설치 폴더의 `Uninstall DaedongCAD.exe`를 사용한다. 작업을 저장하고 해당 앱을 정상 종료한다. 제거는 소유 제품 파일·메타데이터에 한정하며 사용자 프로필·도면·알 수 없는 추가 파일은 보존한다.

설치 실패 후 `app.new`, `app.previous`, `.uninstall.new.exe`, `.uninstall.previous.exe`, `.marker.new`, `.marker.previous`가 남으면 임의 삭제하지 않는다. 해당 앱을 강제 종료하거나 파일 일부를 섞어 복원하지 않는다. 제품 ZIP의 `docs/USER-GUIDE.ko.md`와 `packaging/BUILD.md`에 있는 보존·복원 절차를 따른다. 설치기·EXE는 미서명이므로 보안 경고·필수 승인·조직 정책을 우회하지 않는다.

## 실제 확인한 검증 범위

- 합성·모의 회귀 **84/84**, 추가 파일·용량·DXF **11/11**, 직접 생성한 계측 Node 자식의 저장 단계별 종료 **4/4**가 통과했다.
- 설치 관련 **37건**은 기존 36건(TESTMODE 33 + 승인된 일반모드 3)과 실제 실행 중인 설치 앱의 재설치 거부 1건이다. 후자는 exit17, 기존 25항목 불변, 같은 앱 PID·시작 시각·경로·실행 상태 유지를 확인했다. 이전 실패 기록은 보존했다.
- 실제 UI에서 Windows 파일 잠금 중 저장 실패·미저장 표시·원본/백업 보존, 잠금 해제 후 저장, 직접 생성한 시험 앱 종료 후 복구 저장을 확인했다. 기존 4객체에 선 2개가 추가된 **6객체 전체 필드**를 대조했다.
- 초기 payload 앱과 실제 설치 경로 앱의 EXE·ASAR 해시는 같았다. 실제 설치 경로에서 기동·편집·저장·재열기를 확인했고 저장한 **5객체 파일의 바이트·나머지 필드**가 보존됐다. 복구 앱과 두 설치 앱 인스턴스는 저장 후 정상 종료했고 기록한 main 프로세스 3개 모두 종료코드0이었다.
- UI는 접근성·지원 입력·사용자 보조·파일 대조로 검증했다. native 복구 저장은 대표님이 수행했으며 요청한 시험 출력 경로가 아닌 문서 폴더의 `합성 시험 전용.dcad.json`에 저장됐다. 실제 경로를 확인해 원본을 보존하고 시험 사본을 만들었다. 재열기도 도구의 foreground PID 오류 후 대표님이 창을 앞으로 가져와 주었다. 중간 대화상자의 정확한 선택은 관찰하지 않아 자동 전 과정 성공으로 기록하지 않는다. 초기 시험이 새 release 프로필을 만든 이력과 격리 폴더 이동도 기록했으며 이후 명시적 시험 프로필을 사용했다.
- QCAD **3.33.1 Qt5 CLI**로 대표 합성 **4조합**을 실제 교환해 기하·층/블록·단위·손실 규칙을 수치로 확인했다. 한 외부 CAD 버전의 결과이며 모든 CAD나 시각 렌더링 호환성을 보장하지 않는다.

자세한 UI 근거는 검증자료 ZIP의 `verification/UI_VALIDATION.ko.md`, `verification/ui-recovery-result.json`, `verification/installed-gui/reopen-file-result.json`, `verification/installed-gui/process-exit-check.json`에 있다. 실행 중 설치 거부는 `verification/live-app-installer-refusal/result.json`, 외부 CAD는 `verification/external-cad-20261111/REPORT.ko.md`를 따른다.

## 저장·단위·한계

작업 파일 전체 한도는 이미지 포함 **64MiB(67,108,864바이트)**다. 실제 한도 파일의 읽기·원자 저장·이전본 보존과 67,108,865바이트 거부를 확인했다. 자동복구 localStorage 용량은 별개이며 실제 최대치를 측정한 것으로 표시하지 않는다. 자동 보관 실패 시 정식 작업 파일을 저장한다. `.dcad-tmp-...`·`.dcad-backup-incomplete-...`를 완료된 백업으로 사용하지 않는다.

내부 길이는 mm, 인치 입력은 확인 후 **25.4배** 변환한다. R12 출력의 단위는 수신 CAD에서도 확인한다. 이미지 제외, 치수·여러 줄 문자·해치 변환, 타원 근사 손실이 있으므로 편집 가능한 `.dcad.json`을 함께 보존한다. DXF 내보내기만으로 작업 저장이 완료되지는 않는다.

실제 PC 정전·시스템 디스크 포화·다른 PC/파일시스템·다른 제품 버전 업데이트·모든 CAD 호환성은 미검증이다. 최종 파일 지문 검사 이후 외부 비협력 쓰기 경쟁을 전부 차단하지 않는다. 서로 다른 이미지의 동일 참조는 자동 병합하지 않고 거부할 수 있다.

자동 캡처는 대표님 지시로 **이 데스크톱에서 미해결·해결 불가 처리하고 추가 수리·반복을 종료**했다. 성공이나 영구적 기술 불가능의 입증을 뜻하지 않는다. 지정 AI 관제의 상태 등록 완료는 부모가 확인했다. 제품 ZIP의 `docs/CAPTURE-DISPOSITION.md`를 유지하며 캡처·캔버스 시각 판독 성공을 주장하거나 수리를 재개하지 않는다.

## 재현 빌드와 판정 보관

제품 ZIP의 `packaging/BUILD.md`를 따라 소스·scripts·packaging 구조, 검증된 설치 `app` 런타임, `build-evidence/runtime-base.lock.json`을 사용한다. 실제 재현 도구는 Windows x64의 Node24.22.1, Python3.13.15, @electron/asar4.2.0, NSIS3.0.4.1이다. Node/Python은 재배포하지 않는다. `packaging/build-tools-offline.zip`에는 고정 빌드 도구와 라이선스가 있으며 네트워크 다운로드·npm 설치 스크립트 없이 새 출력 폴더로 빌드한다.

현재 근거는 제품 ZIP의 `build-evidence/reproducible-builds-v2.json`이다. 원작업의 경로는 `verification/reproducible-builds-v2.json`이며 `smoke-build6`와 `smoke-build7-reproduced`의 payload20개·ASAR·EXE·설치기 바이트가 일치했다. 이전 `reproducible-builds.json`은 과거 기록이다. 제품 ZIP의 경로와 검증자료 ZIP의 원작업 상대경로를 구분한다.

동일 판본의 후속 판정·접수증·백업 명세는 `REVIEW-RESULT.md`에 연결해 보관한다. 이 결과 증거만 재귀적으로 새 검토에 접수하지 않는다. 제품 내용이 변경되면 새 판본으로 실제 검토·복원 검증을 수행하며 이전 통과를 승계하지 않는다.
