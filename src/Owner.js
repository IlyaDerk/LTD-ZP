/* exported onOpen, onEdit, openPayrollSidebar, ownerApplyFilters, ownerGetState, ownerConfirmPayment */
var OWNER_HEADERS_ = ['ID статьи', 'Дата готовности', 'Объект', 'Сотрудник', 'Статья', 'Сумма', 'Статус', 'Выбрать', 'Дата выплаты', 'Комментарий'];
var OWNER_HEADER_ROW_ = 10;
var OWNER_SELECTED_COUNT_FORMULA_ = '=COUNTIFS(H11:H,TRUE,G11:G,"К оплате")';
var OWNER_SELECTED_AMOUNT_FORMULA_ = '=SUMIFS(F11:F,H11:H,TRUE,G11:G,"К оплате")';

function onOpen() {
  getPayrollSpreadsheet_();
  SpreadsheetApp.getUi().createMenu('Зарплаты').addItem('Открыть интерфейс', 'openPayrollSidebar').addToUi();
}

function openPayrollSidebar() {
  getPayrollSpreadsheet_();
  SpreadsheetApp.getUi().showSidebar(HtmlService.createHtmlOutputFromFile('Sidebar').setTitle('Зарплаты'));
}

function ownerHash_(value) {
  return Utilities.base64EncodeWebSafe(Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, value, Utilities.Charset.UTF_8));
}

function ownerSource_(ss) {
  var input = readPayrollWorkbook(ss), employees = Object.create(null), deals = Object.create(null);
  input.employees.forEach(function (e) { employees[e.id] = e.name; });
  input.deals.forEach(function (d) { if (d.id) deals[String(d.id)] = d; });
  var types = tableFromSheet(ss.getSheetByName(PAYROLL_CONFIG.sheets.articleTypes), ['Код статьи', 'Название для собственника']);
  var names = Object.create(null);
  types.rows.forEach(function (r) { names[r['Код статьи']] = r['Название для собственника']; });
  var rows = input.existing.filter(function (r) { return !!r.id; }).map(function (r) {
    var d = deals[r.dealId] || {};
    return Object.assign({}, r, {
      id: String(r.id), employeeId: String(r.employeeId),
      employee: employees[r.employeeId] || String(r.employeeId) + ' (нет в справочнике)',
      objectKey: String(d.objectId || r.dealId), object: d.objectName || 'Сделка ' + r.dealId,
      article: names[r.articleCode] || r.articleCode, status: displayStatus(r.status),
      updatedAt: r.updatedAt instanceof Date ? r.updatedAt.toISOString() : String(r.updatedAt || '')
    });
  });
  // Do not silently discard malformed source rows with an amount but without ID.
  if (input.existing.some(function (r) { return !r.id && (r.dealId || r.amount); })) throw new Error('В источнике есть статья без ID');
  PayrollOwnerCore.unique(rows);
  return { table: input.paymentTable, rows: rows, skippedDeals: input.skippedDeals || [], deals: deals };
}

function ownerDiagnosticItem_(reason) {
  var text = String(reason || '').toLowerCase();
  if (/id сделки|id объекта/.test(text)) return 'ID объекта';
  if (/стоимост/.test(text)) return 'стоимость проекта';
  if (/визуализатор/.test(text)) return 'визуализатора';
  if (/инженер/.test(text)) return 'инженера';
  if (/исполнител|сотрудник|фио/.test(text)) return 'сотрудника';
  if (/метраж/.test(text)) return 'метраж';
  if (/модел.*мотивац/.test(text)) return 'модель мотивации';
  if (/грейд/.test(text)) return 'грейд сотрудника';
  if (/ставк/.test(text)) return 'ставку';
  if (/акт|дат/.test(text)) return 'даты актов';
  if (/правил|начислен|стат/.test(text)) return 'правило расчёта';
  return 'данные сделки';
}

function ownerDiagnosticAction_(reason) {
  var text = String(reason || '').toLowerCase();
  if (/справочник/.test(text)) return 'Добавить в справочник';
  if (/не заполн|пуст/.test(text)) return 'Заполнить';
  if (/не указан|отсутствует/.test(text)) return 'Указать';
  if (/некоррект|положительн|нулев|отрицател|нечислов/.test(text)) return 'Исправить';
  return 'Проверить';
}

function ownerUserDiagnostics_(source) {
  return (source.skippedDeals || []).map(function (diagnostic) {
    var reasons = diagnostic.reasons || [], actions = [], byAction = Object.create(null);
    reasons.forEach(function (reason) {
      var action = ownerDiagnosticAction_(reason), item = ownerDiagnosticItem_(reason), group = byAction[action];
      if (!group) {
        group = { action: action, items: [] };
        byAction[action] = group;
        actions.push(group);
      }
      if (group.items.indexOf(item) < 0) group.items.push(item);
    });
    if (!actions.length) actions.push({ action: 'Проверить', items: ['данные сделки'] });
    var deal = (source.deals || {})[String(diagnostic.dealId)] || {};
    return {
      objectId: String(deal.objectId || diagnostic.dealId || 'ID не указан'),
      address: String(deal.objectName || diagnostic.dealName || 'Адрес не указан'),
      projectCost: diagnostic.projectCost,
      actions: actions
    };
  });
}

function ownerCell_(sheetId, row, column, value) {
  var v = {};
  if (value !== '' && value != null) v.userEnteredValue = { [typeof value === 'number' ? 'numberValue' : typeof value === 'boolean' ? 'boolValue' : 'stringValue']: value };
  return { updateCells: { range: { sheetId: sheetId, startRowIndex: row - 1, endRowIndex: row, startColumnIndex: column - 1, endColumnIndex: column }, rows: [{ values: [v] }], fields: 'userEnteredValue' } };
}

function ownerFormulaCell_(sheetId, row, column, formula) {
  return { updateCells: { range: { sheetId: sheetId, startRowIndex: row - 1, endRowIndex: row, startColumnIndex: column - 1, endColumnIndex: column }, rows: [{ values: [{ userEnteredValue: { formulaValue: formula } }] }], fields: 'userEnteredValue' } };
}

function ownerLayoutValues_(sheet, values, formulas, includeHeaders) {
  var entries = [
    [1, 2, 'Зарплаты — интерфейс собственника'],
    [2, 2, 'Флажок только выбирает статью. Оплата — после подтверждения в sidebar.'],
    [3, 2, 'Сводная зарплат'],
    [4, 2, 'Запланировано'], [4, 3, 'К оплате'], [4, 4, 'Выплачено'], [4, 5, 'Итого'],
    [4, 7, 'Найдено статей'], [4, 8, 'Выбрано статей'], [4, 9, 'Сумма выбранных'],
    [6, 2, ''], [7, 2, ''], [6, 4, ''], [7, 4, ''], [8, 2, '']
  ];
  if (includeHeaders) OWNER_HEADERS_.forEach(function (header, index) { entries.push([OWNER_HEADER_ROW_, index + 1, header]); });
  var requests = entries.filter(function (entry) {
    return !values[entry[0] - 1] || values[entry[0] - 1][entry[1] - 1] !== entry[2];
  }).map(function (entry) { return ownerCell_(sheet.getSheetId(), entry[0], entry[1], entry[2]); });
  if (!formulas[4] || formulas[4][7] !== OWNER_SELECTED_COUNT_FORMULA_) requests.push(ownerFormulaCell_(sheet.getSheetId(), 5, 8, OWNER_SELECTED_COUNT_FORMULA_));
  if (!formulas[4] || formulas[4][8] !== OWNER_SELECTED_AMOUNT_FORMULA_) requests.push(ownerFormulaCell_(sheet.getSheetId(), 5, 9, OWNER_SELECTED_AMOUNT_FORMULA_));
  return requests;
}

function ownerFormatLayout_(sheet) {
  var dark = '#415a77', light = '#fff2cc', header = '#e8edf3';
  sheet.getRange(1, 2).setFontSize(16).setFontWeight('bold');
  sheet.getRange(3, 2).setBackground(dark).setFontColor('#ffffff').setFontSize(12).setFontWeight('bold').setHorizontalAlignment('left');
  [sheet.getRange(4, 2, 1, 4), sheet.getRange(4, 7, 1, 3)].forEach(function (range) {
    range.setBackground(dark).setFontColor('#ffffff').setFontSize(12).setFontWeight('bold').setHorizontalAlignment('left').setWrap(false);
  });
  [sheet.getRange(5, 2, 1, 4), sheet.getRange(5, 7, 1, 3)].forEach(function (range) {
    range.setBackground(light).setFontSize(12).setFontWeight('bold').setHorizontalAlignment('center').setVerticalAlignment('middle').setWrap(false);
  });
  sheet.getRange(5, 2, 1, 4).setNumberFormat('#,##0" ₽"');
  sheet.getRange(5, 7, 1, 2).setNumberFormat('#,##0');
  sheet.getRange(5, 9).setNumberFormat('#,##0" ₽"');
  sheet.getRange(OWNER_HEADER_ROW_, 1, 1, 10).setBackground(header).setFontWeight('bold').setWrap(true);
  sheet.setColumnWidths(2, 1, 164); sheet.setColumnWidths(3, 3, 220);
  sheet.setColumnWidth(6, 130); sheet.setColumnWidth(7, 145); sheet.setColumnWidth(8, 125);
  sheet.setColumnWidth(9, 168); sheet.setColumnWidth(10, 240);
  sheet.setFrozenRows(OWNER_HEADER_ROW_); sheet.hideColumns(1);
}

function ownerLayout_(ss) {
  var sheet = ss.getSheetByName(PAYROLL_CONFIG.sheets.owner);
  if (!sheet) throw new Error('Не найден лист «Интерфейс собственника»');
  var data = sheet.getDataRange(), values = data.getValues(), formulas = data.getFormulas();
  var initialized = values[OWNER_HEADER_ROW_ - 1] && OWNER_HEADERS_.every(function (h, i) { return values[OWNER_HEADER_ROW_ - 1][i] === h; });
  if (!initialized) {
    if (values.some(function (r) { return r.slice(0, 10).some(function (v) { return v !== ''; }); })) throw new Error('В области A:J интерфейса есть неизвестная структура. Она не была перезаписана.');
  }
  var requests = ownerLayoutValues_(sheet, values, formulas, !initialized);
  if (requests.length) Sheets.Spreadsheets.batchUpdate({ requests: requests }, ss.getId());
  ownerFormatLayout_(sheet);
  return sheet;
}

function ownerViewRows_(sheet) {
  var t = tableFromSheet(sheet, OWNER_HEADERS_);
  return t.rows.filter(function (r) { return !!r['ID статьи']; }).map(function (r) {
    return { id: String(r['ID статьи']), selected: r['Выбрать'] === true, status: String(r['Статус']), _row: r._row, _values: r._values, _formulas: r._formulas };
  });
}

function ownerSummaryRequests_(sheet, summary) {
  var entries = [[5, 2, summary.planned], [5, 3, summary.toPay], [5, 4, summary.paid], [5, 5, summary.total], [5, 7, summary.count]];
  return entries.map(function (x) { return ownerCell_(sheet.getSheetId(), x[0], x[1], x[2]); });
}

function ownerRender_(ss, source, filters) {
  var view = PayrollOwnerCore.view(source.rows, filters, []), sheet = ownerLayout_(ss);
  var previous = ownerViewRows_(sheet);
  var previousLastRow = previous.reduce(function (last, row) { return Math.max(last, row._row); }, OWNER_HEADER_ROW_);
  var lastManagedRow = Math.max(previousLastRow, OWNER_HEADER_ROW_ + view.rows.length), requests = [];
  if (lastManagedRow > OWNER_HEADER_ROW_) {
    requests.push({ updateCells: { range: { sheetId: sheet.getSheetId(), startRowIndex: OWNER_HEADER_ROW_, endRowIndex: lastManagedRow, startColumnIndex: 0, endColumnIndex: 10 }, rows: [], fields: 'userEnteredValue,note,dataValidation,userEnteredFormat.numberFormat' } });
    requests.push({ updateDimensionProperties: { range: { sheetId: sheet.getSheetId(), dimension: 'ROWS', startIndex: OWNER_HEADER_ROW_, endIndex: lastManagedRow }, properties: { hiddenByUser: false }, fields: 'hiddenByUser' } });
  }
  view.rows.forEach(function (r, index) {
    var target = OWNER_HEADER_ROW_ + 1 + index;
    var values = [r.id, r.readyDate, r.object, r.employee, r.article, r.amount, r.status, r.status === 'Выплачено', r.paymentDate, r.comment];
    values.forEach(function (v, i) {
      requests.push(ownerCell_(sheet.getSheetId(), target, i + 1, v));
    });
  });
  if (view.rows.length) {
    requests.push({ setDataValidation: { range: { sheetId: sheet.getSheetId(), startRowIndex: OWNER_HEADER_ROW_, endRowIndex: OWNER_HEADER_ROW_ + view.rows.length, startColumnIndex: 7, endColumnIndex: 8 }, rule: { condition: { type: 'BOOLEAN' }, strict: true, showCustomUi: true } } });
    requests.push({ repeatCell: { range: { sheetId: sheet.getSheetId(), startRowIndex: OWNER_HEADER_ROW_, endRowIndex: OWNER_HEADER_ROW_ + view.rows.length, startColumnIndex: 5, endColumnIndex: 6 }, cell: { userEnteredFormat: { numberFormat: { type: 'NUMBER', pattern: '#,##0.00 "₽"' } } }, fields: 'userEnteredFormat.numberFormat' } });
  }
  if (OWNER_HEADER_ROW_ + view.rows.length > sheet.getMaxRows()) requests.unshift({ appendDimension: { sheetId: sheet.getSheetId(), dimension: 'ROWS', length: OWNER_HEADER_ROW_ + view.rows.length - sheet.getMaxRows() } });
  Array.prototype.push.apply(requests, ownerSummaryRequests_(sheet, view.summary));
  Sheets.Spreadsheets.batchUpdate({ requests: requests }, ss.getId());
  var state = { version: Utilities.getUuid(), filters: view.filters, sourceHash: ownerHash_(PayrollOwnerCore.fingerprint(source.rows)) };
  PropertiesService.getDocumentProperties().setProperty('payroll.owner.view', JSON.stringify(state));
  ss.setActiveSheet(sheet);
  return ownerResponse_(source, state, []);
}

function ownerResponse_(source, state, selected) {
  var view = PayrollOwnerCore.view(source.rows, state.filters, selected);
  var employees = Object.create(null), objects = Object.create(null);
  source.rows.forEach(function (r) { employees[r.employeeId] = r.employee; objects[r.objectKey] = r.object; });
  function options(map) { return Object.keys(map).map(function (id) { return { id: id, label: map[id] }; }).sort(function (a, b) { return a.label.localeCompare(b.label, 'ru'); }); }
  return { version: state.version, filters: state.filters, summary: view.summary, employees: options(employees), objects: options(objects), statuses: PayrollOwnerCore.statuses, skippedDeals: ownerUserDiagnostics_(source), stale: state.sourceHash !== ownerHash_(PayrollOwnerCore.fingerprint(source.rows)) };
}

function ownerContext_(ss, version) {
  var saved = PropertiesService.getDocumentProperties().getProperty('payroll.owner.view');
  if (!saved) throw new Error('Сначала обновите интерфейс');
  var state = JSON.parse(saved);
  if (version && version !== state.version) throw new Error('Выдача изменена в другом окне. Обновите интерфейс.');
  var sheet = ss.getSheetByName(PAYROLL_CONFIG.sheets.owner), rows = ownerViewRows_(sheet);
  PayrollOwnerCore.unique(rows);
  var selected = rows.filter(function (r) { return r.selected && r.status !== 'Выплачено'; }).map(function (r) { return r.id; });
  // Re-read the source only after capturing the current compact output and its
  // selection. Nothing from the sidebar itself is trusted as payment input.
  var source = ownerSource_(ss);
  var allowed = PayrollOwnerCore.view(source.rows, state.filters, []).rows.map(function (r) { return r.id; });
  // Keep every non-paid checked ID. ownerPlan_ must reject an unknown or
  // out-of-filter ID explicitly instead of silently dropping a tampered row.
  return { state: state, source: source, sheet: sheet, rows: rows, selected: selected, allowed: allowed };
}

function ownerApplyFilters(filters) {
  return withPayrollLock(function () {
    var ss = getPayrollSpreadsheet_();
    return ownerRender_(ss, ownerSource_(ss), PayrollOwnerCore.filters(filters));
  });
}

function ownerGetState(version) {
  return withPayrollLock(function () {
    var ss = getPayrollSpreadsheet_();
    if (!PropertiesService.getDocumentProperties().getProperty('payroll.owner.view')) return ownerRender_(ss, ownerSource_(ss), {});
    ownerLayout_(ss);
    var ctx = ownerContext_(ss, version);
    return ownerResponse_(ctx.source, ctx.state, ctx.selected);
  });
}

function ownerPlan_(ctx) {
  if (ctx.state.sourceHash !== ownerHash_(PayrollOwnerCore.fingerprint(ctx.source.rows))) throw new Error('Исходные статьи изменились. Обновите интерфейс и повторите выбор.');
  var plan = PayrollOwnerCore.plan(ctx.source.rows, ctx.selected, ctx.allowed), shown = PayrollOwnerCore.unique(ctx.rows);
  plan.forEach(function (r) {
    var values = shown[r.id]._values;
    if (values[3] !== r.employee || values[4] !== r.article || values[5] !== r.amount || values[6] !== r.status) {
      throw new Error('Данные статьи ' + r.id + ' в интерфейсе изменены вручную. Обновите выдачу.');
    }
  });
  return plan;
}

function ownerPaymentRequests_(table, plan, today, stamp) {
  var fields = { 'Статус': 'Выплачено', 'Оплатить': true, 'Дата выплаты': today, 'Обновлено': stamp };
  var requests = [];
  plan.forEach(function (r) {
    Object.keys(fields).forEach(function (header) {
      var column = table.headers.indexOf(header);
      if (column < 0 || table.headers.indexOf(header, column + 1) >= 0) throw new Error('Неоднозначный столбец источника: ' + header);
      if (r._formulas && r._formulas[column]) throw new Error('Статья ' + r.id + ': поле ' + header + ' содержит формулу');
      requests.push(ownerCell_(table.sheet.getSheetId(), r._row, column + 1, fields[header]));
    });
  });
  return requests;
}

function ownerConfirmPayment(version) {
  return withPayrollLock(function () {
    var ss = getPayrollSpreadsheet_(), ctx = ownerContext_(ss, version), plan = ownerPlan_(ctx);
    var now = new Date(), stamp = now.toISOString(), today = Utilities.formatDate(now, ss.getSpreadsheetTimeZone(), 'dd.MM.yyyy');
    var requests = ownerPaymentRequests_(ctx.source.table, plan, today, stamp);
    // One Sheets API transaction: no source cell changes if ANY subrequest is invalid.
    Sheets.Spreadsheets.batchUpdate({ requests: requests }, ss.getId());
    var receipt = { paidCount: plan.length, amount: PayrollOwnerCore.summary(plan, ctx.selected).selectedAmount, ids: ctx.selected, paidAt: stamp };
    try {
      // SpreadsheetApp may return its pre-write read cache after a Sheets API
      // transaction. Render the reread source plus the successfully committed
      // fields instead of rereading through that cache in the same execution.
      var paidIds = PayrollOwnerCore.unique(plan);
      var committed = { table: ctx.source.table, skippedDeals: ctx.source.skippedDeals || [], deals: ctx.source.deals, rows: ctx.source.rows.map(function (row) {
        return paidIds[row.id] ? Object.assign({}, row, {
          status: 'Выплачено', paid: true, paymentDate: PayrollCore.toIsoDate(today), updatedAt: stamp
        }) : row;
      }) };
      receipt.state = ownerRender_(ss, committed, ctx.state.filters);
    }
    catch { receipt.warning = 'Оплата подтверждена, но интерфейс не обновился. Обновите его; повторно оплачивать не нужно.'; }
    return receipt;
  });
}

function onEdit(e) {
  if (!e || !e.range || e.range.getSheet().getName() !== PAYROLL_CONFIG.sheets.owner) return;
  var firstRow = e.range.getRow(), lastRow = firstRow + e.range.getNumRows() - 1;
  var firstColumn = e.range.getColumn(), lastColumn = firstColumn + e.range.getNumColumns() - 1;
  if (lastRow <= OWNER_HEADER_ROW_ || firstColumn !== 8 || lastColumn !== 8) return;
  var lock = LockService.getScriptLock();
  if (!lock.tryLock(1000)) throw new Error('Интерфейс занят другим действием. Повторите выбор.');
  try {
    var sheet = e.range.getSheet(), values = sheet.getRange(firstRow, 7, lastRow - firstRow + 1, 2).getValues(), requests = [];
    values.forEach(function (row, index) {
      var status = String(row[0] || ''), selected = row[1] === true, expected = status === 'Выплачено' ? true : status === 'К оплате' ? selected : false;
      if (selected !== expected) requests.push(ownerCell_(sheet.getSheetId(), firstRow + index, 8, expected));
    });
    if (requests.length) Sheets.Spreadsheets.batchUpdate({ requests: requests }, sheet.getParent().getId());
  } finally { lock.releaseLock(); }
}

if (typeof module !== 'undefined') module.exports = { ownerApplyFilters: ownerApplyFilters, ownerGetState: ownerGetState, ownerConfirmPayment: ownerConfirmPayment, ownerPaymentRequests_: ownerPaymentRequests_, ownerUserDiagnostics_: ownerUserDiagnostics_, ownerCell_: ownerCell_, onOpen: onOpen, onEdit: onEdit, openPayrollSidebar: openPayrollSidebar };
