/* exported onOpen, onEdit, openPayrollSidebar, ownerApplyFilters, ownerGetState, ownerPreviewPayment, ownerConfirmPayment */
var OWNER_HEADERS_ = ['ID статьи', 'Дата готовности', 'Объект', 'Сотрудник', 'Статья', 'Сумма', 'Статус', 'Выбрать', 'Дата выплаты', 'Комментарий'];
var OWNER_HEADER_ROW_ = 10;

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
  return { table: input.paymentTable, rows: rows };
}

function ownerCell_(sheetId, row, column, value) {
  var v = {};
  if (value !== '' && value != null) v.userEnteredValue = { [typeof value === 'number' ? 'numberValue' : typeof value === 'boolean' ? 'boolValue' : 'stringValue']: value };
  return { updateCells: { range: { sheetId: sheetId, startRowIndex: row - 1, endRowIndex: row, startColumnIndex: column - 1, endColumnIndex: column }, rows: [{ values: [v] }], fields: 'userEnteredValue' } };
}

function ownerLayout_(ss) {
  var sheet = ss.getSheetByName(PAYROLL_CONFIG.sheets.owner);
  if (!sheet) throw new Error('Не найден лист «Интерфейс собственника»');
  var values = sheet.getDataRange().getValues();
  var initialized = values[OWNER_HEADER_ROW_ - 1] && OWNER_HEADERS_.every(function (h, i) { return values[OWNER_HEADER_ROW_ - 1][i] === h; });
  if (!initialized) {
    if (values.some(function (r) { return r.slice(0, 10).some(function (v) { return v !== ''; }); })) throw new Error('В области A:J интерфейса есть неизвестная структура. Она не была перезаписана.');
    var labels = [
      [1, 2, 'Зарплаты — интерфейс собственника'],
      [2, 2, 'Флажок только выбирает статью. Оплата — после подтверждения в sidebar.'],
      [4, 2, 'Запланировано'], [4, 4, 'К оплате'], [4, 6, 'Выплачено'], [4, 8, 'Итого по фильтру'],
      [6, 2, 'Выбрано статей'], [6, 4, 'Сумма выбранных']
    ];
    var requests = labels.map(function (x) { return ownerCell_(sheet.getSheetId(), x[0], x[1], x[2]); });
    OWNER_HEADERS_.forEach(function (h, i) { requests.push(ownerCell_(sheet.getSheetId(), OWNER_HEADER_ROW_, i + 1, h)); });
    Sheets.Spreadsheets.batchUpdate({ requests: requests }, ss.getId());
    sheet.getRange(OWNER_HEADER_ROW_, 1, 1, 10).setBackground('#e8edf3').setFontWeight('bold').setWrap(true);
    sheet.getRange(1, 2).setFontSize(16).setFontWeight('bold');
    sheet.getRange(5, 2, 1, 8).setNumberFormat('#,##0.00 "₽"');
    sheet.getRange(7, 4).setNumberFormat('#,##0.00 "₽"');
    sheet.setColumnWidths(2, 1, 115); sheet.setColumnWidths(3, 3, 220);
    sheet.setColumnWidth(6, 130); sheet.setColumnWidth(7, 145); sheet.setColumnWidth(8, 125);
    sheet.setColumnWidth(9, 115); sheet.setColumnWidth(10, 240);
    sheet.setFrozenRows(OWNER_HEADER_ROW_);
  }
  sheet.hideColumns(1);
  return sheet;
}

function ownerViewRows_(sheet) {
  var t = tableFromSheet(sheet, OWNER_HEADERS_);
  return t.rows.filter(function (r) { return !!r['ID статьи']; }).map(function (r) {
    return { id: String(r['ID статьи']), selected: r['Выбрать'] === true, status: String(r['Статус']), _row: r._row, _values: r._values, _formulas: r._formulas };
  });
}

function ownerSummaryRequests_(sheet, summary) {
  var entries = [[5, 2, summary.planned], [5, 4, summary.toPay], [5, 6, summary.paid], [5, 8, summary.total], [7, 2, summary.selectedCount], [7, 4, summary.selectedAmount], [8, 2, summary.count ? 'Найдено статей: ' + summary.count : 'По выбранным фильтрам статей нет']];
  return entries.map(function (x) { return ownerCell_(sheet.getSheetId(), x[0], x[1], x[2]); });
}

function ownerRender_(ss, source, filters) {
  var view = PayrollOwnerCore.view(source.rows, filters, []), sheet = ownerLayout_(ss);
  var previous = ownerViewRows_(sheet), byId = PayrollOwnerCore.unique(previous);
  var next = Math.max(sheet.getLastRow() + 1, OWNER_HEADER_ROW_ + 1), requests = [];
  var visible = view.rows.map(function (r) { return r.id; });
  source.rows.forEach(function (r) {
    var old = byId[r.id], target = old ? old._row : next++;
    var values = [r.id, r.readyDate, r.object, r.employee, r.article, r.amount, r.status, r.status === 'Выплачено', r.paymentDate, r.comment];
    values.forEach(function (v, i) {
      if (old && old._formulas[i]) throw new Error('В управляемом столбце интерфейса обнаружена формула. Перезапись отменена.');
      if (!old || old._values[i] !== v) requests.push(ownerCell_(sheet.getSheetId(), target, i + 1, v));
    });
    if (!old) {
      requests.push({ setDataValidation: { range: { sheetId: sheet.getSheetId(), startRowIndex: target - 1, endRowIndex: target, startColumnIndex: 7, endColumnIndex: 8 }, rule: { condition: { type: 'BOOLEAN' }, strict: true, showCustomUi: true } } });
      requests.push({ repeatCell: { range: { sheetId: sheet.getSheetId(), startRowIndex: target - 1, endRowIndex: target, startColumnIndex: 5, endColumnIndex: 6 }, cell: { userEnteredFormat: { numberFormat: { type: 'NUMBER', pattern: '#,##0.00 "₽"' } } }, fields: 'userEnteredFormat.numberFormat' } });
    }
    requests.push({ updateDimensionProperties: { range: { sheetId: sheet.getSheetId(), dimension: 'ROWS', startIndex: target - 1, endIndex: target }, properties: { hiddenByUser: visible.indexOf(r.id) < 0 }, fields: 'hiddenByUser' } });
  });
  // Retain orphaned view rows and their user columns, but exclude them from the issue.
  previous.filter(function (r) { return !source.rows.some(function (s) { return s.id === r.id; }); }).forEach(function (r) {
    requests.push({ updateDimensionProperties: { range: { sheetId: sheet.getSheetId(), dimension: 'ROWS', startIndex: r._row - 1, endIndex: r._row }, properties: { hiddenByUser: true }, fields: 'hiddenByUser' } });
  });
  if (next - 1 > sheet.getMaxRows()) requests.unshift({ appendDimension: { sheetId: sheet.getSheetId(), dimension: 'ROWS', length: next - 1 - sheet.getMaxRows() } });
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
  return { version: state.version, filters: state.filters, summary: view.summary, employees: options(employees), objects: options(objects), statuses: PayrollOwnerCore.statuses, stale: state.sourceHash !== ownerHash_(PayrollOwnerCore.fingerprint(source.rows)) };
}

function ownerContext_(ss, version) {
  var saved = PropertiesService.getDocumentProperties().getProperty('payroll.owner.view');
  if (!saved) throw new Error('Сначала обновите интерфейс');
  var state = JSON.parse(saved);
  if (version && version !== state.version) throw new Error('Выдача изменена в другом окне. Обновите интерфейс.');
  var source = ownerSource_(ss), sheet = ss.getSheetByName(PAYROLL_CONFIG.sheets.owner), rows = ownerViewRows_(sheet);
  PayrollOwnerCore.unique(rows);
  var allowed = PayrollOwnerCore.view(source.rows, state.filters, []).rows.map(function (r) { return r.id; });
  var selected = rows.filter(function (r) { return r.selected && r.status !== 'Выплачено' && allowed.indexOf(r.id) >= 0 && !sheet.isRowHiddenByUser(r._row); }).map(function (r) { return r.id; });
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

function ownerPreviewPayment(version) {
  return withPayrollLock(function () {
    var ctx = ownerContext_(getPayrollSpreadsheet_(), version), plan = ownerPlan_(ctx);
    var preview = { token: Utilities.getUuid(), version: ctx.state.version, hash: ownerHash_(PayrollOwnerCore.fingerprint(plan)), expires: Date.now() + 5 * 60 * 1000 };
    PropertiesService.getUserProperties().setProperty('payroll.owner.preview', JSON.stringify(preview));
    return { token: preview.token, count: plan.length, amount: PayrollOwnerCore.summary(plan, ctx.selected).selectedAmount, ids: ctx.selected };
  });
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

function ownerConfirmPayment(token, version) {
  return withPayrollLock(function () {
    var ss = getPayrollSpreadsheet_(), saved = PropertiesService.getUserProperties().getProperty('payroll.owner.preview');
    if (!saved) throw new Error('Сначала проверьте количество и сумму выбранных статей');
    var preview = JSON.parse(saved), ctx = ownerContext_(ss, version);
    if (preview.token !== token || preview.version !== ctx.state.version || preview.expires < Date.now()) throw new Error('Подтверждение устарело. Повторите предварительную проверку.');
    var plan = ownerPlan_(ctx);
    if (preview.hash !== ownerHash_(PayrollOwnerCore.fingerprint(plan))) throw new Error('Выбор или суммы изменились. Повторите предварительную проверку.');
    var now = new Date(), stamp = now.toISOString(), today = Utilities.formatDate(now, ss.getSpreadsheetTimeZone(), 'dd.MM.yyyy');
    var requests = ownerPaymentRequests_(ctx.source.table, plan, today, stamp);
    // One Sheets API transaction: no source cell changes if ANY subrequest is invalid.
    Sheets.Spreadsheets.batchUpdate({ requests: requests }, ss.getId());
    PropertiesService.getUserProperties().deleteProperty('payroll.owner.preview');
    var receipt = { paidCount: plan.length, amount: PayrollOwnerCore.summary(plan, ctx.selected).selectedAmount, ids: ctx.selected, paidAt: stamp };
    try { receipt.state = ownerRender_(ss, ownerSource_(ss), ctx.state.filters); }
    catch { receipt.warning = 'Оплата подтверждена, но интерфейс не обновился. Обновите его; повторно оплачивать не нужно.'; }
    return receipt;
  });
}

function onEdit(e) {
  if (!e || !e.range || e.range.getSheet().getName() !== PAYROLL_CONFIG.sheets.owner) return;
  // Selection edits never touch the source. PAID checks are restored even after paste.
  return withPayrollLock(function () {
    var ss = getPayrollSpreadsheet_(), saved = PropertiesService.getDocumentProperties().getProperty('payroll.owner.view');
    if (!saved) return;
    var ctx = ownerContext_(ss), paid = PayrollOwnerCore.unique(ctx.source.rows);
    ctx.rows.forEach(function (r) { if (paid[r.id] && paid[r.id].status === 'Выплачено' && !r.selected) ctx.sheet.getRange(r._row, 8).setValue(true); });
    var summary = ownerResponse_(ctx.source, ctx.state, ctx.selected).summary;
    ctx.sheet.getRange(7, 2).setValue(summary.selectedCount); ctx.sheet.getRange(7, 4).setValue(summary.selectedAmount);
  });
}

if (typeof module !== 'undefined') module.exports = { ownerApplyFilters: ownerApplyFilters, ownerGetState: ownerGetState, ownerPreviewPayment: ownerPreviewPayment, ownerConfirmPayment: ownerConfirmPayment, ownerPaymentRequests_: ownerPaymentRequests_, ownerCell_: ownerCell_, onOpen: onOpen, onEdit: onEdit, openPayrollSidebar: openPayrollSidebar };
