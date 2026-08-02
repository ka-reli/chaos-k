/*
 * Дымовые тесты режиссёра: сборка промпта, всепрощающий разбор, плавность.
 * Сеть не трогаем — только чистая логика.
 */
'use strict';
globalThis.window = globalThis;
require('../data/registry.js');
require('../src/director.js');

var D = globalThis.ChaosFX.director;
var pass = 0, fail = 0;

function check(name, cond, extra) {
  if (cond) { pass++; console.log('  ok  ' + name); }
  else { fail++; console.log('FAIL  ' + name + (extra ? '  →  ' + JSON.stringify(extra) : '')); }
}

// ── Промпт ──────────────────────────────────────────────────────────────────
var msgs = D.buildDirectorMessages(
  [{ name: 'Renri', text: 'Комната плыла.' }, { name: 'Эманон', text: 'Я закурила.' }],
  { intensity: 4, moods: ['ominous'] },
  true
);
check('промпт: system + user', msgs.length === 2 && msgs[0].role === 'system', msgs.length);
check('промпт: словарь настроений', /psychedelic — психоделия/.test(msgs[0].content), null);
check('промпт: словарь форм при withForms', /stream — поток сознания/.test(msgs[0].content), null);

// Формы выключены → словарь форм не отправляем вовсе (экономия и фокус).
var msgsNoForms = D.buildDirectorMessages([{ name: 'A', text: 'б' }], { intensity: 3, moods: [] }, false);
check('промпт: без форм словарь опущен',
  !/stream — поток сознания/.test(msgsNoForms[0].content) && /"form": null/.test(msgsNoForms[0].content), null);
check('промпт: только JSON', /ТОЛЬКО JSON/.test(msgs[0].content), null);
check('промпт: текущее состояние', /накал 4/.test(msgs[1].content) && /ominous/.test(msgs[1].content), msgs[1].content.slice(0, 80));
check('промпт: сцена с именами', /Renri: Комната плыла\./.test(msgs[1].content), null);

// ── Разбор: чистый JSON ─────────────────────────────────────────────────────
var p1 = D.parseVerdict('{"intensity": 7, "moods": ["ominous","dream"], "form": null, "image": null, "note": "напряжение растёт"}');
check('разбор: чистый JSON', p1.ok && p1.verdict.intensity === 7 && p1.verdict.moods.join(',') === 'ominous,dream', p1);

// Обёртка ```json и болтовня вокруг.
var p2 = D.parseVerdict('Вот мой ответ:\n```json\n{"intensity": 5, "moods": ["fear"], "form": null}\n```\nНадеюсь, помог!');
check('разбор: json из мусора', p2.ok && p2.verdict.intensity === 5, p2);

// Подрезка значений: 47 → 10, -3 → 0, "7" → 7.
var p3 = D.parseVerdict('{"intensity": 47, "moods": []}');
check('разбор: 47 → 10', p3.ok && p3.verdict.intensity === 10 && p3.warnings.length > 0, p3);
var p4 = D.parseVerdict('{"intensity": -3, "moods": []}');
check('разбор: -3 → 0', p4.ok && p4.verdict.intensity === 0, p4);
var p5 = D.parseVerdict('{"intensity": "7", "moods": []}');
check('разбор: "7" → 7', p5.ok && p5.verdict.intensity === 7, p5);

// Настроения: выдумки выкидываются, RU-алиасы и подстроки подгоняются, >3 режется.
var p6 = D.parseVerdict('{"moods": ["ominous","весёлость","психоделия","psychedelia","calm","joy"]}');
check('разбор: подгонка настроений',
  p6.ok && p6.verdict.moods.indexOf('ominous') !== -1 &&
  p6.verdict.moods.indexOf('psychedelic') !== -1 &&
  p6.verdict.moods.length <= 3, p6.verdict.moods);

// Неизвестная форма → null; известная строкой → id.
var p7 = D.parseVerdict('{"form": "недоформа"}');
check('разбор: неизвестная форма → null', p7.ok && p7.verdict.form === null, p7);
var p8 = D.parseVerdict('{"form": "dossier"}');
check('разбор: форма dossier', p8.ok && p8.verdict.form === 'dossier', p8);

// Полный мусор → ok:false.
var p9 = D.parseVerdict('извини, я не могу оценить эту сцену');
check('разбор: мусор → ok:false', !p9.ok, p9);

// Вложенные скобки в строках не ломают выколупывание.
var p10 = D.parseVerdict('{"note": "скобки {и} кавычки \\" внутри", "intensity": 3, "moods": []}');
check('разбор: скобки в строках', p10.ok && p10.verdict.intensity === 3, p10);

// ── Плавность ───────────────────────────────────────────────────────────────
var OPTS = { maxStep: 2, peakThreshold: 8, peakCooldownTurns: 2, peakCap: 5, formCooldownTurns: 4, moodCap: 4 };

// Сглаживание: 2 → цель 9 идёт шагами по 2.
var s1 = D.applyVerdict({ intensity: 2, moods: [], cooldown: 0, formCooldown: 0 }, { intensity: 9, moods: [], form: null }, OPTS);
check('плавность: шаг ограничен', s1.intensity === 4, s1.intensity);

// Пик: накал 9 достигнут (7+2) → кулдаун взводится, следующая цель придавлена.
var s2 = D.applyVerdict({ intensity: 7, moods: [], cooldown: 0, formCooldown: 0 }, { intensity: 10, moods: [], form: null }, OPTS);
check('плавность: пик взводит кулдаун', s2.intensity === 9 && s2.cooldown === 2, s2);
// На кулдауне цель 10 придавлена до 5 → 9-2=7 (спад), счётчик тикает вниз.
var s3 = D.applyVerdict(s2, { intensity: 10, moods: [], form: null }, OPTS);
check('плавность: кулдаун давит цель', s3.intensity === 7 && s3.cooldown === 1, s3);

// Инерция настроений: прошлые дотлевают один ход.
var s4 = D.applyVerdict({ intensity: 4, moods: ['ominous', 'eerie'], cooldown: 0, formCooldown: 0 }, { intensity: 4, moods: ['joy'], form: null }, OPTS);
check('инерция: объединение с прошлым ходом',
  s4.moods.join(',') === 'joy' && s4.effectiveMoods.indexOf('ominous') !== -1 && s4.effectiveMoods[0] === 'joy', s4.effectiveMoods);

// Пустые настроения в вердикте → остаёмся на прежних.
var s5 = D.applyVerdict({ intensity: 4, moods: ['cold'], cooldown: 0, formCooldown: 0 }, { intensity: 4, moods: [], form: null }, OPTS);
check('настроения: пусто → прежние', s5.moods.join(',') === 'cold', s5.moods);

// Кулдаун форм: сработала → 4 хода тишины.
var s6 = D.applyVerdict({ intensity: 4, moods: [], cooldown: 0, formCooldown: 0 }, { intensity: 4, moods: [], form: 'stream' }, OPTS);
check('форма: сработала, кулдаун взведён', s6.form === 'stream' && s6.formCooldown === 4, s6);
var s7 = D.applyVerdict(s6, { intensity: 4, moods: [], form: 'dossier' }, OPTS);
check('форма: подавлена кулдауном', s7.form === null && s7.formSuppressed === 'dossier' && s7.formCooldown === 3, s7);

// ── Эндпойнт ────────────────────────────────────────────────────────────────
check('endpoint: хвосты обрезаются',
  D.normalizeEndpoint('https://api.example.com/v1/chat/completions/') === 'https://api.example.com/v1' &&
  D.normalizeEndpoint('https://api.example.com/v1/') === 'https://api.example.com/v1',
  null);

console.log('\n' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
