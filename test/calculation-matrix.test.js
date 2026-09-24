const test = require('node:test');
const assert = require('node:assert/strict');
const core = require('../src/Core');
const fixture = require('./fixtures');

const grades = ['I', 'II', 'III', 'IV', 'V', 'VI'];
const moscowRates = { I: .35, II: .375, III: .40, IV: .425, V: .45, VI: .475 };
const tambovRates = {
  'Старт': [105, 113, 120, 127, 135, 143],
  'Инженерный': [280, 300, 320, 340, 360, 380],
  'Инженерный расширенный': [373, 400, 427, 453, 480, 507],
  '3D-визуализация': [350, 375, 400, 425, 450, 475],
  'Коллажи': [187, 200, 213, 227, 240, 253],
  'Развёртки': [117, 125, 133, 141, 150, 158],
  'Бонус за ремонт': [.05, .05, .05, .05, .05, .05]
};
const matrices = {
  moscow: grades.map(grade => ({ key: grade, rate: moscowRates[grade], active: true })).concat({ key: 'Бонус за ремонт', rate: .10, active: true }),
  tambov: Object.entries(tambovRates).flatMap(([key, rates]) => rates.map((rate, index) => ({ key, grade: grades[index], rate, active: true })))
};
const employees = [
  { id: 'M-ENG', name: 'Инженер Москва', active: true, model: 'Москва', grade: 'V', validFrom: '2026-01-01' },
  { id: 'M-VIS', name: 'Визуализатор Москва', active: true, model: 'Москва', grade: 'II', validFrom: '2026-01-01' },
  { id: 'T-ENG', name: 'Инженер Тамбов', active: true, model: 'Тамбов', grade: 'I', validFrom: '2026-01-01' },
  { id: 'T-VIS', name: 'Визуализатор Тамбов', active: true, model: 'Тамбов', grade: 'II', validFrom: '2026-01-01' }
];
const people = Object.fromEntries(employees.map(employee => [employee.name, employee]));
const articleCodes = Object.fromEntries(fixture.rules.map(rule => [rule.id, rule.articleCode]));

function deal(overrides = {}) {
  return fixture.deal(Object.assign({
    id: 'MATRIX', objectName: 'Матричный сценарий', projectCost: 120000, area: 60,
    package: 'Инженерный', visualType: '3D-визуализация', rollouts: 'Нет',
    engineer: 'Инженер Москва', visualizer: 'Нет',
    act1: '2026-08-01', act2: '2026-08-03', act3: '2026-08-05', repairDate: '2026-08-07'
  }, overrides));
}
function calculate(oneDeal, overrides = {}) {
  const warnings = [], original = console.warn;
  console.warn = message => warnings.push(message);
  try {
    const result = core.calculate({
      deals: [oneDeal], employees: overrides.employees || employees,
      rules: overrides.rules || fixture.rules, matrices: overrides.matrices || matrices,
      existing: [], now: '2026-09-24'
    });
    return { result, warnings };
  } finally { console.warn = original; }
}
function employeeRate(employee, work) {
  return employee.model === 'Москва' ? moscowRates[employee.grade] : tambovRates[work][grades.indexOf(employee.grade)];
}
function expectedArticle(ruleId, recipient, work, baseSource, share, readyDate) {
  const employee = people[recipient];
  const base = baseSource === 'project' || employee.model === 'Москва' ? 120000 : 60;
  const rate = work === 'Бонус за ремонт' ? (employee.model === 'Москва' ? .10 : .05) : employeeRate(employee, work);
  const fund = Math.round(base * rate);
  return {
    ruleId, articleCode: articleCodes[ruleId], employeeId: employee.id,
    recipientSlot: /VISUAL|COLLAGE/.test(ruleId) ? 'visualizer' : 'engineer',
    base, rate, share, amount: Math.round(fund * share), readyDate, status: 'TO_PAY'
  };
}
function expectedRows(schema, config, visualizer, visualType) {
  const result = [], engineer = config.engineer;
  if (schema === 'two') {
    result.push(expectedArticle('R_2_PART_1', engineer, config.package, 'model', .5, '2026-08-01'));
    result.push(expectedArticle('R_2_PART_2', engineer, config.package, 'model', .5, '2026-08-03'));
  } else if (schema === 'same') {
    result.push(expectedArticle('R_3_SAME_PART_1', engineer, config.package, 'model', .5, '2026-08-03'));
    result.push(expectedArticle('R_3_SAME_PART_2', engineer, config.package, 'model', .5, '2026-08-05'));
  } else {
    result.push(expectedArticle('R_3_SPLIT_ENGINEERING', engineer, config.package, 'model', 1, '2026-08-03'));
    result.push(expectedArticle(visualType === 'Коллажи' ? 'R_3_SPLIT_COLLAGE' : 'R_3_SPLIT_VISUAL_3D', visualizer, visualType, 'model', 1, '2026-08-05'));
  }
  const engineerModel = people[engineer].model;
  result.push(expectedArticle(engineerModel === 'Москва' ? 'R_REPAIR_MSK_DESIGNER' : 'R_REPAIR_TMB_DESIGNER', engineer, 'Бонус за ремонт', 'project', 1, '2026-08-07'));
  if (engineerModel === 'Тамбов' && /^(Да|Есть)$/.test(config.rollouts)) {
    result.push(expectedArticle('R_TAMBOV_ROLLOUTS', engineer, 'Развёртки', 'model', 1, '2026-08-01'));
  }
  return result;
}
function assertScenario(scenario) {
  const isTwo = scenario.schema === 'two';
  const visualizer = isTwo ? 'Нет' : scenario.schema === 'same' ? scenario.config.engineer : scenario.visualizer;
  const { result } = calculate(deal({
    id: scenario.id, engineer: scenario.config.engineer, visualizer,
    package: scenario.config.package, rollouts: scenario.config.rollouts, visualType: scenario.visualType
  }));
  assert.equal(result.skippedDeals.length, 0);
  const expected = expectedRows(scenario.schema, scenario.config, scenario.visualizer, scenario.visualType);
  assert.deepEqual(result.rows.map(row => row.ruleId).sort(), expected.map(row => row.ruleId).sort());
  assert.equal(result.rows.length, expected.length);
  const byRule = Object.fromEntries(result.rows.map(row => [row.ruleId, row]));
  expected.forEach(item => {
    const row = byRule[item.ruleId];
    assert.ok(row, 'нет статьи ' + item.ruleId);
    ['articleCode', 'employeeId', 'recipientSlot', 'base', 'rate', 'share', 'amount', 'readyDate', 'status'].forEach(key => {
      assert.equal(row[key], item[key], item.ruleId + ': ' + key);
    });
  });
  assert.equal(result.rows.reduce((sum, row) => sum + row.amount, 0), expected.reduce((sum, row) => sum + row.amount, 0));
}

const configs = [
  { label: 'Москва, без развёрток', engineer: 'Инженер Москва', package: 'Инженерный', rollouts: 'Нет' },
  { label: 'Москва, развёртки отмечены', engineer: 'Инженер Москва', package: 'Инженерный', rollouts: 'Да' },
  { label: 'Тамбов Старт', engineer: 'Инженер Тамбов', package: 'Старт', rollouts: 'Нет' },
  { label: 'Тамбов Инженерный', engineer: 'Инженер Тамбов', package: 'Инженерный', rollouts: 'Нет' },
  { label: 'Тамбов Инженерный расширенный', engineer: 'Инженер Тамбов', package: 'Инженерный расширенный', rollouts: 'Нет' },
  { label: 'Тамбов Инженерный + развёртки', engineer: 'Инженер Тамбов', package: 'Инженерный', rollouts: 'Да' },
  { label: 'Тамбов расширенный + развёртки', engineer: 'Инженер Тамбов', package: 'Инженерный расширенный', rollouts: 'Есть' }
];
const scenarios = [];
configs.forEach((config, index) => {
  scenarios.push({ id: 'TWO-' + index, schema: 'two', config, visualType: index % 2 ? 'Коллажи' : '3D-визуализация' });
  scenarios.push({ id: 'SAME-' + index, schema: 'same', config, visualType: index % 2 ? 'Коллажи' : '3D-визуализация' });
  ['Визуализатор Москва', 'Визуализатор Тамбов'].forEach((visualizer, visualIndex) => {
    scenarios.push({ id: '3D-' + index + '-' + visualIndex, schema: 'split', config, visualizer, visualType: '3D-визуализация' });
    scenarios.push({ id: 'COL-' + index + '-' + visualIndex, schema: 'split', config, visualizer, visualType: 'Коллажи' });
  });
});
if (scenarios.length !== 42) throw new Error('Ожидалось 42 основных сценария, получено ' + scenarios.length);
scenarios.forEach((scenario, index) => test('основной сценарий ' + String(index + 1).padStart(2, '0') + '/42: ' + scenario.schema + ', ' + scenario.config.label + (scenario.visualizer ? ', ' + scenario.visualizer : ''), () => assertScenario(scenario)));

grades.forEach(grade => test('ставка Москвы: грейд ' + grade, () => {
  const employee = { id: 'M-' + grade, name: 'Москва ' + grade, active: true, model: 'Москва', grade, validFrom: '2026-01-01' };
  const rows = calculate(deal({ engineer: employee.name }), { employees: [employee] }).result.rows;
  assert.equal(rows.find(row => row.ruleId === 'R_2_PART_1').rate, moscowRates[grade]);
}));
test('ставка Москвы: бонус за ремонт', () => {
  const row = calculate(deal()).result.rows.find(item => item.ruleId === 'R_REPAIR_MSK_DESIGNER');
  assert.deepEqual([row.base, row.rate], [120000, .10]);
});

Object.entries(tambovRates).forEach(([work, rates]) => grades.forEach((grade, index) => test('ставка Тамбова: ' + work + ', грейд ' + grade, () => {
  const employee = { id: 'T-' + grade, name: 'Тамбов ' + grade, active: true, model: 'Тамбов', grade, validFrom: '2026-01-01' };
  let target;
  if (['Старт', 'Инженерный', 'Инженерный расширенный'].includes(work)) {
    target = calculate(deal({ engineer: employee.name, package: work }), { employees: [employee] }).result.rows.find(row => row.ruleId === 'R_2_PART_1');
  } else if (work === '3D-визуализация' || work === 'Коллажи') {
    target = calculate(deal({ visualizer: employee.name, visualType: work }), { employees: employees.filter(item => item.id === 'M-ENG').concat(employee) }).result.rows.find(row => row.recipientSlot === 'visualizer');
  } else if (work === 'Развёртки') {
    target = calculate(deal({ engineer: employee.name, rollouts: 'Да' }), { employees: [employee] }).result.rows.find(row => row.ruleId === 'R_TAMBOV_ROLLOUTS');
  } else {
    target = calculate(deal({ engineer: employee.name }), { employees: [employee] }).result.rows.find(row => row.ruleId === 'R_REPAIR_TMB_DESIGNER');
  }
  assert.equal(target.rate, rates[index]);
})));

test('пограничные даты готовности соответствуют правилам актов', () => {
  let rows = calculate(deal({ act1: '', act2: '' })).result.rows;
  assert.deepEqual(rows.filter(row => row.ruleId.startsWith('R_2_')).map(row => [row.readyDate, row.status]), [['', 'PLANNED'], ['', 'PLANNED']]);
  rows = calculate(deal({ act1: '2026-08-01', act2: '2026-08-03' })).result.rows;
  assert.deepEqual(rows.filter(row => row.ruleId.startsWith('R_2_')).map(row => [row.readyDate, row.status]), [['2026-08-01', 'TO_PAY'], ['2026-08-03', 'TO_PAY']]);
});
test('первая статья трёхактной схемы требует обе даты и выбирает более позднюю', () => {
  ['act1', 'act2'].forEach(missing => {
    const input = { visualizer: 'Инженер Москва' }; input[missing] = '';
    const row = calculate(deal(input)).result.rows.find(item => item.ruleId === 'R_3_SAME_PART_1');
    assert.deepEqual([row.readyDate, row.status], ['', 'PLANNED']);
  });
  const row = calculate(deal({ visualizer: 'Инженер Москва', act1: '2026-08-06', act2: '2026-08-03' })).result.rows.find(item => item.ruleId === 'R_3_SAME_PART_1');
  assert.deepEqual([row.readyDate, row.status], ['2026-08-06', 'TO_PAY']);
});
test('акт 3 и дата ремонта независимо меняют готовность своих статей', () => {
  let rows = calculate(deal({ visualizer: 'Инженер Москва', act3: '', repairDate: '' })).result.rows;
  assert.deepEqual([rows.find(row => row.ruleId === 'R_3_SAME_PART_2').status, rows.find(row => row.ruleId.startsWith('R_REPAIR_')).status], ['PLANNED', 'PLANNED']);
  rows = calculate(deal({ visualizer: 'Инженер Москва', act3: '2026-08-05', repairDate: '2026-08-07' })).result.rows;
  assert.deepEqual([rows.find(row => row.ruleId === 'R_3_SAME_PART_2').status, rows.find(row => row.ruleId.startsWith('R_REPAIR_')).status], ['TO_PAY', 'TO_PAY']);
});
test('развёртки Тамбова готовы строго по акту 1', () => {
  const empty = calculate(deal({ engineer: 'Инженер Тамбов', rollouts: 'Да', act1: '' })).result.rows.find(row => row.ruleId === 'R_TAMBOV_ROLLOUTS');
  const ready = calculate(deal({ engineer: 'Инженер Тамбов', rollouts: 'Да', act1: '2026-08-09' })).result.rows.find(row => row.ruleId === 'R_TAMBOV_ROLLOUTS');
  assert.deepEqual([[empty.readyDate, empty.status], [ready.readyDate, ready.status]], [['', 'PLANNED'], ['2026-08-09', 'TO_PAY']]);
});
test('развёртки Москвы игнорируются без ошибки и дополнительной статьи', () => {
  const no = calculate(deal({ rollouts: 'Нет' })).result;
  const yes = calculate(deal({ rollouts: 'Да' })).result;
  assert.equal(yes.skippedDeals.length, 0);
  assert.deepEqual(yes.rows, no.rows);
  assert.equal(yes.rows.some(row => row.ruleId === 'R_TAMBOV_ROLLOUTS'), false);
});

test('ошибки обязательных данных отклоняют только конкретную сделку', () => {
  const cases = [
    ['пустой ID', deal({ id: '' }), /ID сделки/],
    ['неизвестный инженер', deal({ engineer: 'Неизвестный' }), /отсутствует/],
    ['неизвестный визуализатор', deal({ visualizer: 'Неизвестный' }), /отсутствует/],
    ['неизвестный пакет Тамбова', deal({ engineer: 'Инженер Тамбов', package: 'Неизвестный' }), /ставка/],
    ['неподдерживаемая визуализация', deal({ visualizer: 'Визуализатор Москва', visualType: 'Видео' }), /тип визуализации/]
  ];
  cases.forEach(([label, bad, pattern]) => {
    const { result } = calculate(bad);
    assert.equal(result.rows.length, 0, label);
    assert.match(result.skippedDeals[0].reasons.join(' '), pattern, label);
  });
});
test('дубли сотрудников, неизвестная модель, пустой грейд и ставки диагностируются', () => {
  const duplicateEmployees = employees.concat({ ...employees[0], id: 'M-OTHER' });
  assert.match(calculate(deal(), { employees: duplicateEmployees }).result.skippedDeals[0].reasons.join(' '), /несколько действующих/);
  const unknownModel = employees.map(employee => employee.id === 'M-ENG' ? { ...employee, model: 'Иная' } : employee);
  assert.match(calculate(deal(), { employees: unknownModel }).result.skippedDeals[0].reasons.join(' '), /модель мотивации/);
  const noGrade = employees.map(employee => employee.id === 'M-ENG' ? { ...employee, grade: '' } : employee);
  assert.match(calculate(deal(), { employees: noGrade }).result.skippedDeals[0].reasons.join(' '), /грейд/);
  const missingRate = { ...matrices, moscow: matrices.moscow.filter(row => row.key !== 'V') };
  assert.match(calculate(deal(), { matrices: missingRate }).result.skippedDeals[0].reasons.join(' '), /не найдена действующая ставка/);
  const duplicateRate = { ...matrices, moscow: matrices.moscow.concat({ key: 'V', rate: .46, active: true }) };
  assert.match(calculate(deal(), { matrices: duplicateRate }).result.skippedDeals[0].reasons.join(' '), /несколько ставок/);
});
test('нулевые, отрицательные и нечисловые базы отклоняются атомарно', () => {
  [0, -1, 'не число'].forEach(value => {
    assert.equal(calculate(deal({ projectCost: value })).result.rows.length, 0);
    assert.equal(calculate(deal({ engineer: 'Инженер Тамбов', area: value })).result.rows.length, 0);
  });
});
test('ошибка одной сделки не мешает корректной, а нулевая статья отклоняет комплект', () => {
  const bad = deal({ id: 'BAD', projectCost: 1 });
  const good = deal({ id: 'GOOD' });
  const result = core.calculate({ deals: [bad, good], employees, rules: fixture.rules, matrices, existing: [], now: '2026-09-24' });
  assert.equal(result.skippedDeals.length, 1);
  assert.ok(result.rows.length > 0);
  assert.ok(result.rows.every(row => row.dealId === 'GOOD'));
});
