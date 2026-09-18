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
global.writePayrollDiagnostics = () => { throw new Error('writePayrollDiagnostics stub is not configured'); };
global.ensurePaymentCheckbox = () => { throw new Error('ensurePaymentCheckbox stub is not configured'); };
global.LockService = { getScriptLock: () => ({ tryLock: () => true, releaseLock: () => {} }) };
global.SpreadsheetApp = { getActiveSpreadsheet: () => ({ getId: () => 'TEST' }) };
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
  const requests = [];
  global.Sheets = { Spreadsheets: { batchUpdate: body => requests.push(...body.requests) } };
  const table = {
    headers: ['ID статьи', 'ID сделки', 'ID сотрудника', 'Код статьи', 'ID правила', 'Расчётная база', 'Ставка', 'Доля', 'Расчётная сумма', 'Дата готовности', 'Статус', 'Оплатить', 'Дата выплаты', 'Причина уточнения', 'Комментарий', 'Создано', 'Обновлено'],
    sheet: {
      getSheetId: () => 1,
      getName: () => 'Статьи оплаты',
      getParent: () => ({ getId: () => 'TEST' }),
      getLastRow: () => 2,
      getMaxRows: () => 100,
      getRange: () => ({ getDataValidation: () => null })
    }
  };
  const row = { _row: 2, _values: Array(17).fill(''), id: 'P1', dealId: 'D1', employeeId: 'E1', articleCode: 'A', ruleId: 'R', base: 100, rate: 1, share: 1, amount: 100, readyDate: '', status: 'PLANNED', paid: false, paymentDate: '', comment: '', createdAt: '2026-09-03', updatedAt: '2026-09-03' };
  row._values[13] = 'Существующее значение';
  assert.equal(sheets.writePayrollChanges(table, [{ row, changed: true }]), 1);
  const statusRequest = requests.find(request => request.updateCells?.range.startColumnIndex === 10);
  assert.equal(statusRequest.updateCells.rows[0].values[0].userEnteredValue.stringValue, 'Запланировано');
  assert.equal(requests.some(request => request.updateCells?.range.startColumnIndex === 13), false);
  assert.equal(row._values[13], 'Существующее значение');
});

test('редактирование checkbox в привязанном проекте не подтверждает оплату', () => {
  assert.equal(main.handlePaymentEdit({ value: 'TRUE' }), false);
});

test('dailySync возвращает количество и перечень пропущенных сделок', () => {
  const skippedDeals = [{ dealId: 'BAD', reasons: ['Ошибка'] }];
  const diagnostics = [];
  global.readPayrollWorkbook = () => ({ existing: [], paymentTable: {}, dealTable: { id: 'DEALS' } });
  global.writePayrollChanges = () => 2;
  global.writePayrollDiagnostics = (table, skipped) => diagnostics.push([table.id, skipped]);
  global.PayrollCore = {
    calculate: () => ({ rows: [{ id: '1' }, { id: '2' }], skippedDeals }),
    reconcile: (_existing, rows) => rows.map(row => ({ row, changed: true }))
  };
  assert.deepEqual(main.dailySync(), { calculated: 2, written: 2, skipped: 1, skippedDeals });
  assert.deepEqual(diagnostics, [['DEALS', skippedDeals]]);
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

test('setup только проверяет источник и не создаёт триггеры', () => {
  const events = [];
  global.readPayrollWorkbook = () => { events.push('preflight'); return {}; };
  global.ensurePaymentCheckbox = () => { throw new Error('Нельзя менять checkbox'); };
  global.ScriptApp = { getProjectTriggers: () => { throw new Error('Триггеры не трогать'); } };
  main.setup();
  assert.deepEqual(events, ['preflight']);
});

test('ID контейнера проверяется до чтения и записи', () => {
  global.SpreadsheetApp = { getActiveSpreadsheet: () => ({ getId: () => 'OTHER' }) };
  assert.throws(() => main.dailySync(), /ID контейнерной/);
  global.SpreadsheetApp = { getActiveSpreadsheet: () => null };
  assert.throws(() => main.setup(), /ID контейнерной/);
  global.SpreadsheetApp = { getActiveSpreadsheet: () => ({ getId: () => 'TEST' }) };
});
