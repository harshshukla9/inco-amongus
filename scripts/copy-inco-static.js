#!/usr/bin/env node
const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const src = path.join(root, 'static', 'inco.bundle.js');
const map = `${src}.map`;
const distDir = path.join(root, 'dist', 'static');

fs.mkdirSync(distDir, { recursive: true });
fs.copyFileSync(src, path.join(distDir, 'inco.bundle.js'));
if (fs.existsSync(map)) {
  fs.copyFileSync(map, path.join(distDir, 'inco.bundle.js.map'));
}
console.log('[inco] copied bundle into dist/static/');
