const test = require('node:test');
const assert = require('node:assert/strict');
const core = require('../src/Core');

global.PayrollCore = core;
const sheets = require('../src/Sheets');

const HEADERS = ['ID статьи', 'ID сделки', 'ID сотрудника', 'Код статьи', 'ID правила', 'Расчётная база', 'Ставка', 'Доля', 'Расчётная сумма', 'Дата готовности', 'Статус', 'Оплатить', 'Дата выплаты', 'Комментарий', 'Создано', 'Обновлено'];

function userValue(value) {
  if (typeof value === 'boolean') return { boolValue: value };
  if (typeof value === 'number') return { numberValue: value };
  return { stringValue: value == null ? '' : String(value) };
}

function readCell(cell = {}) {
  const value = cell.effective || cell.value || {};
  return value.stringValue ?? value.numberValue ?? value.boolValue ?? '';
}

function article(id, dealId, overrides = {}) {
  return {
    id, dealId, employeeId: 'E1', articleCode: 'ARTICLE', ruleId: 'RULE', base: 100,
    rate: 1, share: 1, amount: 100, readyDate: '', status: 'PLANNED', paid: false,
    paymentDate: '', comment: '', createdAt: '2026-09-17T00:00:00.000Z',
    updatedAt: '2026-09-17T00:00:00.000Z', ...overrides
  };
}

function cellsFor(row) {
  const values = [row.id, row.dealId, row.employeeId, row.articleCode, row.ruleId, row.base, row.rate,
    row.share, row.amount, row.readyDate, row.status === 'PLANNED' ? 'Запланировано' : row.status,
    row.paid, row.paymentDate, row.comment, row.createdAt, row.updatedAt];
  return values.map(value => ({ value: userValue(value), effective: userValue(value), note: 'note', format: { backgroundColor: { red: .5 } }, validation: null }));
}

function harness(existing = [], options = {}) {
  let grid = [HEADERS.map(value => ({ value: { stringValue: value }, effective: { stringValue: value }, format: { bold: true } }))];
  existing.forEach(row => grid.push(cellsFor(row)));
  while (grid.length < 8) grid.push(HEADERS.map(() => ({ value: {}, effective: {}, note: 'blank-note', format: { backgroundColor: { red: .9 } }, validation: null })));
  let maxRows = grid.length, calls = 0;
  const ss = { getId: () => 'SPREADSHEET' };
  const sheet = {
    getSheetId: () => 7,
    getParent: () => ss,
    getMaxRows: () => maxRows,
    getLastRow: () => grid.reduce((last, row, index) => row.some(cell => readCell(cell) !== '') ? index + 1 : last, 0)
  };
  function reject(stage, request, ordinal) {
    if (typeof options.fail === 'function' && options.fail(stage, request, ordinal)) throw new Error('Искусственная ошибка: ' + stage);
  }
  global.Sheets = { Spreadsheets: { batchUpdate(body, spreadsheetId) {
    assert.equal(spreadsheetId, ss.getId());
    calls += 1;
    let working = structuredClone(grid), workingMaxRows = maxRows, ordinal = 0;
    for (const request of body.requests) {
      ordinal += 1;
      if (request.appendDimension) {
        reject('append', request, ordinal);
        workingMaxRows += request.appendDimension.length;
        while (working.length < workingMaxRows) working.push([]);
      } else if (request.updateCells) {
        reject('update', request, ordinal);
        const update = request.updateCells, rowIndex = update.range.startRowIndex, columnIndex = update.range.startColumnIndex;
        const current = ((working[rowIndex] ||= [])[columnIndex] ||= {});
        const next = update.rows[0].values[0].userEnteredValue;
        const rule = current.validation;
        if (rule?.strict && rule.condition?.type === 'TEXT_EQ' && next.stringValue !== rule.condition.values[0]) throw new Error('Нарушение validation');
        current.value = structuredClone(next); current.effective = structuredClone(next);
      } else if (request.setDataValidation) {
        reject('checkbox', request, ordinal);
        const validation = request.setDataValidation, rowIndex = validation.range.startRowIndex, columnIndex = validation.range.startColumnIndex;
        ((working[rowIndex] ||= [])[columnIndex] ||= {}).validation = structuredClone(validation.rule);
      } else if (request.deleteDimension) {
        reject('delete', request, ordinal);
        const range = request.deleteDimension.range;
        working.splice(range.startIndex, range.endIndex - range.startIndex);
        workingMaxRows -= range.endIndex - range.startIndex;
      } else throw new Error('Неизвестный запрос');
    }
    grid = working; maxRows = workingMaxRows;
  } } };
  function tableRows() {
    return existing.map((row, index) => ({ ...row, _row: index + 2, _values: grid[index + 1].map(readCell), _formulas: grid[index + 1].map(cell => cell.value?.formulaValue || '') }));
  }
  return { sheet, rows: tableRows, grid: () => grid, calls: () => calls, snapshot: () => structuredClone(grid) };
}

function table(h) { return { headers: HEADERS, sheet: h.sheet }; }
function assertUnchanged(h, before) { assert.deepEqual(h.grid(), before, 'значения, формулы, Note, validation и форматирование должны совпасть со снимком'); }

test('конфликт validation в одной целевой ячейке отменяет весь пакет', () => {
  const h = harness(), target = h.grid()[1][0];
  target.validation = { condition: { type: 'TEXT_EQ', values: ['OTHER'] }, strict: true };
  h.grid()[0][15].value = { formulaValue: '=1+1' }; h.grid()[0][15].effective = { numberValue: 2 };
  const before = h.snapshot();
  assert.throws(() => sheets.writePayrollChanges(table(h), [{ row: article('A1', 'D1'), changed: true }]), /validation/);
  assertUnchanged(h, before);
});

test('ошибка установки checkbox после записи значений не оставляет частичную строку', () => {
  const h = harness([], { fail: stage => stage === 'checkbox' }), before = h.snapshot();
  assert.throws(() => sheets.writePayrollChanges(table(h), [
    { row: article('A1', 'D1'), changed: true }, { row: article('A2', 'D1'), changed: true }
  ]), /checkbox/);
  assertUnchanged(h, before);
});

test('ошибка при обновлении существующей строки полностью откатывает пакет', () => {
  const old = article('A1', 'D1'), h = harness([old], { fail: stage => stage === 'update' }), before = h.snapshot();
  const next = { ...old, ...h.rows()[0], amount: 150, updatedAt: '2026-09-17T01:00:00.000Z' };
  assert.throws(() => sheets.writePayrollChanges(table(h), [{ row: next, changed: true }]), /update/);
  assertUnchanged(h, before);
});

test('ошибка удаления не оставляет частично удалённый комплект', () => {
  const old1 = article('A1', 'D1'), old2 = article('A2', 'D1'), other = article('B1', 'D2');
  let deletions = 0;
  const h = harness([old1, old2, other], { fail: stage => stage === 'delete' && ++deletions === 2 }), before = h.snapshot();
  const rows = h.rows();
  assert.throws(() => sheets.writePayrollChanges(table(h), [
    { row: rows[0], changed: true, remove: true }, { row: rows[1], changed: true, remove: true }
  ]), /delete/);
  assertUnchanged(h, before);
});

test('несколько статей одной сделки записываются одним атомарным batchUpdate', () => {
  const h = harness();
  assert.equal(sheets.writePayrollChanges(table(h), [
    { row: article('A1', 'D1'), changed: true }, { row: article('A2', 'D1'), changed: true }
  ]), 2);
  assert.equal(h.calls(), 1);
  assert.equal(readCell(h.grid()[1][0]), 'A1');
  assert.equal(readCell(h.grid()[2][0]), 'A2');
  assert.equal(h.grid()[1][11].validation.condition.type, 'BOOLEAN');
  assert.equal(h.grid()[2][11].validation.condition.type, 'BOOLEAN');
});

test('ошибка одной сделки не повреждает статьи другой сделки', () => {
  const other = article('B1', 'D2'), h = harness([other]);
  h.grid()[2][0].validation = { condition: { type: 'TEXT_EQ', values: ['OTHER'] }, strict: true };
  const before = h.snapshot(), updatedOther = { ...other, ...h.rows()[0], amount: 200, updatedAt: '2026-09-17T02:00:00.000Z' };
  assert.throws(() => sheets.writePayrollChanges(table(h), [
    { row: updatedOther, changed: true }, { row: article('A1', 'D1'), changed: true }
  ]), /validation/);
  assertUnchanged(h, before);
});
