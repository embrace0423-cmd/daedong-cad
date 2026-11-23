'use strict';
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const root = path.join(__dirname, '..', 'src');
for (const name of ['main.js', 'preload.js', 'atomic-store.cjs', 'app/safety.js']) {
  new vm.Script(fs.readFileSync(path.join(root, name), 'utf8'), {filename: name});
}
const html = fs.readFileSync(path.join(root, 'app/daedong-cad.html'), 'utf8');
let total = 0;
for (const match of html.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script\s*>/gi)) {
  if (/\bsrc\s*=/.test(match[1]) || /\btype\s*=\s*["']application\//i.test(match[1])) continue;
  new vm.Script(match[2], {filename: `inline-script-${++total}.js`});
}
if (!total) throw new Error('No inline application scripts found');
console.log(`Syntax verified: 4 JavaScript files and ${total} inline scripts.`);
