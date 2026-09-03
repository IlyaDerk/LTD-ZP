var PayrollCore = (function () {
  'use strict';
  var STATUS = { PLANNED: 'PLANNED', TO_PAY: 'TO_PAY', PAID: 'PAID', CANCELLED: 'CANCELLED' };

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
  function recipientSlot(rule) { return norm(rule.recipient).indexOf('визуализатор') >= 0 ? 'visualizer' : 'engineer'; }
  function recipientName(rule, deal) { return recipientSlot(rule) === 'visualizer' ? deal.visualizer : deal.engineer; }
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
    if (!Number.isFinite(Number(found[0].rate)) || Number(found[0].rate) <= 0) return { error: 'Ставка для модели «' + employee.model + '», грейда «' + employee.grade + '» и работы «' + key + '» должна быть положительным числом' };
    return { value: found[0] };
  }
  function makeId(parts) {
    var str = parts.join('|'), hash = 2166136261;
    for (var i = 0; i < str.length; i += 1) { hash ^= str.charCodeAt(i); hash = Math.imul(hash, 16777619); }
    return 'PAY-' + (hash >>> 0).toString(16).padStart(8, '0').toUpperCase();
  }
  function addError(errors, reason) { if (reason && errors.indexOf(reason) < 0) errors.push(reason); }
  function oneRule(rules, id, errors) {
    var found = rules.filter(function (rule) { return rule.active && rule.id === id; });
    if (found.length !== 1) {
      addError(errors, found.length ? 'Для правила «' + id + '» найдено несколько активных записей' : 'Не найдено активное правило «' + id + '»');
      return null;
    }
    return found[0];
  }
  function validateEmployee(rows, name, date, errors) {
    if (!norm(name) || norm(name) === 'нет') { addError(errors, 'Не указан получатель выплаты'); return null; }
    var result = findEmployee(rows, name, date);
    if (result.error) { addError(errors, result.error); return null; }
    var employee = result.value, model = norm(employee.model);
    if (model !== 'москва' && model !== 'тамбов') addError(errors, 'Для сотрудника «' + name + '» не указана поддерживаемая модель мотивации');
    if (!norm(employee.grade)) addError(errors, 'Для сотрудника «' + name + '» не указан грейд');
    return employee;
  }
  function expectedDesignRuleIds(deal, s, errors) {
    if (s.acts === 2) return ['R_2_PART_1', 'R_2_PART_2'];
    if (s.same) return ['R_3_SAME_PART_1', 'R_3_SAME_PART_2'];
    if (norm(deal.visualType).indexOf('3d') >= 0) return ['R_3_SPLIT_ENGINEERING', 'R_3_SPLIT_VISUAL_3D'];
    if (norm(deal.visualType).indexOf('коллаж') >= 0) return ['R_3_SPLIT_ENGINEERING', 'R_3_SPLIT_COLLAGE'];
    addError(errors, 'Для сделки с тремя актами не указан поддерживаемый тип визуализации');
    return ['R_3_SPLIT_ENGINEERING'];
  }
  function candidateRules(input, deal, s, errors, now) {
    var candidates = [];
    expectedDesignRuleIds(deal, s, errors).forEach(function (id) { var rule = oneRule(input.rules, id, errors); if (rule) candidates.push(rule); });
    var repairEmployee = validateEmployee(input.employees, deal.engineer, iso(deal.repairDate) || now, errors);
    if (repairEmployee) {
      var model = norm(repairEmployee.model);
      if (model === 'москва' || model === 'тамбов') {
        var repairId = model === 'москва' ? 'R_REPAIR_MSK_DESIGNER' : 'R_REPAIR_TMB_DESIGNER';
        var repairRule = oneRule(input.rules, repairId, errors); if (repairRule) candidates.push(repairRule);
      }
    }
    if (/^(да|есть)$/i.test(String(deal.rollouts || '').trim())) {
      var rolloutRule = oneRule(input.rules, 'R_TAMBOV_ROLLOUTS', errors);
      var rolloutEmployee = validateEmployee(input.employees, deal.engineer, iso(deal.act1) || now, errors);
      if (rolloutEmployee && norm(rolloutEmployee.model) !== 'тамбов') addError(errors, 'Для развёрток требуется сотрудник с моделью мотивации «Тамбов»');
      if (rolloutRule && rolloutEmployee && norm(rolloutEmployee.model) === 'тамбов') candidates.push(rolloutRule);
    }
    return candidates;
  }
  function calculateDeal(input, deal, now) {
    var errors = [], items = [], s = structure(deal);
    if (!norm(deal.engineer)) addError(errors, 'Не указан инженер-дизайнер');
    if (!s) addError(errors, 'Заполните поле «Визуализатор / Нет»: «Нет» для двух актов или однозначное ФИО для трёх актов');
    if (!s) return { rows: [], reasons: errors };
    var rules = candidateRules(input, deal, s, errors, now);
    rules.forEach(function (rule) {
      var date = readyDate(rule, deal), employee = validateEmployee(input.employees, recipientName(rule, deal), date || now, errors);
      if (!employee) return;
      var model = norm(employee.model);
      if (model !== 'москва' && model !== 'тамбов') return;
      var base = model === 'москва' || rule.id.indexOf('R_REPAIR_') === 0 ? Number(deal.projectCost) : Number(deal.area);
      if (!Number.isFinite(base) || base <= 0) addError(errors, 'Расчётная база для правила «' + rule.id + '» должна быть положительным числом');
      var rateResult = rateFor(rule, deal, employee, input.matrices, date || now);
      if (rateResult.error) addError(errors, rateResult.error);
      if (!Number.isFinite(Number(rule.share)) || Number(rule.share) <= 0) addError(errors, 'Доля правила «' + rule.id + '» должна быть положительным числом');
      if (!Number.isFinite(base) || base <= 0 || rateResult.error || !Number.isFinite(Number(rule.share)) || Number(rule.share) <= 0) return;
      var slot = recipientSlot(rule), naturalKey = [deal.id, rule.id, rule.articleCode, slot].join('|');
      items.push({ id: makeId([deal.id, rule.id, rule.articleCode, slot]), naturalKey: naturalKey, dealId: String(deal.id), employeeId: employee.id, articleCode: rule.articleCode, ruleId: rule.id, recipientSlot: slot, base: base, rate: Number(rateResult.value.rate), share: Number(rule.share), fund: Math.round(base * Number(rateResult.value.rate)), readyDate: date, status: date ? STATUS.TO_PAY : STATUS.PLANNED, paid: false, paymentDate: '', comment: '' });
    });
    return errors.length ? { rows: [], reasons: errors } : { rows: items, reasons: [] };
  }
  function calculate(input) {
    var out = [], skippedDeals = [], now = iso(input.now || new Date());
    input.deals.forEach(function (deal) {
      var result = calculateDeal(input, deal, now);
      if (result.reasons.length) {
        var skipped = { dealId: String(deal.id), reasons: result.reasons };
        skippedDeals.push(skipped);
        if (typeof console !== 'undefined' && console.warn) console.warn('Сделка ' + skipped.dealId + ' пропущена: ' + skipped.reasons.join('; '));
        return;
      }
      Array.prototype.push.apply(out, result.rows);
    });
    var groups = {};
    out.forEach(function (x) { var k = x.dealId + '|' + x.employeeId + '|' + x.fund; (groups[k] || (groups[k] = [])).push(x); });
    Object.keys(groups).forEach(function (k) {
      var xs = groups[k].sort(function (a, b) { return a.ruleId.localeCompare(b.ruleId); });
      if (xs.length > 1 && Math.abs(xs.reduce(function (sum, x) { return sum + x.share; }, 0) - 1) < 1e-9) {
        var rest = 0; for (var i = 1; i < xs.length; i += 1) { xs[i].amount = Math.floor(xs[i].fund * xs[i].share); rest += xs[i].amount; } xs[0].amount = xs[0].fund - rest;
      } else xs.forEach(function (x) { x.amount = Math.round(x.fund * x.share); });
    });
    return { rows: out, skippedDeals: skippedDeals };
  }
  function comparable(x) {
    var keys = ['id', 'dealId', 'employeeId', 'articleCode', 'ruleId', 'base', 'rate', 'share', 'amount', 'readyDate', 'status', 'paid', 'paymentDate', 'comment'];
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
