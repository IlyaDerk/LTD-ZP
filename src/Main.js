/* exported dailySync, handlePaymentEdit, setup */
function withPayrollLock(action) {
  var lock = LockService.getScriptLock(); if (!lock.tryLock(30000)) throw new Error('Другой процесс расчёта уже выполняется');
  try { return action(); } finally { lock.releaseLock(); }
}

function dailySync() {
  return withPayrollLock(function () {
    var ss = SpreadsheetApp.openById(PAYROLL_CONFIG.spreadsheetId), data = readPayrollWorkbook(ss);
    var calculated = PayrollCore.calculate(data), results = PayrollCore.reconcile(data.existing, calculated, new Date().toISOString());
    var count = writePayrollChanges(data.paymentTable, results); rebuildReviewSheet(ss, results.map(function (x) { return x.row; }), data.deals);
    return { calculated: calculated.length, written: count, review: calculated.filter(function (x) { return x.status === 'NEEDS_REVIEW'; }).length };
  });
}

function handlePaymentEdit(e) {
  if (!e || !e.range || e.range.getNumRows() !== 1 || e.range.getNumColumns() !== 1) return;
  var sheet = e.range.getSheet(); if (sheet.getName() !== PAYROLL_CONFIG.sheets.payments) return;
  return withPayrollLock(function () {
    var table = tableFromSheet(sheet, ['ID статьи', 'Статус', 'Оплатить']), payColumn = table.headers.indexOf('Оплатить') + 1;
    if (e.range.getColumn() !== payColumn || e.range.getRow() <= table.headerRow + 1) return;
    var statusColumn = table.headers.indexOf('Статус') + 1, paymentDateColumn = table.headers.indexOf('Дата выплаты') + 1, updatedColumn = table.headers.indexOf('Обновлено') + 1;
    var current = status(sheet.getRange(e.range.getRow(), statusColumn).getValue());
    if (String(e.value).toUpperCase() !== 'TRUE') { if (current === PayrollCore.STATUS.PAID) e.range.setValue(true); return; }
    if (current !== PayrollCore.STATUS.TO_PAY) { e.range.setValue(false); e.source.toast('Оплата разрешена только для статьи со статусом TO_PAY'); return; }
    sheet.getRange(e.range.getRow(), statusColumn).setValue(PayrollCore.STATUS.PAID);
    sheet.getRange(e.range.getRow(), paymentDateColumn).setValue(new Date());
    if (updatedColumn > 0) sheet.getRange(e.range.getRow(), updatedColumn).setValue(new Date());
  });
}

function setup() {
  var ss = SpreadsheetApp.openById(PAYROLL_CONFIG.spreadsheetId); ensurePaymentCheckbox(ss); readPayrollWorkbook(ss);
  var triggers = ScriptApp.getProjectTriggers();
  if (!triggers.some(function (t) { return t.getHandlerFunction() === 'dailySync'; })) ScriptApp.newTrigger('dailySync').timeBased().everyDays(1).atHour(5).create();
  if (!triggers.some(function (t) { return t.getHandlerFunction() === 'handlePaymentEdit'; })) ScriptApp.newTrigger('handlePaymentEdit').forSpreadsheet(ss).onEdit().create();
  return 'Проверка завершена, триггеры настроены без дублей';
}
