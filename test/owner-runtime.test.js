const test = require('node:test');
const assert = require('node:assert/strict');
const workbook = require('./helpers/owner-workbook');
const payments = w => JSON.stringify(w.cells('Статьи оплаты'));
const plain = v => JSON.parse(JSON.stringify(v));
const cell = (w, row, column) => w.readValue(w.cells('Интерфейс собственника')[row - 1]?.[column - 1]);
const formula = (w, row, column) => w.cells('Интерфейс собственника')[row - 1]?.[column - 1]?.value?.formulaValue || '';

test('сводка использует новые семь координат и очищает только прежние служебные ячейки', () => {
  const w = workbook(), state = w.api.ownerGetState();
  assert.deepEqual([
    cell(w, 5, 2), cell(w, 5, 3), cell(w, 5, 4), cell(w, 5, 5),
    cell(w, 5, 7)
  ], [state.summary.planned, state.summary.toPay, state.summary.paid, state.summary.total, state.summary.count]);
  assert.equal(formula(w, 5, 8), '=COUNTIFS(H11:H,TRUE,G11:G,"К оплате")');
  assert.equal(formula(w, 5, 9), '=SUMIFS(F11:F,H11:H,TRUE,G11:G,"К оплате")');
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

test('onEdit не пишет H5:I5, поддерживает диапазон и не читает источники', () => {
  const w = workbook(); w.api.ownerGetState();
  const rows = w.cells('Интерфейс собственника');
  const indexes = ['К оплате', 'Запланировано', 'Выплачено'].map(status => rows.findIndex(row => w.readValue(row?.[6]) === status));
  const cancelled = rows.findIndex((row, index) => index >= 10 && !indexes.includes(index) && w.readValue(row?.[0]));
  indexes.splice(2, 0, cancelled);
  assert.ok(indexes.every(index => index >= 10));
  w.value('Интерфейс собственника', indexes[2] + 1, 7, 'Отменено');
  w.value('Интерфейс собственника', indexes[0] + 1, 8, true);
  w.value('Интерфейс собственника', indexes[1] + 1, 8, true);
  w.value('Интерфейс собственника', indexes[2] + 1, 8, true);
  w.value('Интерфейс собственника', indexes[3] + 1, 8, false);
  const formulas = [formula(w, 5, 8), formula(w, 5, 9)];
  const source = payments(w); let reads = 0; const read = w.api.readPayrollWorkbook;
  w.api.readPayrollWorkbook = ss => { reads += 1; return read(ss); };
  const first = Math.min(...indexes) + 1, last = Math.max(...indexes) + 1;
  w.api.onEdit({ range: w.range('Интерфейс собственника', first, 8, last - first + 1, 1) });
  assert.equal(reads, 0); assert.equal(payments(w), source);
  assert.deepEqual([formula(w, 5, 8), formula(w, 5, 9)], formulas);
  assert.equal(cell(w, indexes[0] + 1, 8), true, 'К оплате разрешено выбрать');
  assert.equal(cell(w, indexes[1] + 1, 8), false, 'Запланировано нельзя выбрать');
  assert.equal(cell(w, indexes[2] + 1, 8), false, 'Отменено нельзя выбрать');
  assert.equal(cell(w, indexes[3] + 1, 8), true, 'Выплачено восстанавливается');
});

for (const ids of [['PAY-ED36BAC4'], ['PAY-ED36BAC4', 'PAY-8D4056C3']]) {
  test('после оплаты интерфейс актуален при устаревшем чтении SpreadsheetApp: ' + ids.length + ' статьи', () => {
    const w = workbook(), state = w.api.ownerGetState();
    ids.forEach(id => w.select(id));
    const expectedAmount = ids.length === 1 ? 90000 : 165000;
    // Reproduce the live read-after-write cache: API writes commit, but reads
    // through SpreadsheetApp still return the pre-payment workbook this execution.
    const read = w.api.readPayrollWorkbook;
    let cached;
    w.api.readPayrollWorkbook = ss => cached || (cached = read(ss));
    let result;
    try { result = w.api.ownerConfirmPayment(state.version); }
    finally { w.api.readPayrollWorkbook = read; }
    assert.equal(result.warning, undefined);
    assert.equal(result.state.summary.paid, state.summary.paid + expectedAmount);
    assert.equal(result.state.summary.toPay, state.summary.toPay - expectedAmount);
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
    assert.throws(() => w.api.ownerConfirmPayment(result.state.version), /Не выбраны статьи со статусом “К оплате”/);
    assert.equal(payments(w), source);
  });
}

test('реальные адаптеры: checkbox не меняет источник, одна серверная операция платит по ID', () => {
  const w = workbook(), state = w.api.ownerGetState();
  const before = payments(w);
  w.select('PAY-ED36BAC4');
  assert.equal(payments(w), before);
  assert.equal(w.api.ownerGetState().summary.selectedAmount, 90000);
  const result = w.api.ownerConfirmPayment(state.version);
  assert.equal(result.paidCount, 1);
  assert.equal(result.amount, 90000);
  assert.equal(w.readValue(w.cells('Статьи оплаты')[10][10]), 'Выплачено');
  assert.equal(w.readValue(w.cells('Статьи оплаты')[11][10]), 'К оплате');
  assert.throws(() => w.api.ownerConfirmPayment(result.state.version), /Не выбраны статьи со статусом “К оплате”/);
  w.select('PAY-ED36BAC4', false);
  const paid = w.cells('Интерфейс собственника').find(r => w.readValue(r?.[0]) === 'PAY-ED36BAC4');
  assert.equal(w.readValue(paid[7]), true);
  assert.equal(w.api.ownerGetState().summary.selectedCount, 0);
});

test('две выплаты записываются одним атомарным batch, чужие поля и validation сохраняются', () => {
  const w = workbook(), state = w.api.ownerGetState();
  const source = structuredClone(w.cells('Статьи оплаты'));
  w.select('PAY-ED36BAC4'); w.select('PAY-8D4056C3');
  const result = w.api.ownerConfirmPayment(state.version);
  assert.equal(result.paidCount, 2);
  assert.equal(result.amount, 165000);
  const sourceBatches = w.calls.filter(reqs => reqs.some(r => r.updateCells?.range.sheetId === w.meta['Статьи оплаты'].id));
  assert.equal(sourceBatches.length, 1); assert.equal(sourceBatches[0].length, 8);
  w.cells('Статьи оплаты').forEach((row, ri) => row.forEach((cell, ci) => {
    if ([10, 11].includes(ri) && [10, 11, 12, 17].includes(ci)) {
      assert.deepEqual(cell.format, source[ri][ci].format); assert.deepEqual(cell.validation, source[ri][ci].validation);
    } else assert.deepEqual(cell, source[ri][ci]);
  }));
  assert.equal(result.state.summary.paid, 185000);
  assert.equal(formula(w, 5, 8), '=COUNTIFS(H11:H,TRUE,G11:G,"К оплате")');
  assert.equal(formula(w, 5, 9), '=SUMIFS(F11:F,H11:H,TRUE,G11:G,"К оплате")');
});

test('одна невалидная выбранная статья отменяет всю группу без частичных записей', () => {
  const w = workbook(), state = w.api.ownerGetState(), before = payments(w);
  w.select('PAY-ED36BAC4');
  const invalid = w.cells('Интерфейс собственника').findIndex(row => w.readValue(row?.[0]) === 'PA-003');
  w.value('Интерфейс собственника', invalid + 1, 8, true); // имитируем обход onEdit внешней записью
  assert.throws(() => w.api.ownerConfirmPayment(state.version), /не может быть оплачена/);
  assert.equal(payments(w), before);
});

test('выбранный ID вне текущей выдачи не отбрасывается молча и отменяет выплату', () => {
  const w = workbook(), state = w.api.ownerApplyFilters({ employee: 'EMP_002' }), before = payments(w);
  const row = w.cells('Интерфейс собственника').findIndex((item, index) => index >= 10 && w.readValue(item?.[0])) + 1;
  w.value('Интерфейс собственника', row, 1, 'PAY-ED36BAC4');
  w.value('Интерфейс собственника', row, 8, true);
  assert.throws(() => w.api.ownerConfirmPayment(state.version), /Статья отсутствует в текущей выдаче/);
  assert.equal(payments(w), before);
});

for (const [name, change] of [
  ['сумма', w => w.value('Статьи оплаты', 11, 9, 1)],
  ['статус', w => w.value('Статьи оплаты', 11, 11, 'Выплачено')]
]) test('изменение источника после формирования выдачи: ' + name + ' блокирует выплату', () => {
  const w = workbook(), state = w.api.ownerGetState(); w.select('PAY-ED36BAC4');
  change(w); const before = payments(w);
  assert.throws(() => w.api.ownerConfirmPayment(state.version), /Исходные статьи изменились/); assert.equal(payments(w), before);
});

test('устаревшая версия компактной выдачи блокирует выплату', () => {
  const w = workbook(), state = w.api.ownerGetState(); w.select('PAY-ED36BAC4');
  w.api.ownerApplyFilters({ employee: 'EMP_001' });
  const before = payments(w);
  assert.throws(() => w.api.ownerConfirmPayment(state.version), /Выдача изменена в другом окне/);
  assert.equal(payments(w), before);
});

test('отсутствие выбора отклоняется без записи', () => {
  const w = workbook(), state = w.api.ownerGetState(), before = payments(w), calls = w.calls.length;
  assert.throws(() => w.api.ownerConfirmPayment(state.version), /Не выбраны статьи со статусом “К оплате”/);
  assert.equal(payments(w), before);
  assert.equal(w.calls.length, calls, 'batchUpdate не вызывается');
});

test('ошибка Sheets API не оставляет частичную выплату', () => {
  const w = workbook(), state = w.api.ownerGetState(); w.select('PAY-ED36BAC4'); w.select('PAY-8D4056C3');
  const before = payments(w);
  w.failNextBatch(); assert.throws(() => w.api.ownerConfirmPayment(state.version), /Atomic API failure/);
  assert.equal(payments(w), before);
});

test('фильтр создаёт компактную выдачу, очищает остатки и сохраняет области вне A:J', () => {
  const w = workbook(), source = payments(w); w.api.ownerGetState();
  const initialCount = cell(w, 5, 7);
  assert.ok(initialCount > 1);
  w.value('Интерфейс собственника', 10, 11, 'Личная заметка');
  w.value('Интерфейс собственника', 11, 11, 'Не очищать');
  w.cells('Интерфейс собственника')[10][10].validation = { condition: { type: 'ONE_OF_LIST', values: [{ userEnteredValue: 'Не очищать' }] } };
  const personal = structuredClone(w.cells('Интерфейс собственника')[10][10]);
  const state = w.api.ownerApplyFilters({ employee: 'EMP_002' });
  assert.equal(state.summary.count, 1);
  assert.equal(cell(w, 5, 7), 1);
  assert.notEqual(cell(w, 11, 1), '');
  for (let row = 12; row <= 10 + initialCount; row += 1) for (let column = 1; column <= 10; column += 1) {
    assert.equal(cell(w, row, column), '');
    assert.equal(w.cells('Интерфейс собственника')[row - 1]?.[column - 1]?.validation, undefined);
  }
  assert.deepEqual(w.cells('Интерфейс собственника')[10][10], personal);
  assert.equal(cell(w, 10, 11), 'Личная заметка');
  assert.ok(!Object.values(w.hidden['Интерфейс собственника']).some(Boolean), 'выдача не должна использовать скрытие строк');
  assert.equal(payments(w), source, 'фильтрация не меняет Статьи оплаты');
  assert.equal(formula(w, 5, 8), '=COUNTIFS(H11:H,TRUE,G11:G,"К оплате")');
  assert.equal(formula(w, 5, 9), '=SUMIFS(F11:F,H11:H,TRUE,G11:G,"К оплате")');
  assert.equal(w.cells('Интерфейс собственника')[10][7].validation.condition.type, 'BOOLEAN');
  assert.deepEqual(w.cells('Интерфейс собственника')[10][5].format.numberFormat, { type: 'NUMBER', pattern: '#,##0.00 "₽"' });
  assert.equal(cell(w, 11, 8), cell(w, 11, 7) === 'Выплачено');
});

test('данные в K и далее не расширяют очистку и раскрытие управляемой выдачи', () => {
  const w = workbook();
  w.value('Интерфейс собственника', 200, 11, 'Пользовательские данные');
  w.cells('Интерфейс собственника')[199][10].format = { backgroundColor: { red: 1 } };
  w.hidden['Интерфейс собственника'][200] = true;
  const personal = structuredClone(w.cells('Интерфейс собственника')[199][10]);
  const state = w.api.ownerGetState(), batch = w.calls.at(-1);
  const clear = batch.find(request => request.updateCells?.fields.includes('dataValidation'));
  const reveal = batch.find(request => request.updateDimensionProperties);
  assert.equal(clear.updateCells.range.endRowIndex, 10 + state.summary.count);
  assert.equal(reveal.updateDimensionProperties.range.endIndex, 10 + state.summary.count);
  assert.equal(reveal.updateDimensionProperties.properties.hiddenByUser, false);
  assert.deepEqual(w.cells('Интерфейс собственника')[199][10], personal);
  assert.equal(w.hidden['Интерфейс собственника'][200], true);
});

test('прежняя выдача раскрывается внутри единого batchUpdate и не затрагивает другие строки', () => {
  const w = workbook(), initial = w.api.ownerGetState(), previousLast = 10 + initial.summary.count;
  w.hidden['Интерфейс собственника'][previousLast] = true;
  w.hidden['Интерфейс собственника'][previousLast + 20] = true;
  const calls = w.calls.length;
  const state = w.api.ownerApplyFilters({ employee: 'EMP_002' });
  assert.equal(state.summary.count, 1);
  assert.equal(w.calls.length, calls + 1);
  const batch = w.calls.at(-1), reveal = batch.find(request => request.updateDimensionProperties);
  assert.equal(reveal.updateDimensionProperties.range.startIndex, 10);
  assert.equal(reveal.updateDimensionProperties.range.endIndex, previousLast);
  assert.equal(w.hidden['Интерфейс собственника'][previousLast], false);
  assert.equal(w.hidden['Интерфейс собственника'][previousLast + 20], true);
});

test('ошибка batchUpdate не оставляет отдельно применённого раскрытия строк', () => {
  const w = workbook(); w.api.ownerGetState();
  w.hidden['Интерфейс собственника'][11] = true;
  const before = structuredClone(w.cells('Интерфейс собственника'));
  w.failNextBatch();
  assert.throws(() => w.api.ownerApplyFilters({ employee: 'EMP_002' }), /Atomic API failure/);
  assert.equal(w.hidden['Интерфейс собственника'][11], true);
  assert.deepEqual(w.cells('Интерфейс собственника'), before);
});

test('пустой результат сохраняет источник и возвращает нулевые показатели', () => {
  const w = workbook(), before = payments(w), state = w.api.ownerApplyFilters({ employee: 'missing' });
  assert.deepEqual(plain(state.summary), { planned: 0, toPay: 0, paid: 0, total: 0, selectedCount: 0, selectedAmount: 0, count: 0 });
  assert.equal(payments(w), before);
});

test('dailySync сохраняет PAID после подтверждения и остаётся идемпотентным', () => {
  const w = workbook(); w.api.dailySync();
  const state = w.api.ownerGetState(); w.select('PAY-ED36BAC4');
  w.api.ownerConfirmPayment(state.version);
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
  assert.ok(sidebar.skippedDeals[0].objectId);
  assert.ok(sidebar.skippedDeals[0].address);
  assert.ok(sidebar.skippedDeals[0].actions.length);
  sidebar.skippedDeals[0].actions.forEach(group => {
    assert.match(group.action, /^(Заполнить|Исправить|Указать|Добавить в справочник|Проверить)$/);
    assert.ok(group.items.length);
  });
  assert.equal(Object.hasOwn(sidebar.skippedDeals[0], 'reasons'), false);
  assert.equal(Object.hasOwn(sidebar.skippedDeals[0], 'articles'), false);

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

test('одна причина преобразуется в одну пользовательскую группу', () => {
  const w = workbook();
  const diagnostics = w.api.ownerUserDiagnostics_({
    deals: { D1: { objectId: 'OBJ-1', objectName: 'Тестовый адрес' } },
    skippedDeals: [{
      dealId: 'D1', dealName: 'Техническое имя', projectCost: 100000,
      articles: [{ name: 'Акт 1', amount: 0 }],
      reasons: ['ФИО «Неизвестный» отсутствует в действующем справочнике сотрудников']
    }]
  });
  assert.deepEqual(plain(diagnostics), [{
    objectId: 'OBJ-1', address: 'Тестовый адрес', projectCost: 100000,
    actions: [{ action: 'Добавить в справочник', items: ['сотрудника'] }]
  }]);
  assert.equal(Object.hasOwn(diagnostics[0], 'reasons'), false);
  assert.equal(Object.hasOwn(diagnostics[0], 'articles'), false);
});

test('две причины с одинаковым действием объединяются без дублей', () => {
  const w = workbook();
  const [diagnostic] = w.api.ownerUserDiagnostics_({
    deals: {},
    skippedDeals: [{ dealId: 'D1', projectCost: 1, reasons: [
      'Не заполнен инженер', 'Пустое поле визуализатор', 'Не заполнен инженер'
    ] }]
  });
  assert.deepEqual(plain(diagnostic.actions), [{ action: 'Заполнить', items: ['инженера', 'визуализатора'] }]);
});

test('разнотипные причины возвращаются отдельными группами действий', () => {
  const w = workbook();
  const [diagnostic] = w.api.ownerUserDiagnostics_({
    deals: {},
    skippedDeals: [{ dealId: 'D1', projectCost: 1, reasons: [
      'ФИО отсутствует в действующем справочнике сотрудников',
      'Некорректная стоимость проекта',
      'Некорректная стоимость проекта'
    ] }]
  });
  assert.deepEqual(plain(diagnostic.actions), [
    { action: 'Добавить в справочник', items: ['сотрудника'] },
    { action: 'Исправить', items: ['стоимость проекта'] }
  ]);
  assert.equal(Object.hasOwn(diagnostic, 'reasons'), false);
  assert.equal(Object.hasOwn(diagnostic, 'articles'), false);
});

test('меню и sidebar принадлежат привязанному проекту и не создают триггеры', () => {
  const w = workbook(), events = [];
  w.api.SpreadsheetApp.getUi = () => ({ createMenu: name => ({ addItem(label, handler) { events.push([name, label, handler]); return this; }, addToUi() {} }), showSidebar: html => events.push(html) });
  w.api.HtmlService = { createHtmlOutputFromFile: name => ({ setTitle: title => ({ name, title }) }) };
  w.api.onOpen(); w.api.openPayrollSidebar();
  assert.deepEqual(plain(events), [['Зарплаты', 'Открыть интерфейс', 'openPayrollSidebar'], { name: 'Sidebar', title: 'Зарплаты' }]);
});

for (const [name, column, value] of [['суммы', 6, 1], ['статуса', 7, 'Запланировано'], ['сотрудника', 4, 'Другой сотрудник']]) {
  test('ручное изменение ' + name + ' в представлении не может подменить платёж', () => {
    const w = workbook(), state = w.api.ownerGetState(); w.select('PAY-ED36BAC4');
    const row = w.cells('Интерфейс собственника').findIndex(item => w.readValue(item?.[0]) === 'PAY-ED36BAC4') + 1;
    w.value('Интерфейс собственника', row, column, value);
    const before = payments(w);
    assert.throws(() => w.api.ownerConfirmPayment(state.version), /изменены вручную/);
    assert.equal(payments(w), before);
  });
}

test('формула в записываемом поле источника отменяет всю выплату', () => {
  const w = workbook();
  const cell = w.cells('Статьи оплаты')[11][17];
  cell.value = { formulaValue: '="2026-09-06"' }; cell.effective = { stringValue: '2026-09-06' };
  const state = w.api.ownerGetState(); w.select('PAY-ED36BAC4'); w.select('PAY-8D4056C3');
  const before = payments(w);
  assert.throws(() => w.api.ownerConfirmPayment(state.version), /содержит формулу/);
  assert.equal(payments(w), before);
});
