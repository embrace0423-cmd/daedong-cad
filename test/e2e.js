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
  const browser = await playwright.chromium.launch({ env: { ...process.env, LANG: 'C.UTF-8', LC_ALL: 'C.UTF-8' } }); // 한글 파일 이름
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

  // 2-1) 해치: 벽 사이를 클릭 → 바깥·안쪽 두 경계, 무늬 바꾸기
  await run('H');
  await clickWorld(-50, 2000);
  await run('');
  let ht = await page.evaluate(() => DCAD.App.doc.ents.find((e) => e.type === 'hatch'));
  check(ht && ht.loops.length === 2 && ht.pat === 'LINE45' && ht.fams.length === 1, '해치: 벽 사이 클릭 → 경계 2개(바깥·안쪽), 사선');
  check(await page.evaluate(() => DCAD.App.doc.ents[0].type === 'hatch'), '해치는 다른 객체 뒤에 그려짐');
  await runAll(['H', 'P', '잔디', 'S', '2']);
  await clickWorld(2500, 2000);
  await run('');
  ht = await page.evaluate(() => DCAD.App.doc.ents.filter((e) => e.type === 'hatch').map((e) => [e.pat, e.loops.length, Math.round(e.scale)]));
  check(JSON.stringify(ht[0]) === JSON.stringify(['GRASS', 1, 100]), '해치: 방 안 클릭, 잔디 무늬·축척 2 (1:50 → 100) ' + JSON.stringify(ht[0]));

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

  // 12) 마우스로: 끝점 스냅, 창 선택, 그립, 호 폴리선, 바로 타이핑, 문자 두 번 클릭
  await page.evaluate(() => { DCAD.App.R.fit({ x0: 19000, y0: 4000, x1: 23000, y1: 7000 }); });
  await runAll(['L', '20000,5000', '@1000,0', '']);
  await run('L');
  await clickWorld(21004, 5003); // 끝점 근처를 클릭 → 정확히 (21000,5000)
  await clickWorld(21000, 6000);
  await run('');
  ents = await page.evaluate(() => DCAD.App.doc.ents.slice(-1)[0]);
  check(ents.a.x === 21000 && ents.a.y === 5000, '끝점 스냅으로 정확한 점 (' + ents.a.x + ',' + ents.a.y + ')');
  // 창 선택: 왼쪽 위 → 오른쪽 아래로 끌어 두 선을 고른다
  const sA = await page.evaluate(() => { const r = DCAD.App.R.toScreen({ x: 19800, y: 6300 }); const b = document.getElementById('cv').getBoundingClientRect(); return { x: r.x + b.left, y: r.y + b.top }; });
  const sB = await page.evaluate(() => { const r = DCAD.App.R.toScreen({ x: 21300, y: 4800 }); const b = document.getElementById('cv').getBoundingClientRect(); return { x: r.x + b.left, y: r.y + b.top }; });
  await page.mouse.move(sA.x, sA.y); await page.mouse.down(); await page.mouse.move(sB.x, sB.y, { steps: 5 }); await page.mouse.up();
  check((await page.evaluate(() => DCAD.App.sel.size)) === 2, '창 선택으로 2개');
  await runAll(['M', '20000,5000', '@0,-500']);
  ents = await page.evaluate(() => DCAD.App.doc.ents.slice(-2).map((e) => e.a.y));
  check(ents[0] === 4500 && ents[1] === 4500, '선택한 채로 이동 → 2개 모두 이동');
  // 그립: 선 하나를 고르고 끝점을 끌어 옮김
  const lid = await page.evaluate(() => DCAD.App.doc.ents.slice(-1)[0].id);
  await page.evaluate((id) => { DCAD.App.sel.clear(); DCAD.App.sel.add(id); }, lid);
  await page.evaluate(() => DCAD.App.zoomExtents && 0);
  await clickWorld(21000, 5500); // 위쪽 끝 그립
  await run('22000,5500'); // 새 위치는 좌표로
  ents = await page.evaluate((id) => DCAD.App.doc.ents.find((e) => e.id === id), lid);
  check(ents.b.x === 22000 && ents.b.y === 5500, '그립으로 끝점 옮기기 → (' + ents.b.x + ',' + ents.b.y + ')');
  await page.keyboard.press('Escape');
  // 호가 섞인 폴리선 (A 모드)
  await runAll(['PL', '19000,6000', '@500,0', 'A', '@0,500', 'L', '@-500,0', 'C']);
  ents = await page.evaluate(() => DCAD.App.doc.ents.slice(-1)[0]);
  check(ents.type === 'poly' && ents.closed && ents.pts.length === 4 && Math.abs(ents.pts[1].bulge - 1) < 1e-9, '폴리선 호 모드: 반원 볼록값 1');
  // 화면에서 바로 타이핑하면 명령줄로 들어감
  await page.focus('#cv');
  await page.keyboard.type('c');
  check((await page.inputValue('#cmd')) === 'c', '화면에서 타이핑 → 명령줄');
  await page.fill('#cmd', '');
  // 문자 두 번 클릭 → 고치기
  await runAll(['T', '19200,6800', '150', '0', '수정 전', '']);
  const s3 = await page.evaluate(() => { const r = DCAD.App.R.toScreen({ x: 19260, y: 6850 }); const b = document.getElementById('cv').getBoundingClientRect(); return { x: r.x + b.left, y: r.y + b.top }; });
  await page.mouse.dblclick(s3.x, s3.y);
  await run('수정 후');
  ents = await page.evaluate(() => DCAD.App.doc.ents.slice(-1)[0].s);
  check(ents === '수정 후', '문자 두 번 클릭해서 고치기');
  // 분해 → 결합
  const maxId = await page.evaluate(() => { const e = DCAD.App.doc.ents.filter((x) => x.type === 'poly' && x.closed && x.pts.length === 4 && x.pts[1].bulge).slice(-1)[0]; DCAD.App.sel.clear(); DCAD.App.sel.add(e.id); return DCAD.App.doc.nextId - 1; });
  await run('X');
  const parts = await page.evaluate((m) => DCAD.App.doc.ents.filter((e) => e.id > m).map((e) => e.type).join(','), maxId);
  check(parts === 'line,arc,line,line', '분해: 선·호·선·선 (' + parts + ')');
  await page.evaluate((m) => { DCAD.App.sel.clear(); DCAD.App.doc.ents.filter((e) => e.id > m).forEach((e) => DCAD.App.sel.add(e.id)); }, maxId);
  await run('J');
  ents = await page.evaluate(() => DCAD.App.doc.ents.slice(-1)[0]);
  check(ents.type === 'poly' && ents.closed && ents.pts.length === 4 && ents.pts.some((p) => Math.abs(Math.abs(p.bulge || 0) - 1) < 1e-9), '결합: 다시 닫힌 폴리선 하나');
  // 블록 만들기: 사각형 + 원 → 블록 하나
  await page.evaluate(() => DCAD.App.R.fit({ x0: 24000, y0: 4000, x1: 28000, y1: 7000 }));
  await runAll(['REC', '25000,5000', '@400,300', 'C', '25200,5150', '100']);
  await page.evaluate(() => { DCAD.App.sel.clear(); DCAD.App.doc.ents.slice(-2).forEach((e) => DCAD.App.sel.add(e.id)); });
  await runAll(['B', '25000,5000', '내 의자']);
  ents = await page.evaluate(() => ({ last: DCAD.App.doc.ents.slice(-1)[0], blk: DCAD.App.doc.blocks['내 의자'] }));
  check(ents.last.type === 'insert' && ents.last.name === '내 의자' && ents.blk && ents.blk.ents.length === 2, '블록 만들기: "내 의자" (객체 2개)');
  await page.click('[data-tab=lib]');
  check(await page.evaluate(() => [...document.querySelectorAll('#pane-lib .lib-cats button')].some((b) => b.textContent === '이 도면의 블록')), '기호 탭에 "이 도면의 블록" 표시');
  // 끊기: 선 가운데 200을 끊음
  await runAll(['L', '25000,6000', '@1000,0', '']);
  await run('BR');
  await clickWorld(25400, 6000);
  await runAll(['F', '25400,6000', '25600,6000']);
  ents = await page.evaluate(() => DCAD.App.doc.ents.slice(-2).map((e) => [e.a.x, e.b.x]));
  check(JSON.stringify(ents) === JSON.stringify([[25000, 25400], [25600, 26000]]), '끊기: 25400~25600 지움 ' + JSON.stringify(ents));
  // 호 연장: 0~90° 호를 세로선까지
  await runAll(['A', 'C', '27000,5000', '27300,5000', '27000,5300']);
  await runAll(['L', '26850,4500', '@0,1500', '']);
  await run('EX');
  await clickWorld(27000, 5300);
  await run('');
  ents = await page.evaluate(() => DCAD.App.doc.ents.filter((e) => e.type === 'arc' && Math.abs(e.r - 300) < 1e-9).slice(-1)[0]);
  check(Math.abs(ents.a1 * 180 / Math.PI - 120) < 1e-6, '호 연장: 끝각 90° → 120° (' + (ents.a1 * 180 / Math.PI).toFixed(3) + ')');
  // 늘리기: 오른쪽 벽을 1000 오른쪽으로 (벽·해치·치수가 함께)
  await page.evaluate(() => DCAD.App.zoomExtents());
  await runAll(['S', '4800,-300', '5300,4300', '5000,0', '@1000,0']);
  const wallAreas = await page.evaluate(() => DCAD.App.doc.ents.filter((e) => e.type === 'poly' && e.closed && e.layer === '벽체').map((e) => Math.abs(DCAD.Commands.polyAreaBulge(e.pts, true)) / 1e6).sort((a, b) => a - b));
  check(wallAreas.some((a) => Math.abs(a - 6.2 * 4.2) < 1e-6) && wallAreas.some((a) => Math.abs(a - 5.8 * 3.8) < 1e-6), '늘리기: 벽 6.2×4.2 / 5.8×3.8 ' + JSON.stringify(wallAreas.map((a) => +a.toFixed(2))));
  ht = await page.evaluate(() => { const h = DCAD.App.doc.ents.find((e) => e.type === 'hatch' && e.loops.length === 2); const b = DCAD.Model.bounds(h, DCAD.App.doc); return b.x1; });
  check(Math.abs(ht - 6100) < 1e-6, '늘리기: 벽 해치 경계도 함께 (오른쪽 끝 ' + ht + ')');

  // 1.2.0: 선으로만 그린 방 + 선 가구를 클릭 해치
  await page.evaluate(() => DCAD.App.R.fit({ x0: 29000, y0: 4000, x1: 36000, y1: 9000 }));
  await runAll(['L', '30000,5000', '@4000,0', '@0,3000', '@-4000,0', 'C']);
  await runAll(['L', '31000,6000', '@1000,0', '@0,1000', '@-1000,0', 'C']);
  await runAll(['H', 'P', '타일', 'S', '0.5']);
  await clickWorld(30500, 5500);
  await run('');
  ht = await page.evaluate(() => { const h = DCAD.App.doc.ents.find((e) => e.type === 'hatch' && e.pat === 'TILE'); let a = 0; DCAD.Hatch.trapezoids(h).forEach((q) => { a += Math.abs(DCAD.G.polyArea(q)); }); return { loops: h.loops.length, m2: a / 1e6 }; });
  check(ht.loops === 2 && Math.abs(ht.m2 - 11) < 1e-6, '선으로 그린 방 해치: 12㎡ − 가구 1㎡ = ' + ht.m2.toFixed(3) + '㎡ (경계 ' + ht.loops + '개)');
  // 치수 끝: 리모델링 양식은 사선
  check(await page.evaluate(() => { const d = DCAD.App.doc.ents.find((e) => e.type === 'dim' && e.kind === 'lin'); return DCAD.Model.dimGeom(d, DCAD.App.doc).arrows.length === 0; }), '리모델링 양식 치수 끝 = 사선(틱)');
  // 선 굵기 보기 끄고 켜기
  await page.click('[data-tog=lw]');
  const lwOff = await page.evaluate(() => DCAD.App.R.showLw);
  await page.click('[data-tog=lw]');
  check(lwOff === false && (await page.evaluate(() => DCAD.App.R.showLw)) === true, '선 굵기 보기 끄고 켜기');
  // 복사·붙여넣기
  await page.evaluate(() => { const c = DCAD.App.doc.ents.filter((e) => e.type === 'circle' && Math.abs(e.r - 300) < 1e-9)[0]; DCAD.App.sel.clear(); DCAD.App.sel.add(c.id); });
  await page.focus('#cv');
  await page.keyboard.press('Control+c');
  const nClip = await count();
  await page.keyboard.press('Control+v');
  await run('35000,6000');
  ents = await page.evaluate(() => DCAD.App.doc.ents.slice(-1)[0]);
  check((await count()) === nClip + 1 && ents.type === 'circle' && Math.abs(ents.c.x - 35300) < 1e-6 && Math.abs(ents.c.y - 6300) < 1e-6, 'Ctrl+C/V: 원 붙여넣기 (중심 ' + ents.c.x + ',' + ents.c.y + ')');
  // 물량 산출 → CSV
  await page.evaluate(() => DCAD.App.sel.clear());
  await run('물량');
  await page.waitForSelector('#dlg-qto[open]');
  const qtoText = await page.innerText('#qto-body');
  check(/여닫이문 900\s+DOOR_900\s+1/.test(qtoText) && /해치: 타일/.test(qtoText), '물량 산출: 문 1개, 해치 넓이 표시');
  const [dq] = await Promise.all([page.waitForEvent('download'), page.click('#qto-csv')]);
  const qPath = path.join(OUT, 'e2e-qto.csv');
  await dq.saveAs(qPath);
  const qcsv = fs.readFileSync(qPath, 'utf8');
  check(dq.suggestedFilename().endsWith('-물량.csv') && qcsv.charCodeAt(0) === 0xfeff && /여닫이문 900,DOOR_900,1,개/.test(qcsv), '물량 CSV (엑셀용 BOM, 한글)');
  await page.click('#dlg-qto [data-close]');

  // 인쇄 준비 (실제 인쇄창은 막음)
  await page.evaluate(() => { window.print = () => { window.__printed = true; }; });
  await page.click('[data-act=print]');
  await page.waitForTimeout(150);
  check(await page.evaluate(() => window.__printed === true && !!document.querySelector('#printarea svg')), '인쇄: 흑백 SVG 준비 후 인쇄 호출');

  // 화면 캡처
  await page.evaluate(() => DCAD.App.zoomExtents());
  await page.waitForTimeout(100);
  await page.screenshot({ path: path.join(OUT, 'ui-remodel.png') });

  // 13) DXF 저장 (다운로드)
  const [dl] = await Promise.all([page.waitForEvent('download'), page.click('[data-act=save]')]);
  const dxfPath = path.join(OUT, 'e2e-remodel.dxf');
  await dl.saveAs(dxfPath);
  check(fs.statSync(dxfPath).size > 1000, 'DXF 저장 (' + fs.statSync(dxfPath).size + ' bytes)');
  check(dl.suggestedFilename() === '리모델링 평면도.dxf', '저장 파일 이름 = 도면 이름 (' + dl.suggestedFilename() + ')');
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
  check(/열었습니다: rich-r2018-utf8\.dxf/.test(h) && !/읽지 못한 개체/.test(h.split('rich-r2018-utf8')[1] || ''), '받은 DXF 열기 (건너뛴 개체 없음)');
  check(await page.evaluate(() => DCAD.App.doc.ents.some((e) => e.type === 'hatch')), '받은 DXF의 해치도 읽음');
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
