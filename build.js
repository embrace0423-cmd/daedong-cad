// 한 파일 만들기: node build.js → dist/daedong-cad.html (CSS·JS를 모두 안에 넣음, 인터넷 없이 열림)
'use strict';
const fs = require('fs');
const path = require('path');
const root = __dirname;
let html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
html = html.replace(/<link rel="stylesheet" href="([^"]+)">/g, (m, href) => '<style>\n' + fs.readFileSync(path.join(root, href), 'utf8') + '</style>');
html = html.replace(/<script src="([^"]+)"><\/script>/g, (m, src) => {
  const js = fs.readFileSync(path.join(root, src), 'utf8').replace(/<\/script/gi, '<\\/script');
  return '<script>\n// ---- ' + src + ' ----\n' + js + '</script>';
});
if (/src="js\/|href="css\//.test(html)) throw new Error('인라인되지 않은 파일이 남음');
fs.mkdirSync(path.join(root, 'dist'), { recursive: true });
const out = path.join(root, 'dist', 'daedong-cad.html');
fs.writeFileSync(out, html);
console.log('만듦:', path.relative(root, out), Math.round(html.length / 1024) + 'KB');
