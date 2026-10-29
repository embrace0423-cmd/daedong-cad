// 브라우저 종단 시험: 명령줄로 실제 사용자처럼 그리고, DXF·SVG·PNG를 저장한다.
// 사용: node test/e2e.js <출력 폴더>   (Playwright Chromium 필요)
'use strict';
const path = require('path');
const fs = require('fs');
let playwright;
try { playwright = require('playwright'); } catch (e) { playwright = require('/opt/node22/lib/node_modules/playwright'); }

const OUT = path.resolve(process.argv[2] || 'e2e-out');
fs.mkdirSync(OUT, { recursive: true });
const URL = 'file://' + path.resolve(__dirname, '..', 'index.html');

(async () => {
  const browser = await playwright.chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1500, height: 920 }, acceptDownloads: true });
  const errors = [];
  page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));
  page.on('console', (m) => { if (m.type() === 'error') errors.push('console: ' + m.text()); });
  await page.goto(URL); // 새 브라우저 문맥이라 자동 저장본이 없다 → 새 도면 대화상자가 열린다
  await page.waitForSelector('#dlg-new[open]');
  await page.click('#new-ok');

  const run = async (line) => {
    await page.fill('#cmd', line);
    await page.press('#cmd', 'Enter');
  };
  const runAll = async (lines) => { for (const l of lines) await run(l); };
  const clickWorld = async (x, y, opts) => {
    const s = await page.evaluate(([x, y]) => { const r = DCAD.App.R.toScreen({ x, y }); const b = document.getElementById('cv').getBoundingClientRect(); return { x: r.x + b.left, y: r.y + b.top }; }, [x, y]);
    await page.mouse.move(s.x, s.y);
    await page.mouse.click(s.x, s.y, opts);
  };
  const count = () => page.evaluate(() => DCAD.App.doc.ents.length);
  const history = () => page.evaluate(() => document.getElementById('history').innerText);
  const check = (cond, label) => { if (!cond) { errors.push('실패: ' + label); console.log('  ✗', label); } else console.log('  ✓', label); };

  const n0 = await count();
  check(n0 > 10, '도곽·표제란이 그려짐 (' + n0 + '개)');

  // 1) 벽: 5000×4000 닫힌 벽 → 바깥·안쪽 폴리선 2개
  await runAll(['벽', '0,0', '@5000,0', '@0,4000', '@-5000,0', 'C']);
  let ents = await page.evaluate(() => DCAD.App.doc.ents.slice(-2));
  check(ents.length === 2 && ents.every((e) => e.type === 'poly' && e.closed), '벽 명령: 닫힌 폴리선 2개');
  const areas = await page.evaluate(() => DCAD.App.doc.ents.slice(-2).map((e) => Math.abs(DCAD.Commands.polyAreaBulge(e.pts, true)) / 1e6));
  check(Math.abs(Math.max(...areas) - 5.2 * 4.2) < 1e-6 && Math.abs(Math.min(...areas) - 4.8 * 3.8) < 1e-6, '벽 바깥 21.84㎡ / 안쪽 18.24㎡ (' + areas.map((a) => a.toFixed(2)).join(', ') + ')');

  // 2) 넓이 재기 (객체)
  await runAll(['AA', 'O']);
  await clickWorld(-100, 2000);
  let h = await history();
  check(/넓이 21\.84 m²/.test(h) && /6\.61평/.test(h), '넓이: 21.84 m², 6.61평');

  // 3) 문 기호 넣기
  await page.evaluate(() => DCAD.App.Engine.start('INSERT', { name: 'DOOR_900' }));
  await run('1000,100');
  ents = await page.evaluate(() => DCAD.App.doc.ents.slice(-1)[0]);
  check(ents.type === 'insert' && ents.name === 'DOOR_900', '문 기호(블록) 넣기');

  // 4) 사각형 + 선형 치수
  await runAll(['REC', '500,500', '@2000,1500']);
  await runAll(['DLI', '500,500', '2500,500', '1500,-200']);
  ents = await page.evaluate(() => { const e = DCAD.App.doc.ents.slice(-1)[0]; return { e, v: DCAD.Model.dimGeom(e, DCAD.App.doc).value }; });
  check(ents.e.type === 'dim' && Math.abs(ents.v - 2000) < 1e-9 && ents.e.ang === 0, '선형 치수 2000 (가로)');
  await runAll(['DLI', '2500,500', '2500,2000', '3000,1200']);
  ents = await page.evaluate(() => { const e = DCAD.App.doc.ents.slice(-1)[0]; return { ang: e.ang, v: DCAD.Model.dimGeom(e, DCAD.App.doc).value }; });
  check(Math.abs(ents.v - 1500) < 1e-9 && Math.abs(ents.ang - Math.PI / 2) < 1e-9, '선형 치수 1500 (세로)');

  // 5) 원 + 지름 치수
  await runAll(['C', '4000,3000', '300']);
  await run('DDI');
  await clickWorld(4300, 3000);
  await clickWorld(4600, 3400);
  ents = await page.evaluate(() => { const e = DCAD.App.doc.ents.slice(-1)[0]; return DCAD.Model.dimGeom(e, DCAD.App.doc).text.s; });
  check(ents === 'Ø600', '지름 치수 Ø600');

  // 6) 문자
  await runAll(['T', '1000,2600', '200', '0', '거실 리모델링', '']);
  ents = await page.evaluate(() => DCAD.App.doc.ents.slice(-1)[0]);
  check(ents.type === 'text' && ents.s === '거실 리모델링' && ents.h === 200, '한글 문자 입력');

  // 7) 선 그리고 자르기: 가로선 2개 + 세로선 → 세로선 가운데 토막 지우기
  // (도곽 안쪽 테두리 y=500과 겹치지 않는 곳에서)
  await runAll(['L', '6000,3000', '@3000,0', '']);
  await runAll(['L', '6000,4000', '@3000,0', '']);
  await runAll(['L', '7500,2500', '@0,2000', '']);
  const before = await count();
  await run('TR');
  await clickWorld(7500, 3500);
  await run('');
  const after = await count();
  ents = await page.evaluate(() => DCAD.App.doc.ents.slice(-2).map((e) => [e.a.y, e.b.y]));
  check(after === before + 1 && JSON.stringify(ents) === JSON.stringify([[2500, 3000], [4000, 4500]]), '자르기: 가운데 토막 지움 → ' + JSON.stringify(ents));

  // 8) 간격띄우기
  await runAll(['O', '250']);
  await clickWorld(6500, 3000);
  await clickWorld(6500, 2800);
  await run('');
  ents = await page.evaluate(() => DCAD.App.doc.ents.slice(-1)[0]);
  check(ents.type === 'line' && Math.abs(ents.a.y - 2750) < 1e-9, '간격띄우기 250 아래로');

  // 9) 모깎기 반지름 300: 두 선의 모서리
  await runAll(['L', '10000,0', '@2000,0', '']);
  await runAll(['L', '10000,0', '@0,2000', '']);
  await runAll(['F', 'R', '300']);
  await clickWorld(11000, 0);
  await clickWorld(10000, 1000);
  ents = await page.evaluate(() => DCAD.App.doc.ents.slice(-3).map((e) => e.type === 'arc' ? ['arc', e.r, e.c.x, e.c.y] : ['line', e.a.x, e.a.y, e.b.x, e.b.y]));
  const arc = ents.find((x) => x[0] === 'arc');
  check(arc && Math.abs(arc[1] - 300) < 1e-9 && Math.abs(arc[2] - 10300) < 1e-6 && Math.abs(arc[3] - 300) < 1e-6, '모깎기 R300, 중심 (10300,300)');

  // 10) 이동·회전·대칭·배열
  await runAll(['C', '15000,0', '100']);
  const cid = await page.evaluate(() => DCAD.App.doc.ents.slice(-1)[0].id);
  await page.evaluate((id) => { DCAD.App.sel.clear(); DCAD.App.sel.add(id); }, cid);
  await runAll(['M', '15000,0', '@1000,500']);
  let c = await page.evaluate((id) => DCAD.App.doc.ents.find((e) => e.id === id).c, cid);
  check(c.x === 16000 && c.y === 500, '이동 @1000,500');
  await page.evaluate((id) => { DCAD.App.sel.clear(); DCAD.App.sel.add(id); }, cid);
  await runAll(['ARP', '16000,0', '6', '360']);
  const nPolar = await page.evaluate(() => DCAD.App.doc.ents.filter((e) => e.type === 'circle' && Math.abs(e.r - 100) < 1e-9).length);
  check(nPolar === 6, '원형 배열 6개');

  // 11) 되돌리기
  const nb = await count();
  await page.keyboard.press('Control+z');
  check((await count()) === nb - 5, '되돌리기 (원형 배열 취소)');
  await page.keyboard.press('Control+y');
  check((await count()) === nb, '다시 하기');

  // 12) 창 선택(드래그) → 지우기
  await page.evaluate(() => DCAD.App.zoomExtents());
  await page.waitForTimeout(50);

  // 화면 캡처
  await page.evaluate(() => DCAD.App.zoomExtents());
  await page.waitForTimeout(100);
  await page.screenshot({ path: path.join(OUT, 'ui-remodel.png') });

  // 13) DXF 저장 (다운로드)
  const [dl] = await Promise.all([page.waitForEvent('download'), page.click('[data-act=save]')]);
  const dxfPath = path.join(OUT, 'e2e-remodel.dxf');
  await dl.saveAs(dxfPath);
  check(fs.statSync(dxfPath).size > 1000, 'DXF 저장 (' + fs.statSync(dxfPath).size + ' bytes)');
  const [dl2] = await Promise.all([page.waitForEvent('download'), page.click('[data-act=svg]')]);
  await dl2.saveAs(path.join(OUT, 'e2e-remodel.svg'));
  const [dl3] = await Promise.all([page.waitForEvent('download'), page.click('[data-act=png]')]);
  await dl3.saveAs(path.join(OUT, 'e2e-remodel.png'));
  const [dl4] = await Promise.all([page.waitForEvent('download'), page.click('[data-act=savework]')]);
  await dl4.saveAs(path.join(OUT, 'e2e-remodel.dcad.json'));

  // 14) 다시 열기: 저장한 DXF를 열어 개체 수 비교
  const dxfText = fs.readFileSync(dxfPath);
  const reread = await page.evaluate((arr) => { const r = DCAD.DXF.read(new Uint8Array(arr)); return { n: r.doc.ents.length, layers: r.doc.layers.map((l) => l.name), skipped: r.report.skipped }; }, Array.from(dxfText));
  check(reread.layers.includes('벽체') && reread.layers.includes('치수'), '저장한 DXF 다시 읽기: 한글 도면층 유지');
  check(Object.keys(reread.skipped).length === 0, '다시 읽을 때 건너뛴 개체 없음');

  // 15) 각 양식으로 새 도면 + 기호 전부 넣기
  for (const id of ['furniture', 'landscape', 'vehicle', 'machine', 'food']) {
    await page.evaluate((id) => {
      const d = DCAD.Library.newFromTemplate(id, { date: '2026-10-29' });
      DCAD.App.Engine.cancel(true);
      DCAD.App.doc = d;
      DCAD.Model.touch();
    }, id);
    const ok = await page.evaluate(() => {
      let x = 0;
      const k = DCAD.App.doc.settings.scale;
      DCAD.Library.SYMBOLS.forEach((s) => {
        DCAD.Library.ensureBlock(DCAD.App.doc, s.name);
        const e = DCAD.Model.mk(DCAD.App.doc, 'insert', { name: s.name, p: { x: 30 * k + x, y: 150 * k }, sx: s.annot ? k : 1, sy: s.annot ? k : 1, rot: 0 });
        e.layer = DCAD.App.doc.currentLayer;
        DCAD.App.doc.ents.push(e);
        x += 2500;
      });
      DCAD.Model.touch();
      return DCAD.App.doc.ents.length;
    });
    const [d5] = await Promise.all([page.waitForEvent('download'), page.click('[data-act=save]')]);
    await d5.saveAs(path.join(OUT, 'template-' + id + '.dxf'));
    check(ok > 40, '양식 ' + id + ': 도곽 + 기호 ' + (await page.evaluate(() => DCAD.Library.SYMBOLS.length)) + '종');
  }

  // 16) 받은 DXF 열기 (ezdxf가 만든 R2018)
  const fx = path.resolve(__dirname, 'fixtures', 'rich-r2018-utf8.dxf');
  await page.setInputFiles('#file', fx);
  await page.waitForTimeout(300);
  h = await history();
  check(/열었습니다: rich-r2018-utf8\.dxf/.test(h) && /HATCH 1개/.test(h), '받은 DXF 열기 + 해치 건너뜀 알림');
  await page.screenshot({ path: path.join(OUT, 'ui-open-fixture.png') });

  // 17) 밝은 화면 + 도움말 + 새 도면 대화상자 캡처
  await page.click('[data-act=theme]');
  await page.click('[data-act=help]');
  await page.waitForTimeout(100);
  await page.screenshot({ path: path.join(OUT, 'ui-help-light.png') });
  await page.click('#dlg-help [data-close]');
  await page.click('[data-act=new]');
  await page.screenshot({ path: path.join(OUT, 'ui-new-dialog.png') });

  console.log(errors.length ? '\n오류 ' + errors.length + '개:\n' + errors.join('\n') : '\n모두 통과');
  await browser.close();
  process.exit(errors.length ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(2); });
