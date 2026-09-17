/* exported dailySync, handlePaymentEdit, setup, withPayrollLock, getPayrollSpreadsheet_ */
function withPayrollLock(action) {
  var lock = LockService.getScriptLock();
  if (!lock.tryLock(30000)) throw new Error('Другой процесс расчёта уже выполняется');
  try { return action(); } finally { lock.releaseLock(); }
}

function getPayrollSpreadsheet_() {
  var container = SpreadsheetApp.getActiveSpreadsheet();
  if (!container || container.getId() !== PAYROLL_CONFIG.spreadsheetId) {
    throw new Error('ID контейнерной таблицы не совпадает с PAYROLL_CONFIG.spreadsheetId. Выполнение остановлено.');
  }
  return container;
}

function dailySync() {
  return withPayrollLock(function () {
    var data = readPayrollWorkbook(getPayrollSpreadsheet_());
    var calculation = PayrollCore.calculate(data);
    var results = PayrollCore.reconcile(data.existing, calculation.rows, new Date().toISOString(), calculation.skippedDeals);
    var count = writePayrollChanges(data.paymentTable, results);
    writePayrollDiagnostics(data.dealTable, calculation.skippedDeals);
    console.info('dailySync: рассчитано ' + calculation.rows.length + ', записано ' + count + ', пропущено сделок ' + calculation.skippedDeals.length);
    return { calculated: calculation.rows.length, written: count, skipped: calculation.skippedDeals.length, skippedDeals: calculation.skippedDeals };
  });
}

// Compatibility entry point: edits in the bound project NEVER confirm payments.
// The old standalone retains its own code/triggers until the owner switches them.
function handlePaymentEdit() { return false; }

function setup() {
  return withPayrollLock(function () {
    readPayrollWorkbook(getPayrollSpreadsheet_());
    return 'Проверка завершена. Триггеры не создавались. Откройте меню «Зарплаты».';
  });
}

if (typeof module !== 'undefined') module.exports = { dailySync: dailySync, handlePaymentEdit: handlePaymentEdit, setup: setup, getPayrollSpreadsheet_: getPayrollSpreadsheet_, withPayrollLock: withPayrollLock };
