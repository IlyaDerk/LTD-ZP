const test = require('node:test');
const assert = require('node:assert/strict');
const workbook = require('./helpers/owner-workbook');
const payments = w => JSON.stringify(w.cells('Статьи оплаты'));
const plain = v => JSON.parse(JSON.stringify(v));
const cell = (w, row, column) => w.readValue(w.cells('Интерфейс собственника')[row - 1]?.[column - 1]);

test('сводка использует новые семь координат и очищает только прежние служебные ячейки', () => {
  const w = workbook(), state = w.api.ownerGetState();
  assert.deepEqual([
    cell(w, 5, 2), cell(w, 5, 3), cell(w, 5, 4), cell(w, 5, 5),
    cell(w, 5, 7), cell(w, 5, 8), cell(w, 5, 9)
  ], [state.summary.planned, state.summary.toPay, state.summary.paid, state.summary.total, state.summary.count, 0, 0]);
  assert.deepEqual([cell(w, 4, 2), cell(w, 4, 3), cell(w, 4, 4), cell(w, 4, 5), cell(w, 4, 7), cell(w, 4, 8), cell(w, 4, 9)],
    ['Запланировано', 'К оплате', 'Выплачено', 'Итого', 'Найдено статей', 'Выбрано статей', 'Сумма выбранных']);
  assert.deepEqual(w.cells('Интерфейс собственника')[9].slice(0, 10).map(value => w.readValue(value)),
    ['ID статьи', 'Дата готовности', 'Объект', 'Сотрудник', 'Статья', 'Сумма', 'Статус', 'Выбрать', 'Дата выплаты', 'Комментарий']);
  assert.equal(w.meta['Интерфейс собственника'].frozenRows, 10);
  assert.equal(w.meta['Интерфейс собственника'].hiddenColumns[1], true);
  assert.deepEqual(w.meta['Интерфейс собственника'].widths, { 2: 164, 3: 220, 4: 220, 5: 220, 6: 130, 7: 145, 8: 125, 9: 168, 10: 240 });

  [[6, 2], [7, 2], [6, 4], [7, 4], [8, 2]].forEach(([row, column]) => w.value('Интерфейс собственника', row, column, 'старый дубль'));
  w.value('Интерфейс собственника', 6, 3, 'Пользовательская ячейка');
  w.value('Интерфейс собственника', 8, 4, 'Не очищать');
  const articleRows = structuredClone(w.cells('Интерфейс собственника').slice(10));
  w.api.ownerGetState(state.version);
  assert.deepEqual([[6, 2], [7, 2], [6, 4], [7, 4], [8, 2]].map(([row, column]) => cell(w, row, column)), ['', '', '', '', '']);
  assert.equal(cell(w, 6, 3), 'Пользовательская ячейка');
  assert.equal(cell(w, 8, 4), 'Не очищать');
  assert.deepEqual(w.cells('Интерфейс собственника').slice(10), articleRows, 'строки статей, checkbox, Note, формулы, validation и формат должны сохраниться');
  const stable = structuredClone(w.cells('Интерфейс собственника'));
  w.api.ownerGetState(state.version);
  assert.deepEqual(w.cells('Интерфейс собственника'), stable, 'повторная отрисовка должна быть идемпотентна по данным и структуре ячеек');
});

test('onEdit игнорирует изменения вне Выбрать и не читает книгу', () => {
  const w = workbook(); w.api.ownerGetState();
  const calls = w.calls.length, before = structuredClone(w.cells('Интерфейс собственника'));
  let reads = 0; const read = w.api.readPayrollWorkbook;
  w.api.readPayrollWorkbook = ss => { reads += 1; return read(ss); };
  w.api.onEdit({ range: w.range('Интерфейс собственника', 11, 6) });
  w.api.onEdit({ range: w.range('Интерфейс собственника', 11, 7, 1, 3) });
  w.api.onEdit({ range: w.range('Интерфейс собственника', 10, 8) });
  w.api.onEdit({ range: w.range('Интерфейс собственника', 999, 8) });
  assert.equal(reads, 0); assert.equal(w.calls.length, calls);
  assert.deepEqual(w.cells('Интерфейс собственника'), before);
});

test('onEdit checkbox обновляет только H5:I5, поддерживает диапазон и не читает справочники', () => {
  const w = workbook(); w.api.ownerGetState();
  const ids = ['PAY-ED36BAC4', 'PAY-8D4056C3'];
  const indexes = ids.map(id => w.cells('Интерфейс собственника').findIndex(row => w.readValue(row?.[0]) === id));
  indexes.forEach(index => w.value('Интерфейс собственника', index + 1, 8, true));
  const before = structuredClone(w.cells('Интерфейс собственника'));
  const source = payments(w); let reads = 0; const read = w.api.readPayrollWorkbook;
  w.api.readPayrollWorkbook = ss => { reads += 1; return read(ss); };
  const first = Math.min(...indexes) + 1, last = Math.max(...indexes) + 1;
  w.api.onEdit({ range: w.range('Интерфейс собственника', first, 8, last - first + 1, 1) });
  assert.equal(reads, 0); assert.equal(payments(w), source);
  assert.equal(cell(w, 5, 8), 2); assert.equal(cell(w, 5, 9), 165000);
  w.cells('Интерфейс собственника').forEach((row, ri) => row.forEach((value, ci) => {
    if (ri === 4 && (ci === 7 || ci === 8)) return;
    assert.deepEqual(value, before[ri]?.[ci]);
  }));
});

for (const ids of [['PAY-ED36BAC4'], ['PAY-ED36BAC4', 'PAY-8D4056C3']]) {
  test('после оплаты интерфейс актуален при устаревшем чтении SpreadsheetApp: ' + ids.length + ' статьи', () => {
    const w = workbook(), state = w.api.ownerGetState();
    ids.forEach(id => w.select(id));
    const quote = w.api.ownerPreviewPayment(state.version);
    // Reproduce the live read-after-write cache: API writes commit, but reads
    // through SpreadsheetApp still return the pre-payment workbook this execution.
    const read = w.api.readPayrollWorkbook;
    let cached;
    w.api.readPayrollWorkbook = ss => cached || (cached = read(ss));
    let result;
    try { result = w.api.ownerConfirmPayment(quote.token, state.version); }
    finally { w.api.readPayrollWorkbook = read; }
    assert.equal(result.warning, undefined);
    assert.equal(result.state.summary.paid, state.summary.paid + quote.amount);
    assert.equal(result.state.summary.toPay, state.summary.toPay - quote.amount);
    assert.equal(result.state.summary.selectedCount, 0);
    ids.forEach(id => {
      const row = w.cells('Интерфейс собственника').find(r => w.readValue(r?.[0]) === id);
      assert.equal(w.readValue(row[6]), 'Выплачено');
      assert.equal(w.readValue(row[7]), true);
      assert.match(w.readValue(row[8]), /^\d{4}-\d{2}-\d{2}$/);
    });
    const fresh = w.api.ownerGetState(result.state.version);
    assert.equal(fresh.stale, false, 'следующий запрос не должен объявлять собственную оплату внешним изменением');
    assert.deepEqual(plain(fresh.summary), plain(result.state.summary));
    const source = payments(w);
    assert.throws(() => w.api.ownerConfirmPayment(quote.token, result.state.version), /Сначала/);
    assert.equal(payments(w), source);
  });
}

test('реальные адаптеры: checkbox выбирает, preview ничего не оплачивает, одиночная кнопка платит по ID', () => {
  const w = workbook(), state = w.api.ownerGetState();
  const before = payments(w);
  w.select('PAY-ED36BAC4');
  assert.equal(payments(w), before);
  assert.equal(w.api.ownerGetState().summary.selectedAmount, 90000);
  const quote = w.api.ownerPreviewPayment(state.version);
  assert.equal(quote.count, 1); assert.equal(quote.amount, 90000); assert.equal(payments(w), before);
  const result = w.api.ownerConfirmPayment(quote.token, state.version);
  assert.equal(result.paidCount, 1);
  assert.equal(w.readValue(w.cells('Статьи оплаты')[10][10]), 'Выплачено');
  assert.equal(w.readValue(w.cells('Статьи оплаты')[11][10]), 'К оплате');
  assert.throws(() => w.api.ownerConfirmPayment(quote.token, state.version), /Сначала/);
  w.select('PAY-ED36BAC4', false);
  assert.equal(w.readValue(w.cells('Интерфейс собственника')[16][7]), true);
  assert.equal(w.api.ownerGetState().summary.selectedCount, 0);
});

test('две выплаты записываются одним атомарным batch, чужие поля и validation сохраняются', () => {
  const w = workbook(), state = w.api.ownerGetState();
  const source = structuredClone(w.cells('Статьи оплаты'));
  w.select('PAY-ED36BAC4'); w.select('PAY-8D4056C3');
  const quote = w.api.ownerPreviewPayment(state.version);
  assert.equal(quote.amount, 165000);
  const result = w.api.ownerConfirmPayment(quote.token, state.version);
  assert.equal(result.paidCount, 2);
  const sourceBatches = w.calls.filter(reqs => reqs.some(r => r.updateCells?.range.sheetId === w.meta['Статьи оплаты'].id));
  assert.equal(sourceBatches.length, 1); assert.equal(sourceBatches[0].length, 8);
  w.cells('Статьи оплаты').forEach((row, ri) => row.forEach((cell, ci) => {
    if ([10, 11].includes(ri) && [10, 11, 12, 17].includes(ci)) {
      assert.deepEqual(cell.format, source[ri][ci].format); assert.deepEqual(cell.validation, source[ri][ci].validation);
    } else assert.deepEqual(cell, source[ri][ci]);
  }));
  assert.equal(result.state.summary.paid, 185000);
});

test('одна невалидная выбранная статья отменяет всю группу без частичных записей', () => {
  const w = workbook(), state = w.api.ownerGetState(), before = payments(w);
  w.select('PAY-ED36BAC4'); w.select('PA-003');
  assert.throws(() => w.api.ownerPreviewPayment(state.version), /не может быть оплачена/);
  assert.equal(payments(w), before);
});

for (const [name, change] of [
  ['сумма', w => w.value('Статьи оплаты', 11, 9, 1)],
  ['статус', w => w.value('Статьи оплаты', 11, 11, 'Выплачено')],
  ['выбор', w => w.select('PAY-8D4056C3')],
  ['выдача', w => w.api.ownerApplyFilters({ employee: 'EMP_001' })]
]) test('изменение после preview: ' + name + ' блокирует подтверждение', () => {
  const w = workbook(), state = w.api.ownerGetState(); w.select('PAY-ED36BAC4');
  const quote = w.api.ownerPreviewPayment(state.version); change(w); const before = payments(w);
  assert.throws(() => w.api.ownerConfirmPayment(quote.token, state.version)); assert.equal(payments(w), before);
});

test('ошибка Sheets API не оставляет частичную выплату', () => {
  const w = workbook(), state = w.api.ownerGetState(); w.select('PAY-ED36BAC4'); w.select('PAY-8D4056C3');
  const quote = w.api.ownerPreviewPayment(state.version), before = payments(w);
  w.failNextBatch(); assert.throws(() => w.api.ownerConfirmPayment(quote.token, state.version), /Atomic API failure/);
  assert.equal(payments(w), before);
});

test('фильтры не перемещают неизвестные столбцы или validation относительно ID', () => {
  const w = workbook(); w.api.ownerGetState();
  w.value('Интерфейс собственника', 10, 11, 'Личная заметка');
  w.value('Интерфейс собственника', 17, 11, 'Не перемещать');
  w.cells('Интерфейс собственника')[16][10].validation = { condition: { type: 'ONE_OF_LIST', values: [{ userEnteredValue: 'Не перемещать' }] } };
  const cell = structuredClone(w.cells('Интерфейс собственника')[16][10]);
  const state = w.api.ownerApplyFilters({ employee: 'EMP_002' });
  assert.equal(state.summary.count, 1);
  assert.equal(w.hidden['Интерфейс собственника'][17], true);
  assert.equal(w.hidden['Интерфейс собственника'][18], false);
  assert.deepEqual(w.cells('Интерфейс собственника')[16][10], cell);
  w.select('PAY-ED36BAC4'); // hidden checkbox is never part of the current issue
  assert.equal(w.api.ownerGetState().summary.selectedCount, 0);
  w.api.ownerApplyFilters({});
  assert.deepEqual(w.cells('Интерфейс собственника')[16][10], cell);
});

test('пустой результат сохраняет источник и возвращает нулевые показатели', () => {
  const w = workbook(), before = payments(w), state = w.api.ownerApplyFilters({ employee: 'missing' });
  assert.deepEqual(plain(state.summary), { planned: 0, toPay: 0, paid: 0, total: 0, selectedCount: 0, selectedAmount: 0, count: 0 });
  assert.equal(payments(w), before);
});

test('dailySync сохраняет PAID после подтверждения и остаётся идемпотентным', () => {
  const w = workbook(); w.api.dailySync();
  const state = w.api.ownerGetState(); w.select('PAY-ED36BAC4');
  const quote = w.api.ownerPreviewPayment(state.version); w.api.ownerConfirmPayment(quote.token, state.version);
  const before = payments(w);
  assert.equal(w.api.dailySync().written, 0); assert.equal(w.api.dailySync().written, 0);
  assert.equal(payments(w), before);
});

test('dailySync удаляет прежние нулевые неоплаченные статьи, сохраняет PAID и после исправления идемпотентен', () => {
  const w = workbook(), dealId = '32225537';
  w.cells('Выгрузка сделок')[4][20].note = 'Комментарий пользователя';
  w.value('Выгрузка сделок', 5, 8, 1);
  const rejected = w.api.dailySync();
  assert.equal(rejected.skipped, 1);
  assert.equal(rejected.written, 3);
  const afterReject = w.cells('Статьи оплаты').filter(row => String(w.readValue(row?.[1])) === dealId);
  assert.equal(afterReject.length, 1);
  assert.equal(w.readValue(afterReject[0][10]), 'Выплачено');
  const note = w.cells('Выгрузка сделок')[4][20].note;
  assert.match(note, /^Комментарий пользователя/);
  assert.equal((note.match(/--- Расчёт зарплаты: начало ---/g) || []).length, 1);
  const sidebar = w.api.ownerGetState();
  assert.equal(sidebar.skippedDeals.length, 1);
  assert.equal(sidebar.skippedDeals[0].dealId, dealId);

  w.value('Выгрузка сделок', 5, 8, 200000);
  const corrected = w.api.dailySync();
  assert.equal(corrected.skipped, 0);
  assert.equal(corrected.written, 2);
  assert.equal(w.cells('Выгрузка сделок')[4][20].note, 'Комментарий пользователя');
  const current = w.cells('Статьи оплаты').filter(row => String(w.readValue(row?.[1])) === dealId);
  assert.equal(current.length, 3);
  assert.ok(current.every(row => Number(w.readValue(row[8])) > 0));
  const beforeRepeat = payments(w);
  assert.equal(w.api.dailySync().written, 0);
  assert.equal(payments(w), beforeRepeat);
});

test('меню и sidebar принадлежат привязанному проекту и не создают триггеры', () => {
  const w = workbook(), events = [];
  w.api.SpreadsheetApp.getUi = () => ({ createMenu: name => ({ addItem(label, handler) { events.push([name, label, handler]); return this; }, addToUi() {} }), showSidebar: html => events.push(html) });
  w.api.HtmlService = { createHtmlOutputFromFile: name => ({ setTitle: title => ({ name, title }) }) };
  w.api.onOpen(); w.api.openPayrollSidebar();
  assert.deepEqual(plain(events), [['Зарплаты', 'Открыть интерфейс', 'openPayrollSidebar'], { name: 'Sidebar', title: 'Зарплаты' }]);
});

test('ручное изменение суммы в представлении не может подменить платёж', () => {
  const w = workbook(), state = w.api.ownerGetState(); w.select('PAY-ED36BAC4');
  w.value('Интерфейс собственника', 17, 6, 1);
  const before = payments(w);
  assert.throws(() => w.api.ownerPreviewPayment(state.version), /изменены вручную/);
  assert.equal(payments(w), before);
});

test('формула в записываемом поле источника отменяет всю выплату', () => {
  const w = workbook();
  const cell = w.cells('Статьи оплаты')[11][17];
  cell.value = { formulaValue: '="2026-09-06"' }; cell.effective = { stringValue: '2026-09-06' };
  const state = w.api.ownerGetState(); w.select('PAY-ED36BAC4'); w.select('PAY-8D4056C3');
  const quote = w.api.ownerPreviewPayment(state.version), before = payments(w);
  assert.throws(() => w.api.ownerConfirmPayment(quote.token, state.version), /содержит формулу/);
  assert.equal(payments(w), before);
});
