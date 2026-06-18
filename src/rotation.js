/*
 * Chaos-FX — ротация палитры (пункт 2 «ротация» + шаг 1 жизненного пути).
 *
 * Каждый ход модели подкидывается случайная горстка эффектов и цветов:
 *   • фильтр по потолку интенсивности (накал сцены),
 *   • фильтр по активным настроениям,
 *   • взвешенный рандом по weight, с приоритетом эффектов, помеченных
 *     несколькими активными настроениями сразу.
 * Это экономит контекст (модель видит крошечный блок, а не всю таблицу)
 * И постоянно удивляет (палитра каждый ход новая).
 *
 * На выход — записи отобранных эффектов/цветов + готовый компактный
 * блок-подсказка для модели (уходит через setExtensionPrompt).
 *
 * Standalone-режим: вешается на window.ChaosFX.
 */
(function (root) {
  'use strict';

  var ChaosFX = root.ChaosFX = root.ChaosFX || {};
  if (!ChaosFX.EFFECTS || !ChaosFX.COLORS) {
    throw new Error('ChaosFX данные не загружены — подключи data/registry.js до rotation.js');
  }

  var DEFAULTS = {
    intensity: 5,        // потолок накала 0–10
    moods: [],           // активные настроения (2–3); пусто = без фильтра
    form: null,          // id формы (если режиссёр выбрал) — подмешать инструкцию
    effectsCount: 6,     // сколько эффектов подкинуть
    colorsCount: 4,      // сколько цветов подкинуть
    rng: Math.random
  };

  // Сколько активных настроений задевает запись.
  function moodMatch(rec, moods) {
    var recMoods = rec.moods || [];
    var n = 0;
    for (var i = 0; i < recMoods.length; i++) {
      if (moods.indexOf(recMoods[i]) !== -1) n++;
    }
    return n;
  }

  // Отфильтровать + взвесить кандидатов.
  //   filterByIntensity — применять ли потолок (для цветов intensity нет).
  function candidates(list, moods, ceiling, filterByIntensity) {
    var out = [];
    for (var i = 0; i < list.length; i++) {
      var rec = list[i];
      if (filterByIntensity && rec.intensity > ceiling) continue;

      var base = rec.weight != null ? rec.weight : 1;
      var w;
      if (moods.length) {
        var match = moodMatch(rec, moods);
        if (match === 0) continue;          // вне активных настроений — мимо
        w = base * match;                   // приоритет мульти-настроенческим
      } else {
        w = base;                           // настроений нет — ровный вес
      }
      out.push({ rec: rec, weight: w });
    }
    return out;
  }

  // Взвешенная выборка без повторов.
  function sample(pool, count, rng) {
    var items = pool.slice();
    var picked = [];
    while (picked.length < count && items.length) {
      var total = 0, i;
      for (i = 0; i < items.length; i++) total += items[i].weight;
      var r = rng() * total;
      var idx = items.length - 1;
      for (i = 0; i < items.length; i++) {
        r -= items[i].weight;
        if (r <= 0) { idx = i; break; }
      }
      picked.push(items[idx].rec);
      items.splice(idx, 1);
    }
    return picked;
  }

  // ── Сборка блока-подсказки для модели (RU — это контекст, не UI) ───────────
  function buildPrompt(effects, colors, form) {
    var lines = [];
    lines.push('〈Chaos-FX〉 В СВОЁМ ОТВЕТЕ расставляй эти метки прямо в тексте — оборачивай отдельные слова и короткие фразы по смыслу (акценты, а не весь текст). Метки пиши как есть, не объясняй их.');

    if (effects.length) {
      var fx = effects.map(function (e) {
        return '[fx:' + e.id + '] ' + e.desc;
      }).join(' · ');
      lines.push('Эффекты — [fx:имя]слово[/fx]: ' + fx);
    }

    if (colors.length) {
      var cl = colors.map(function (c) {
        var ru = (c.aliases && c.aliases[0]) ? ' ' + c.aliases[0] : '';
        return '[' + c.id + ']' + ru;
      }).join(' · ');
      lines.push('Цвета — [имя]слово[/имя]: ' + cl);
    }

    if (form && form.instruction) {
      lines.push('Форма ответа: ' + form.instruction);
    }

    lines.push('Вкладывать можно: [fx:ember][blood]пламя[/blood][/fx].');
    var ex1 = effects[0] ? effects[0].id : 'glow';
    var ex2 = effects[1] ? effects[1].id : 'ember';
    var exC = colors[0] ? colors[0].id : 'blood';
    lines.push('Пример: Она [fx:' + ex1 + ']замерла[/fx], когда [fx:' + ex2 + '][' + exC + ']тьма[/' + exC + '][/fx] коснулась её.');
    return lines.join('\n');
  }

  // ── Публичный API ─────────────────────────────────────────────────────────
  function rotate(settings) {
    var opts = Object.assign({}, DEFAULTS, settings || {});
    var moods = (opts.moods || []).map(function (m) {
      var c = ChaosFX.registry.mood(m);
      return c || m;
    }).filter(Boolean);

    var effects = sample(
      candidates(ChaosFX.EFFECTS, moods, opts.intensity, true),
      opts.effectsCount, opts.rng
    );
    var colors = sample(
      candidates(ChaosFX.COLORS, moods, opts.intensity, false),
      opts.colorsCount, opts.rng
    );
    var form = opts.form ? ChaosFX.registry.form(opts.form) : null;

    return {
      effects: effects,
      colors: colors,
      form: form,
      prompt: buildPrompt(effects, colors, form)
    };
  }

  ChaosFX.rotate = rotate;
  ChaosFX.rotation = { candidates: candidates, sample: sample, buildPrompt: buildPrompt };
})(typeof window !== 'undefined' ? window : this);
