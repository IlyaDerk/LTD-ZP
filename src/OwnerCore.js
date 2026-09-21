var PayrollOwnerCore = (function () {
  'use strict';
  var statuses = ['Запланировано', 'К оплате', 'Выплачено', 'Отменено'];
  function unique(rows) {
    var result = Object.create(null);
    rows.forEach(function (row) {
      if (!row.id || Object.prototype.hasOwnProperty.call(result, row.id)) throw new Error('Пустой или дублирующий ID статьи: ' + row.id);
      result[row.id] = row;
    });
    return result;
  }
  function filters(value) {
    value = value || {};
    var f = {};
    ['from', 'to', 'employee', 'status', 'object'].forEach(function (key) { f[key] = String(value[key] || '').trim(); });
    ['from', 'to'].forEach(function (key) {
      if (f[key] && (!/^\d{4}-\d{2}-\d{2}$/.test(f[key]) || !Number.isFinite(Date.parse(f[key])) || new Date(f[key]).toISOString().slice(0, 10) !== f[key])) throw new Error('Некорректная дата фильтра');
    });
    if (f.from && f.to && f.from > f.to) throw new Error('Дата «от» позже даты «до»');
    if (f.status && statuses.indexOf(f.status) < 0) throw new Error('Неизвестный статус фильтра');
    return f;
  }
  function matches(row, f) {
    return (!f.from || (row.readyDate && row.readyDate >= f.from)) && (!f.to || (row.readyDate && row.readyDate <= f.to)) &&
      (!f.employee || row.employeeId === f.employee) && (!f.status || row.status === f.status) && (!f.object || row.objectKey === f.object);
  }
  function summary(rows, selected) {
    var result = { planned: 0, toPay: 0, paid: 0, total: 0, selectedCount: 0, selectedAmount: 0, count: rows.length };
    rows.forEach(function (r) {
      var key = { 'Запланировано': 'planned', 'К оплате': 'toPay', 'Выплачено': 'paid' }[r.status];
      if (key) result[key] += r.amount;
      result.total += r.amount;
      if (selected.indexOf(r.id) >= 0 && r.status !== 'Выплачено') { result.selectedCount += 1; result.selectedAmount += r.amount; }
    });
    Object.keys(result).forEach(function (k) { result[k] = Math.round(result[k] * 100) / 100; });
    return result;
  }
  function view(rows, value, selected) {
    unique(rows);
    var f = filters(value), visible = rows.filter(function (r) { return matches(r, f); });
    return { filters: f, rows: visible, summary: summary(visible, selected || []) };
  }
  function plan(rows, ids, allowedIds) {
    var byId = unique(rows), seen = Object.create(null);
    if (!ids.length) throw new Error('Не выбраны статьи со статусом “К оплате”');
    return ids.map(function (id) {
      if (seen[id]) throw new Error('Повторный ID в выборе: ' + id);
      seen[id] = true;
      var row = byId[id];
      if (!row || allowedIds.indexOf(id) < 0) throw new Error('Статья отсутствует в текущей выдаче: ' + id);
      if (row.status !== 'К оплате' || row.paymentDate) throw new Error('Статья ' + id + ' не может быть оплачена: ' + row.status);
      if (!Number.isFinite(row.amount) || row.amount <= 0) throw new Error('Некорректная сумма статьи: ' + id);
      return row;
    });
  }
  function fingerprint(rows) {
    return JSON.stringify(rows.map(function (r) {
      return [r.id, r.dealId, r.employeeId, r.articleCode, r.ruleId, r.base, r.rate, r.share, r.amount, r.readyDate, r.status, r.paymentDate, r.updatedAt];
    }).sort(function (a, b) { return String(a[0]).localeCompare(String(b[0])); }));
  }
  return { statuses: statuses, unique: unique, filters: filters, matches: matches, view: view, summary: summary, plan: plan, fingerprint: fingerprint };
}());
if (typeof module !== 'undefined') module.exports = PayrollOwnerCore;
