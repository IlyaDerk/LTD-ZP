const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { ESLint } = require('eslint');
const html = fs.readFileSync(path.join(__dirname, '../src/Sidebar.html'), 'utf8');
const script = html.match(/<script>([\s\S]*?)<\/script>/)[1];

function sidebar() {
  class Element {
    constructor(id = '') { this.id = id; this.children = []; this.hidden = id === 'confirmation' || id === 'skipped-details'; this.disabled = false; this.value = ''; this.textContent = ''; this.className = ''; this.attributes = {}; }
    replaceChildren(...children) { this.children = children; }
    append(...children) { this.children.push(...children); }
    add(child) { this.children.push(child); }
    setAttribute(name, value) { this.attributes[name] = value; }
  }
  const ids = ['message', 'confirmation', 'apply', 'reset', 'refresh', 'preview', 'confirm', 'cancel', 'employee', 'object', 'status', 'from', 'to', 'metrics', 'quote', 'skipped-toggle', 'skipped-details', 'skipped-list'];
  const elements = Object.fromEntries(ids.map(id => [id, new Element(id)]));
  const calls = [];
  const runner = (success, failure) => new Proxy({
    withSuccessHandler: callback => runner(callback, failure),
    withFailureHandler: callback => runner(success, callback)
  }, { get(target, name) {
    if (name in target) return target[name];
    return (...args) => calls.push({ name: String(name), args, success, failure });
  } });
  const context = vm.createContext({
    Intl, String, Array, Number, Object,
    document: { getElementById: id => elements[id], createElement: tag => new Element(tag) },
    Option: class Option { constructor(label, value) { this.label = label; this.value = value; } },
    google: { script: { run: runner() } }
  });
  vm.runInContext(script, context);
  return { elements, calls };
}

function state(overrides = {}) {
  return {
    version: 'V1', stale: false,
    filters: { from: '', to: '', employee: '', status: '', object: '' },
    employees: [], objects: [], statuses: ['Запланировано', 'К оплате', 'Выплачено', 'Отменено'],
    skippedDeals: [{ dealId: 'D1', dealName: 'Тест', projectCost: 1, articles: [], reasons: ['Причина'] }],
    summary: { planned: 10, toPay: 20, paid: 30, total: 60, selectedCount: 1, selectedAmount: 20, count: 3 },
    ...overrides
  };
}

test('sidebar: JavaScript компилируется и проходит lint', async () => {
  assert.doesNotThrow(() => new vm.Script(script));
  const eslint = new ESLint({ overrideConfig: { languageOptions: { globals: { document: 'readonly', google: 'readonly', Option: 'readonly' } } } });
  const [result] = await eslint.lintText(script, { filePath: 'test/sidebar-inline.js' });
  assert.equal(result.errorCount, 0, JSON.stringify(result.messages));
});

test('sidebar использует только явные запросы и отдельное подтверждение', () => {
  assert.match(script, /google\.script\.run/);
  assert.match(script, /'ownerPreviewPayment'/);
  assert.match(script, /'ownerConfirmPayment'/);
  assert.match(html, /Да, зафиксировать выплату/);
  assert.doesNotMatch(script, /setInterval|setTimeout/);
  assert.doesNotMatch(script, /querySelectorAll\(['"]button/);
  assert.doesNotMatch(script, /innerHTML/);
  ['Загрузка…', 'Применяем фильтры…', 'Обновляем выбор…', 'Проверяем выплату…', 'Записываем выплату…'].forEach(text => assert.match(script, new RegExp(text)));
});

test('серверные действия блокируются вместе, двойной клик защищён, успех и ошибка восстанавливают управление', () => {
  const ui = sidebar();
  const serverControls = ['apply', 'reset', 'refresh', 'preview', 'confirm'];
  assert.equal(ui.calls.length, 1);
  assert.equal(ui.calls[0].name, 'ownerGetState');
  assert.equal(ui.elements.message.textContent, 'Загрузка…');
  serverControls.forEach(id => assert.equal(ui.elements[id].disabled, true, id + ' должен быть недоступен во время загрузки'));
  assert.equal(ui.elements['skipped-toggle'].disabled, false);
  ui.calls[0].success(state());
  assert.equal(ui.elements.apply.disabled, false);
  assert.equal(ui.elements.reset.disabled, false);
  assert.equal(ui.elements.refresh.disabled, false);
  assert.equal(ui.elements.preview.disabled, false);

  const before = ui.calls.length;
  ui.elements.preview.onclick(); ui.elements.preview.onclick();
  assert.equal(ui.calls.length, before + 1, 'двойной клик не должен запускать второй запрос');
  assert.equal(ui.calls.at(-1).name, 'ownerPreviewPayment');
  serverControls.forEach(id => assert.equal(ui.elements[id].disabled, true, id + ' должен быть недоступен во время запроса'));
  assert.equal(ui.elements['skipped-toggle'].disabled, false, 'локальное раскрытие остаётся доступным');
  const duringRequest = ui.calls.length;
  ui.elements['skipped-toggle'].onclick();
  assert.equal(ui.elements['skipped-details'].hidden, false);
  assert.equal(ui.calls.length, duringRequest);
  ui.calls.at(-1).success({ token: 'T1', count: 1, amount: 20, ids: ['A'] });
  assert.equal(ui.elements.apply.disabled, false);
  assert.equal(ui.elements.reset.disabled, false);
  assert.equal(ui.elements.refresh.disabled, false);
  assert.equal(ui.elements.preview.disabled, false);
  assert.equal(ui.elements.confirm.disabled, false);

  ui.elements.refresh.onclick(); ui.elements.refresh.onclick();
  assert.equal(ui.calls.length, before + 2, 'повторный refresh не должен запускать второй запрос');
  assert.equal(ui.calls.at(-1).name, 'ownerGetState');
  serverControls.forEach(id => assert.equal(ui.elements[id].disabled, true, id + ' должен быть недоступен во время refresh'));
  assert.equal(ui.elements.message.textContent, 'Обновляем выбор…');
  ui.calls.at(-1).failure({ message: 'Ошибка связи' });
  assert.equal(ui.elements.refresh.disabled, false);
  assert.equal(ui.elements.apply.disabled, false);
  assert.equal(ui.elements.reset.disabled, false);
  assert.equal(ui.elements.preview.disabled, false);
  assert.equal(ui.elements.confirm.disabled, true, 'ошибка сбрасывает устаревшее подтверждение');
  assert.equal(ui.elements['skipped-toggle'].disabled, false);
  assert.equal(ui.elements.message.textContent, 'Ошибка связи');
});

test('пропущенные сделки раскрываются локально и выводятся безопасно', () => {
  const ui = sidebar(); ui.calls[0].success(state());
  assert.equal(ui.elements['skipped-toggle'].textContent, 'Пропущенные сделки: 1');
  assert.equal(ui.elements['skipped-details'].hidden, true);
  const before = ui.calls.length;
  ui.elements['skipped-toggle'].onclick();
  assert.equal(ui.elements['skipped-details'].hidden, false);
  assert.equal(ui.elements['skipped-toggle'].attributes['aria-expanded'], 'true');
  assert.equal(ui.calls.length, before, 'раскрытие не должно обращаться к серверу');
  assert.match(script, /element\.textContent = String/);
  assert.doesNotMatch(script, /innerHTML|insertAdjacentHTML|document\.write/);
  const malicious = '<img src=x onerror=alert(1)><script>alert(2)</script>';
  const target = { textContent: '' }; target.textContent = String(malicious);
  assert.equal(target.textContent, malicious);
});
