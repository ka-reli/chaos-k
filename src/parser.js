/*
 * Chaos-FX — парсер меток (пункт 4 спецификации).
 *
 * Синтаксис:
 *   эффект      [fx:ember]…[/fx]      (имя эффекта — параметр, не часть шаблона)
 *   настроение  [ominous]…[/ominous]  (разворачивается в случайный эффект из пула)
 *   цвет        [void]…[/void]
 *   вложенность [fx:ember][void]…[/void][/fx]
 *   авто-закрытие [/]  закрывает ближайшую открытую метку
 *
 * Подход: токенизация → дерево (AST) со стеком → рендер в HTML.
 * Дерево даёт полный текст каждого узла, поэтому предохранители
 * (бюджет, потолок вложенности, maxChars для spatial) считаются точно.
 *
 * Толерантность:
 *   • [fx:НЕИЗВЕСТНО] и любые [/…] — это явно метки → выкусываются без следа
 *     (сырьё игроку не протекает).
 *   • [слово], не совпавшее ни с настроением, ни с цветом — НЕ метка
 *     (markdown-ссылка [text](url), OOC-скобки) → отдаётся как обычный текст.
 *   • регистр и пробелы не важны; алиасы → канон; забытые метки авто-закрываются.
 */
(function (root) {
  'use strict';

  var ChaosFX = root.ChaosFX = root.ChaosFX || {};
  var reg = ChaosFX.registry;
  if (!reg) {
    throw new Error('ChaosFX.registry не загружен — подключи data/registry.js до parser.js');
  }

  var DEFAULTS = {
    maxDepth: 6,          // потолок вложенности спанов
    budget: 14,           // сумма intensity применённых эффектов на сообщение
    reducedMotion: false, // a11y: применять поле reducedMotion
    theme: 'dark',        // для маркировки; реальные цвета — в CSS-переменных
    escape: true,         // экранировать текст? (false — для готового HTML сообщения ST)
    rng: Math.random      // инъекция для детерминированных тестов
  };

  // Метки: [ ... ] без вложенных скобок. Поддержка latin+cyrillic, цифр, : - _ /.
  var TAG_RE = /\[\s*\/?\s*[A-Za-z0-9_Ѐ-ӿ][A-Za-z0-9_Ѐ-ӿ :\/-]*\s*\]/g;

  function escapeHtml(s) {
    return String(s)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;');
  }

  // ── Токенизация ───────────────────────────────────────────────────────────
  // Возвращает массив { type:'text', value } | { type:'open'|'close', ... }.
  function tokenize(input) {
    var tokens = [];
    var last = 0;
    var m;
    TAG_RE.lastIndex = 0;
    while ((m = TAG_RE.exec(input)) !== null) {
      if (m.index > last) {
        tokens.push({ type: 'text', value: input.slice(last, m.index) });
      }
      var raw = m[0];
      var inner = raw.slice(1, -1).trim(); // без [ ]
      tokens.push(classify(inner, raw));
      last = m.index + raw.length;
    }
    if (last < input.length) {
      tokens.push({ type: 'text', value: input.slice(last) });
    }
    return tokens;
  }

  function classify(inner, raw) {
    // Закрывающая метка: [/], [/fx], [/void], [/ominous] …
    if (inner.charAt(0) === '/') {
      var closeName = inner.slice(1).trim().toLowerCase();
      return { type: 'close', name: closeName }; // '' => generic [/]
    }

    // Эффект: [fx:NAME]
    var fxMatch = /^fx\s*:\s*(.+)$/i.exec(inner);
    if (fxMatch) {
      var fx = reg.effect(fxMatch[1]);
      // Явная метка эффекта: известна → открыть, неизвестна → выкусить (drop).
      return { type: 'open', kind: 'fx', rec: fx, raw: raw, drop: !fx };
    }

    // Форма-фрагмент: [form:NAME] — блочная вставка (письмо/досье/записка…).
    var formMatch = /^form\s*:\s*(.+)$/i.exec(inner);
    if (formMatch) {
      var frm = reg.form(formMatch[1]);
      return { type: 'open', kind: 'form', rec: frm, raw: raw, drop: !frm };
    }

    // Голое [имя]: настроение? цвет? — иначе это НЕ метка (обычный текст).
    var mood = reg.mood(inner);
    if (mood) return { type: 'open', kind: 'mood', name: mood, raw: raw };

    var color = reg.color(inner);
    if (color) return { type: 'open', kind: 'color', rec: color, raw: raw };

    // Не распознано как метка — отдаём как обычный текст (markdown/OOC не ломаем).
    return { type: 'text', value: raw };
  }

  // ── Сборка дерева ─────────────────────────────────────────────────────────
  function buildTree(tokens) {
    var root = { kind: 'root', children: [] };
    var stack = [root];

    function top() { return stack[stack.length - 1]; }

    tokens.forEach(function (t) {
      if (t.type === 'text') {
        top().children.push({ kind: 'text', value: t.value });
        return;
      }
      if (t.type === 'open') {
        if (t.drop) return; // явная, но неизвестная метка эффекта — без следа
        var node = { kind: t.kind, rec: t.rec, name: t.name, children: [] };
        top().children.push(node);
        stack.push(node);
        return;
      }
      if (t.type === 'close') {
        closeTag(stack, t.name);
        return;
      }
    });

    // Забытые открытые метки — авто-закрытие (просто оставляем в дереве).
    return root;
  }

  // Закрыть метку толерантно. Имя может быть '', 'fx', id/алиас настроения/цвета.
  function closeTag(stack, name) {
    if (stack.length <= 1) return; // нечего закрывать — мягкий провал

    if (!name) { stack.pop(); return; } // [/] — ближайшую

    // Ищем сверху вниз подходящий открытый узел.
    for (var i = stack.length - 1; i >= 1; i--) {
      if (matchesClose(stack[i], name)) {
        stack.length = i; // закрываем его и всё, что внутри (авто-закрытие)
        return;
      }
    }
    // Совпадения нет — закрываем ближайший (терпимость к мусору).
    stack.pop();
  }

  function matchesClose(node, name) {
    if (name === 'fx') return node.kind === 'fx';
    if (name === 'form') return node.kind === 'form';
    if (node.kind === 'fx' && node.rec) {
      return reg.effect(name) === node.rec;
    }
    if (node.kind === 'form' && node.rec) {
      return reg.form(name) === node.rec;
    }
    if (node.kind === 'color' && node.rec) {
      return reg.color(name) === node.rec;
    }
    if (node.kind === 'mood') {
      return reg.mood(name) === node.name;
    }
    return false;
  }

  // ── Рендер дерева в HTML ──────────────────────────────────────────────────
  function textLength(node) {
    if (node.kind === 'text') return node.value.length;
    if (!node.children) return 0;
    return node.children.reduce(function (n, c) { return n + textLength(c); }, 0);
  }

  // Выбор случайного эффекта из пула настроения, взвешенно по weight,
  // с фильтром по остатку бюджета.
  function pickFromMood(moodName, ctx) {
    var pool = (ChaosFX.MOOD_POOL[moodName] || []).filter(function (fx) {
      return fx.intensity <= ctx.budgetLeft;
    });
    if (!pool.length) return null;
    var total = pool.reduce(function (s, fx) { return s + (fx.weight || 1); }, 0);
    var r = ctx.rng() * total;
    for (var i = 0; i < pool.length; i++) {
      r -= (pool[i].weight || 1);
      if (r <= 0) return pool[i];
    }
    return pool[pool.length - 1];
  }

  // Класс эффекта с учётом reduced-motion. Возвращает строку класса или null
  // (null => применять не нужно, рендерим детей голыми).
  function effectClass(fx, ctx) {
    if (!ctx.reducedMotion) return fx.css;
    var rm = fx.reducedMotion;
    if (rm === 'disable') return null; // голый текст
    if (rm == null) return fx.css;      // эффект безопасен и в покое
    return rm;                          // статическая замена
  }

  function renderNode(node, ctx) {
    if (node.kind === 'text') {
      return ctx.escape ? escapeHtml(node.value) : node.value;
    }
    if (node.kind === 'root') {
      return renderChildren(node, ctx);
    }

    // Цвет — отдельная ось: класс clr-* + пометка для контрастной обводки.
    if (node.kind === 'color') {
      if (ctx.depth >= ctx.maxDepth) return renderChildren(node, ctx);
      ctx.depth++;
      var inner = renderChildren(node, ctx);
      ctx.depth--;
      return '<span class="clr-' + node.rec.id + ' fx-colored">' + inner + '</span>';
    }

    // Форма-фрагмент — блочная «вставка» с тонким акцентом и ярлыком.
    if (node.kind === 'form') {
      if (ctx.depth >= ctx.maxDepth) return renderChildren(node, ctx);
      ctx.depth++;
      var fbody = renderChildren(node, ctx);
      ctx.depth--;
      var label = node.rec.desc || node.rec.id;
      return '<div class="cfx-form" data-form="' + node.rec.id + '">' +
        '<span class="cfx-form-label">' + escapeHtml(label) + '</span>' +
        fbody + '</div>';
    }

    // Настроение → конкретный эффект из пула, дальше как эффект.
    var fx = node.kind === 'mood' ? pickFromMood(node.name, ctx) : node.rec;
    if (!fx) return renderChildren(node, ctx); // пул пуст / бюджет — мягкий провал

    // Предохранитель глубины.
    if (ctx.depth >= ctx.maxDepth) return renderChildren(node, ctx);

    // Предохранитель бюджета.
    if (fx.intensity > ctx.budgetLeft) return renderChildren(node, ctx);

    // Предохранитель длины для spatial.
    if (fx.scope === 'spatial' && fx.maxChars && textLength(node) > fx.maxChars) {
      return renderChildren(node, ctx);
    }

    var cls = effectClass(fx, ctx);
    if (!cls) return renderChildren(node, ctx); // reduced-motion: disable

    ctx.budgetLeft -= fx.intensity;
    ctx.depth++;
    var body = renderChildren(node, ctx);
    ctx.depth--;

    var classes = cls;
    if (fx.colorBased) classes += ' fx-colored';
    var attrs = ' data-fx="' + fx.id + '"';
    if (fx.scope === 'spatial') attrs += ' data-scope="spatial"';
    return '<span class="' + classes + '"' + attrs + '>' + body + '</span>';
  }

  function renderChildren(node, ctx) {
    if (!node.children) return '';
    var out = '';
    for (var i = 0; i < node.children.length; i++) {
      out += renderNode(node.children[i], ctx);
    }
    return out;
  }

  // ── Публичный API ─────────────────────────────────────────────────────────
  function parse(input, options) {
    var opts = Object.assign({}, DEFAULTS, options || {});
    var ctx = {
      depth: 0,
      maxDepth: opts.maxDepth,
      budgetLeft: opts.budget,
      reducedMotion: !!opts.reducedMotion,
      escape: opts.escape !== false,
      rng: opts.rng
    };
    var tree = buildTree(tokenize(input));
    return renderNode(tree, ctx);
  }

  // Снять все метки, оставив чистый текст (для контекста модели и «читаемого» вида).
  // escape=false по умолчанию: вход может быть готовым HTML сообщения.
  function strip(input, options) {
    var opts = options || {};
    function walk(node) {
      if (node.kind === 'text') return (opts.escape ? escapeHtml(node.value) : node.value);
      if (!node.children) return '';
      return node.children.map(walk).join('');
    }
    return walk(buildTree(tokenize(input)));
  }

  ChaosFX.parse = parse;
  ChaosFX.strip = strip;
  ChaosFX.tokenize = tokenize;       // экспорт для юнит-тестов
  ChaosFX.buildTree = buildTree;
  ChaosFX.escapeHtml = escapeHtml;
})(typeof window !== 'undefined' ? window : this);
