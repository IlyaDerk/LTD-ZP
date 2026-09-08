const test = require('node:test');
const assert = require('node:assert/strict');
const fixture = require('./sheet-fixture.json');
const core = require('../src/Core');
global.PayrollCore = core;
global.PAYROLL_CONFIG = { sheets: { deals: 'Выгрузка сделок', employees: 'Справочник сотрудников', articleTypes: 'Справочник статей', rules: 'Правила создания статей', moscow: 'Матрица Мотив Москва', tambov: 'Матрица Мотив Тамбов', payments: 'Статьи оплаты' } };
global.Utilities = { formatDate(date, timeZone, pattern) {
  assert.equal(pattern, 'yyyy-MM-dd');
  const parts = new Intl.DateTimeFormat('en-US', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(date);
  return ['year', 'month', 'day'].map(type => parts.find(p => p.type === type).value).join('-');
} };
const sheets = require('../src/Sheets');

// Sheets getValues returns calendar cells as Dates at midnight in spreadsheet time,
// even when the script runs in UTC. setValue on a date-formatted cell parses ISO dates.
function workbook() {
  const data = JSON.parse(JSON.stringify(fixture));
  const writes = [];
  const readValue = cell => {
    const v = cell.effective || cell.value || {};
    if (typeof v.numberValue === 'number' && cell.format?.numberFormat?.type === 'DATE') {
      return new Date(Date.UTC(1899, 11, 30) + v.numberValue * 86400000 - 3 * 3600000);
    }
    return v.stringValue ?? v.numberValue ?? v.boolValue ?? '';
  };
  const ss = { getSpreadsheetTimeZone: () => 'Europe/Moscow', getSheetByName(name) {
    const rows = data[name];
    if (!rows) return null;
    const width = Math.max(...rows.map(r => r.length));
    return {
      getDataRange: () => ({
        getValues: () => rows.map(row => Array.from({ length: width }, (_, i) => readValue(row[i] || {}))),
        getFormulas: () => rows.map(row => Array.from({ length: width }, (_, i) => row[i]?.value?.formulaValue || ''))
      }),
      getLastRow: () => rows.length,
      getRange: (row, column) => ({ setValue(value) {
        const cell = rows[row - 1][column - 1] ||= {};
        writes.push([name, row, column]);
        if (cell.format?.numberFormat?.type === 'DATE' && /^\d{4}-\d{2}-\d{2}$/.test(value)) {
          cell.value = { numberValue: (Date.parse(value + 'T00:00:00Z') - Date.UTC(1899, 11, 30)) / 86400000 };
        } else cell.value = { [typeof value === 'number' ? 'numberValue' : typeof value === 'boolean' ? 'boolValue' : 'stringValue']: value };
        cell.effective = cell.value;
      } })
    };
  } };
  function sync(now) {
    const input = sheets.readPayrollWorkbook(ss);
    const calculated = core.calculate(input);
    const results = core.reconcile(input.existing, calculated.rows, now);
    return { calculated, written: sheets.writePayrollChanges(input.paymentTable, results) };
  }
  return { ss, data, writes, sync };
}

test('Europe/Moscow: полный цикл Sheets → расчёт → запись → чтение не меняет второй и третий прогон', () => {
  const w = workbook(), payments = w.data['Статьи оплаты'];
  const beforePaid = JSON.stringify(payments[7]);
  // Preserve user-owned values and formulas even during the initial date repair.
  payments[10][13] = { value: { formulaValue: '=1+1' }, effective: { numberValue: 2 } };
  payments[10][14] = { value: { stringValue: 'Комментарий пользователя' } };
  payments[10][16] = { value: { stringValue: '2026-08-01T12:34:56.789Z' } };
  const first = w.sync('2026-09-06T18:00:00.001Z');
  assert.equal(first.written, 2);
  const input = sheets.readPayrollWorkbook(w.ss);
  assert.equal(input.deals[0].act2, '2026-08-05');
  assert.equal(core.toIsoDate(input.employees[0].validFrom), '2026-08-01');
  assert.equal(input.existing[6].readyDate, '2026-08-05');
  assert.equal(input.existing[7].readyDate, '2026-08-12');
  assert.equal(input.existing[6].createdAt, '2026-08-01T12:34:56.789Z');
  assert.equal(input.existing[6].updatedAt, '2026-09-06T18:00:00.001Z');
  const snapshot = JSON.stringify(w.data), writeCount = w.writes.length;
  assert.equal(w.sync('2026-09-07T18:00:00.002Z').written, 0);
  assert.equal(w.sync('2026-09-08T18:00:00.003Z').written, 0);
  assert.equal(JSON.stringify(w.data), snapshot);
  assert.equal(w.writes.length, writeCount);
  assert.equal(JSON.stringify(payments[7]), beforePaid);
  assert.equal(payments[10][13].value.formulaValue, '=1+1');
});

test('сохранённый ID, флажок и комментарий не вызывают вечное обновление по naturalKey', () => {
  const w = workbook(), row = w.data['Статьи оплаты'][10];
  row[0] = { value: { stringValue: 'LEGACY-ID' } };
  row[11] = { value: { boolValue: true }, validation: { condition: { type: 'BOOLEAN' } } };
  w.sync('2026-09-06T18:00:00Z');
  const before = JSON.stringify(w.data);
  assert.equal(w.sync('2026-09-07T18:00:00Z').written, 0);
  assert.equal(JSON.stringify(w.data), before);
  assert.equal(row[0].value.stringValue, 'LEGACY-ID');
  assert.equal(row[11].value.boolValue, true);
});

test('пустая строка между статьями не сдвигает адрес записи', () => {
  const w = workbook();
  w.data['Статьи оплаты'].splice(10, 0, []);
  w.sync('2026-09-06T18:00:00Z');
  assert.deepEqual(w.data['Статьи оплаты'][10], []);
  assert.ok(w.writes.every(([, row]) => row === 12 || row === 13));
});
