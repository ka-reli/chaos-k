/*
 * Chaos-FX — точка входа расширения SillyTavern.
 *
 * Склеивает уже оттестированные standalone-модули (реестр, парсер, ротация)
 * с движком Таверны:
 *   • рендер: CHARACTER_MESSAGE_RENDERED → разворачиваем метки в DOM сообщения;
 *   • подсказка: перед каждой генерацией ротация кладёт палитру через
 *     setExtensionPrompt (крошечный блок, тяжесть в контекст не уходит);
 *   • чистота контекста: перехватчик генерации может сжать/снять метки;
 *   • кнопка «сделать читаемым» в строке сообщения (per-message);
 *   • базовые настройки (extension_settings) + панель.
 *
 * Тяжёлая логика — в модулях ниже; здесь только проводка к ST.
 * Сигнатуры ST проверены по докам (июнь 2026), но ST часто меняется —
 * при поломке сверять writing-extensions.
 */

// Модули-данные/логика: вешают всё на window.ChaosFX (side-effect import).
import './data/registry.js';
import './src/parser.js';
import './src/rotation.js';

// API SillyTavern.
import {
    eventSource,
    event_types,
    saveSettingsDebounced,
    setExtensionPrompt,
    extension_prompt_types,
} from '../../../../script.js';
import { extension_settings, getContext } from '../../../extensions.js';

const CFX = window.ChaosFX;
const MODULE = 'chaos_fx';
const PROMPT_KEY = 'chaos_fx_palette';

// ── Настройки ───────────────────────────────────────────────────────────────
const defaultSettings = {
    enabled: true,
    effects: true,        // слой микро-эффектов
    intensity: 5,         // потолок накала 0–10 (ручной режим)
    moods: [],            // активные настроения (ручной режим)
    budget: 14,           // бюджет суммы intensity на сообщение
    effectsCount: 6,      // сколько эффектов подкидывать модели
    colorsCount: 4,       // сколько цветов подкидывать
    reducedMotion: false, // ручной reduced-motion
    theme: 'auto',        // auto | dark | light
    stripFromContext: false, // вырезать метки из истории перед отправкой
};

function settings() {
    extension_settings[MODULE] = Object.assign(
        {},
        defaultSettings,
        extension_settings[MODULE] || {},
    );
    return extension_settings[MODULE];
}

// ── Тема: авто по яркости фона ST, либо ручной выбор ─────────────────────────
function resolveTheme() {
    const s = settings();
    if (s.theme === 'light') return 'light';
    if (s.theme === 'dark') return 'dark';
    // auto: читаем цвет текста темы ST — светлый текст ⇒ тёмный фон.
    try {
        const probe = getComputedStyle(document.body).color;
        const m = probe.match(/\d+/g);
        if (m) {
            const lum = (0.2126 * +m[0] + 0.7152 * +m[1] + 0.0722 * +m[2]);
            return lum > 140 ? 'dark' : 'light';
        }
    } catch (e) { /* пусто */ }
    return 'dark';
}

function applyTheme() {
    const dark = resolveTheme() === 'dark';
    document.body.classList.add('cfx-root');
    document.body.classList.toggle('cfx-theme-light', !dark);
}

// ── Рендер: развернуть метки в DOM готового сообщения ────────────────────────
function renderMessage(messageId) {
    const s = settings();
    if (!s.enabled || !s.effects) return;

    const block = document.querySelector(`#chat .mes[mesid="${messageId}"]`);
    if (!block) return;
    const textEl = block.querySelector('.mes_text');
    if (!textEl || textEl.dataset.cfxDone === '1') return;

    // Работаем по уже отрендеренному HTML (markdown сохраняется): escape off.
    const html = CFX.parse(textEl.innerHTML, {
        escape: false,
        budget: s.budget,
        reducedMotion: s.reducedMotion,
        theme: resolveTheme(),
    });
    textEl.innerHTML = html;
    textEl.dataset.cfxDone = '1';

    // Восстановить состояние «читаемого» вида, если было сохранено.
    const ctx = getContext();
    const msg = ctx.chat?.[messageId];
    if (msg?.extra?.cfxReadable) textEl.classList.add('cfx-readable');

    addReadableButton(block, textEl, messageId);
}

// ── Кнопка «сделать читаемым» ────────────────────────────────────────────────
function addReadableButton(block, textEl, messageId) {
    const row = block.querySelector('.mes_buttons');
    if (!row || row.querySelector('.cfx-readable-btn')) return;

    const btn = document.createElement('div');
    btn.className = 'mes_button cfx-readable-btn fa-solid fa-eye-low-vision interactable';
    btn.title = 'Chaos-FX: toggle readable text';
    btn.tabIndex = 0;
    btn.addEventListener('click', () => {
        const on = textEl.classList.toggle('cfx-readable');
        const ctx = getContext();
        const msg = ctx.chat?.[messageId];
        if (msg) {
            msg.extra = msg.extra || {};
            msg.extra.cfxReadable = on;
            ctx.saveChatDebounced?.();
        }
    });
    row.prepend(btn);
}

// ── Подсказка модели: ротация палитры перед генерацией ───────────────────────
function injectPalette() {
    const s = settings();
    if (!s.enabled || !s.effects) {
        setExtensionPrompt(PROMPT_KEY, '', extension_prompt_types.IN_CHAT, 1);
        return;
    }
    const res = CFX.rotate({
        intensity: s.intensity,
        moods: s.moods,
        effectsCount: s.effectsCount,
        colorsCount: s.colorsCount,
    });
    // IN_CHAT, глубина 1 (перед последним сообщением), роль system (0).
    setExtensionPrompt(PROMPT_KEY, res.prompt, extension_prompt_types.IN_CHAT, 1, false, 0);
    console.debug('[Chaos-FX] palette injected:\n' + res.prompt);
}

// ── Перехватчик генерации (manifest: generate_interceptor) ───────────────────
// Зовётся ST перед сборкой промпта (кроме dry-run). Здесь обновляем палитру
// и, по желанию, чистим метки из истории.
globalThis.chaosFxInterceptor = async function (chat, _contextSize, _abort, type) {
    const s = settings();
    console.debug('[Chaos-FX] interceptor fired, type=' + type);
    if (!s.enabled) return;
    if (type === 'quiet') return; // тихие фоновые генерации не трогаем

    injectPalette();

    if (s.stripFromContext && Array.isArray(chat)) {
        // Снимаем метки со всех сообщений, кроме последнего ответа персонажа
        // (его оставляем как пример разметки для модели).
        let lastCharIdx = -1;
        for (let i = chat.length - 1; i >= 0; i--) {
            if (!chat[i].is_user && !chat[i].is_system) { lastCharIdx = i; break; }
        }
        for (let i = 0; i < chat.length; i++) {
            if (i === lastCharIdx) continue;
            if (typeof chat[i].mes === 'string') {
                chat[i].mes = CFX.strip(chat[i].mes, { escape: false });
            }
        }
    }
};

// ── Панель настроек ──────────────────────────────────────────────────────────
function buildSettingsPanel() {
    const s = settings();
    const moodChips = CFX.MOODS.map((m) => {
        const on = s.moods.includes(m) ? ' cfx-on' : '';
        return `<span class="cfx-mood-chip${on}" data-mood="${m}">${m}</span>`;
    }).join('');

    const html = `
    <div class="chaos-fx-settings">
      <div class="inline-drawer">
        <div class="inline-drawer-toggle inline-drawer-header">
          <b>Chaos-FX</b>
          <div class="inline-drawer-icon fa-solid fa-circle-chevron-down down"></div>
        </div>
        <div class="inline-drawer-content">
          <label class="checkbox_label"><input type="checkbox" id="cfx-enabled" ${s.enabled ? 'checked' : ''}> Enable Chaos-FX</label>
          <label class="checkbox_label"><input type="checkbox" id="cfx-effects" ${s.effects ? 'checked' : ''}> Micro-effects layer</label>
          <label class="checkbox_label"><input type="checkbox" id="cfx-reduced" ${s.reducedMotion ? 'checked' : ''}> Reduced motion (static)</label>
          <label class="checkbox_label"><input type="checkbox" id="cfx-strip" ${s.stripFromContext ? 'checked' : ''}> Strip tags from context history</label>

          <label>Theme
            <select id="cfx-theme" class="text_pole">
              <option value="auto" ${s.theme === 'auto' ? 'selected' : ''}>Auto</option>
              <option value="dark" ${s.theme === 'dark' ? 'selected' : ''}>Dark</option>
              <option value="light" ${s.theme === 'light' ? 'selected' : ''}>Light</option>
            </select>
          </label>

          <label>Intensity ceiling: <span id="cfx-intensity-val">${s.intensity}</span>
            <input type="range" id="cfx-intensity" min="0" max="10" value="${s.intensity}">
          </label>
          <label>Effect budget per message
            <input type="number" id="cfx-budget" class="text_pole" min="0" max="60" value="${s.budget}">
          </label>
          <div class="flex-container">
            <label>Effects offered <input type="number" id="cfx-fxn" class="text_pole" min="0" max="32" value="${s.effectsCount}"></label>
            <label>Colors offered <input type="number" id="cfx-clrn" class="text_pole" min="0" max="24" value="${s.colorsCount}"></label>
          </div>

          <div>Active moods (manual mode)</div>
          <div class="cfx-moods">${moodChips}</div>
          <small class="cfx-hint">Empty = all moods. The director (coming later) will set these automatically.</small>
        </div>
      </div>
    </div>`;

    $('#extensions_settings').append(html);
    wireSettings();
}

function wireSettings() {
    const s = settings();
    const save = () => saveSettingsDebounced();

    $('#cfx-enabled').on('change', function () { s.enabled = this.checked; save(); });
    $('#cfx-effects').on('change', function () { s.effects = this.checked; save(); });
    $('#cfx-reduced').on('change', function () { s.reducedMotion = this.checked; save(); });
    $('#cfx-strip').on('change', function () { s.stripFromContext = this.checked; save(); });
    $('#cfx-theme').on('change', function () { s.theme = this.value; applyTheme(); save(); });
    $('#cfx-intensity').on('input', function () {
        s.intensity = +this.value; $('#cfx-intensity-val').text(this.value); save();
    });
    $('#cfx-budget').on('input', function () { s.budget = +this.value || 0; save(); });
    $('#cfx-fxn').on('input', function () { s.effectsCount = +this.value || 0; save(); });
    $('#cfx-clrn').on('input', function () { s.colorsCount = +this.value || 0; save(); });

    $(document).on('click', '.cfx-mood-chip', function () {
        const mood = this.dataset.mood;
        const i = s.moods.indexOf(mood);
        if (i === -1) { s.moods.push(mood); this.classList.add('cfx-on'); }
        else { s.moods.splice(i, 1); this.classList.remove('cfx-on'); }
        save();
    });
}

// Перерендер при правке/свайпе: сбросить флаг и развернуть метки заново.
function rerenderMessage(messageId) {
    const block = document.querySelector(`#chat .mes[mesid="${messageId}"]`);
    const el = block?.querySelector('.mes_text');
    if (el) delete el.dataset.cfxDone;
    renderMessage(messageId);
}

// ── Старт ────────────────────────────────────────────────────────────────────
jQuery(() => {
    settings();
    applyTheme();
    buildSettingsPanel();

    eventSource.on(event_types.CHARACTER_MESSAGE_RENDERED, renderMessage);
    eventSource.on(event_types.USER_MESSAGE_RENDERED, renderMessage);

    // Фикс №1: после правки/свайпа сообщение перерисовывается из сырого текста —
    // прогоняем метки заново. Имена событий могут отличаться по версии ST.
    [event_types.MESSAGE_UPDATED, event_types.MESSAGE_EDITED, event_types.MESSAGE_SWIPED]
        .forEach((ev) => { if (ev) eventSource.on(ev, rerenderMessage); });

    // Запасная инъекция палитры (на случай, если generate_interceptor
    // не вызывается в этой версии ST).
    if (event_types.GENERATION_STARTED) {
        eventSource.on(event_types.GENERATION_STARTED, (type, _opts, dryRun) => {
            if (dryRun) return;
            if (type === 'quiet') return;
            injectPalette();
        });
    }

    // Перерисовка при загрузке/смене чата — метки в старых сообщениях.
    eventSource.on(event_types.CHAT_CHANGED, () => {
        document.querySelectorAll('#chat .mes_text[data-cfx-done="1"]').forEach((el) => {
            delete el.dataset.cfxDone;
        });
    });

    console.log('[Chaos-FX] loaded');
});
