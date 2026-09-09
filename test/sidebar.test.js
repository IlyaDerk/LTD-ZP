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
