/*
 * Chaos-FX — единый источник правды (пункт 2 спецификации).
 *
 * Отсюда кормятся: парсер (метки), ротация палитры, пулы настроений,
 * режиссёр, система тем. Эффект/цвет/настроение — это запись данных,
 * а не правило в коде.
 *
 * Standalone-режим: всё вешается на window.ChaosFX.
 * (Позже тот же файл легко обернуть в ES-модуль для SillyTavern.)
 */
(function (root) {
  'use strict';

  // ── Настроения (16) — словарь для режиссёра ───────────────────────────────
  var MOODS = [
    'calm', 'joy', 'tender', 'sorrow', 'nostalgia', 'ominous', 'fear', 'rage',
    'eerie', 'dream', 'psychedelic', 'chaos', 'sacred', 'corrupt', 'cold', 'sensual'
  ];

  // ── Эффекты (32) ──────────────────────────────────────────────────────────
  var EFFECTS = [
    { id: 'rainbow', aliases: ['радуга', 'prism', 'spectrum'], css: 'fx-rainbow', moods: ['joy', 'psychedelic'], intensity: 4, scope: 'inline', weight: 1.0, colorBased: true, special: false, reducedMotion: 'fx-rainbow-static', desc: 'переливается всеми цветами' },
    { id: 'glow', aliases: ['неон', 'neon', 'halo', 'свечение'], css: 'fx-glow', moods: ['sacred', 'dream', 'psychedelic'], intensity: 3, scope: 'inline', weight: 1.0, colorBased: true, special: false, reducedMotion: 'fx-glow-static', desc: 'мягкий светящийся ореол' },
    { id: 'ember', aliases: ['огонь', 'fire', 'угли', 'burning'], css: 'fx-ember', moods: ['rage', 'ominous', 'sensual'], intensity: 5, scope: 'inline', weight: 1.0, colorBased: true, special: false, reducedMotion: 'fx-ember-static', desc: 'тлеющий оранжево-красный жар' },
    { id: 'frost', aliases: ['иней', 'frozen', 'изморозь'], css: 'fx-frost', moods: ['cold', 'eerie'], intensity: 3, scope: 'inline', weight: 1.0, colorBased: true, special: false, reducedMotion: 'fx-frost-static', desc: 'холодный голубой блеск' },
    { id: 'gold', aliases: ['золото', 'golden', 'gilded'], css: 'fx-gold', moods: ['sacred', 'tender'], intensity: 3, scope: 'inline', weight: 0.3, colorBased: true, special: false, reducedMotion: 'fx-gold-static', desc: 'благородное золотое мерцание' },
    { id: 'sickly', aliases: ['больной', 'ill', 'toxic'], css: 'fx-sickly', moods: ['corrupt', 'eerie'], intensity: 5, scope: 'inline', weight: 0.3, colorBased: true, special: false, reducedMotion: 'fx-sickly-static', desc: 'нездоровое зелёное свечение' },
    { id: 'spark', aliases: ['искры', 'sparkle', 'glitter', 'блёстки'], css: 'fx-spark', moods: ['joy', 'sacred'], intensity: 4, scope: 'inline', weight: 1.0, colorBased: true, special: false, reducedMotion: 'fx-spark-static', desc: 'искры и блёстки' },
    { id: 'electric', aliases: ['молния', 'lightning', 'crackle', 'электричество'], css: 'fx-electric', moods: ['rage', 'psychedelic'], intensity: 6, scope: 'inline', weight: 0.3, colorBased: true, special: false, reducedMotion: 'fx-electric-static', desc: 'потрескивающие молнии' },

    { id: 'shake', aliases: ['дрожь', 'tremble', 'shiver', 'трясёт'], css: 'fx-shake', moods: ['fear', 'rage'], intensity: 4, scope: 'inline', weight: 1.0, colorBased: false, special: false, reducedMotion: 'disable', desc: 'мелкая дрожь' },
    { id: 'sway', aliases: ['качание', 'drift', 'покачивание', 'floaty'], css: 'fx-sway', moods: ['calm', 'dream', 'sensual'], intensity: 3, scope: 'inline', weight: 1.0, colorBased: false, special: false, reducedMotion: 'disable', desc: 'плавное покачивание, дрейф' },
    { id: 'heartbeat', aliases: ['пульс', 'pulse', 'throb'], css: 'fx-heartbeat', moods: ['fear', 'tender', 'sensual'], intensity: 5, scope: 'inline', weight: 1.0, colorBased: false, special: false, reducedMotion: 'disable', desc: 'пульсация как сердце' },
    { id: 'drip', aliases: ['капель', 'стекает'], css: 'fx-drip', moods: ['corrupt', 'sorrow'], intensity: 6, scope: 'inline', weight: 0.3, colorBased: false, special: false, reducedMotion: 'disable', desc: 'буквы стекают вниз' },
    { id: 'rise', aliases: ['всплытие', 'float-up', 'ascend', 'взлёт'], css: 'fx-rise', moods: ['dream', 'sacred', 'calm'], intensity: 4, scope: 'inline', weight: 1.0, colorBased: false, special: false, reducedMotion: 'disable', desc: 'слова всплывают вверх' },
    { id: 'jitter', aliases: ['вибрация', 'jitter', 'buzz', 'нервный'], css: 'fx-jitter', moods: ['fear', 'chaos'], intensity: 6, scope: 'inline', weight: 1.0, colorBased: false, special: false, reducedMotion: 'disable', desc: 'нервная частая вибрация' },

    { id: 'glitch', aliases: ['глитч', 'сбой'], css: 'fx-glitch', moods: ['corrupt', 'chaos', 'psychedelic'], intensity: 7, scope: 'inline', weight: 1.0, colorBased: false, special: false, reducedMotion: 'disable', desc: 'RGB-разрыв и нарезка' },
    { id: 'blur', aliases: ['размытие', 'blur', 'smear', 'смаз'], css: 'fx-blur', moods: ['dream', 'calm'], intensity: 4, scope: 'inline', weight: 1.0, colorBased: false, special: false, reducedMotion: 'fx-blur-static', desc: 'размытие, смаз' },
    { id: 'melt', aliases: ['плавление', 'melt', 'тает'], css: 'fx-melt', moods: ['psychedelic', 'eerie', 'corrupt'], intensity: 7, scope: 'inline', weight: 0.3, colorBased: false, special: false, reducedMotion: 'disable', desc: 'текст тает и растекается' },
    { id: 'scramble', aliases: ['перемешивание', 'scramble', 'shuffle', 'мешанина'], css: 'fx-scramble', moods: ['chaos', 'fear'], intensity: 6, scope: 'inline', weight: 1.0, colorBased: false, special: false, reducedMotion: 'disable', desc: 'буквы мешаются и встают на место' },

    { id: 'handwritten', aliases: ['рукопись', 'handwritten', 'scrawl', 'от руки'], css: 'fx-handwritten', moods: ['nostalgia', 'tender'], intensity: 2, scope: 'inline', weight: 1.0, colorBased: false, special: false, reducedMotion: null, desc: 'будто написано от руки' },
    { id: 'typewriter', aliases: ['машинка', 'typewriter', 'typing', 'печать'], css: 'fx-typewriter', moods: ['ominous', 'cold'], intensity: 3, scope: 'inline', weight: 1.0, colorBased: false, special: false, reducedMotion: 'disable', desc: 'набирается по буквам' },
    { id: 'flicker-in', aliases: ['мерцание', 'flicker', 'signal'], css: 'fx-flicker-in', moods: ['eerie', 'corrupt'], intensity: 5, scope: 'inline', weight: 1.0, colorBased: false, special: false, reducedMotion: 'disable', desc: 'мерцающее проявление, как плохой сигнал' },

    { id: 'ghost', aliases: ['призрак', 'ghost', 'faint', 'полупрозрачный'], css: 'fx-ghost', moods: ['sorrow', 'eerie', 'dream'], intensity: 4, scope: 'inline', weight: 1.0, colorBased: false, special: true, reducedMotion: 'fx-ghost-static', desc: 'призрачная полупрозрачность' },
    { id: 'whisper', aliases: ['шёпот', 'whisper', 'tiny', 'бледный'], css: 'fx-whisper', moods: ['ominous', 'tender', 'eerie'], intensity: 1, scope: 'inline', weight: 1.0, colorBased: false, special: true, reducedMotion: null, desc: 'мелкий, бледный, едва видный' },
    { id: 'smoke', aliases: ['дым', 'smoke', 'fume', 'курится'], css: 'fx-smoke', moods: ['eerie', 'dream'], intensity: 5, scope: 'inline', weight: 0.3, colorBased: false, special: true, reducedMotion: 'disable', desc: 'буквы курятся дымкой' },
    { id: 'negative', aliases: ['негатив', 'invert', 'inverse', 'инверсия'], css: 'fx-negative', moods: ['corrupt', 'psychedelic'], intensity: 6, scope: 'inline', weight: 0.3, colorBased: false, special: true, reducedMotion: null, desc: 'инверсия цветов' },
    { id: 'redacted', aliases: ['цензура', 'redacted', 'censored', 'зачёркнуто'], css: 'fx-redacted', moods: ['ominous', 'cold'], intensity: 4, scope: 'inline', weight: 0.3, colorBased: false, special: true, reducedMotion: null, desc: 'чёрная плашка, спадает по наведению' },

    { id: 'shout', aliases: ['крик', 'shout', 'scream', 'орёт'], css: 'fx-shout', moods: ['rage', 'fear', 'chaos'], intensity: 8, scope: 'inline', weight: 0.3, colorBased: false, special: false, reducedMotion: 'fx-shout-static', desc: 'огромный, жирный, дёрганый' },

    { id: 'spiral', aliases: ['спираль', 'spiral', 'whirl', 'вихрь'], css: 'fx-spiral', moods: ['dream', 'psychedelic'], intensity: 8, scope: 'spatial', weight: 0.3, colorBased: false, special: false, reducedMotion: 'disable', maxChars: 80, desc: 'закручивается спиралью' },
    { id: 'upsidedown', aliases: ['вверхногами', 'upsidedown', 'flipped', 'перевёрнутый'], css: 'fx-upsidedown', moods: ['chaos', 'psychedelic'], intensity: 8, scope: 'spatial', weight: 0.3, colorBased: false, special: false, reducedMotion: 'disable', maxChars: 80, desc: 'текст вверх ногами' },
    { id: 'mirror', aliases: ['зеркало', 'mirror', 'reversed', 'отражение'], css: 'fx-mirror', moods: ['eerie', 'dream'], intensity: 7, scope: 'spatial', weight: 0.3, colorBased: false, special: false, reducedMotion: 'disable', maxChars: 120, desc: 'зеркальное отражение' },
    { id: 'scatter', aliases: ['разлёт', 'scatter', 'explode', 'разброс'], css: 'fx-scatter', moods: ['chaos', 'fear'], intensity: 8, scope: 'spatial', weight: 0.3, colorBased: false, special: false, reducedMotion: 'disable', maxChars: 100, desc: 'слова разбросаны по странице' },
    { id: 'wave', aliases: ['волна', 'wave', 'undulate', 'колышется'], css: 'fx-wave', moods: ['dream', 'sensual', 'calm'], intensity: 6, scope: 'spatial', weight: 1.0, colorBased: false, special: false, reducedMotion: 'disable', maxChars: 200, desc: 'строка колышется целиком' }
  ];

  // ── Реестр цветов (24) — пара dark/light под фон ──────────────────────────
  var COLORS = [
    { id: 'blood', aliases: ['кровь', 'crimson'], dark: '#e03b3b', light: '#8b0000', moods: ['rage', 'fear', 'sensual'] },
    { id: 'flame', aliases: ['пламя', 'fire-color'], dark: '#ff8c2b', light: '#c2410c', moods: ['rage', 'psychedelic', 'joy'] },
    { id: 'rust', aliases: ['ржавчина', 'oxide'], dark: '#c46a3a', light: '#8a4421', moods: ['corrupt', 'nostalgia'] },
    { id: 'amber', aliases: ['янтарь'], dark: '#ffc24d', light: '#b8860b', moods: ['joy', 'nostalgia', 'sacred'] },
    { id: 'honey', aliases: ['мёд'], dark: '#ffd97a', light: '#c79a32', moods: ['tender', 'joy', 'nostalgia'] },
    { id: 'sulfur', aliases: ['сера', 'brimstone'], dark: '#e6e23a', light: '#9a9810', moods: ['corrupt', 'chaos', 'fear'] },
    { id: 'acid', aliases: ['кислота', 'toxic-green'], dark: '#9dff3c', light: '#4d8a00', moods: ['corrupt', 'psychedelic', 'chaos'] },
    { id: 'ichor', aliases: ['ихор', 'bile'], dark: '#b9d44a', light: '#6b7a1f', moods: ['corrupt', 'eerie', 'sacred'] },
    { id: 'moss', aliases: ['мох', 'verdant'], dark: '#7bbf6a', light: '#3f6f33', moods: ['calm', 'nostalgia'] },
    { id: 'ice', aliases: ['лёд', 'cyan'], dark: '#9fe3ff', light: '#2b7a9e', moods: ['cold', 'calm', 'eerie'] },
    { id: 'azure', aliases: ['лазурь', 'sky'], dark: '#5bb8ff', light: '#1565c0', moods: ['calm', 'sacred'] },
    { id: 'abyss', aliases: ['бездна', 'deep-blue'], dark: '#5a7fd0', light: '#283d6b', moods: ['sorrow', 'cold', 'dream'] },
    { id: 'void', aliases: ['пустота', 'null'], dark: '#6b7299', light: '#1a1d33', moods: ['ominous', 'eerie', 'cold', 'dream'] },
    { id: 'mist', aliases: ['туман', 'haze'], dark: '#c4d2e0', light: '#6b7d8f', moods: ['dream', 'calm', 'eerie'] },
    { id: 'violet', aliases: ['фиолет', 'purple'], dark: '#b98cff', light: '#6a3dbf', moods: ['sacred', 'dream', 'sensual'] },
    { id: 'ultraviolet', aliases: ['ультрафиолет', 'uv'], dark: '#d28bff', light: '#8a2be2', moods: ['psychedelic', 'eerie'] },
    { id: 'bruise', aliases: ['синяк', 'contusion'], dark: '#bf6fa3', light: '#5e2750', moods: ['corrupt', 'sorrow', 'fear'] },
    { id: 'neon', aliases: ['неон-розовый', 'magenta'], dark: '#ff5cc8', light: '#d6178f', moods: ['psychedelic', 'sensual', 'chaos'] },
    { id: 'rose', aliases: ['роза', 'pink'], dark: '#ff9bb5', light: '#c44569', moods: ['tender', 'joy'] },
    { id: 'silver', aliases: ['серебро', 'chrome'], dark: '#d8dee6', light: '#7a828c', moods: ['cold', 'sacred', 'sensual'] },
    { id: 'bone', aliases: ['кость', 'ivory'], dark: '#ede4d3', light: '#8a7f68', moods: ['eerie', 'sacred', 'cold'] },
    { id: 'ash', aliases: ['пепел', 'grey'], dark: '#b0b4ba', light: '#6b6f76', moods: ['sorrow', 'cold', 'calm'] },
    { id: 'ink', aliases: ['чернила', 'black'], dark: '#c0c4cc', light: '#1a1a22', moods: ['ominous', 'sorrow', 'cold'] },
    { id: 'oil', aliases: ['нефть', 'iridescent'], dark: '#7af0c0', light: '#2a9d8f', moods: ['psychedelic', 'dream', 'corrupt'], note: 'переливчатый — анимированный градиент' }
  ];

  // ── Макро-формы (14) — весь ответ как рецепт/пьеса/поток и т.д. ────────────
  // Главное поле — instruction (уходит модели). Часть несёт CSS-вёрстку.
  var FORMS = [
    { id: 'stream', moods: ['dream', 'fear', 'psychedelic', 'chaos'], intensity: 7, weight: 0.4, desc: 'поток сознания', instruction: 'Пиши потоком сознания: размывай границы предложений, перескакивай между мыслями, образами и воспоминаниями, обрывай фразы на полуслове.' },
    { id: 'recipe', moods: ['calm', 'nostalgia', 'sacred'], intensity: 6, weight: 0.3, desc: 'рецепт', instruction: 'Оформи как кулинарный рецепт — раздел «ингредиенты» и пронумерованные шаги, но описывай ими то, что происходит в сцене.' },
    { id: 'play', moods: ['rage', 'tender', 'ominous'], intensity: 6, weight: 0.4, desc: 'пьеса', instruction: 'Оформи как пьесу: имя персонажа перед каждой репликой, действия и обстановка — курсивом в скобках, как сценические ремарки.' },
    { id: 'documentary', moods: ['cold', 'sacred', 'nostalgia'], intensity: 5, weight: 0.3, desc: 'документалка', instruction: 'Веди отстранённым тоном документального наблюдателя, добавляй сноски-пояснения к происходящему.' },
    { id: 'code', moods: ['cold', 'corrupt', 'chaos'], intensity: 7, weight: 0.3, desc: 'код/алгоритм', instruction: 'Опиши сцену как псевдокод или алгоритм: условия, циклы, функции и логика — но смыслом остаётся происходящее.' },
    { id: 'math', moods: ['cold', 'psychedelic', 'dream'], intensity: 7, weight: 0.2, desc: 'последовательность/фрактал', instruction: 'Структурируй текст как формулу, последовательность или фрактал: повторы с вариацией, вложенность, числовая логика.' },
    { id: 'palindrome', moods: ['eerie', 'dream', 'corrupt'], intensity: 8, weight: 0.2, desc: 'зеркальный текст', instruction: 'Построй фрагмент зеркально — вторая половина отражает первую по структуре или смыслу.' },
    { id: 'scrapbook', moods: ['nostalgia', 'sorrow', 'dream'], intensity: 7, weight: 0.3, css: 'fx-scrapbook', desc: 'скрэпбук', instruction: 'Собери ответ как страницу скрэпбука: обрывки фраз, подписи, разрозненные вклейки воспоминаний.' },
    { id: 'letters', moods: ['tender', 'sorrow', 'nostalgia'], intensity: 5, weight: 0.3, desc: 'письма', instruction: 'Оформи как письмо или переписку: обращение, тело, подпись.' },
    { id: 'dictionary', moods: ['cold', 'eerie'], intensity: 6, weight: 0.2, desc: 'словарная статья', instruction: 'Оформи как словарную или энциклопедическую статью: термин, определения по пунктам, примеры употребления.' },
    { id: 'dossier', moods: ['ominous', 'cold', 'fear'], intensity: 6, weight: 0.3, css: 'fx-dossier', desc: 'досье с цензурой', instruction: 'Оформи как засекреченный документ: грифы и заголовки, пункты, часть текста скрой как [ЗАЦЕНЗУРЕНО].' },
    { id: 'interview', moods: ['cold', 'ominous'], intensity: 5, weight: 0.2, desc: 'расшифровка', instruction: 'Оформи как расшифровку интервью или допроса: реплики с метками [В:] и [О:] или тайм-кодами.' },
    { id: 'dialogue', moods: ['tender', 'ominous', 'rage'], intensity: 4, weight: 0.3, desc: 'чистый диалог', instruction: 'Используй только прямую речь — без описаний действий; что персонажи делают, должно угадываться из одних реплик.' },
    { id: 'ransom', moods: ['chaos', 'ominous', 'fear'], intensity: 7, weight: 0.2, css: 'fx-ransom', desc: 'записка из вырезок', instruction: 'Оформи как записку из вырезанных букв: рваный, скачущий, угрожающий тон.' }
  ];

  // ── Индексы: алиас/имя → каноническая запись ──────────────────────────────
  function norm(s) {
    return String(s == null ? '' : s).trim().toLowerCase().replace(/\s+/g, ' ');
  }

  function buildIndex(list) {
    var idx = {};
    list.forEach(function (rec) {
      idx[norm(rec.id)] = rec;
      (rec.aliases || []).forEach(function (a) { idx[norm(a)] = rec; });
    });
    return idx;
  }

  var EFFECT_INDEX = buildIndex(EFFECTS);
  var COLOR_INDEX = buildIndex(COLORS);
  var FORM_INDEX = buildIndex(FORMS);
  var MOOD_SET = {};
  MOODS.forEach(function (m) { MOOD_SET[norm(m)] = m; });

  // Пул эффектов по настроению (для меток-настроений и ротации режиссёра).
  var MOOD_POOL = {};
  MOODS.forEach(function (m) { MOOD_POOL[m] = []; });
  EFFECTS.forEach(function (fx) {
    (fx.moods || []).forEach(function (m) {
      if (MOOD_POOL[m]) MOOD_POOL[m].push(fx);
    });
  });

  var ChaosFX = root.ChaosFX = root.ChaosFX || {};
  ChaosFX.MOODS = MOODS;
  ChaosFX.EFFECTS = EFFECTS;
  ChaosFX.COLORS = COLORS;
  ChaosFX.FORMS = FORMS;
  ChaosFX.MOOD_POOL = MOOD_POOL;
  ChaosFX.registry = {
    norm: norm,
    effect: function (name) { return EFFECT_INDEX[norm(name)] || null; },
    color: function (name) { return COLOR_INDEX[norm(name)] || null; },
    form: function (name) { return FORM_INDEX[norm(name)] || null; },
    mood: function (name) { return MOOD_SET[norm(name)] || null; }
  };
})(typeof window !== 'undefined' ? window : this);
