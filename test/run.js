/*
 * Дымовые тесты парсера Chaos-FX (node, без браузера).
 * Файлы вешаются на window → подсовываем globalThis как window.
 */
'use strict';
globalThis.window = globalThis;
require('../data/registry.js');
require('../src/parser.js');

var CFX = globalThis.ChaosFX;
var pass = 0, fail = 0;

function check(name, cond, extra) {
  if (cond) { pass++; console.log('  ok  ' + name); }
  else { fail++; console.log('FAIL  ' + name + (extra ? '  →  ' + extra : '')); }
}

// Детерминированный rng для меток-настроений.
function seeded() { var s = 42; return function () { s = (s * 1103515245 + 12345) & 0x7fffffff; return s / 0x7fffffff; }; }

// 1. Базовый эффект разворачивается в спан.
var r1 = CFX.parse('[fx:ember]жар[/fx]');
check('эффект → span с data-fx', /data-fx="ember"/.test(r1) && />жар</.test(r1), r1);

// 2. Вложенность эффект+цвет — два спана.
var r2 = CFX.parse('[fx:glow][ice]свет[/ice][/fx]');
check('вложенность fx+color', /fx-glow/.test(r2) && /clr-ice/.test(r2), r2);

// 3. Цветной эффект помечается fx-colored (для обводки).
check('colorBased → fx-colored', /fx-glow[^"]*fx-colored|fx-colored/.test(r2), r2);

// 4. Markdown-ссылка не ломается (неизвестное [..] = текст).
var r4 = CFX.parse('[не метка](url)');
check('markdown не съеден', r4.indexOf('[') !== -1 && r4.indexOf('(url)') !== -1, r4);

// 5. Сырьё явной, но неизвестной метки эффекта не протекает.
var r5 = CFX.parse('до [fx:неведомое]x[/fx] после');
check('неизвестный fx выкушен', r5.indexOf('fx:') === -1 && r5.indexOf('[') === -1, r5);

// 6. Забытое закрытие — авто-закрытие, но спан открыт.
var r6 = CFX.parse('[fx:glow][gold]хвост');
check('авто-закрытие забытых меток', /fx-glow/.test(r6) && /хвост/.test(r6), r6);

// 7. Спан-предохранитель длины для spatial: длинный wave деградирует.
var longText = 'я'.repeat(250);
var r7 = CFX.parse('[fx:wave]' + longText + '[/fx]');
check('spatial maxChars → деградация', r7.indexOf('fx-wave') === -1, r7.slice(0, 60));

// 8. Короткий wave применяется.
var r8 = CFX.parse('[fx:wave]короткая волна[/fx]');
check('spatial в пределах maxChars', /fx-wave/.test(r8), r8);

// 9. reduced-motion: shake (disable) → без класса, ember → статический.
var r9 = CFX.parse('[fx:shake]a[/fx][fx:ember]b[/fx]', { reducedMotion: true });
check('reduced: shake снят', r9.indexOf('fx-shake') === -1, r9);
check('reduced: ember → статика', /fx-ember-static/.test(r9), r9);

// 10. Бюджет: при лимите 4 второй ember (intensity 5) не применится.
var r10 = CFX.parse('[fx:ember]a[/fx][fx:ember]b[/fx]', { budget: 5 });
var emberCount = (r10.match(/data-fx="ember"/g) || []).length;
check('бюджет режет лишние эффекты', emberCount === 1, 'применено ' + emberCount);

// 11. Метка-настроение разворачивается в какой-то эффект из пула.
var r11 = CFX.parse('[ominous]тревога[/ominous]', { rng: seeded() });
check('настроение → эффект из пула', /data-fx=/.test(r11), r11);

// 12. HTML-экранирование текста.
var r12 = CFX.parse('[fx:glow]<b>&</b>[/fx]');
check('экранирование html', /&lt;b&gt;&amp;/.test(r12), r12);

// 13. Регистр и пробелы не важны.
var r13 = CFX.parse('[ FX : Ember ]x[/FX]');
check('регистр/пробелы в метке', /data-fx="ember"/.test(r13), r13);

// 14. Generic-закрытие [/] закрывает ближайшую.
var r14 = CFX.parse('[fx:glow][ice]x[/][/]');
check('generic-закрытие [/]', /fx-glow/.test(r14) && /clr-ice/.test(r14), r14);

// 15. escape:false — готовый HTML сообщения не экранируется, метки разворачиваются.
var r15 = CFX.parse('<em>курсив</em> [fx:glow]свет[/fx]', { escape: false });
check('escape:false сохраняет html', /<em>курсив<\/em>/.test(r15) && /fx-glow/.test(r15), r15);

// 16. strip снимает все метки, оставляя чистый текст.
var r16 = CFX.strip('[fx:ember][blood]жар[/blood][/fx] и [ominous]тень[/ominous]', { escape: false });
check('strip снимает метки', r16 === 'жар и тень', JSON.stringify(r16));

// 17. Форма-фрагмент [form:NAME] → блочный div с ярлыком.
var r17 = CFX.parse('[form:dossier]секретные данные[/form]', { escape: false });
check('форма → блок cfx-form', /<div class="cfx-form" data-form="dossier">/.test(r17) && /секретные данные/.test(r17), r17);
check('форма → ярлык-подпись', /cfx-form-label/.test(r17), r17);

// 18. Неизвестная форма выкусывается без следа.
var r18 = CFX.parse('до [form:неведомое]x[/form] после', { escape: false });
check('неизвестная форма выкушена', r18.indexOf('form:') === -1 && r18.indexOf('[') === -1, r18);

// 19. Эффекты и цвета работают внутри формы.
var r19 = CFX.parse('[form:letters]привет [fx:glow][rose]милый[/rose][/fx][/form]', { escape: false });
check('метки внутри формы', /cfx-form/.test(r19) && /fx-glow/.test(r19) && /clr-rose/.test(r19), r19);

console.log('\n' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
