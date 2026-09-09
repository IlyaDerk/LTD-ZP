const test = require('node:test');
const assert = require('node:assert/strict');
const owner = require('../src/OwnerCore');
const rows = [
  { id: 'A', employeeId: 'E1', objectKey: 'O1', readyDate: '2026-08-05', status: 'К оплате', amount: 100, paymentDate: '' },
  { id: 'B', employeeId: 'E2', objectKey: 'O2', readyDate: '2026-08-12', status: 'Выплачено', amount: 200, paymentDate: '2026-08-15' },
  { id: 'C', employeeId: 'E1', objectKey: 'O2', readyDate: '', status: 'Запланировано', amount: 300, paymentDate: '' }
];
for (const [name, filters, expected] of [
  ['от включительно', { from: '2026-08-05' }, ['A', 'B']],
  ['до включительно', { to: '2026-08-05' }, ['A']],
  ['сотрудник', { employee: 'E1' }, ['A', 'C']],
  ['статус', { status: 'Выплачено' }, ['B']],
  ['объект', { object: 'O2' }, ['B', 'C']],
  ['комбинация', { from: '2026-08-05', to: '2026-08-05', employee: 'E1', status: 'К оплате', object: 'O1' }, ['A']],
  ['пустая выдача', { employee: 'missing' }, []]
]) test('фильтр: ' + name, () => assert.deepEqual(owner.view(rows, filters, []).rows.map(r => r.id), expected));

test('сводные показатели и выбранные статьи; PAID не входит в выбор', () => {
  assert.deepEqual(owner.view(rows, {}, ['A', 'B']).summary, { planned: 300, toPay: 100, paid: 200, total: 600, selectedCount: 1, selectedAmount: 100, count: 3 });
});
test('некорректный период, дата и статус отвергаются', () => {
  for (const f of [{ from: '2026-08-10', to: '2026-08-05' }, { from: '2026-02-30' }, { to: '08.05.2026' }, { status: 'PAID' }]) assert.throws(() => owner.filters(f));
});
test('план оплаты связан только с ID текущей выдачи', () => {
  assert.deepEqual(owner.plan(rows, ['A'], ['A']).map(r => r.id), ['A']);
  for (const ids of [[], ['missing'], ['A', 'A'], ['A', 'C'], ['B']]) assert.throws(() => owner.plan(rows, ids, ['A', 'B', 'C']));
  assert.throws(() => owner.plan(rows, ['A'], ['C']));
});
test('дубли источника не допускаются, включая постороннюю статью', () => {
  assert.throws(() => owner.view([...rows, rows[1]], {}, []), /дублирующий/);
  assert.throws(() => owner.plan([...rows, rows[1]], ['A'], ['A']), /дублирующий/);
});
test('снимок подтверждения меняется при изменении суммы или получателя, не зависит от порядка', () => {
  assert.equal(owner.fingerprint(rows), owner.fingerprint(rows.slice().reverse()));
  assert.notEqual(owner.fingerprint(rows), owner.fingerprint(rows.map(r => ({ ...r, amount: r.amount + 1 }))));
  assert.notEqual(owner.fingerprint(rows), owner.fingerprint(rows.map(r => ({ ...r, employeeId: 'OTHER' }))));
});
