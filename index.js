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
    // Макро-формы (весь ответ как рецепт/пьеса/досье и т.д.)
    formsEnabled: false,  // слой макро-форм
    formMode: 'random',   // off | random | forced
    forcedForm: '',       // id формы при formMode === 'forced'
    formChance: 25,       // шанс формы на ход (%) при formMode === 'random'
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

// ── Рендер: развернуть метки в DOM сообщения ─────────────────────────────────
// Флаг: мы сами сейчас пишем в DOM — наблюдатель должен игнорировать эти мутации.
let cfxApplying = false;

// Развернуть метки в одном .mes_text. Идемпотентно: если меток нет или они уже
// развёрнуты, DOM не трогаем (можно звать сколько угодно раз).
function expandTags(textEl) {
    const s = settings();
    if (!s.enabled || !s.effects || !textEl) return;
    const src = textEl.innerHTML;
    if (src.indexOf('[') === -1) return; // быстрый выход: меток точно нет

    const html = CFX.parse(src, {
        escape: false, // работаем по готовому HTML — markdown сохраняется
        budget: s.budget,
        reducedMotion: s.reducedMotion,
        theme: resolveTheme(),
    });
    if (html === src) return; // распознанных меток не нашлось — не дёргаем DOM

    cfxApplying = true;
    textEl.innerHTML = html;
    cfxApplying = false;
}

// Полная обработка одного сообщения: метки + восстановление «читаемого» + кнопка.
function processBlock(block) {
    if (!block) return;
    const textEl = block.querySelector('.mes_text');
    if (!textEl) return;
    expandTags(textEl);

    const messageId = block.getAttribute('mesid');
    const ctx = getContext();
    const msg = ctx.chat?.[messageId];
    if (msg?.extra?.cfxReadable) textEl.classList.add('cfx-readable');

    addReadableButton(block, textEl, messageId);
}

// Обработчик событий рендера (получает messageId).
function renderMessage(messageId) {
    const block = document.querySelector(`#chat .mes[mesid="${messageId}"]`);
    processBlock(block);
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

// ── Наблюдатель за DOM чата ───────────────────────────────────────────────────
// Страховка от стриминга и повторных рендеров ST: когда .mes_text меняется и в
// нём появляются сырые метки — доразворачиваем (с дебаунсом, чтобы не дёргать
// на каждый токен). Покрывает случай «модель пишет метки, но они не оформляются».
const cfxPending = new Set();
let cfxFlushTimer = null;

function scheduleFlush() {
    clearTimeout(cfxFlushTimer);
    cfxFlushTimer = setTimeout(() => {
        const blocks = [...cfxPending];
        cfxPending.clear();
        blocks.forEach(processBlock);
    }, 180);
}

function startObserver() {
    const chat = document.getElementById('chat');
    if (!chat) return;
    const observer = new MutationObserver((mutations) => {
        if (cfxApplying) return; // не реагируем на собственную запись
        for (const m of mutations) {
            const t = m.target;
            const el = t.nodeType === 1 ? t : t.parentElement;
            const block = el && el.closest ? el.closest('.mes') : null;
            if (block) cfxPending.add(block);
        }
        if (cfxPending.size) scheduleFlush();
    });
    observer.observe(chat, { childList: true, subtree: true, characterData: true });
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
        form: chooseForm(s),
    });
    // IN_CHAT, глубина 1 (перед последним сообщением), роль system (0).
    setExtensionPrompt(PROMPT_KEY, res.prompt, extension_prompt_types.IN_CHAT, 1, false, 0);
    console.debug('[Chaos-FX] palette injected:\n' + res.prompt);
}

// Решить, какая форма (если есть) уйдёт модели в этот ход.
function chooseForm(s) {
    if (!s.formsEnabled) return null;
    if (s.formMode === 'forced') return s.forcedForm || null;
    if (s.formMode === 'random') {
        if (Math.random() * 100 >= s.formChance) return null;
        const f = CFX.pickForm({ moods: s.moods, intensity: s.intensity });
        return f ? f.id : null;
    }
    return null;
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

    const formOptions = CFX.FORMS.map((f) => {
        const sel = s.forcedForm === f.id ? 'selected' : '';
        return `<option value="${f.id}" ${sel}>${f.id} — ${f.desc}</option>`;
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

          <hr class="cfx-sep">
          <label class="checkbox_label"><input type="checkbox" id="cfx-forms" ${s.formsEnabled ? 'checked' : ''}> Macro-forms layer</label>
          <label>Form mode
            <select id="cfx-form-mode" class="text_pole">
              <option value="off" ${s.formMode === 'off' ? 'selected' : ''}>Off</option>
              <option value="random" ${s.formMode === 'random' ? 'selected' : ''}>Random (by chance)</option>
              <option value="forced" ${s.formMode === 'forced' ? 'selected' : ''}>Forced (always)</option>
            </select>
          </label>
          <label id="cfx-form-chance-row">Form chance: <span id="cfx-form-chance-val">${s.formChance}</span>%
            <input type="range" id="cfx-form-chance" min="0" max="100" value="${s.formChance}">
          </label>
          <label id="cfx-forced-form-row">Forced form
            <select id="cfx-forced-form" class="text_pole">${formOptions}</select>
          </label>
          <small class="cfx-hint">Forms reshape the whole reply (recipe, play, dossier…). The model formats text per the form's instruction.</small>
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

    // Макро-формы.
    const refreshFormRows = () => {
        const random = s.formMode === 'random' && s.formsEnabled;
        const forced = s.formMode === 'forced' && s.formsEnabled;
        $('#cfx-form-chance-row').toggle(random);
        $('#cfx-forced-form-row').toggle(forced);
    };
    $('#cfx-forms').on('change', function () { s.formsEnabled = this.checked; refreshFormRows(); save(); });
    $('#cfx-form-mode').on('change', function () { s.formMode = this.value; refreshFormRows(); save(); });
    $('#cfx-form-chance').on('input', function () {
        s.formChance = +this.value || 0; $('#cfx-form-chance-val').text(this.value); save();
    });
    $('#cfx-forced-form').on('change', function () { s.forcedForm = this.value; save(); });
    refreshFormRows();
}

// Обработать все сообщения в чате (загрузка/смена чата).
function processAll() {
    document.querySelectorAll('#chat .mes').forEach(processBlock);
}

// ── Старт ────────────────────────────────────────────────────────────────────
jQuery(() => {
    settings();
    applyTheme();
    buildSettingsPanel();
    startObserver();

    // Рендер по событиям (на всякий случай — наблюдатель тоже подхватит).
    eventSource.on(event_types.CHARACTER_MESSAGE_RENDERED, renderMessage);
    eventSource.on(event_types.USER_MESSAGE_RENDERED, renderMessage);

    // После правки/свайпа сообщение перерисовывается из сырого текста.
    // Обработка идемпотентна, имена событий могут отличаться по версии ST.
    [event_types.MESSAGE_UPDATED, event_types.MESSAGE_EDITED, event_types.MESSAGE_SWIPED]
        .forEach((ev) => { if (ev) eventSource.on(ev, renderMessage); });

    // Запасная инъекция палитры (на случай, если generate_interceptor
    // не вызывается в этой версии ST).
    if (event_types.GENERATION_STARTED) {
        eventSource.on(event_types.GENERATION_STARTED, (type, _opts, dryRun) => {
            if (dryRun) return;
            if (type === 'quiet') return;
            injectPalette();
        });
    }

    // Метки в старых сообщениях при загрузке/смене чата.
    eventSource.on(event_types.CHAT_CHANGED, () => setTimeout(processAll, 100));
    setTimeout(processAll, 300);

    console.log('[Chaos-FX] loaded');
});
