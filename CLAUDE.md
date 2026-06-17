# SillyTavern FX-расширение — полная спецификация (передача в Claude Code)

Самодостаточный документ: цель, архитектура, логика, все решения и данные.
Метки статуса: ✅ решено · 🔜 следующий шаг / ещё проектируем · 💡 на будущее.

---

## 0. Что это и зачем

Расширение для SillyTavern, которое оформляет текст постов богатыми HTML/CSS-
эффектами: слова и предложения окрашиваются, двигаются, искажаются, крутятся;
эффекты смешиваются по контексту. Сверх этого — макро-формы (весь ответ как
рецепт/пьеса/поток сознания и т.д.), текстуры-подложки и картинки-как-пост.
Всем дирижирует «режиссёр» — отдельная модель, оценивающая сцену.

**Цель — добиться всего этого, НЕ засоряя контекст основной модели** тоннами кода.

---

## 1. Корневая проблема и главный принцип ✅

Если заставлять модель генерировать сам HTML/CSS, в контекст улетают простыни
кода. Решение — **развести два слоя**:

- **Слой контекста** — то, что уходит модели. Здесь только крошечные метки.
- **Слой отображения** — то, что видит игрок. Здесь весь тяжёлый CSS, анимации, картинки.

Модель пишет короткие метки → парсер разворачивает их в HTML на экране → тяжесть
никогда не попадает в контекст. CSS описан один раз, не в каждом сообщении.

---

## 2. Архитектура — большие идеи ✅

- **Метки вместо HTML.** Модель пишет `[fx:ember]…[/fx]` и т.п., а не спаны со стилями.
- **CSS живёт один раз** — инжектится расширением при загрузке.
- **Свой парсер, НЕ встроенный Regex Таверны.** Регекс не тянет много эффектов,
  смешивание и вложенность и требует жёсткой структуры. Нужен парсер со стеком.
- **Единая таблица — источник правды.** Из неё кормятся парсер, ротация, пулы
  настроений, режиссёр, система тем. Эффект — это запись данных, а не правило.
- **Ротация палитры.** Каждый ход модели подкидывается случайная горстка эффектов
  (фильтр по потолку интенсивности + активные настроения, взвешенный рандом).
  Это экономит контекст И постоянно удивляет.
- **Режиссёр** — отдельная модель (кастомный API), оценивает сцену, возвращает
  настройки атмосферы. В чате не появляется.
- **Цвет — отдельная ось**, навешивается на любой эффект через вложенность.
- **Три категории картинок:** текстуры-подложки · картинки-как-пост · (💡 персонажи).
- **Темы:** двойная палитра под светлый/тёмный фон + контрастная обводка.

---

## 3. Жизненный путь одного сообщения ✅

0. **Режиссёр** (по счётчику частоты) читает последние сообщения → пакет настроек
   (накал, настроения, форма?, картинка?). В ручном режиме — берётся с ползунков.
1. **Сборка подсказки.** Расширение фильтрует таблицу по текущим настройкам,
   выбирает горстку эффектов/цветов, одним блоком кладёт модели (через
   `setExtensionPrompt`). Если выпала форма — добавляется её инструкция.
2. **Генерация.** Модель пишет текст с короткими метками.
3. **Парсер** разворачивает метки в HTML на экране: настроения → случайный эффект
   из пула; пространственные → проверка длины; предохранители (бюджет, вложенность,
   reduced-motion); авто-закрытие, мягкий провал.
3b. **Картинка** (если просил режиссёр) — асинхронно, всплывает по готовности.
4. **Чистота контекста.** В историю сохраняются только метки; на следующем ходу
   перехватчик решает — оставить их компактными или вырезать. Тяжесть в контекст
   не попадала никогда.

---

## 4. Система меток и парсер 🔜 (СЛЕДУЮЩИЙ ШАГ — синтаксис ещё не финализирован)

Принятые требования к будущему синтаксису и парсеру:

- **Обобщённая грамматика:** имя эффекта — параметр метки, а не часть шаблона
  (`[fx:ИМЯ]…[/fx]`), чтобы парсер не зависел от числа эффектов.
- **Оси меток:** эффект (`[fx:ember]`), настроение (`[ominous]` → случайный эффект
  из пула), цвет (`[void]`), формы и пространственные.
- **Стек для вложенности и смешивания:** `[fx:ember][void]…[/void][/fx]`.
  Вложенные спаны заодно решают конфликты CSS (каждый слой владеет своим transform).
- **Толерантность:** авто-закрытие забытых меток, алиасы/синонимы → канон,
  мягкий провал неизвестных (ближайший/убрать), регистр и пробелы не важны,
  **сырые метки никогда не протекают игроку**.
- **Предохранители:** потолок вложенности, бюджет эффектов на сообщение,
  проверка `maxChars` для пространственных.

> Конкретный вид скобок и разделителей — решение, с которого начинается пункт 3.

---

## 5. Режиссёр ✅ (формат решён; текст промпта 🔜)

- **Отдельный API:** поле эндпойта, поле ключа, кнопка проверки/обновления,
  **выпадашка моделей** (тянется с `/models` провайдера, не ввод вручную).
- **Режимы:** `авто` (оценивает сцену) и `ручной` (ползунки — для тестов и приколов).
- **Частота:** число от юзера (по умолчанию — каждый ход; дешёвая модель).
- **Пакет-ответ (строго JSON, ничего кроме):**

```json
{ "intensity": 7, "moods": ["ominous","dream"], "form": null, "image": null, "note": "напряжение растёт" }
```

- `intensity` 0–10 · `moods` 2–3 максимум · `form`/`image` необязательны (`null`) ·
  `note` — пояснение для отладочной панельки.
- **Разбор всепрощающий:** выколупывать JSON из мусора, подрезать значения
  (47 → 10), выдумки подгонять к словарю, при провале — оставить текущее.
- **Плавность:** накал подводить к цели постепенно + кулдаун (после буйного хода
  пара спокойных), чтобы атмосфера не дёргалась.

---

## 6. Темы (светлый/тёмный фон) ✅

Проблема — цвет может быть не виден на фоне юзера (а фонов в ST много: светлый,
тёмный, серый, картинка).

- **Двойная палитра** через CSS-переменные: у каждого цвета пара `dark`/`light`,
  переключается по теме. Эффект ссылается на «цвет из активной палитры», а не на хекс.
- **Определение темы:** авто (по яркости фона ST) + ручной тумблер Авто/Светлый/Тёмный.
- **Контрастная обводка** на всех цветных — страховка от любого фона (как субтитры).
- **Три корзины:** `colorBased` (8 цветных — палитра+обводка) · `special` (5 хитрых
  — индивидуально) · безразличные к фону (остальные — ничего не нужно).

---

## 7. Интерфейс настроек 🔜 (состав решён, верстка — при сборке)

- Тумблеры слоёв: микро-эффекты · макро-формы · картинки.
- Режим накала (авто/ручной) + ползунки на ручной.
- Поле частоты режиссёра.
- Блок API режиссёра (эндпойт/ключ/проверка/выпадашка моделей).
- Блок API картинок (то же).
- Тумблер темы (Авто/Светлый/Тёмный).
- Уважение к `prefers-reduced-motion` + ручной тумблер.
- Бюджет/лимит эффектов на сообщение.
- Кнопка «успокоить всё» (глобально).
- **Кнопка в строке сообщения** «сделать читаемым» — показывает чистый текст
  (per-message, состояние хранить в данных сообщения).

---

## 8. Производительность и доступность ✅ (принципы)

- Бюджет и потолок одновременных анимаций (особенно на телефоне).
- `prefers-reduced-motion` → применяется поле `reducedMotion` эффекта.
- Эффекты применять после стриминга (без мигания).

---

## 9. ДАННЫЕ — наполнение (пункт 2) ✅

### 9.1 Схема записи эффекта

| Поле | Что | Кто читает |
|---|---|---|
| `id` | каноническое имя | парсер |
| `aliases` | синонимы | парсер |
| `css` | класс | отрисовка |
| `moods` | настроения | пулы, режиссёр |
| `intensity` | 0–10 | потолок, бюджет |
| `scope` | inline/spatial/decorative | отрисовка |
| `weight` | частота в ротации (1.0 / 0.3) | ротация |
| `desc` | подсказка модели (уходит в контекст) | промпт |
| `colorBased` | нужна перекраска+обводка | темы |
| `special` | хитрый контраст, индивидуально | темы |
| `reducedMotion` | замена; `null` безопасен, `"disable"` голым | a11y |
| `maxChars` | только spatial: лимит длины | предохранитель |

### 9.2 Настроения (16)

Словарь для режиссёра — выбирать только отсюда. Смешивание: 2–3 максимум,
объединение пулов с приоритетом эффектов, помеченных несколькими активными.

`calm` спокойствие · `joy` радость/тепло · `tender` нежность/романтика ·
`sorrow` грусть/тоска · `nostalgia` память/прошлое · `ominous` тревога/угроза ·
`fear` страх/паника · `rage` ярость/насилие · `eerie` жуть/потустороннее ·
`dream` сон/бред · `psychedelic` психоделия/трип · `chaos` хаос/мания ·
`sacred` сакральное/божественное · `corrupt` порча/искажение ·
`cold` холод/клиника · `sensual` чувственность/желание

### 9.3 Эффекты (32)

```json
[
  { "id": "rainbow", "aliases": ["радуга","prism","spectrum"], "css": "fx-rainbow", "moods": ["joy","psychedelic"], "intensity": 4, "scope": "inline", "weight": 1.0, "colorBased": true, "special": false, "reducedMotion": "fx-rainbow-static", "desc": "переливается всеми цветами" },
  { "id": "glow", "aliases": ["неон","neon","halo","свечение"], "css": "fx-glow", "moods": ["sacred","dream","psychedelic"], "intensity": 3, "scope": "inline", "weight": 1.0, "colorBased": true, "special": false, "reducedMotion": "fx-glow-static", "desc": "мягкий светящийся ореол" },
  { "id": "ember", "aliases": ["огонь","fire","угли","burning"], "css": "fx-ember", "moods": ["rage","ominous","sensual"], "intensity": 5, "scope": "inline", "weight": 1.0, "colorBased": true, "special": false, "reducedMotion": "fx-ember-static", "desc": "тлеющий оранжево-красный жар" },
  { "id": "frost", "aliases": ["иней","frozen","изморозь"], "css": "fx-frost", "moods": ["cold","eerie"], "intensity": 3, "scope": "inline", "weight": 1.0, "colorBased": true, "special": false, "reducedMotion": "fx-frost-static", "desc": "холодный голубой блеск" },
  { "id": "gold", "aliases": ["золото","golden","gilded"], "css": "fx-gold", "moods": ["sacred","tender"], "intensity": 3, "scope": "inline", "weight": 0.3, "colorBased": true, "special": false, "reducedMotion": "fx-gold-static", "desc": "благородное золотое мерцание" },
  { "id": "sickly", "aliases": ["больной","ill","toxic"], "css": "fx-sickly", "moods": ["corrupt","eerie"], "intensity": 5, "scope": "inline", "weight": 0.3, "colorBased": true, "special": false, "reducedMotion": "fx-sickly-static", "desc": "нездоровое зелёное свечение" },
  { "id": "spark", "aliases": ["искры","sparkle","glitter","блёстки"], "css": "fx-spark", "moods": ["joy","sacred"], "intensity": 4, "scope": "inline", "weight": 1.0, "colorBased": true, "special": false, "reducedMotion": "fx-spark-static", "desc": "искры и блёстки" },
  { "id": "electric", "aliases": ["молния","lightning","crackle","электричество"], "css": "fx-electric", "moods": ["rage","psychedelic"], "intensity": 6, "scope": "inline", "weight": 0.3, "colorBased": true, "special": false, "reducedMotion": "fx-electric-static", "desc": "потрескивающие молнии" },

  { "id": "shake", "aliases": ["дрожь","tremble","shiver","трясёт"], "css": "fx-shake", "moods": ["fear","rage"], "intensity": 4, "scope": "inline", "weight": 1.0, "colorBased": false, "special": false, "reducedMotion": "disable", "desc": "мелкая дрожь" },
  { "id": "sway", "aliases": ["качание","drift","покачивание","floaty"], "css": "fx-sway", "moods": ["calm","dream","sensual"], "intensity": 3, "scope": "inline", "weight": 1.0, "colorBased": false, "special": false, "reducedMotion": "disable", "desc": "плавное покачивание, дрейф" },
  { "id": "heartbeat", "aliases": ["пульс","pulse","throb"], "css": "fx-heartbeat", "moods": ["fear","tender","sensual"], "intensity": 5, "scope": "inline", "weight": 1.0, "colorBased": false, "special": false, "reducedMotion": "disable", "desc": "пульсация как сердце" },
  { "id": "drip", "aliases": ["капель","drip","стекает"], "css": "fx-drip", "moods": ["corrupt","sorrow"], "intensity": 6, "scope": "inline", "weight": 0.3, "colorBased": false, "special": false, "reducedMotion": "disable", "desc": "буквы стекают вниз" },
  { "id": "rise", "aliases": ["всплытие","float-up","ascend","взлёт"], "css": "fx-rise", "moods": ["dream","sacred","calm"], "intensity": 4, "scope": "inline", "weight": 1.0, "colorBased": false, "special": false, "reducedMotion": "disable", "desc": "слова всплывают вверх" },
  { "id": "jitter", "aliases": ["вибрация","jitter","buzz","нервный"], "css": "fx-jitter", "moods": ["fear","chaos"], "intensity": 6, "scope": "inline", "weight": 1.0, "colorBased": false, "special": false, "reducedMotion": "disable", "desc": "нервная частая вибрация" },

  { "id": "glitch", "aliases": ["глитч","glitch","сбой"], "css": "fx-glitch", "moods": ["corrupt","chaos","psychedelic"], "intensity": 7, "scope": "inline", "weight": 1.0, "colorBased": false, "special": false, "reducedMotion": "disable", "desc": "RGB-разрыв и нарезка" },
  { "id": "blur", "aliases": ["размытие","blur","smear","смаз"], "css": "fx-blur", "moods": ["dream","calm"], "intensity": 4, "scope": "inline", "weight": 1.0, "colorBased": false, "special": false, "reducedMotion": "fx-blur-static", "desc": "размытие, смаз" },
  { "id": "melt", "aliases": ["плавление","melt","тает"], "css": "fx-melt", "moods": ["psychedelic","eerie","corrupt"], "intensity": 7, "scope": "inline", "weight": 0.3, "colorBased": false, "special": false, "reducedMotion": "disable", "desc": "текст тает и растекается" },
  { "id": "scramble", "aliases": ["перемешивание","scramble","shuffle","мешанина"], "css": "fx-scramble", "moods": ["chaos","fear"], "intensity": 6, "scope": "inline", "weight": 1.0, "colorBased": false, "special": false, "reducedMotion": "disable", "desc": "буквы мешаются и встают на место" },

  { "id": "handwritten", "aliases": ["рукопись","handwritten","scrawl","от руки"], "css": "fx-handwritten", "moods": ["nostalgia","tender"], "intensity": 2, "scope": "inline", "weight": 1.0, "colorBased": false, "special": false, "reducedMotion": null, "desc": "будто написано от руки" },
  { "id": "typewriter", "aliases": ["машинка","typewriter","typing","печать"], "css": "fx-typewriter", "moods": ["ominous","cold"], "intensity": 3, "scope": "inline", "weight": 1.0, "colorBased": false, "special": false, "reducedMotion": "disable", "desc": "набирается по буквам" },
  { "id": "flicker-in", "aliases": ["мерцание","flicker","signal"], "css": "fx-flicker-in", "moods": ["eerie","corrupt"], "intensity": 5, "scope": "inline", "weight": 1.0, "colorBased": false, "special": false, "reducedMotion": "disable", "desc": "мерцающее проявление, как плохой сигнал" },

  { "id": "ghost", "aliases": ["призрак","ghost","faint","полупрозрачный"], "css": "fx-ghost", "moods": ["sorrow","eerie","dream"], "intensity": 4, "scope": "inline", "weight": 1.0, "colorBased": false, "special": true, "reducedMotion": "fx-ghost-static", "desc": "призрачная полупрозрачность" },
  { "id": "whisper", "aliases": ["шёпот","whisper","tiny","бледный"], "css": "fx-whisper", "moods": ["ominous","tender","eerie"], "intensity": 1, "scope": "inline", "weight": 1.0, "colorBased": false, "special": true, "reducedMotion": null, "desc": "мелкий, бледный, едва видный" },
  { "id": "smoke", "aliases": ["дым","smoke","fume","курится"], "css": "fx-smoke", "moods": ["eerie","dream"], "intensity": 5, "scope": "inline", "weight": 0.3, "colorBased": false, "special": true, "reducedMotion": "disable", "desc": "буквы курятся дымкой" },
  { "id": "negative", "aliases": ["негатив","invert","inverse","инверсия"], "css": "fx-negative", "moods": ["corrupt","psychedelic"], "intensity": 6, "scope": "inline", "weight": 0.3, "colorBased": false, "special": true, "reducedMotion": null, "desc": "инверсия цветов" },
  { "id": "redacted", "aliases": ["цензура","redacted","censored","зачёркнуто"], "css": "fx-redacted", "moods": ["ominous","cold"], "intensity": 4, "scope": "inline", "weight": 0.3, "colorBased": false, "special": true, "reducedMotion": null, "desc": "чёрная плашка, спадает по наведению" },

  { "id": "shout", "aliases": ["крик","shout","scream","орёт"], "css": "fx-shout", "moods": ["rage","fear","chaos"], "intensity": 8, "scope": "inline", "weight": 0.3, "colorBased": false, "special": false, "reducedMotion": "fx-shout-static", "desc": "огромный, жирный, дёрганый" },

  { "id": "spiral", "aliases": ["спираль","spiral","whirl","вихрь"], "css": "fx-spiral", "moods": ["dream","psychedelic"], "intensity": 8, "scope": "spatial", "weight": 0.3, "colorBased": false, "special": false, "reducedMotion": "disable", "maxChars": 80, "desc": "закручивается спиралью" },
  { "id": "upsidedown", "aliases": ["вверхногами","upsidedown","flipped","перевёрнутый"], "css": "fx-upsidedown", "moods": ["chaos","psychedelic"], "intensity": 8, "scope": "spatial", "weight": 0.3, "colorBased": false, "special": false, "reducedMotion": "disable", "maxChars": 80, "desc": "текст вверх ногами" },
  { "id": "mirror", "aliases": ["зеркало","mirror","reversed","отражение"], "css": "fx-mirror", "moods": ["eerie","dream"], "intensity": 7, "scope": "spatial", "weight": 0.3, "colorBased": false, "special": false, "reducedMotion": "disable", "maxChars": 120, "desc": "зеркальное отражение" },
  { "id": "scatter", "aliases": ["разлёт","scatter","explode","разброс"], "css": "fx-scatter", "moods": ["chaos","fear"], "intensity": 8, "scope": "spatial", "weight": 0.3, "colorBased": false, "special": false, "reducedMotion": "disable", "maxChars": 100, "desc": "слова разбросаны по странице" },
  { "id": "wave", "aliases": ["волна","wave","undulate","колышется"], "css": "fx-wave", "moods": ["dream","sensual","calm"], "intensity": 6, "scope": "spatial", "weight": 1.0, "colorBased": false, "special": false, "reducedMotion": "disable", "maxChars": 200, "desc": "строка колышется целиком" }
]
```

### 9.4 Реестр цветов (24)

Пара `dark`/`light` под фон; реализация — CSS-переменные, переключаемые по теме;
поверх всех цветных — контрастная обводка. Hex'ы стартовые. `void`/`ink` на тёмном
фоне осветляются. `oil` — перелив, делается градиентом.

```json
[
  { "id": "blood", "aliases": ["кровь","crimson"], "dark": "#e03b3b", "light": "#8b0000", "moods": ["rage","fear","sensual"] },
  { "id": "flame", "aliases": ["пламя","fire-color"], "dark": "#ff8c2b", "light": "#c2410c", "moods": ["rage","psychedelic","joy"] },
  { "id": "rust", "aliases": ["ржавчина","oxide"], "dark": "#c46a3a", "light": "#8a4421", "moods": ["corrupt","nostalgia"] },
  { "id": "amber", "aliases": ["янтарь"], "dark": "#ffc24d", "light": "#b8860b", "moods": ["joy","nostalgia","sacred"] },
  { "id": "honey", "aliases": ["мёд"], "dark": "#ffd97a", "light": "#c79a32", "moods": ["tender","joy","nostalgia"] },
  { "id": "sulfur", "aliases": ["сера","brimstone"], "dark": "#e6e23a", "light": "#9a9810", "moods": ["corrupt","chaos","fear"] },
  { "id": "acid", "aliases": ["кислота","toxic-green"], "dark": "#9dff3c", "light": "#4d8a00", "moods": ["corrupt","psychedelic","chaos"] },
  { "id": "ichor", "aliases": ["ихор","bile"], "dark": "#b9d44a", "light": "#6b7a1f", "moods": ["corrupt","eerie","sacred"] },
  { "id": "moss", "aliases": ["мох","verdant"], "dark": "#7bbf6a", "light": "#3f6f33", "moods": ["calm","nostalgia"] },
  { "id": "ice", "aliases": ["лёд","cyan"], "dark": "#9fe3ff", "light": "#2b7a9e", "moods": ["cold","calm","eerie"] },
  { "id": "azure", "aliases": ["лазурь","sky"], "dark": "#5bb8ff", "light": "#1565c0", "moods": ["calm","sacred"] },
  { "id": "abyss", "aliases": ["бездна","deep-blue"], "dark": "#5a7fd0", "light": "#283d6b", "moods": ["sorrow","cold","dream"] },
  { "id": "void", "aliases": ["пустота","null"], "dark": "#6b7299", "light": "#1a1d33", "moods": ["ominous","eerie","cold","dream"] },
  { "id": "mist", "aliases": ["туман","haze"], "dark": "#c4d2e0", "light": "#6b7d8f", "moods": ["dream","calm","eerie"] },
  { "id": "violet", "aliases": ["фиолет","purple"], "dark": "#b98cff", "light": "#6a3dbf", "moods": ["sacred","dream","sensual"] },
  { "id": "ultraviolet", "aliases": ["ультрафиолет","uv"], "dark": "#d28bff", "light": "#8a2be2", "moods": ["psychedelic","eerie"] },
  { "id": "bruise", "aliases": ["синяк","contusion"], "dark": "#bf6fa3", "light": "#5e2750", "moods": ["corrupt","sorrow","fear"] },
  { "id": "neon", "aliases": ["неон-розовый","magenta"], "dark": "#ff5cc8", "light": "#d6178f", "moods": ["psychedelic","sensual","chaos"] },
  { "id": "rose", "aliases": ["роза","pink"], "dark": "#ff9bb5", "light": "#c44569", "moods": ["tender","joy"] },
  { "id": "silver", "aliases": ["серебро","chrome"], "dark": "#d8dee6", "light": "#7a828c", "moods": ["cold","sacred","sensual"] },
  { "id": "bone", "aliases": ["кость","ivory"], "dark": "#ede4d3", "light": "#8a7f68", "moods": ["eerie","sacred","cold"] },
  { "id": "ash", "aliases": ["пепел","grey"], "dark": "#b0b4ba", "light": "#6b6f76", "moods": ["sorrow","cold","calm"] },
  { "id": "ink", "aliases": ["чернила","black"], "dark": "#c0c4cc", "light": "#1a1a22", "moods": ["ominous","sorrow","cold"] },
  { "id": "oil", "aliases": ["нефть","iridescent"], "dark": "#7af0c0", "light": "#2a9d8f", "moods": ["psychedelic","dream","corrupt"], "note": "переливчатый — анимированный градиент" }
]
```

### 9.5 Макро-формы (14)

Слой генерации: главное поле — `instruction`. Часть несёт CSS-вёрстку. Включаются
редко, по решению режиссёра, могут смешиваться (основная + второстепенная).

```json
[
  { "id": "stream", "moods": ["dream","fear","psychedelic","chaos"], "intensity": 7, "weight": 0.4, "desc": "поток сознания", "instruction": "Пиши потоком сознания: размывай границы предложений, перескакивай между мыслями, образами и воспоминаниями, обрывай фразы на полуслове." },
  { "id": "recipe", "moods": ["calm","nostalgia","sacred"], "intensity": 6, "weight": 0.3, "desc": "рецепт", "instruction": "Оформи как кулинарный рецепт — раздел «ингредиенты» и пронумерованные шаги, но описывай ими то, что происходит в сцене." },
  { "id": "play", "moods": ["rage","tender","ominous"], "intensity": 6, "weight": 0.4, "desc": "пьеса", "instruction": "Оформи как пьесу: имя персонажа перед каждой репликой, действия и обстановка — курсивом в скобках, как сценические ремарки." },
  { "id": "documentary", "moods": ["cold","sacred","nostalgia"], "intensity": 5, "weight": 0.3, "desc": "документалка", "instruction": "Веди отстранённым тоном документального наблюдателя, добавляй сноски-пояснения к происходящему." },
  { "id": "code", "moods": ["cold","corrupt","chaos"], "intensity": 7, "weight": 0.3, "desc": "код/алгоритм", "instruction": "Опиши сцену как псевдокод или алгоритм: условия, циклы, функции и логика — но смыслом остаётся происходящее." },
  { "id": "math", "moods": ["cold","psychedelic","dream"], "intensity": 7, "weight": 0.2, "desc": "последовательность/фрактал", "instruction": "Структурируй текст как формулу, последовательность или фрактал: повторы с вариацией, вложенность, числовая логика." },
  { "id": "palindrome", "moods": ["eerie","dream","corrupt"], "intensity": 8, "weight": 0.2, "desc": "зеркальный текст", "instruction": "Построй фрагмент зеркально — вторая половина отражает первую по структуре или смыслу." },
  { "id": "scrapbook", "moods": ["nostalgia","sorrow","dream"], "intensity": 7, "weight": 0.3, "css": "fx-scrapbook", "desc": "скрэпбук", "instruction": "Собери ответ как страницу скрэпбука: обрывки фраз, подписи, разрозненные вклейки воспоминаний." },
  { "id": "letters", "moods": ["tender","sorrow","nostalgia"], "intensity": 5, "weight": 0.3, "desc": "письма", "instruction": "Оформи как письмо или переписку: обращение, тело, подпись." },
  { "id": "dictionary", "moods": ["cold","eerie"], "intensity": 6, "weight": 0.2, "desc": "словарная статья", "instruction": "Оформи как словарную или энциклопедическую статью: термин, определения по пунктам, примеры употребления." },
  { "id": "dossier", "moods": ["ominous","cold","fear"], "intensity": 6, "weight": 0.3, "css": "fx-dossier", "desc": "досье с цензурой", "instruction": "Оформи как засекреченный документ: грифы и заголовки, пункты, часть текста скрой как [ЗАЦЕНЗУРЕНО]." },
  { "id": "interview", "moods": ["cold","ominous"], "intensity": 5, "weight": 0.2, "desc": "расшифровка", "instruction": "Оформи как расшифровку интервью или допроса: реплики с метками [В:] и [О:] или тайм-кодами." },
  { "id": "dialogue", "moods": ["tender","ominous","rage"], "intensity": 4, "weight": 0.3, "desc": "чистый диалог", "instruction": "Используй только прямую речь — без описаний действий; что персонажи делают, должно угадываться из одних реплик." },
  { "id": "ransom", "moods": ["chaos","ominous","fear"], "intensity": 7, "weight": 0.2, "css": "fx-ransom", "desc": "записка из вырезок", "instruction": "Оформи как записку из вырезанных букв: рваный, скачущий, угрожающий тон." }
]
```

### 9.6 Текстуры-подложки (10)

Безликий фон ПОД CSS-текстом. **Глобально к промпту всегда добавляется:**
`abstract texture, seamless background, no people, no characters, full-bleed`.
Накладывается приглушённо, текст поверх читается.

```json
[
  { "id": "paper", "fits": ["letters","documentary","nostalgia"], "prompt": "aged paper, fibrous grain, subtle stains" },
  { "id": "torn", "fits": ["ransom","dossier","scrapbook"], "prompt": "torn paper scraps, rough ripped edges, layered" },
  { "id": "ink", "fits": ["dream","dialogue","sorrow"], "prompt": "ink stains and blots, bleeding black ink" },
  { "id": "glitch", "fits": ["psychedelic","corrupt","chaos"], "prompt": "glitch art, datamosh, chromatic aberration, VHS noise" },
  { "id": "blueprint", "fits": ["code","documentary","cold"], "prompt": "blueprint grid, schematic lines, technical drafting" },
  { "id": "vintage", "fits": ["nostalgia","sorrow"], "prompt": "faded sepia film grain, scratches, light leaks" },
  { "id": "watercolor", "fits": ["dream","tender","calm"], "prompt": "watercolor wash, soft bleeding pigment on paper" },
  { "id": "oilslick", "fits": ["psychedelic","dream"], "prompt": "iridescent oil slick, fluid rainbow sheen" },
  { "id": "static", "fits": ["fear","corrupt","eerie"], "prompt": "tv static, analog noise, heavy grain" },
  { "id": "rust", "fits": ["corrupt","rage","eerie"], "prompt": "rusted corroded metal, decay, patina" }
]
```

### 9.7 Картинки-как-пост

Весь пост рисуется как ОДНО изображение, текст уходит в `{TEXT}` промпта. Режим
отрисовки `renderMode: "image"` у форм `ransom`/`scrapbook` (вместо CSS). Настоящий
короткий текст хранится в сообщении и достаётся кнопкой «сделать читаемым».
**Оговорка:** image-модели плохо рисуют точный текст → держим текст коротким,
советуем текст-умеющий бэкенд (Flux/Ideogram); кривые вырезки = жутковатый вайб (ок).

```json
[
  { "id": "ransom-img", "form": "ransom", "textLimit": "одна короткая строка", "prompt": "ransom note, message «{TEXT}» spelled in cut-out magazine and newspaper letters, mismatched fonts and colors, glued on paper, grungy, photographed" },
  { "id": "scrapbook-img", "form": "scrapbook", "textLimit": "обрывки, подписи в пару слов", "prompt": "scrapbook collage page, torn photos, tape, handwritten notes «{TEXT}», layered clippings, pressed flowers, photographed" }
]
```

### 9.8 Конвенции данных

- Классы: эффекты `fx-{id}`, цвета — переменная `--clr-{id}` через класс `clr-{id}`.
- **Единый источник цвета:** цветные эффекты ссылаются на записи реестра, а не задают hex.
- Обводка — всем цветным. Ротация — фильтр по потолку+настроениям, рандом по `weight`.
- Бюджет — сумма `intensity` применённых ≤ лимит. Вложенность — стек, цвет+эффект свободно.

---

## 10. Порядок сборки / статус роадмапа

- ✅ **Пункт 2 (наполнение)** — настроения, эффекты, цвета, формы, текстуры, картинки-как-пост.
- 🔜 **Пункт 3 (синтаксис меток + парсер)** — следующий шаг, начать с вида меток.
- ⬜ Далее: CSS-стили эффектов и тем · режиссёр (промпт + разбор) · картинки ·
  интерфейс настроек · кнопка читаемости · производительность/доступность · отладочная панель.

Рекомендованный старт в коде: парсер + базовый набор CSS на 5–6 эффектов →
проверить путь «метка → экран» → потом ротация, режиссёр, формы, картинки.

---

## 11. Заметки по интеграции в SillyTavern (проверить актуальные сигнатуры в доках ST)

- Расширение: папка в `extensions/third-party/<name>/` с `manifest.json` + JS.
- **Отрисовка:** событие рендера сообщения (`CHARACTER_MESSAGE_RENDERED`) — разворачивать метки в DOM.
- **Чистота контекста:** перехватчик промпта перед отправкой — вырезать/сжать метки.
- **Инъекция подсказки:** `setExtensionPrompt` — палитра+накал одним блоком на заданной глубине.
- **Кнопка в сообщении:** добавить иконку в ряд кнопок сообщения при рендере.
- **Настройки:** `extension_settings` + сохранение; выпадашки моделей — запрос к `/models` провайдера.
- **Режиссёр/картинки:** свой `fetch` к OpenAI-совместимому эндпойту (или профили
  подключения ST); для тихих фоновых генераций на основном API есть `generateQuietPrompt`.
- **Тема:** читать CSS-переменные темы ST (цвет фона/текста) для авто-определения светлый/тёмный.

> ST часто обновляется — точные имена событий/функций уточнить по текущей документации
> при сборке (Claude Code это умеет проверить в процессе).

---

## 12. Идеи на будущее 💡

- **Принудительные формы на каждый пост** — тестовый тумблер, как у эффектов.
- **Режим «БЕЗУМИЕ»** — всё выкручено на максимум, чистый психодел.
- **Внешность персонажа/персоны в картинках** — из аватаров (как популярные image-gen
  расширения). Отложено, чтобы не конфликтовать с основной генерацией.
- Паки-настроения · эффекты по ключевым словам · фирменные эффекты у персонажа ·
  шкала порчи/безумия · эскалация-затухание · «рулетка жанров» · звук ·
  именованные смеси настроений (`sacred+corrupt`=кощунственное) · веса настроений ·
  смесь настроений прямо в метке · свободный RGB с авто-контрастом.
