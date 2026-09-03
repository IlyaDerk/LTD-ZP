const test = require('node:test');
const assert = require('node:assert/strict');
const core = require('../src/Core');
const f = require('./fixtures');

const main = rows => rows.filter(x => x.articleCode.startsWith('DESIGN_PART'));

test('Москва: два акта, конкретные суммы, доли, даты и статусы', () => {
  const rows = core.calculate(f.input(f.deal()));
  assert.equal(rows.length, 3); // две части и заранее созданный бонус
  assert.deepEqual(main(rows).map(x => [x.amount, x.share, x.readyDate, x.status]), [[45000, .5, '2026-08-02', 'TO_PAY'], [45000, .5, '', 'PLANNED']]);
  assert.equal(rows.find(x => x.articleCode === 'REPAIR_BONUS_DESIGNER').amount, 20000);
});

test('коллажи при двух актах не создают дополнительную статью', () => {
  const a = core.calculate(f.input(f.deal({ visualType: 'Коллажи' })));
  const b = core.calculate(f.input(f.deal()));
  assert.equal(a.length, b.length); assert.equal(a.filter(x => x.articleCode.includes('COLLAGE')).length, 0);
});

test('Москва-инженер и Тамбов-визуализатор считаются независимо', () => {
  const rows = core.calculate(f.input(f.deal({ visualizer: 'Вера Виз', act2: '2026-08-05', act3: '2026-08-12' })));
  assert.deepEqual(rows.filter(x => x.articleCode.startsWith('DESIGN_')).map(x => [x.employeeId, x.amount, x.readyDate]), [['M1', 90000, '2026-08-05'], ['T2', 28000, '2026-08-12']]);
});

test('Тамбов: два акта рассчитывается по метражу', () => {
  const rows = core.calculate(f.input(f.deal({ engineer: 'Иван Тамбов' })));
  assert.deepEqual(main(rows).map(x => x.amount), [11200, 11200]);
});

test('развёртки Тамбова готовы после Акта 1', () => {
  const row = core.calculate(f.input(f.deal({ engineer: 'Иван Тамбов', rollouts: 'Да' }))).find(x => x.articleCode === 'DESIGN_ROLLOUTS');
  assert.deepEqual([row.base, row.rate, row.amount, row.readyDate, row.status], [80, 117, 9360, '2026-08-02', 'TO_PAY']);
});

test('бонус в проекте с двумя сотрудниками принадлежит инженеру и использует стоимость проекта', () => {
  const row = core.calculate(f.input(f.deal({ visualizer: 'Вера Виз', act2: '2026-08-05', repairDate: '2026-08-11' }))).find(x => x.articleCode === 'REPAIR_BONUS_DESIGNER');
  assert.deepEqual([row.employeeId, row.base, row.rate, row.amount, row.readyDate], ['M1', 200000, .1, 20000, '2026-08-11']);
});

test('отсутствующий сотрудник и отсутствующая ставка дают прикладной NEEDS_REVIEW', () => {
  const missingEmployee = core.calculate(f.input(f.deal({ engineer: 'Неизвестный' })));
  assert.equal(missingEmployee[0].status, 'NEEDS_REVIEW'); assert.match(missingEmployee[0].reviewReason, /отсутствует/);
  const missingRate = core.calculate(f.input(f.deal({ engineer: 'Иван Тамбов', package: 'Неизвестный пакет' })));
  assert.equal(missingRate[0].status, 'NEEDS_REVIEW'); assert.match(missingRate[0].reviewReason, /не найдена/);
});

test('неоднозначная структура и отсутствующее правило развёрток дают NEEDS_REVIEW', () => {
  const structure = core.calculate(f.input(f.deal({ visualizer: '' })));
  assert.equal(structure.length, 1); assert.match(structure[0].reviewReason, /Визуализатор/);
  const rollout = core.calculate(f.input(f.deal({ rollouts: 'Да' }))).find(x => x.articleCode === 'DESIGN_ROLLOUTS');
  assert.equal(rollout.status, 'NEEDS_REVIEW'); assert.match(rollout.reviewReason, /правило/);
});

test('нечётный фонд округляется один раз, остаток получает первая статья', () => {
  const matrices = { ...f.matrices, moscow: [{ key: 'V', rate: .50005, active: true }, { key: 'Бонус за ремонт', rate: .1, active: true }] };
  const rows = main(core.calculate(f.input(f.deal({ projectCost: 20000 }), { matrices })));
  assert.deepEqual(rows.map(x => x.amount), [5001, 5000]); assert.equal(rows.reduce((s, x) => s + x.amount, 0), 10001);
});

test('готовая статья выбирает исторические модель, грейд и ставку', () => {
  const employees = [{ id: 'E', name: 'История', active: true, model: 'Москва', grade: 'I', validFrom: '2026-01-01', validTo: '2026-08-10' }, { id: 'E', name: 'История', active: true, model: 'Москва', grade: 'II', validFrom: '2026-08-11' }];
  const row = core.calculate(f.input(f.deal({ engineer: 'История', act1: '2026-08-02' }), { employees }))[0];
  assert.deepEqual([row.rate, row.amount], [.35, 35000]);
});

test('reconcile идемпотентен, обновляет невыплаченное и сохраняет PAID', () => {
  const calculated = core.calculate(f.input(f.deal()));
  const first = core.reconcile([], calculated, '2026-08-20'); assert.ok(first.every(x => x.changed));
  const second = core.reconcile(first.map(x => x.row), calculated, '2026-08-21'); assert.ok(second.every(x => !x.changed));
  const changed = core.calculate(f.input(f.deal({ projectCost: 220000 })));
  assert.ok(core.reconcile(first.map(x => x.row), changed, '2026-08-21').some(x => x.changed));
  const paid = { ...first[0].row, status: 'PAID', paid: true, amount: 12345 };
  assert.equal(core.reconcile([paid], changed, '2026-08-22')[0].row.amount, 12345);
});

test('существующий дублирующий ключ останавливает запись', () => {
  const row = core.calculate(f.input(f.deal()))[0];
  assert.throws(() => core.reconcile([row, { ...row, id: 'OTHER' }], [row], '2026-08-21'), /Дублирующий ключ/);
});

test('оплата проводится целиком один раз и повтор блокируется', () => {
  const row = { status: 'TO_PAY', paid: false, amount: 45000 };
  const first = core.pay(row, '2026-08-25'); assert.deepEqual([first.ok, first.row.status, first.row.paymentDate], [true, 'PAID', '2026-08-25']);
  assert.equal(core.pay(first.row, '2026-08-26').ok, false);
});

test('изменение источника не меняет PAID и не создаёт корректировку', () => {
  const before = core.calculate(f.input(f.deal())); const paid = { ...before[0], status: 'PAID', paid: true, amount: 45000 };
  const after = core.calculate(f.input(f.deal({ projectCost: 300000 })));
  const merged = core.reconcile([paid], after, '2026-08-30');
  assert.equal(merged.filter(x => x.row.id === paid.id).length, 1); assert.equal(merged.find(x => x.row.id === paid.id).row.amount, 45000);
  assert.equal(merged.some(x => x.row.articleCode === 'PAYMENT_CORRECTION'), false);
});
