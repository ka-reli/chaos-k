/*
 * Дымовые тесты ротации палитры (node).
 */
'use strict';
globalThis.window = globalThis;
require('../data/registry.js');
require('../src/rotation.js');

var CFX = globalThis.ChaosFX;
var pass = 0, fail = 0;

function check(name, cond, extra) {
  if (cond) { pass++; console.log('  ok  ' + name); }
  else { fail++; console.log('FAIL  ' + name + (extra ? '  →  ' + extra : '')); }
}

function seeded(s) { s = s || 7; return function () { s = (s * 1103515245 + 12345) & 0x7fffffff; return s / 0x7fffffff; }; }

// 1. Возвращает запрошенное число эффектов и цветов.
var r1 = CFX.rotate({ intensity: 10, moods: [], effectsCount: 6, colorsCount: 4, rng: seeded(1) });
check('число эффектов', r1.effects.length === 6, r1.effects.length);
check('число цветов', r1.colors.length === 4, r1.colors.length);

// 2. Потолок интенсивности отсекает мощные эффекты.
var r2 = CFX.rotate({ intensity: 3, moods: [], effectsCount: 32, rng: seeded(2) });
var overCeiling = r2.effects.filter(function (e) { return e.intensity > 3; });
check('потолок накала фильтрует', overCeiling.length === 0, 'превышений: ' + overCeiling.length);

// 3. Фильтр по настроениям: все эффекты задевают активные настроения.
var r3 = CFX.rotate({ intensity: 10, moods: ['fear', 'rage'], effectsCount: 32, rng: seeded(3) });
var offMood = r3.effects.filter(function (e) {
  return e.moods.indexOf('fear') === -1 && e.moods.indexOf('rage') === -1;
});
check('фильтр по настроениям', offMood.length === 0, 'вне настроений: ' + offMood.length);

// 4. Без повторов.
var r4 = CFX.rotate({ intensity: 10, moods: [], effectsCount: 10, rng: seeded(4) });
var ids = r4.effects.map(function (e) { return e.id; });
check('эффекты без повторов', new Set(ids).size === ids.length, ids.join(','));

// 5. Приоритет мульти-настроенческим: при ominous+eerie+dream void (4 совпадения
//    среди цветов с этими настроениями) должен почти всегда попадать в выборку.
var hits = 0, N = 200;
for (var i = 0; i < N; i++) {
  var rr = CFX.rotate({ intensity: 10, moods: ['ominous', 'eerie', 'dream'], colorsCount: 3, rng: seeded(100 + i) });
  if (rr.colors.some(function (c) { return c.id === 'void'; })) hits++;
}
check('приоритет мульти-настроенческим (void част)', hits > N * 0.6, hits + '/' + N);

// 6. Блок-подсказка содержит синтаксис и метки выбранных эффектов.
var r6 = CFX.rotate({ intensity: 10, moods: [], effectsCount: 3, rng: seeded(6) });
check('в подсказке есть синтаксис', /\[fx:имя\]/.test(r6.prompt), r6.prompt.slice(0, 40));
check('в подсказке есть выбранные эффекты',
  r6.effects.every(function (e) { return r6.prompt.indexOf('[fx:' + e.id + ']') !== -1; }), r6.prompt);

// 7. Форма подмешивает инструкцию в подсказку.
var r7 = CFX.rotate({ intensity: 10, moods: [], form: 'recipe', rng: seeded(7) });
check('форма → инструкция в подсказке', r7.form && /рецепт/.test(r7.prompt), r7.prompt);

// 8. Запрос больше пула не падает (берём сколько есть).
var r8 = CFX.rotate({ intensity: 1, moods: ['sacred'], effectsCount: 99, rng: seeded(8) });
check('запрос > пула не падает', Array.isArray(r8.effects) && r8.effects.length <= 32, r8.effects.length);

console.log('\n' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
