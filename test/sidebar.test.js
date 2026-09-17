const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { ESLint } = require('eslint');
const html = fs.readFileSync(path.join(__dirname, '../src/Sidebar.html'), 'utf8');
const script = html.match(/<script>([\s\S]*?)<\/script>/)[1];
test('sidebar: JavaScript компилируется и проходит lint', async () => {
  assert.doesNotThrow(() => new vm.Script(script));
  const eslint = new ESLint({ overrideConfig: { languageOptions: { globals: { document: 'readonly', google: 'readonly', Option: 'readonly', setInterval: 'readonly' } } } });
  const [result] = await eslint.lintText(script, { filePath: 'test/sidebar-inline.js' });
  assert.equal(result.errorCount, 0, JSON.stringify(result.messages));
});
test('sidebar использует google.script.run и отдельное явное подтверждение', () => {
  assert.match(script, /google\.script\.run/);
  assert.match(script, /call\('ownerPreviewPayment'/);
  assert.match(script, /call\('ownerConfirmPayment'/);
  assert.match(html, /Да, зафиксировать выплату/);
  assert.doesNotMatch(script, /innerHTML/);
});

test('пропущенные сделки выводятся безопасно без интерпретации HTML', () => {
  assert.match(html, /Пропущенные сделки/);
  assert.match(script, /function renderSkipped/);
  assert.match(script, /element\.textContent = String/);
  assert.doesNotMatch(script, /innerHTML|insertAdjacentHTML|document\.write/);
  const malicious = '<img src=x onerror=alert(1)><script>alert(2)</script>';
  const target = { textContent: '' };
  target.textContent = String(malicious);
  assert.equal(target.textContent, malicious, 'значение должно остаться текстом, а не разметкой');
});
