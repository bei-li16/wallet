// Compile the actual inline Vue template without browser or package dependencies.
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');
const root = path.join(__dirname, '..');
const decode = text => text.replace(/&quot;/g, '"').replace(/&#39;|&apos;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&');
const context = { console, document: { createElement: () => { let html; return { set innerHTML(value) { html = value; }, get textContent() { return decode(html); }, get children() { return [{ getAttribute: () => decode(html.slice(10, -2)) }]; } }; } }, Function: function (...args) {
  try { return vm.runInContext('(function(' + args.slice(0, -1).join(',') + ') {' + args[args.length - 1] + '\n})', context); } catch (e) { fs.mkdirSync(path.join(__dirname, 'artifacts'), { recursive: true }); fs.writeFileSync(path.join(__dirname, 'artifacts/template-compiled.js'), args[args.length - 1]); throw e; }
} };
vm.createContext(context);
vm.runInContext(fs.readFileSync(path.join(root, 'js/vendor/vue.global.prod.js'), 'utf8'), context);
const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
try { context.Vue.compile(html.slice(html.indexOf('<div id="app"'), html.lastIndexOf('</body>'))); console.log('PASS inline Vue template compiles'); }
catch (e) { console.error('FAIL Vue template: ' + e.message); process.exitCode = 1; }
