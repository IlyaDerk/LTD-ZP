const test = require('node:test');
const assert = require('node:assert/strict');
const core = require('../src/Core');

global.PayrollCore = core;
const sheets = require('../src/Sheets');

function diagnostic(overrides = {}) {
  return {
    dealId: 'D<1>', dealName: '<img src=x onerror=alert(1)>', projectCost: 1,
    articles: [{ name: '<script>alert(1)</script>', articleCode: 'A', ruleId: 'R', amount: 0, amountText: '0 ₽' }],
    nonPositiveArticles: [{ name: 'Акт 1', articleCode: 'A', ruleId: 'R', amount: 0, amountText: '0 ₽' }],
    reasons: ['Нулевая статья'], cleanupExisting: true, ...overrides
  };
}

test('служебный блок Note сохраняет пользовательское примечание и не дублируется', () => {
  const user = 'Пользовательская строка\nи ещё строка';
  const first = sheets.mergePayrollDiagnostic(user, diagnostic());
  const second = sheets.mergePayrollDiagnostic(first, diagnostic({ reasons: ['Обновлённая причина'] }));
  assert.ok(second.startsWith(user + '\n\n'));
  assert.equal((second.match(/--- Расчёт зарплаты: начало ---/g) || []).length, 1);
  assert.equal((second.match(/--- Расчёт зарплаты: конец ---/g) || []).length, 1);
  assert.doesNotMatch(second, /Нулевая статья/);
  assert.match(second, /Обновлённая причина/);
  assert.equal(sheets.mergePayrollDiagnostic(second, null), user);
  const unmatched = user + '\n--- Расчёт зарплаты: начало ---\nэто пользовательский текст';
  assert.ok(sheets.mergePayrollDiagnostic(unmatched, diagnostic()).startsWith(unmatched));
});

test('служебный блок Note читается обратно без потери специальных символов', () => {
  const source = diagnostic();
  const note = sheets.mergePayrollDiagnostic('Не удалять', source);
  const parsed = sheets.parsePayrollDiagnostic(note);
  assert.deepEqual(parsed, source);
  assert.equal(sheets.mergePayrollDiagnostic(note, source), note);
});

test('обновление Note меняет только примечание диагностической ячейки', () => {
  const writes = [];
  const table = {
    headers: ['ID сделки', 'Проверка данных'],
    rows: [{ _row: 7, _notes: ['', 'Примечание пользователя'], 'ID сделки': 'D<1>' }],
    sheet: { getRange: (row, column) => ({ setNote: note => writes.push({ row, column, note }) }) }
  };
  assert.equal(sheets.writePayrollDiagnostics(table, [diagnostic()]), 1);
  assert.deepEqual([writes[0].row, writes[0].column], [7, 2]);
  assert.match(writes[0].note, /^Примечание пользователя/);
  table.rows[0]._notes[1] = writes[0].note;
  assert.equal(sheets.writePayrollDiagnostics(table, [diagnostic()]), 0);
  assert.equal(writes.length, 1);
  assert.equal(sheets.writePayrollDiagnostics(table, []), 1);
  assert.equal(writes[1].note, 'Примечание пользователя');
});

test('удаление статей выполняется снизу вверх и не записывает значения', () => {
  const requests = [];
  global.Sheets = { Spreadsheets: { batchUpdate: body => requests.push(...body.requests) } };
  const table = { headers: [], sheet: { getSheetId: () => 1, getParent: () => ({ getId: () => 'S' }), getLastRow: () => 12, getMaxRows: () => 100 } };
  const results = [
    { row: { id: 'A', dealId: 'D', _row: 10 }, changed: true, remove: true },
    { row: { id: 'B', dealId: 'D', _row: 12 }, changed: true, remove: true }
  ];
  assert.equal(sheets.writePayrollChanges(table, results), 2);
  assert.deepEqual(requests.map(request => request.deleteDimension.range.startIndex), [11, 9]);
});
