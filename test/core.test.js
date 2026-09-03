const test = require('node:test');
const assert = require('node:assert/strict');
const core = require('../src/Core');
const f = require('./fixtures');

const calculate = input => core.calculate(input).rows;
const main = rows => rows.filter(x => x.articleCode.startsWith('DESIGN_PART'));
function captureCalculation(input) {
  const warnings = [], original = console.warn;
  console.warn = message => warnings.push(message);
  try { return { result: core.calculate(input), warnings }; } finally { console.warn = original; }
}

test('Москва: два акта, конкретные суммы, доли, даты и статусы', () => {
  const rows = calculate(f.input(f.deal()));
  assert.equal(rows.length, 3); // две части и заранее созданный бонус
  assert.deepEqual(main(rows).map(x => [x.amount, x.share, x.readyDate, x.status]), [[45000, .5, '2026-08-02', 'TO_PAY'], [45000, .5, '', 'PLANNED']]);
  assert.equal(rows.find(x => x.articleCode === 'REPAIR_BONUS_DESIGNER').amount, 20000);
});

test('коллажи при двух актах не создают дополнительную статью', () => {
  const a = calculate(f.input(f.deal({ visualType: 'Коллажи' })));
  const b = calculate(f.input(f.deal()));
  assert.equal(a.length, b.length); assert.equal(a.filter(x => x.articleCode.includes('COLLAGE')).length, 0);
});

test('Москва-инженер и Тамбов-визуализатор считаются независимо', () => {
  const rows = calculate(f.input(f.deal({ visualizer: 'Вера Виз', act2: '2026-08-05', act3: '2026-08-12' })));
  assert.deepEqual(rows.filter(x => x.articleCode.startsWith('DESIGN_')).map(x => [x.employeeId, x.amount, x.readyDate]), [['M1', 90000, '2026-08-05'], ['T2', 28000, '2026-08-12']]);
});

test('Тамбов: два акта рассчитывается по метражу', () => {
  const rows = calculate(f.input(f.deal({ engineer: 'Иван Тамбов' })));
  assert.deepEqual(main(rows).map(x => x.amount), [11200, 11200]);
});

test('развёртки Тамбова готовы после Акта 1', () => {
  const row = calculate(f.input(f.deal({ engineer: 'Иван Тамбов', rollouts: 'Да' }))).find(x => x.articleCode === 'DESIGN_ROLLOUTS');
  assert.deepEqual([row.base, row.rate, row.amount, row.readyDate, row.status], [80, 117, 9360, '2026-08-02', 'TO_PAY']);
});

test('бонус в проекте с двумя сотрудниками принадлежит инженеру и использует стоимость проекта', () => {
  const row = calculate(f.input(f.deal({ visualizer: 'Вера Виз', act2: '2026-08-05', repairDate: '2026-08-11' }))).find(x => x.articleCode === 'REPAIR_BONUS_DESIGNER');
  assert.deepEqual([row.employeeId, row.base, row.rate, row.amount, row.readyDate], ['M1', 200000, .1, 20000, '2026-08-11']);
});

test('ошибка пропускает всю сделку без диагностических статей', () => {
  const { result } = captureCalculation(f.input(f.deal({ engineer: 'Неизвестный' })));
  assert.equal(result.rows.length, 0);
  assert.equal(result.skippedDeals.length, 1);
  assert.match(result.skippedDeals[0].reasons.join(' '), /отсутствует/);
  assert.equal(JSON.stringify(result).includes('NEEDS_REVIEW'), false);
});

test('ошибочная сделка не мешает рассчитать остальные', () => {
  const bad = f.deal({ id: 'BAD', engineer: 'Неизвестный' });
  const good = f.deal({ id: 'GOOD' });
  const { result } = captureCalculation(f.input(bad, { deals: [bad, good] }));
  assert.equal(result.skippedDeals.length, 1);
  assert.equal(result.skippedDeals[0].dealId, 'BAD');
  assert.ok(result.rows.length > 0);
  assert.ok(result.rows.every(row => row.dealId === 'GOOD'));
});

test('для пропущенной сделки собираются все причины', () => {
  const { result, warnings } = captureCalculation(f.input(f.deal({ projectCost: 0, rollouts: 'Да' })));
  const reasons = result.skippedDeals[0].reasons;
  assert.equal(result.rows.length, 0);
  assert.ok(reasons.length >= 3);
  assert.ok(reasons.some(reason => /положительным числом/.test(reason)));
  assert.ok(reasons.some(reason => /развёрток/.test(reason)));
  assert.equal(warnings.length, 1);
  assert.match(warnings[0], /D1/);
  reasons.forEach(reason => assert.ok(warnings[0].includes(reason)));
});

test('до расчёта проверяются структура, сотрудник, модель, грейд, ставка и правило развёрток', () => {
  const structure = captureCalculation(f.input(f.deal({ visualizer: '' }))).result;
  assert.match(structure.skippedDeals[0].reasons.join(' '), /Визуализатор/);

  const duplicateEmployees = f.employees.concat({ ...f.employees[0], id: 'M2' });
  const employee = captureCalculation(f.input(f.deal(), { employees: duplicateEmployees })).result;
  assert.match(employee.skippedDeals[0].reasons.join(' '), /несколько действующих/);

  const incompleteEmployee = f.employees.map(item => item.id === 'M1' ? { ...item, model: 'Иная', grade: '' } : item);
  const modelAndGrade = captureCalculation(f.input(f.deal(), { employees: incompleteEmployee })).result;
  assert.match(modelAndGrade.skippedDeals[0].reasons.join(' '), /модель мотивации/);
  assert.match(modelAndGrade.skippedDeals[0].reasons.join(' '), /грейд/);

  const duplicateRates = { ...f.matrices, moscow: f.matrices.moscow.concat({ key: 'V', rate: .46, active: true }) };
  const rate = captureCalculation(f.input(f.deal(), { matrices: duplicateRates })).result;
  assert.match(rate.skippedDeals[0].reasons.join(' '), /несколько ставок/);

  const noRolloutRule = f.rules.filter(rule => rule.id !== 'R_TAMBOV_ROLLOUTS');
  const rollout = captureCalculation(f.input(f.deal({ engineer: 'Иван Тамбов', rollouts: 'Да' }), { rules: noRolloutRule })).result;
  assert.match(rollout.skippedDeals[0].reasons.join(' '), /R_TAMBOV_ROLLOUTS/);
});

test('нечётный фонд округляется один раз, остаток получает первая статья', () => {
  const matrices = { ...f.matrices, moscow: [{ key: 'V', rate: .50005, active: true }, { key: 'Бонус за ремонт', rate: .1, active: true }] };
  const rows = main(calculate(f.input(f.deal({ projectCost: 20000 }), { matrices })));
  assert.deepEqual(rows.map(x => x.amount), [5001, 5000]); assert.equal(rows.reduce((s, x) => s + x.amount, 0), 10001);
});

test('готовая статья выбирает исторические модель, грейд и ставку', () => {
  const employees = [{ id: 'E', name: 'История', active: true, model: 'Москва', grade: 'I', validFrom: '2026-01-01', validTo: '2026-08-10' }, { id: 'E', name: 'История', active: true, model: 'Москва', grade: 'II', validFrom: '2026-08-11' }];
  const row = calculate(f.input(f.deal({ engineer: 'История', act1: '2026-08-02' }), { employees }))[0];
  assert.deepEqual([row.rate, row.amount], [.35, 35000]);
});

test('reconcile идемпотентен, обновляет невыплаченное и сохраняет PAID', () => {
  const calculated = calculate(f.input(f.deal()));
  const first = core.reconcile([], calculated, '2026-08-20'); assert.ok(first.every(x => x.changed));
  const second = core.reconcile(first.map(x => x.row), calculated, '2026-08-21'); assert.ok(second.every(x => !x.changed));
  const changed = calculate(f.input(f.deal({ projectCost: 220000 })));
  assert.ok(core.reconcile(first.map(x => x.row), changed, '2026-08-21').some(x => x.changed));
  const paid = { ...first[0].row, status: 'PAID', paid: true, amount: 12345 };
  assert.equal(core.reconcile([paid], changed, '2026-08-22')[0].row.amount, 12345);
});

test('существующий дублирующий ключ останавливает запись', () => {
  const row = calculate(f.input(f.deal()))[0];
  assert.throws(() => core.reconcile([row, { ...row, id: 'OTHER' }], [row], '2026-08-21'), /Дублирующий ключ/);
});

test('оплата проводится целиком один раз и повтор блокируется', () => {
  const row = { status: 'TO_PAY', paid: false, amount: 45000 };
  const first = core.pay(row, '2026-08-25'); assert.deepEqual([first.ok, first.row.status, first.row.paymentDate], [true, 'PAID', '2026-08-25']);
  assert.equal(core.pay(first.row, '2026-08-26').ok, false);
});

test('изменение источника не меняет PAID и не создаёт корректировку', () => {
  const before = calculate(f.input(f.deal())); const paid = { ...before[0], status: 'PAID', paid: true, amount: 45000 };
  const after = calculate(f.input(f.deal({ projectCost: 300000 })));
  const merged = core.reconcile([paid], after, '2026-08-30');
  assert.equal(merged.filter(x => x.row.id === paid.id).length, 1); assert.equal(merged.find(x => x.row.id === paid.id).row.amount, 45000);
  assert.equal(merged.some(x => x.row.articleCode === 'PAYMENT_CORRECTION'), false);
});
