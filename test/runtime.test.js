const test = require('node:test');
const assert = require('node:assert/strict');
const core = require('../src/Core');

global.PayrollCore = core;
global.PAYROLL_CONFIG = { spreadsheetId: 'TEST', sheets: { payments: 'Статьи оплаты' } };
const sheets = require('../src/Sheets');

global.displayStatus = sheets.displayStatus;
global.status = sheets.status;
global.tableFromSheet = () => { throw new Error('tableFromSheet stub is not configured'); };
global.readPayrollWorkbook = () => { throw new Error('readPayrollWorkbook stub is not configured'); };
global.writePayrollChanges = () => { throw new Error('writePayrollChanges stub is not configured'); };
global.ensurePaymentCheckbox = () => { throw new Error('ensurePaymentCheckbox stub is not configured'); };
global.LockService = { getScriptLock: () => ({ tryLock: () => true, releaseLock: () => {} }) };
global.SpreadsheetApp = { openById: () => ({}) };
global.ScriptApp = { getProjectTriggers: () => [] };
const main = require('../src/Main');

test('статусы отображаются по-русски и читаются во внутренние английские значения', () => {
  assert.deepEqual(
    ['PLANNED', 'TO_PAY', 'PAID', 'CANCELLED'].map(sheets.displayStatus),
    ['Запланировано', 'К оплате', 'Выплачено', 'Отменено']
  );
  assert.deepEqual(
    ['Запланировано', 'К оплате', 'Выплачено', 'Отменено'].map(sheets.status),
    ['PLANNED', 'TO_PAY', 'PAID', 'CANCELLED']
  );
});

test('запись выплаты использует русский статус и сохраняет существующий необязательный столбец', () => {
  const written = [];
  const table = {
    headers: ['ID статьи', 'ID сделки', 'ID сотрудника', 'Код статьи', 'ID правила', 'Расчётная база', 'Ставка', 'Доля', 'Расчётная сумма', 'Дата готовности', 'Статус', 'Оплатить', 'Дата выплаты', 'Причина уточнения', 'Комментарий', 'Создано', 'Обновлено'],
    sheet: { getRange: (_row, column) => ({ setValue: value => { written[column - 1] = value; } }) }
  };
  const row = { _row: 2, _values: Array(17).fill(''), id: 'P1', dealId: 'D1', employeeId: 'E1', articleCode: 'A', ruleId: 'R', base: 100, rate: 1, share: 1, amount: 100, readyDate: '', status: 'PLANNED', paid: false, paymentDate: '', comment: '', createdAt: '2026-09-03', updatedAt: '2026-09-03' };
  row._values[13] = 'Существующее значение';
  assert.equal(sheets.writePayrollChanges(table, [{ row, changed: true }]), 1);
  assert.equal(written[10], 'Запланировано');
  assert.equal(written[13], undefined);
  assert.equal(row._values[13], 'Существующее значение');
});

test('handlePaymentEdit записывает «Выплачено»', () => {
  const writes = [];
  const sheet = {
    getName: () => 'Статьи оплаты',
    getRange: (row, column) => ({
      getValue: () => column === 2 ? 'К оплате' : '',
      setValue: value => writes.push({ row, column, value })
    })
  };
  global.tableFromSheet = () => ({ headers: ['ID статьи', 'Статус', 'Оплатить', 'Дата выплаты', 'Обновлено'], headerRow: 0 });
  const event = { value: 'TRUE', source: { toast: () => {} }, range: { getNumRows: () => 1, getNumColumns: () => 1, getSheet: () => sheet, getColumn: () => 3, getRow: () => 2, setValue: () => {} } };
  main.handlePaymentEdit(event);
  assert.equal(writes.find(write => write.column === 2).value, 'Выплачено');
});

test('dailySync возвращает количество и перечень пропущенных сделок', () => {
  const skippedDeals = [{ dealId: 'BAD', reasons: ['Ошибка'] }];
  global.readPayrollWorkbook = () => ({ existing: [], paymentTable: {} });
  global.writePayrollChanges = () => 2;
  global.PayrollCore = {
    calculate: () => ({ rows: [{ id: '1' }, { id: '2' }], skippedDeals }),
    reconcile: (_existing, rows) => rows.map(row => ({ row, changed: true }))
  };
  assert.deepEqual(main.dailySync(), { calculated: 2, written: 2, skipped: 1, skippedDeals });
  global.PayrollCore = core;
});

test('setup сначала выполняет preflight и при структурной ошибке ничего не меняет', () => {
  const events = [];
  global.readPayrollWorkbook = () => { events.push('preflight'); throw new Error('Структурная ошибка'); };
  global.ensurePaymentCheckbox = () => { events.push('checkbox'); };
  global.ScriptApp = { getProjectTriggers: () => { events.push('triggers'); return []; } };
  assert.throws(() => main.setup(), /Структурная ошибка/);
  assert.deepEqual(events, ['preflight']);
});

test('setup добавляет checkbox после preflight и оставляет ровно по одному целевому триггеру', () => {
  const events = [], deleted = [], created = [];
  const trigger = handler => ({ getHandlerFunction: () => handler });
  global.readPayrollWorkbook = () => { events.push('preflight'); return {}; };
  global.ensurePaymentCheckbox = () => { events.push('checkbox'); };
  global.ScriptApp = {
    getProjectTriggers: () => [trigger('dailySync'), trigger('dailySync'), trigger('other')],
    deleteTrigger: item => deleted.push(item.getHandlerFunction()),
    newTrigger: handler => ({
      timeBased() { return this; }, everyDays() { return this; }, atHour() { return this; },
      forSpreadsheet() { return this; }, onEdit() { return this; },
      create() { created.push(handler); }
    })
  };
  main.setup();
  assert.deepEqual(events, ['preflight', 'checkbox']);
  assert.deepEqual(deleted, ['dailySync']);
  assert.deepEqual(created, ['handlePaymentEdit']);
});
