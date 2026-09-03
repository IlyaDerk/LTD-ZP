/* exported readPayrollWorkbook, writePayrollChanges, rebuildReviewSheet, findHeaderRow */
function findHeaderRow(values, required) {
  for (var r = 0; r < Math.min(values.length, 20); r += 1) {
    var cells = values[r].map(function (x) { return String(x).trim(); });
    if (required.every(function (h) { return cells.indexOf(h) >= 0; })) return r;
  }
  throw new Error('Не найдена строка заголовков: ' + required.join(', '));
}

function tableFromSheet(sheet, required) {
  var range = sheet.getDataRange(), values = range.getValues(), headerRow = findHeaderRow(values, required);
  var headers = values[headerRow].map(function (x) { return String(x).trim(); });
  var rows = values.slice(headerRow + 1).filter(function (row) { return row.some(function (v) { return v !== ''; }); });
  return { sheet: sheet, headerRow: headerRow, headers: headers, rows: rows.map(function (row, index) {
    var object = { _row: headerRow + index + 2, _values: row.slice() };
    headers.forEach(function (h, i) { if (h) object[h] = row[i]; }); return object;
  }) };
}

function bool(v) { return v === true || /^(true|да|1)$/i.test(String(v).trim()); }
function number(v) { if (typeof v === 'number') return v; var s = String(v || '').replace(/\s/g, '').replace(',', '.').replace(/[^\d.-]/g, ''); return Number(s); }
function status(v) {
  var n = PayrollCore.normalize(v), map = { 'запланировано': 'PLANNED', 'к оплате': 'TO_PAY', 'выплачено': 'PAID', 'на уточнении': 'NEEDS_REVIEW', 'отменено': 'CANCELLED' };
  return map[n] || String(v || '');
}
function getSheet(ss, name) { var s = ss.getSheetByName(name); if (!s) throw new Error('Отсутствует обязательный лист «' + name + '»'); return s; }

function readPayrollWorkbook(ss) {
  var c = PAYROLL_CONFIG.sheets;
  var deals = tableFromSheet(getSheet(ss, c.deals), ['ID сделки', 'Инженер-дизайнер', 'Визуализатор / Нет']);
  var employees = tableFromSheet(getSheet(ss, c.employees), ['ID сотрудника', 'ФИО', 'Модель мотивации', 'Грейд']);
  var types = tableFromSheet(getSheet(ss, c.articleTypes), ['Код статьи', 'Активна']);
  var rules = tableFromSheet(getSheet(ss, c.rules), ['ID правила', 'Код статьи', 'Получатель', 'Доля']);
  var moscow = tableFromSheet(getSheet(ss, c.moscow), ['Грейд / начисление', 'Ставка за дизайн-проект']);
  var tambov = tableFromSheet(getSheet(ss, c.tambov), ['Работа или пакет', 'I', 'Единица']);
  var payments = tableFromSheet(getSheet(ss, c.payments), ['ID статьи', 'ID сделки', 'ID сотрудника', 'Код статьи', 'ID правила', 'Расчётная база', 'Ставка', 'Доля', 'Расчётная сумма', 'Дата готовности', 'Статус', 'Дата выплаты', 'Причина уточнения', 'Комментарий', 'Создано', 'Обновлено']);
  getSheet(ss, c.review); getSheet(ss, c.owner);
  var activeCodes = {}; types.rows.forEach(function (x) { if (bool(x['Активна'])) activeCodes[x['Код статьи']] = true; });
  var ruleRows = rules.rows.filter(function (x) { return bool(x['Активно']) && activeCodes[x['Код статьи']]; }).map(function (x) { return { id: x['ID правила'], active: true, articleCode: x['Код статьи'], recipient: x['Получатель'], share: number(x['Доля']) / (String(x['Доля']).indexOf('%') >= 0 ? 100 : 1) }; });
  var matrices = { moscow: moscow.rows.filter(function (x) { return bool(x['Активна']); }).map(function (x) { return { key: x['Грейд / начисление'], grade: '', rate: number(x['Ставка за дизайн-проект']) / (String(x['Ставка за дизайн-проект']).indexOf('%') >= 0 ? 100 : 1), active: true, validFrom: x['Действует с'], validTo: x['Действует по'] }; }), tambov: [] };
  tambov.rows.filter(function (x) { return bool(x['Активна']); }).forEach(function (x) { ['I', 'II', 'III', 'IV', 'V', 'VI'].forEach(function (g) { var rate = number(x[g]); if (x['Единица'] === 'Процент' && rate > 1) rate /= 100; matrices.tambov.push({ key: x['Работа или пакет'], grade: g, rate: rate, active: true, validFrom: x['Действует с'], validTo: x['Действует по'] }); }); });
  var ruleById = {}; ruleRows.forEach(function (r) { ruleById[r.id] = r; });
  return {
    deals: deals.rows.map(function (x) { return { id: x['ID сделки'], objectName: x['Название сделки'], projectCost: number(x['Стоимость дизайн-проекта']), area: number(x['Метраж после замера']), package: x['Пакет дизайна'], visualType: x['Тип визуализации'], rollouts: x['Развёртки'], engineer: x['Инженер-дизайнер'], visualizer: x['Визуализатор / Нет'], act1: x['Дата выполнения Акта №1'], act2: x['Дата выполнения Акта №2'], act3: x['Дата выполнения Акта №3'], repairDate: x['Дата подписания ремонта'] }; }),
    employees: employees.rows.map(function (x) { return { id: x['ID сотрудника'], name: x['ФИО'], active: bool(x['Активен']), model: x['Модель мотивации'], grade: x['Грейд'], role: x['Основная роль'], validFrom: x['Действует с'], validTo: x['Действует по'] }; }),
    rules: ruleRows, matrices: matrices, paymentTable: payments,
    existing: payments.rows.map(function (x) { var rule = ruleById[x['ID правила']] || {}; var slot = PayrollCore.normalize(rule.recipient).indexOf('визуализатор') >= 0 ? 'visualizer' : 'engineer'; return { _row: x._row, _values: x._values, id: x['ID статьи'], naturalKey: [x['ID сделки'], x['ID правила'], x['Код статьи'], slot].join('|'), dealId: String(x['ID сделки']), employeeId: x['ID сотрудника'], articleCode: x['Код статьи'], ruleId: x['ID правила'], recipientSlot: slot, base: number(x['Расчётная база']), rate: number(x['Ставка']), share: number(x['Доля']), amount: number(x['Расчётная сумма']), readyDate: PayrollCore.toIsoDate(x['Дата готовности']), status: status(x['Статус']), paid: bool(x['Оплатить']) || status(x['Статус']) === 'PAID', paymentDate: PayrollCore.toIsoDate(x['Дата выплаты']), reviewReason: x['Причина уточнения'] || '', comment: x['Комментарий'] || '', createdAt: PayrollCore.toIsoDate(x['Создано']), updatedAt: PayrollCore.toIsoDate(x['Обновлено']) }; })
  };
}

var PAYMENT_COLUMNS = { id: 'ID статьи', dealId: 'ID сделки', employeeId: 'ID сотрудника', articleCode: 'Код статьи', ruleId: 'ID правила', base: 'Расчётная база', rate: 'Ставка', share: 'Доля', amount: 'Расчётная сумма', readyDate: 'Дата готовности', status: 'Статус', paid: 'Оплатить', paymentDate: 'Дата выплаты', reviewReason: 'Причина уточнения', comment: 'Комментарий', createdAt: 'Создано', updatedAt: 'Обновлено' };
function writePayrollChanges(table, results) {
  var changed = results.filter(function (x) { return x.changed; }); if (!changed.length) return 0;
  var headers = table.headers, sheet = table.sheet;
  Object.keys(PAYMENT_COLUMNS).forEach(function (k) { if (headers.indexOf(PAYMENT_COLUMNS[k]) < 0) throw new Error('На листе «Статьи оплаты» отсутствует заголовок «' + PAYMENT_COLUMNS[k] + '»'); });
  changed.forEach(function (entry) {
    var row = entry.row, target = row._row || sheet.getLastRow() + 1;
    var values = headers.map(function (h, i) { var key = Object.keys(PAYMENT_COLUMNS).find(function (k) { return PAYMENT_COLUMNS[k] === h; }); return key ? (row[key] == null ? '' : row[key]) : (row._values ? row._values[i] : ''); });
    sheet.getRange(target, 1, 1, headers.length).setValues([values]);
    if (!row._row) sheet.getRange(target, headers.indexOf('Оплатить') + 1).insertCheckboxes();
  }); return changed.length;
}

function rebuildReviewSheet(ss, rows, deals) {
  var sheet = getSheet(ss, PAYROLL_CONFIG.sheets.review), headers = ['Объект', 'ID сделки', 'Сотрудник / роль', 'Статья', 'Причина', 'Что исправить'];
  var names = {}; deals.forEach(function (d) { names[d.id] = d.objectName; });
  sheet.clearContents(); sheet.getRange(1, 1, 1, headers.length).setValues([headers]);
  var review = rows.filter(function (x) { return x.status === 'NEEDS_REVIEW'; }).map(function (x) { return [names[x.dealId] || '', x.dealId, x.employeeId || x.recipientSlot, x.articleCode, x.reviewReason, x.reviewReason]; });
  if (review.length) sheet.getRange(2, 1, review.length, headers.length).setValues(review);
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
