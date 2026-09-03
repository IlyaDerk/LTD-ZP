/* exported dailySync, handlePaymentEdit, setup */
function withPayrollLock(action) {
  var lock = LockService.getScriptLock(); if (!lock.tryLock(30000)) throw new Error('Другой процесс расчёта уже выполняется');
  try { return action(); } finally { lock.releaseLock(); }
}

function dailySync() {
  return withPayrollLock(function () {
    var ss = SpreadsheetApp.openById(PAYROLL_CONFIG.spreadsheetId), data = readPayrollWorkbook(ss);
    var calculation = PayrollCore.calculate(data), results = PayrollCore.reconcile(data.existing, calculation.rows, new Date().toISOString());
    var count = writePayrollChanges(data.paymentTable, results);
    return { calculated: calculation.rows.length, written: count, skipped: calculation.skippedDeals.length, skippedDeals: calculation.skippedDeals };
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
    if (current !== PayrollCore.STATUS.TO_PAY) { e.range.setValue(false); e.source.toast('Оплата разрешена только для статьи со статусом «К оплате»'); return; }
    sheet.getRange(e.range.getRow(), statusColumn).setValue(displayStatus(PayrollCore.STATUS.PAID));
    sheet.getRange(e.range.getRow(), paymentDateColumn).setValue(new Date());
    if (updatedColumn > 0) sheet.getRange(e.range.getRow(), updatedColumn).setValue(new Date());
  });
}

function setup() {
  var ss = SpreadsheetApp.openById(PAYROLL_CONFIG.spreadsheetId);
  readPayrollWorkbook(ss);
  ensurePaymentCheckbox(ss);
  var triggers = ScriptApp.getProjectTriggers();
  ensureSingleTrigger(triggers, 'dailySync', function () { return ScriptApp.newTrigger('dailySync').timeBased().everyDays(1).atHour(5); });
  ensureSingleTrigger(triggers, 'handlePaymentEdit', function () { return ScriptApp.newTrigger('handlePaymentEdit').forSpreadsheet(ss).onEdit(); });
  return 'Проверка завершена, триггеры настроены без дублей';
}

function ensureSingleTrigger(triggers, handler, builder) {
  var matches = triggers.filter(function (trigger) { return trigger.getHandlerFunction() === handler; });
  matches.slice(1).forEach(function (trigger) { ScriptApp.deleteTrigger(trigger); });
  if (!matches.length) builder().create();
}

if (typeof module !== 'undefined') module.exports = { dailySync: dailySync, handlePaymentEdit: handlePaymentEdit, setup: setup, ensureSingleTrigger: ensureSingleTrigger };
