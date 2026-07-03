/*
 * Chaos-FX — режиссёр (пункт 5 спецификации).
 *
 * Отдельная дешёвая модель читает последние сообщения сцены и возвращает
 * пакет атмосферы: { intensity, moods, form, image, note }. В чате не
 * появляется никогда; его вердикт кормит ротацию и формы.
 *
 * Модуль разбит на слои, тестируемые без сети:
 *   • buildDirectorMessages — сборка промпта (словарь настроений/форм, сцена);
 *   • parseVerdict — всепрощающий разбор ответа (JSON из мусора, подрезка);
 *   • applyVerdict — плавность: сглаживание накала, кулдауны, инерция настроений;
 *   • client — fetch к OpenAI-совместимому API (модели/тест/вердикт).
 *
 * Standalone-режим: вешается на window.ChaosFX.director.
 */
(function (root) {
  'use strict';

  var ChaosFX = root.ChaosFX = root.ChaosFX || {};
  if (!ChaosFX.MOODS || !ChaosFX.FORMS) {
    throw new Error('ChaosFX данные не загружены — подключи data/registry.js до director.js');
  }

  // ── Параметры плавности (дефолты; часть выводится в настройки) ─────────────
  var SMOOTH_DEFAULTS = {
    maxStep: 2,           // максимум изменения накала за ход
    peakThreshold: 8,     // накал ≥ этого — «буйный ход»
    peakCooldownTurns: 2, // сколько ходов после пика потолок занижен
    peakCap: 5,           // потолок цели во время кулдауна
    formCooldownTurns: 4, // формы не чаще, чем раз в K ходов
    moodCap: 4            // максимум настроений с учётом инерции
  };

  // Расшифровки настроений для словаря в промпте (RU — контекст, не UI).
  var MOOD_RU = {
    calm: 'спокойствие', joy: 'радость/тепло', tender: 'нежность/романтика',
    sorrow: 'грусть/тоска', nostalgia: 'память/прошлое', ominous: 'тревога/угроза',
    fear: 'страх/паника', rage: 'ярость/насилие', eerie: 'жуть/потустороннее',
    dream: 'сон/бред', psychedelic: 'психоделия/трип', chaos: 'хаос/мания',
    sacred: 'сакральное/божественное', corrupt: 'порча/искажение',
    cold: 'холод/клиника', sensual: 'чувственность/желание'
  };

  // RU-алиасы → канон (модель может ответить по-русски, прощаем).
  var MOOD_ALIAS = {};
  Object.keys(MOOD_RU).forEach(function (id) {
    MOOD_RU[id].split('/').forEach(function (word) {
      MOOD_ALIAS[word.trim().toLowerCase()] = id;
    });
  });

  // ── Сборка промпта ──────────────────────────────────────────────────────────
  function buildDirectorMessages(sceneMessages, state) {
    var moodDict = ChaosFX.MOODS.map(function (m) {
      return m + ' — ' + (MOOD_RU[m] || m);
    }).join('; ');
    var formDict = ChaosFX.FORMS.map(function (f) {
      return f.id + ' — ' + f.desc;
    }).join('; ');

    var sys = [
      'Ты — «режиссёр атмосферы» текстовой ролевой игры. Прочитай последние сообщения сцены и верни настройки визуальной атмосферы.',
      '',
      'Ответь ТОЛЬКО JSON-объектом, без markdown, без пояснений, без текста вокруг:',
      '{"intensity": 0-10, "moods": ["1-3 из словаря"], "form": "id формы или null", "image": null, "note": "короткое пояснение"}',
      '',
      'Правила:',
      '- intensity — накал сцены: 0-2 покой, 3-5 обычное напряжение, 6-8 сильные эмоции, 9-10 экстрим.',
      '- moods — 1-3 настроения СТРОГО из словаря. Не выдумывай новых.',
      '- form — id формы ТОЛЬКО если сцена явно уходит в психодел, бред, сон или искажение реальности; иначе null. Это редкий приём.',
      '- image — всегда null (зарезервировано).',
      '- note — одна короткая фраза, почему так.',
      '',
      'Словарь настроений: ' + moodDict + '.',
      'Формы (id — что это): ' + formDict + '.'
    ].join('\n');

    var cur = state && state.intensity != null
      ? 'Текущая атмосфера: накал ' + state.intensity +
        (state.moods && state.moods.length ? ', настроения: ' + state.moods.join(', ') : ', настроений нет') + '.'
      : 'Текущая атмосфера ещё не задана.';

    var scene = (sceneMessages || []).map(function (m) {
      return m.name + ': ' + m.text;
    }).join('\n\n');

    return [
      { role: 'system', content: sys },
      { role: 'user', content: cur + '\n\nСцена:\n' + scene }
    ];
  }

  // ── Всепрощающий разбор ─────────────────────────────────────────────────────
  // Выколупать первый сбалансированный {...} из любого мусора (с учётом строк).
  function extractJson(text) {
    var s = String(text || '');
    var start = s.indexOf('{');
    while (start !== -1) {
      var depth = 0, inStr = false, esc = false;
      for (var i = start; i < s.length; i++) {
        var c = s[i];
        if (esc) { esc = false; continue; }
        if (c === '\\') { esc = true; continue; }
        if (c === '"') { inStr = !inStr; continue; }
        if (inStr) continue;
        if (c === '{') depth++;
        else if (c === '}') {
          depth--;
          if (depth === 0) return s.slice(start, i + 1);
        }
      }
      start = s.indexOf('{', start + 1);
    }
    return null;
  }

  function coerceMood(raw) {
    if (typeof raw !== 'string') return null;
    var v = raw.trim().toLowerCase();
    if (!v) return null;
    var canon = ChaosFX.registry.mood(v);
    if (canon) return canon;
    if (MOOD_ALIAS[v]) return MOOD_ALIAS[v];
    // Подстрочное совпадение: «psychedelia» → psychedelic и т.п.
    for (var i = 0; i < ChaosFX.MOODS.length; i++) {
      var m = ChaosFX.MOODS[i];
      if (v.indexOf(m) === 0 || m.indexOf(v) === 0) return m;
    }
    return null;
  }

  // Разбор сырого текста ответа → { ok, verdict, warnings }.
  // При ok:false вызывающий остаётся на текущих настройках.
  function parseVerdict(text) {
    var warnings = [];
    var jsonStr = extractJson(text);
    if (!jsonStr) return { ok: false, verdict: null, warnings: ['no JSON found'] };

    var obj;
    try { obj = JSON.parse(jsonStr); }
    catch (e) { return { ok: false, verdict: null, warnings: ['JSON.parse: ' + e.message] }; }
    if (!obj || typeof obj !== 'object') {
      return { ok: false, verdict: null, warnings: ['not an object'] };
    }

    var v = { intensity: null, moods: [], form: null, image: null, note: '' };

    // intensity: число/строка-число → clamp 0..10; иначе null (не менять).
    var n = Number(obj.intensity);
    if (obj.intensity != null && isFinite(n)) {
      var clamped = Math.max(0, Math.min(10, Math.round(n)));
      if (clamped !== n) warnings.push('intensity ' + obj.intensity + ' → ' + clamped);
      v.intensity = clamped;
    } else if (obj.intensity != null) {
      warnings.push('intensity not a number: ' + JSON.stringify(obj.intensity));
    }

    // moods: подгонка к словарю, максимум 3.
    var rawMoods = Array.isArray(obj.moods) ? obj.moods : (obj.moods != null ? [obj.moods] : []);
    rawMoods.forEach(function (raw) {
      var m = coerceMood(raw);
      if (m) { if (v.moods.indexOf(m) === -1) v.moods.push(m); }
      else warnings.push('unknown mood dropped: ' + JSON.stringify(raw));
    });
    if (v.moods.length > 3) { warnings.push('moods trimmed to 3'); v.moods = v.moods.slice(0, 3); }

    // form: известная запись или null.
    if (obj.form != null && obj.form !== '' && obj.form !== 'null') {
      var f = ChaosFX.registry.form(String(obj.form));
      if (f) v.form = f.id;
      else warnings.push('unknown form dropped: ' + JSON.stringify(obj.form));
    }

    if (typeof obj.note === 'string') v.note = obj.note.slice(0, 200);

    return { ok: true, verdict: v, warnings: warnings };
  }

  // ── Плавность: применить вердикт к состоянию ────────────────────────────────
  // state: { intensity, moods, prevMoods, cooldown, formCooldown }
  // Возвращает НОВОЕ состояние + поле form (форма на этот ход или null).
  function applyVerdict(state, verdict, opts) {
    var o = Object.assign({}, SMOOTH_DEFAULTS, opts || {});
    var st = Object.assign(
      { intensity: 4, moods: [], prevMoods: [], cooldown: 0, formCooldown: 0 },
      state || {}
    );

    // Накал: цель → кулдаун-потолок → шаг сглаживания.
    var target = verdict.intensity != null ? verdict.intensity : st.intensity;
    var next = Object.assign({}, st);
    if (st.cooldown > 0) {
      target = Math.min(target, o.peakCap);
      next.cooldown = st.cooldown - 1;
    }
    var delta = Math.max(-o.maxStep, Math.min(o.maxStep, target - st.intensity));
    next.intensity = st.intensity + delta;
    // Пик достигнут → пара спокойных ходов после.
    if (next.intensity >= o.peakThreshold && st.cooldown === 0) {
      next.cooldown = o.peakCooldownTurns;
    }

    // Настроения + инерция: прошлый ход «дотлевает» один ход.
    var fresh = verdict.moods && verdict.moods.length ? verdict.moods.slice() : st.moods.slice();
    var effective = fresh.slice();
    (st.moods || []).forEach(function (m) {
      if (effective.indexOf(m) === -1 && effective.length < o.moodCap) effective.push(m);
    });
    next.prevMoods = st.moods.slice();
    next.moods = fresh;
    next.effectiveMoods = effective;

    // Форма: кулдаун — формы редкая приправа.
    if (verdict.form && st.formCooldown <= 0) {
      next.form = verdict.form;
      next.formCooldown = o.formCooldownTurns;
    } else {
      next.form = null;
      if (verdict.form) next.formSuppressed = verdict.form; // для отладки
      next.formCooldown = Math.max(0, st.formCooldown - 1);
    }

    next.note = verdict.note || '';
    return next;
  }

  // ── API-клиент (браузерный fetch; в node-тестах не используется) ────────────
  // База: https://host/v1 → /models и /chat/completions. Хвосты обрезаем.
  function normalizeEndpoint(url) {
    var u = String(url || '').trim().replace(/\/+$/, '');
    u = u.replace(/\/chat\/completions$/, '').replace(/\/models$/, '');
    return u;
  }

  function headers(cfg) {
    var h = { 'Content-Type': 'application/json' };
    if (cfg.apiKey) h['Authorization'] = 'Bearer ' + cfg.apiKey;
    return h;
  }

  async function fetchModels(cfg) {
    var base = normalizeEndpoint(cfg.endpoint);
    var res = await fetch(base + '/models', { headers: headers(cfg) });
    if (!res.ok) throw new Error('HTTP ' + res.status + ' ' + res.statusText);
    var data = await res.json();
    var list = Array.isArray(data.data) ? data.data : (Array.isArray(data) ? data : []);
    return list.map(function (m) { return m.id || m.name || String(m); }).filter(Boolean);
  }

  async function complete(cfg, messages, maxTokens) {
    var base = normalizeEndpoint(cfg.endpoint);
    var res = await fetch(base + '/chat/completions', {
      method: 'POST',
      headers: headers(cfg),
      body: JSON.stringify({
        model: cfg.model,
        messages: messages,
        temperature: cfg.temperature != null ? cfg.temperature : 0.6,
        max_tokens: maxTokens || 250,
        stream: false
      })
    });
    if (!res.ok) {
      var body = '';
      try { body = (await res.text()).slice(0, 300); } catch (e) { /* пусто */ }
      throw new Error('HTTP ' + res.status + ': ' + body);
    }
    var data = await res.json();
    var msg = data.choices && data.choices[0] && data.choices[0].message;
    return (msg && msg.content) || '';
  }

  // Короткий тестовый запрос: жива ли выбранная модель.
  async function testConnection(cfg) {
    var t0 = Date.now();
    var reply = await complete(cfg, [
      { role: 'user', content: 'Ответь ровно одним словом: работаю' }
    ], 20);
    return { ok: true, latencyMs: Date.now() - t0, reply: String(reply).slice(0, 80) };
  }

  // Полный цикл: сцена → вызов → разбор. Сетевые/парс-ошибки не бросаем наружу.
  async function directScene(cfg, sceneMessages, state, smoothOpts) {
    var messages = buildDirectorMessages(sceneMessages, state);
    var raw;
    try {
      raw = await complete(cfg, messages, 250);
    } catch (e) {
      return { ok: false, error: 'request failed: ' + e.message, state: state };
    }
    var parsed = parseVerdict(raw);
    if (!parsed.ok) {
      return { ok: false, error: 'parse failed: ' + parsed.warnings.join('; '), raw: raw, state: state };
    }
    var next = applyVerdict(state, parsed.verdict, smoothOpts);
    return { ok: true, verdict: parsed.verdict, warnings: parsed.warnings, raw: raw, state: next };
  }

  ChaosFX.director = {
    SMOOTH_DEFAULTS: SMOOTH_DEFAULTS,
    buildDirectorMessages: buildDirectorMessages,
    extractJson: extractJson,
    parseVerdict: parseVerdict,
    applyVerdict: applyVerdict,
    normalizeEndpoint: normalizeEndpoint,
    fetchModels: fetchModels,
    complete: complete,
    testConnection: testConnection,
    directScene: directScene
  };
})(typeof window !== 'undefined' ? window : this);
