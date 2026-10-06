const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');
const root = path.join(__dirname, '..');
const base = 'https://example.test/personal/wallet/';
const handlers = {};
const ctx = { URL, Request, self: { location: { href: base + 'sw.js' }, addEventListener: (name, fn) => handlers[name] = fn } };
vm.createContext(ctx); vm.runInContext(fs.readFileSync(path.join(root, 'sw.js'), 'utf8'), ctx);
const shell = Array.from(vm.runInContext('SHELL', ctx));
test('offline shell contains every script/style/icon and stays inside its deployment subpath', () => {
  for (const url of shell) {
    assert.ok(url.startsWith(base));
    const rel = url.slice(base.length) || 'index.html';
    assert.ok(fs.statSync(path.join(root, rel)).isFile(), 'Missing cache asset: ' + rel);
  }
  const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
  for (const match of html.matchAll(/(?:src|href)="(\.\/[^"#]+)"/g)) assert.ok(shell.includes(new URL(match[1], base).href), 'Uncached asset: ' + match[1]);
  assert.ok(handlers.install && handlers.activate && handlers.fetch && handlers.message);
});
test('manifest installation identity is relative and PNG dimensions match its icon declarations', () => {
  const manifest = JSON.parse(fs.readFileSync(path.join(root, 'manifest.webmanifest'), 'utf8'));
  assert.equal(manifest.scope, './'); assert.equal(manifest.start_url, './'); assert.equal(manifest.display, 'standalone');
  for (const icon of manifest.icons) {
    const bytes = fs.readFileSync(path.join(root, icon.src));
    assert.equal(bytes.toString('hex', 0, 8), '89504e470d0a1a0a');
    assert.equal(`${bytes.readUInt32BE(16)}x${bytes.readUInt32BE(20)}`, icon.sizes);
  }
  const apple = fs.readFileSync(path.join(root, 'icons/apple-touch-icon.png')); assert.equal(apple.readUInt32BE(16), 180);
});
test('settings shows the same release version as the cached shell', () => {
  const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
  const shown = html.match(/Wallet (\d+\.\d+\.\d+) · 数据仅保存在当前设备/);
  assert.ok(shown, 'settings footnote version not found');
  assert.ok(vm.runInContext('VERSION', ctx).startsWith(shown[1] + '-'), 'update the settings version with sw.js VERSION');
});
test('worker ignores other apps, third-party requests, and financial data files', () => {
  for (const url of ['https://example.test/other-app/', 'https://elsewhere.test/app.js', base + 'personal-backup.json', base + 'expenses.csv']) {
    let intercepted = false;
    handlers.fetch({ request: { url, method: 'GET', mode: 'cors' }, respondWith: () => intercepted = true });
    assert.equal(intercepted, false, url);
  }
});
