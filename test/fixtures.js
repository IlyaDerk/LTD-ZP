const rules = [
  ['R_2_PART_1', 'DESIGN_PART_1', 'Инженер-дизайнер', .5],
  ['R_2_PART_2', 'DESIGN_PART_2', 'Инженер-дизайнер', .5],
  ['R_3_SPLIT_ENGINEERING', 'DESIGN_ENGINEERING', 'Инженер-дизайнер', 1],
  ['R_3_SPLIT_VISUAL_3D', 'DESIGN_VISUAL_3D', 'Визуализатор', 1],
  ['R_3_SPLIT_COLLAGE', 'DESIGN_VISUAL_COLLAGE', 'Визуализатор', 1],
  ['R_TAMBOV_ROLLOUTS', 'DESIGN_ROLLOUTS', 'Инженер-дизайнер', 1],
  ['R_REPAIR_MSK_DESIGNER', 'REPAIR_BONUS_DESIGNER', 'Инженер-дизайнер', 1],
  ['R_REPAIR_TMB_DESIGNER', 'REPAIR_BONUS_DESIGNER', 'Инженер-дизайнер', 1]
].map(([id, articleCode, recipient, share]) => ({ id, articleCode, recipient, share, active: true }));

const matrices = {
  moscow: [
    { key: 'I', rate: .35, active: true }, { key: 'II', rate: .375, active: true },
    { key: 'III', rate: .40, active: true }, { key: 'V', rate: .45, active: true },
    { key: 'Бонус за ремонт', rate: .10, active: true }
  ],
  tambov: [
    ['Старт', 'I', 105], ['Инженерный', 'I', 280], ['Инженерный', 'II', 300],
    ['3D-визуализация', 'I', 350], ['Коллажи', 'I', 187], ['Развёртки', 'I', 117],
    ['Бонус за ремонт', 'I', .05]
  ].map(([key, grade, rate]) => ({ key, grade, rate, active: true }))
};

const employees = [
  { id: 'M1', name: 'Мария Москва', active: true, model: 'Москва', grade: 'V', validFrom: '2026-01-01' },
  { id: 'T1', name: 'Иван Тамбов', active: true, model: 'Тамбов', grade: 'I', validFrom: '2026-01-01' },
  { id: 'T2', name: 'Вера Виз', active: true, model: 'Тамбов', grade: 'I', validFrom: '2026-01-01' }
];

function deal(overrides = {}) {
  return Object.assign({ id: 'D1', objectName: 'Объект', projectCost: 200000, area: 80, package: 'Инженерный', visualType: '3D-визуализация', rollouts: 'Нет', engineer: 'Мария Москва', visualizer: 'Нет', act1: '2026-08-02', act2: '', act3: '', repairDate: '' }, overrides);
}
function input(d, overrides = {}) { return Object.assign({ deals: [d], employees, rules, matrices, existing: [], now: '2026-08-20' }, overrides); }

module.exports = { rules, matrices, employees, deal, input };
