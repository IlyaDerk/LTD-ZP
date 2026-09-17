/* exported readPayrollWorkbook, writePayrollChanges, writePayrollDiagnostics, ensurePaymentCheckbox, findHeaderRow */
function findHeaderRow(values, required) {
  for (var r = 0; r < Math.min(values.length, 20); r += 1) {
    var cells = values[r].map(function (x) { return String(x).trim(); });
    if (required.every(function (h) { return cells.indexOf(h) >= 0; })) return r;
  }
  throw new Error('Не найдена строка заголовков: ' + required.join(', '));
}

function tableFromSheet(sheet, required, timeZone) {
  var range = sheet.getDataRange(), values = range.getValues(), headerRow = findHeaderRow(values, required);
  var formulas = range.getFormulas();
  var notes = typeof range.getNotes === 'function' ? range.getNotes() : values.map(function (row) { return row.map(function () { return ''; }); });
  var headers = values[headerRow].map(function (x) { return String(x).trim(); });
  var rows = [];
  values.slice(headerRow + 1).forEach(function (row, index) {
    if (!row.some(function (v) { return v !== ''; })) return;
    var object = { _row: headerRow + index + 2, _values: row.slice(), _formulas: formulas[headerRow + index + 1], _notes: notes[headerRow + index + 1] || [] };
    headers.forEach(function (h, i) {
      if (!h) return;
      var value = row[i];
      // Calendar dates belong to the spreadsheet timezone; audit timestamps retain their precision.
      object[h] = timeZone && value instanceof Date && h !== 'Создано' && h !== 'Обновлено'
        ? Utilities.formatDate(value, timeZone, 'yyyy-MM-dd') : value;
    });
    rows.push(object);
  });
  return { sheet: sheet, headerRow: headerRow, headers: headers, rows: rows };
}

function bool(v) { return v === true || /^(true|да|1)$/i.test(String(v).trim()); }
function number(v) { if (typeof v === 'number') return v; var s = String(v || '').replace(/\s/g, '').replace(',', '.').replace(/[^\d.-]/g, ''); return Number(s); }
function status(v) {
  var n = PayrollCore.normalize(v), map = { 'запланировано': 'PLANNED', 'к оплате': 'TO_PAY', 'выплачено': 'PAID', 'отменено': 'CANCELLED' };
  return map[n] || String(v || '');
}
function displayStatus(v) {
  return { PLANNED: 'Запланировано', TO_PAY: 'К оплате', PAID: 'Выплачено', CANCELLED: 'Отменено' }[v] || String(v || '');
}
function getSheet(ss, name) { var s = ss.getSheetByName(name); if (!s) throw new Error('Отсутствует обязательный лист «' + name + '»'); return s; }

var PAYROLL_NOTE_START = '--- Расчёт зарплаты: начало ---';
var PAYROLL_NOTE_END = '--- Расчёт зарплаты: конец ---';
var PAYROLL_NOTE_DATA = 'Служебные данные URI: ';
function stripPayrollDiagnostic(note) {
  var text = String(note || ''), start;
  while ((start = text.indexOf(PAYROLL_NOTE_START)) >= 0) {
    var end = text.indexOf(PAYROLL_NOTE_END, start + PAYROLL_NOTE_START.length);
    if (end < 0) break;
    end += PAYROLL_NOTE_END.length;
    if (start >= 2 && text.slice(start - 2, start) === '\n\n') start -= 2;
    else if (end + 2 <= text.length && text.slice(end, end + 2) === '\n\n') end += 2;
    text = text.slice(0, start) + text.slice(end);
  }
  return text;
}
function noteLine(value) {
  return String(value == null ? '' : value).replace(/[\r\n]+/g, ' ').replace(/--- Расчёт зарплаты: (?:начало|конец) ---/g, '[служебный маркер]');
}
function noteAmount(value) { return Number.isFinite(Number(value)) ? String(Number(value)) + ' ₽' : 'нечисловая сумма'; }
function payrollDiagnosticBlock(diagnostic) {
  var bad = diagnostic.nonPositiveArticles || [];
  var lines = [PAYROLL_NOTE_START,
    'ID сделки: ' + noteLine(diagnostic.dealId),
    'Название: ' + noteLine(diagnostic.dealName),
    'Стоимость сделки: ' + noteAmount(diagnostic.projectCost),
    'Рассчитанные неположительные статьи:'];
  if (bad.length) bad.forEach(function (item) { lines.push('- ' + noteLine(item.name) + ' [' + noteLine(item.articleCode) + ' / ' + noteLine(item.ruleId) + ']: ' + noteLine(item.amountText)); });
  else lines.push('- нет');
  lines.push('Причины полного отклонения:');
  (diagnostic.reasons || []).forEach(function (reason) { lines.push('- ' + noteLine(reason)); });
  lines.push(PAYROLL_NOTE_DATA + encodeURIComponent(JSON.stringify(diagnostic)), PAYROLL_NOTE_END);
  return lines.join('\n');
}
function mergePayrollDiagnostic(note, diagnostic) {
  var userNote = stripPayrollDiagnostic(note);
  return diagnostic ? userNote + (userNote ? '\n\n' : '') + payrollDiagnosticBlock(diagnostic) : userNote;
}
function parsePayrollDiagnostic(note) {
  var text = String(note || ''), start = text.indexOf(PAYROLL_NOTE_START), end = text.indexOf(PAYROLL_NOTE_END, start + PAYROLL_NOTE_START.length);
  if (start < 0 || end < 0) return null;
  var block = text.slice(start, end), line = block.split(/\r?\n/).find(function (value) { return value.indexOf(PAYROLL_NOTE_DATA) === 0; });
  if (!line) return null;
  try { return JSON.parse(decodeURIComponent(line.slice(PAYROLL_NOTE_DATA.length))); } catch { return null; }
}
function readPayrollDiagnostics(table) {
  var column = table.headers.indexOf('Проверка данных');
  if (column < 0) return [];
  return table.rows.map(function (row) { return parsePayrollDiagnostic((row._notes || [])[column]); }).filter(function (item) { return !!item; });
}
function writePayrollDiagnostics(table, skippedDeals) {
  var column = table.headers.indexOf('Проверка данных');
  if (column < 0) throw new Error('На листе сделок отсутствует столбец «Проверка данных»');
  var byId = Object.create(null), changed = 0;
  (skippedDeals || []).forEach(function (deal) { byId[String(deal.dealId)] = deal; });
  table.rows.forEach(function (row) {
    var current = String((row._notes || [])[column] || ''), next = mergePayrollDiagnostic(current, byId[String(row['ID сделки'])] || null);
    if (next !== current) { table.sheet.getRange(row._row, column + 1).setNote(next); changed += 1; }
  });
  return changed;
}

function readPayrollWorkbook(ss) {
  var c = PAYROLL_CONFIG.sheets;
  var timeZone = ss.getSpreadsheetTimeZone();
  function read(name, required) { return tableFromSheet(getSheet(ss, name), required, timeZone); }
  var deals = read(c.deals, ['ID сделки', 'Стоимость дизайн-проекта', 'Метраж после замера', 'Пакет дизайна', 'Тип визуализации', 'Развёртки', 'Инженер-дизайнер', 'Визуализатор / Нет', 'Дата выполнения Акта №1', 'Дата выполнения Акта №2', 'Дата выполнения Акта №3', 'Дата подписания ремонта', 'Проверка данных']);
  var employees = read(c.employees, ['ID сотрудника', 'ФИО', 'Активен', 'Модель мотивации', 'Грейд', 'Действует с', 'Действует по']);
  var types = read(c.articleTypes, ['Код статьи', 'Активна']);
  var rules = read(c.rules, ['ID правила', 'Активно', 'Код статьи', 'Получатель', 'Доля']);
  var moscow = read(c.moscow, ['Грейд / начисление', 'Ставка за дизайн-проект', 'Активна']);
  var tambov = read(c.tambov, ['Работа или пакет', 'I', 'II', 'III', 'IV', 'V', 'VI', 'Единица', 'Активна']);
  var payments = read(c.payments, ['ID статьи', 'ID сделки', 'ID сотрудника', 'Код статьи', 'ID правила', 'Расчётная база', 'Ставка', 'Доля', 'Расчётная сумма', 'Дата готовности', 'Статус', 'Дата выплаты', 'Комментарий', 'Создано', 'Обновлено']);
  var activeCodes = {}; types.rows.forEach(function (x) { if (bool(x['Активна'])) activeCodes[x['Код статьи']] = true; });
  var ruleRows = rules.rows.filter(function (x) { return bool(x['Активно']) && activeCodes[x['Код статьи']]; }).map(function (x) { return { id: x['ID правила'], active: true, articleCode: x['Код статьи'], recipient: x['Получатель'], share: number(x['Доля']) / (String(x['Доля']).indexOf('%') >= 0 ? 100 : 1) }; });
  var matrices = { moscow: moscow.rows.filter(function (x) { return bool(x['Активна']); }).map(function (x) { return { key: x['Грейд / начисление'], grade: '', rate: number(x['Ставка за дизайн-проект']) / (String(x['Ставка за дизайн-проект']).indexOf('%') >= 0 ? 100 : 1), active: true, validFrom: x['Действует с'], validTo: x['Действует по'] }; }), tambov: [] };
  tambov.rows.filter(function (x) { return bool(x['Активна']); }).forEach(function (x) { ['I', 'II', 'III', 'IV', 'V', 'VI'].forEach(function (g) { var rate = number(x[g]); if (x['Единица'] === 'Процент' && rate > 1) rate /= 100; matrices.tambov.push({ key: x['Работа или пакет'], grade: g, rate: rate, active: true, validFrom: x['Действует с'], validTo: x['Действует по'] }); }); });
  var ruleById = {}; ruleRows.forEach(function (r) { ruleById[r.id] = r; });
  return {
    deals: deals.rows.map(function (x) { return { id: x['ID сделки'], objectId: x['ID объекта'], objectName: x['Название сделки'], projectCost: number(x['Стоимость дизайн-проекта']), area: number(x['Метраж после замера']), package: x['Пакет дизайна'], visualType: x['Тип визуализации'], rollouts: x['Развёртки'], engineer: x['Инженер-дизайнер'], visualizer: x['Визуализатор / Нет'], act1: x['Дата выполнения Акта №1'], act2: x['Дата выполнения Акта №2'], act3: x['Дата выполнения Акта №3'], repairDate: x['Дата подписания ремонта'] }; }),
    employees: employees.rows.map(function (x) { return { id: x['ID сотрудника'], name: x['ФИО'], active: bool(x['Активен']), model: x['Модель мотивации'], grade: x['Грейд'], role: x['Основная роль'], validFrom: x['Действует с'], validTo: x['Действует по'] }; }),
    now: Utilities.formatDate(new Date(), timeZone, 'yyyy-MM-dd'), rules: ruleRows, matrices: matrices, dealTable: deals, paymentTable: payments, skippedDeals: readPayrollDiagnostics(deals),
    existing: payments.rows.map(function (x) { var rule = ruleById[x['ID правила']] || {}; var slot = PayrollCore.normalize(rule.recipient).indexOf('визуализатор') >= 0 ? 'visualizer' : 'engineer'; return { _row: x._row, _values: x._values, _formulas: x._formulas, id: x['ID статьи'], naturalKey: [x['ID сделки'], x['ID правила'], x['Код статьи'], slot].join('|'), dealId: String(x['ID сделки']), employeeId: x['ID сотрудника'], articleCode: x['Код статьи'], ruleId: x['ID правила'], recipientSlot: slot, base: number(x['Расчётная база']), rate: number(x['Ставка']), share: number(x['Доля']), amount: number(x['Расчётная сумма']), readyDate: PayrollCore.toIsoDate(x['Дата готовности']), status: status(x['Статус']), paid: bool(x['Оплатить']) || status(x['Статус']) === 'PAID', paymentDate: PayrollCore.toIsoDate(x['Дата выплаты']), comment: x['Комментарий'] || '', createdAt: x['Создано'], updatedAt: x['Обновлено'] }; })
  };
}

var PAYMENT_COLUMNS = { id: 'ID статьи', dealId: 'ID сделки', employeeId: 'ID сотрудника', articleCode: 'Код статьи', ruleId: 'ID правила', base: 'Расчётная база', rate: 'Ставка', share: 'Доля', amount: 'Расчётная сумма', readyDate: 'Дата готовности', status: 'Статус', paid: 'Оплатить', paymentDate: 'Дата выплаты', comment: 'Комментарий', createdAt: 'Создано', updatedAt: 'Обновлено' };
var PAYMENT_PRESERVED_ON_UPDATE = { paid: true, paymentDate: true, comment: true, createdAt: true };
function paymentUserValue(value, key) {
  if ((key === 'readyDate' || key === 'paymentDate') && /^\d{4}-\d{2}-\d{2}$/.test(String(value || ''))) {
    var parts = String(value).split('-').map(Number);
    return { numberValue: (Date.UTC(parts[0], parts[1] - 1, parts[2]) - Date.UTC(1899, 11, 30)) / 86400000 };
  }
  if (typeof value === 'boolean') return { boolValue: value };
  if (typeof value === 'number' && Number.isFinite(value)) return { numberValue: value };
  return { stringValue: value == null ? '' : String(value) };
}
function paymentCellRequest(sheetId, row, column, value, key) {
  return { updateCells: {
    range: { sheetId: sheetId, startRowIndex: row - 1, endRowIndex: row, startColumnIndex: column - 1, endColumnIndex: column },
    rows: [{ values: [{ userEnteredValue: paymentUserValue(value, key) }] }], fields: 'userEnteredValue'
  } };
}
function paymentColumnIndexes(headers) {
  var columns = {};
  Object.keys(PAYMENT_COLUMNS).forEach(function (key) {
    var header = PAYMENT_COLUMNS[key], column = headers.indexOf(header);
    if (column < 0 || headers.indexOf(header, column + 1) >= 0) throw new Error('На листе «Статьи оплаты» отсутствует или неоднозначен заголовок «' + header + '»');
    columns[key] = column;
  });
  return columns;
}
function writePayrollChanges(table, results) {
  var changed = results.filter(function (x) { return x.changed; }); if (!changed.length) return 0;
  var headers = table.headers, sheet = table.sheet, writes = changed.filter(function (x) { return !x.remove; });
  var removals = changed.filter(function (x) { return x.remove; }), columns = writes.length ? paymentColumnIndexes(headers) : {};
  var sheetId = sheet.getSheetId(), parent = sheet.getParent();
  if (!parent || typeof parent.getId !== 'function') throw new Error('Не удалось определить таблицу для атомарной записи');
  var requests = [], nextRow = sheet.getLastRow() + 1;
  var plans = writes.map(function (entry) {
    var row = entry.row;
    if (!String(row.dealId == null ? '' : row.dealId).trim()) throw new Error('Статья ' + (row.id || 'без ID') + ': не указан ID сделки');
    return { row: row, target: row._row || nextRow++ };
  });
  removals.forEach(function (entry) {
    if (!String(entry.row.dealId == null ? '' : entry.row.dealId).trim()) throw new Error('Статья ' + (entry.row.id || 'без ID') + ': не указан ID сделки');
    if (!entry.row._row) throw new Error('Нельзя удалить статью без номера строки: ' + entry.row.id);
  });
  if (nextRow - 1 > sheet.getMaxRows()) requests.push({ appendDimension: { sheetId: sheetId, dimension: 'ROWS', length: nextRow - 1 - sheet.getMaxRows() } });
  plans.forEach(function (plan) {
    var row = plan.row;
    Object.keys(PAYMENT_COLUMNS).forEach(function (key) {
      if (row._row && PAYMENT_PRESERVED_ON_UPDATE[key]) return;
      var column = columns[key], value = key === 'status' ? displayStatus(row.status) : row[key] == null ? '' : row[key];
      var previous = row._values ? row._values[column] : '';
      if (row._row && previous === value) return;
      if (row._row && row._formulas && row._formulas[column]) throw new Error('Статья ' + row.id + ': поле «' + PAYMENT_COLUMNS[key] + '» содержит формулу. Атомарная запись отменена.');
      requests.push(paymentCellRequest(sheetId, plan.target, column + 1, value, key));
    });
    if (!row._row) requests.push({ setDataValidation: {
      range: { sheetId: sheetId, startRowIndex: plan.target - 1, endRowIndex: plan.target, startColumnIndex: columns.paid, endColumnIndex: columns.paid + 1 },
      rule: { condition: { type: 'BOOLEAN' }, strict: true, showCustomUi: true }
    } });
  });
  removals.sort(function (a, b) { return b.row._row - a.row._row; }).forEach(function (entry) {
    requests.push({ deleteDimension: { range: { sheetId: sheetId, dimension: 'ROWS', startIndex: entry.row._row - 1, endIndex: entry.row._row } } });
  });
  if (!requests.length) return 0;
  // One Sheets API transaction: if validation, checkbox setup, update or deletion fails,
  // no value, formula, note, validation, formatting or row operation is committed.
  Sheets.Spreadsheets.batchUpdate({ requests: requests }, parent.getId());
  return changed.length;
}

function ensurePaymentCheckbox(ss) {
  var sheet = getSheet(ss, PAYROLL_CONFIG.sheets.payments), values = sheet.getDataRange().getValues();
  var headerRow = findHeaderRow(values, ['ID статьи', 'Статус']);
  var headers = values[headerRow].map(function (x) { return String(x).trim(); });
  if (headers.indexOf('Оплатить') >= 0) return false;
  var column = headers.indexOf('Статус') + 2;
  sheet.insertColumnAfter(column - 1); sheet.getRange(headerRow + 1, column).setValue('Оплатить');
  if (sheet.getLastRow() > headerRow + 1) {
    var count = sheet.getLastRow() - headerRow - 1, checkboxes = sheet.getRange(headerRow + 2, column, count);
    checkboxes.insertCheckboxes();
    var statusColumn = headers.indexOf('Статус') + 1, statuses = sheet.getRange(headerRow + 2, statusColumn, count).getValues();
    checkboxes.setValues(statuses.map(function (row) { return [status(row[0]) === PayrollCore.STATUS.PAID]; }));
  }
  return true;
}

if (typeof module !== 'undefined') module.exports = { readPayrollWorkbook: readPayrollWorkbook, tableFromSheet: tableFromSheet, status: status, displayStatus: displayStatus, writePayrollChanges: writePayrollChanges, writePayrollDiagnostics: writePayrollDiagnostics, readPayrollDiagnostics: readPayrollDiagnostics, mergePayrollDiagnostic: mergePayrollDiagnostic, parsePayrollDiagnostic: parsePayrollDiagnostic, ensurePaymentCheckbox: ensurePaymentCheckbox, findHeaderRow: findHeaderRow };
