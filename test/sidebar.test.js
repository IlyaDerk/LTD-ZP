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
    constructor(id = '') { this.id = id; this.children = []; this.hidden = id === 'skipped-details'; this.disabled = false; this.value = ''; this.textContent = ''; this.className = ''; this.attributes = {}; }
    replaceChildren(...children) { this.children = children; }
    append(...children) { this.children.push(...children); }
    add(child) { this.children.push(child); }
    setAttribute(name, value) { this.attributes[name] = value; }
  }
  const ids = ['message', 'apply', 'reset', 'payment', 'employee', 'object', 'status', 'from', 'to', 'metrics', 'skipped-toggle', 'skipped-details', 'skipped-list'];
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
    skippedDeals: [{ objectId: 'OBJ-1', address: 'Тестовый адрес', projectCost: 1, actions: [{ action: 'Заполнить', items: ['инженера'] }] }],
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

test('sidebar содержит одну операцию выплаты без preview, confirmation и polling', () => {
  assert.match(script, /'ownerConfirmPayment'/);
  assert.doesNotMatch(script, /ownerPreviewPayment|setInterval|setTimeout/);
  assert.doesNotMatch(html, /Обновить выбор|Подтвердить оплату|Да, зафиксировать выплату|id="confirmation"|id="preview"|id="confirm"/);
  assert.match(html, /id="payment"[^>]*>Зафиксировать выплату/);
  assert.doesNotMatch(script, /innerHTML|insertAdjacentHTML|document\.write/);
  ['Загрузка…', 'Применяем фильтры…', 'Записываем выплату…'].forEach(text => assert.match(script, new RegExp(text)));
});

test('одно нажатие вызывает одну операцию, двойной клик защищён, элементы восстанавливаются', () => {
  const ui = sidebar(), serverControls = ['apply', 'reset', 'payment'];
  assert.equal(ui.calls.length, 1);
  assert.equal(ui.calls[0].name, 'ownerGetState');
  serverControls.forEach(id => assert.equal(ui.elements[id].disabled, true));
  ui.calls[0].success(state());
  serverControls.forEach(id => assert.equal(ui.elements[id].disabled, false));

  ui.elements.payment.onclick(); ui.elements.payment.onclick();
  assert.equal(ui.calls.length, 2);
  assert.equal(ui.calls[1].name, 'ownerConfirmPayment');
  assert.deepEqual(ui.calls[1].args, ['V1']);
  serverControls.forEach(id => assert.equal(ui.elements[id].disabled, true));
  assert.equal(ui.elements.message.textContent, 'Записываем выплату…');
  const during = ui.calls.length;
  ui.elements['skipped-toggle'].onclick();
  assert.equal(ui.elements['skipped-details'].hidden, false);
  assert.equal(ui.calls.length, during, 'локальное раскрытие не вызывает сервер');
  ui.calls[1].success({ paidCount: 1, amount: 20, state: state({ version: 'V2', summary: { planned: 10, toPay: 0, paid: 50, total: 60, selectedCount: 0, selectedAmount: 0, count: 3 } }) });
  serverControls.forEach(id => assert.equal(ui.elements[id].disabled, false));
  assert.match(ui.elements.message.textContent, /Зафиксировано выплат: 1/);

  ui.elements.apply.onclick();
  serverControls.forEach(id => assert.equal(ui.elements[id].disabled, true));
  ui.calls.at(-1).failure({ message: 'Ошибка связи' });
  serverControls.forEach(id => assert.equal(ui.elements[id].disabled, false));
  assert.equal(ui.elements.message.textContent, 'Ошибка связи');
});

test('структурированная диагностика раскрывается локально и выводится через textContent', () => {
  const malicious = '<img src=x onerror=alert(1)><script>alert(2)</script>';
  const ui = sidebar();
  ui.calls[0].success(state({ skippedDeals: [{
    objectId: malicious, address: malicious, projectCost: 100,
    actions: [{ action: 'Проверить', items: [malicious] }, { action: 'Исправить', items: ['стоимость проекта'] }]
  }] }));
  assert.equal(ui.elements['skipped-toggle'].textContent, 'Пропущенные сделки: 1');
  const card = ui.elements['skipped-list'].children[0];
  assert.equal(card.children[0].textContent, malicious + ', ' + malicious);
  assert.equal(card.children[2].textContent, 'Проверить: ' + malicious);
  assert.equal(card.children[3].textContent, 'Исправить: стоимость проекта');
  assert.match(script, /element\.textContent = String/);
  assert.doesNotMatch(script, /\.reasons|\.articles|innerHTML|insertAdjacentHTML|document\.write/);
  const before = ui.calls.length;
  ui.elements['skipped-toggle'].onclick();
  assert.equal(ui.elements['skipped-details'].hidden, false);
  assert.equal(ui.calls.length, before);
});
