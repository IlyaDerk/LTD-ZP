var PayrollCore = (function () {
  'use strict';
  var STATUS = { PLANNED: 'PLANNED', TO_PAY: 'TO_PAY', PAID: 'PAID', REVIEW: 'NEEDS_REVIEW', CANCELLED: 'CANCELLED' };

  function norm(v) { return String(v == null ? '' : v).trim().replace(/\s+/g, ' ').toLocaleLowerCase('ru-RU'); }
  function iso(v) {
    if (!v) return '';
    if (v instanceof Date) return isNaN(v.getTime()) ? '' : v.toISOString().slice(0, 10);
    var m = String(v).trim().match(/^(\d{1,2})[./](\d{1,2})[./](\d{4})$/);
    return m ? m[3] + '-' + m[2].padStart(2, '0') + '-' + m[1].padStart(2, '0') : String(v).slice(0, 10);
  }
  function activeOn(row, date) {
    var d = iso(date), from = iso(row.validFrom), to = iso(row.validTo);
    return row.active !== false && (!from || from <= d) && (!to || d <= to);
  }
  function structure(deal) {
    if (norm(deal.visualizer) === 'нет') return { acts: 2, same: true };
    if (!norm(deal.visualizer)) return null;
    return { acts: 3, same: norm(deal.visualizer) === norm(deal.engineer) };
  }
  function eligible(rule, deal, employee, s) {
    var id = rule.id;
    if (id.indexOf('R_2_') === 0) return s.acts === 2;
    if (id.indexOf('R_3_SAME_') === 0) return s.acts === 3 && s.same;
    if (id === 'R_3_SPLIT_ENGINEERING') return s.acts === 3 && !s.same;
    if (id === 'R_3_SPLIT_VISUAL_3D') return s.acts === 3 && !s.same && norm(deal.visualType).indexOf('3d') >= 0;
    if (id === 'R_3_SPLIT_COLLAGE') return s.acts === 3 && !s.same && norm(deal.visualType).indexOf('коллаж') >= 0;
    if (id === 'R_TAMBOV_ROLLOUTS') return /^(да|есть)$/i.test(String(deal.rollouts || '').trim()) && employee && norm(employee.model) === 'тамбов';
    if (id === 'R_REPAIR_MSK_DESIGNER') return employee && norm(employee.model) === 'москва';
    if (id === 'R_REPAIR_TMB_DESIGNER') return employee && norm(employee.model) === 'тамбов';
    return false;
  }
  function readyDate(rule, d) {
    if (rule.id === 'R_2_PART_1' || rule.id === 'R_TAMBOV_ROLLOUTS') return iso(d.act1);
    if (rule.id === 'R_2_PART_2') return iso(d.act2);
    if (rule.id === 'R_3_SPLIT_VISUAL_3D' || rule.id === 'R_3_SPLIT_COLLAGE' || rule.id === 'R_3_SAME_PART_2') return iso(d.act3);
    if (rule.id === 'R_3_SPLIT_ENGINEERING' || rule.id === 'R_3_SAME_PART_1') {
      var a = iso(d.act1), b = iso(d.act2); return a && b ? (a > b ? a : b) : '';
    }
    if (rule.id.indexOf('R_REPAIR_') === 0) return iso(d.repairDate);
    return '';
  }
  function recipientName(rule, deal) { return norm(rule.recipient).indexOf('визуализатор') >= 0 ? deal.visualizer : deal.engineer; }
  function findEmployee(rows, name, date) {
    var matches = rows.filter(function (e) { return norm(e.name) === norm(name) && activeOn(e, date); });
    return matches.length === 1 ? { value: matches[0] } : { error: !matches.length ? 'ФИО «' + name + '» отсутствует в действующем справочнике сотрудников' : 'Для ФИО «' + name + '» найдено несколько действующих записей' };
  }
  function workKey(rule, deal) {
    if (rule.id === 'R_TAMBOV_ROLLOUTS') return 'Развёртки';
    if (rule.id === 'R_3_SPLIT_VISUAL_3D') return '3D-визуализация';
    if (rule.id === 'R_3_SPLIT_COLLAGE') return 'Коллажи';
    if (rule.id.indexOf('R_REPAIR_') === 0) return 'Бонус за ремонт';
    return deal.package;
  }
  function rateFor(rule, deal, employee, matrices, date) {
    var model = norm(employee.model), rows = model === 'москва' ? matrices.moscow : model === 'тамбов' ? matrices.tambov : [];
    var key = rule.id.indexOf('R_REPAIR_') === 0 ? 'Бонус за ремонт' : model === 'москва' ? employee.grade : workKey(rule, deal);
    var found = rows.filter(function (r) { return activeOn(r, date) && norm(r.key) === norm(key) && (model !== 'тамбов' || norm(r.grade) === norm(employee.grade)); });
    if (found.length !== 1) return { error: 'Для модели «' + employee.model + '», грейда «' + employee.grade + '» и работы «' + key + '» ' + (found.length ? 'найдено несколько ставок' : 'не найдена действующая ставка') };
    return { value: found[0] };
  }
  function makeId(parts) {
    var str = parts.join('|'), hash = 2166136261;
    for (var i = 0; i < str.length; i += 1) { hash ^= str.charCodeAt(i); hash = Math.imul(hash, 16777619); }
    return 'PAY-' + (hash >>> 0).toString(16).padStart(8, '0').toUpperCase();
  }
  function calculate(input) {
    var out = [], now = iso(input.now || new Date());
    input.deals.forEach(function (deal) {
      var s = structure(deal);
      if (!s) {
        out.push({ id: makeId([deal.id, 'STRUCTURE_REVIEW']), naturalKey: [deal.id, 'STRUCTURE_REVIEW'].join('|'), dealId: String(deal.id), employeeId: '', articleCode: '', ruleId: '', recipientSlot: 'engineer', readyDate: '', status: STATUS.REVIEW, paid: false, paymentDate: '', reviewReason: 'Заполните поле «Визуализатор / Нет»: «Нет» для двух актов или однозначное ФИО для трёх актов', comment: '' });
        return;
      }
      input.rules.filter(function (r) { return r.active; }).forEach(function (rule) {
        var provisionalDate = readyDate(rule, deal) || now;
        var employeeResult = findEmployee(input.employees, recipientName(rule, deal), provisionalDate);
        var employee = employeeResult.value;
        if (!eligible(rule, deal, employee, s)) return;
        var slot = norm(rule.recipient).indexOf('визуализатор') >= 0 ? 'visualizer' : 'engineer';
        var naturalKey = [deal.id, rule.id, rule.articleCode, slot].join('|');
        var item = { id: makeId([deal.id, rule.id, rule.articleCode, slot]), naturalKey: naturalKey, dealId: String(deal.id), employeeId: employee ? employee.id : '', articleCode: rule.articleCode, ruleId: rule.id, recipientSlot: slot, readyDate: readyDate(rule, deal), paid: false, paymentDate: '', comment: '' };
        if (employeeResult.error) { item.status = STATUS.REVIEW; item.reviewReason = employeeResult.error; out.push(item); return; }
        var rateResult = rateFor(rule, deal, employee, input.matrices, item.readyDate || now);
        var base = norm(employee.model) === 'москва' || rule.id.indexOf('R_REPAIR_') === 0 ? Number(deal.projectCost) : Number(deal.area);
        if (!Number.isFinite(base) || base <= 0) { item.status = STATUS.REVIEW; item.reviewReason = 'Заполните положительную расчётную базу для сделки ' + deal.id; out.push(item); return; }
        if (rateResult.error) { item.status = STATUS.REVIEW; item.reviewReason = rateResult.error; out.push(item); return; }
        item.base = base; item.rate = Number(rateResult.value.rate); item.share = Number(rule.share); item.fund = Math.round(base * item.rate); item.status = item.readyDate ? STATUS.TO_PAY : STATUS.PLANNED; item.reviewReason = '';
        out.push(item);
      });
      if (/^(да|есть)$/i.test(String(deal.rollouts || '').trim()) && !out.some(function (x) { return x.dealId === String(deal.id) && x.articleCode === 'DESIGN_ROLLOUTS'; })) {
        out.push({ id: makeId([deal.id, 'ROLLOUTS_NO_RULE', 'engineer']), naturalKey: [deal.id, 'ROLLOUTS_NO_RULE', 'DESIGN_ROLLOUTS', 'engineer'].join('|'), dealId: String(deal.id), employeeId: '', articleCode: 'DESIGN_ROLLOUTS', ruleId: '', recipientSlot: 'engineer', readyDate: iso(deal.act1), status: STATUS.REVIEW, paid: false, paymentDate: '', reviewReason: 'Для модели инженера не найдено активное правило расчёта развёрток; добавьте однозначное правило и ставку в матрицу', comment: '' });
      }
    });
    var groups = {};
    out.filter(function (x) { return x.status !== STATUS.REVIEW; }).forEach(function (x) { var k = x.dealId + '|' + x.employeeId + '|' + x.fund; (groups[k] || (groups[k] = [])).push(x); });
    Object.keys(groups).forEach(function (k) {
      var xs = groups[k].sort(function (a, b) { return a.ruleId.localeCompare(b.ruleId); });
      if (xs.length > 1 && Math.abs(xs.reduce(function (s, x) { return s + x.share; }, 0) - 1) < 1e-9) {
        var rest = 0; for (var i = 1; i < xs.length; i += 1) { xs[i].amount = Math.floor(xs[i].fund * xs[i].share); rest += xs[i].amount; } xs[0].amount = xs[0].fund - rest;
      } else xs.forEach(function (x) { x.amount = Math.round(x.fund * x.share); });
    });
    return out;
  }
  function comparable(x) {
    var keys = ['id', 'dealId', 'employeeId', 'articleCode', 'ruleId', 'base', 'rate', 'share', 'amount', 'readyDate', 'status', 'paid', 'paymentDate', 'reviewReason', 'comment'];
    var c = {}; keys.forEach(function (k) { c[k] = x[k] == null ? '' : x[k]; }); return JSON.stringify(c);
  }
  function reconcile(existing, calculated, now) {
    var byId = {}, byKey = {}; existing.forEach(function (x) {
      if (byId[x.id]) throw new Error('Дублирующий ID статьи: ' + x.id);
      if (x.naturalKey && byKey[x.naturalKey]) throw new Error('Дублирующий ключ статьи: ' + x.naturalKey);
      byId[x.id] = x; if (x.naturalKey) byKey[x.naturalKey] = x;
    });
    return calculated.map(function (next) {
      var old = byId[next.id] || byKey[next.naturalKey];
      if (old && (old.status === STATUS.PAID || old.status === STATUS.CANCELLED)) return { row: old, changed: false };
      if (old && comparable(old) === comparable(Object.assign({}, next, { createdAt: old.createdAt, updatedAt: old.updatedAt }))) return { row: old, changed: false };
      return { row: Object.assign({}, next, { _row: old && old._row, _values: old && old._values, id: old ? old.id : next.id, createdAt: old ? old.createdAt : now, updatedAt: now }), changed: true };
    });
  }
  function pay(row, date) {
    if (row.status !== STATUS.TO_PAY || row.paid) return { ok: false, reason: 'Оплата разрешена только один раз для статьи TO_PAY', row: row };
    return { ok: true, row: Object.assign({}, row, { status: STATUS.PAID, paid: true, paymentDate: iso(date), updatedAt: iso(date) }) };
  }
  return { STATUS: STATUS, normalize: norm, toIsoDate: iso, calculate: calculate, reconcile: reconcile, pay: pay };
}());

if (typeof module !== 'undefined') module.exports = PayrollCore;
