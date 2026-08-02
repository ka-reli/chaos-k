# Шрифты

## Caveat

Рукописный шрифт с **поддержкой кириллицы** — используется эффектом `handwritten`.
Системные рукописные шрифты (Segoe Script, Bradley Hand и т.п.) кириллицу либо
не покрывают, либо отсутствуют на Linux/Android, поэтому шрифт вшит в расширение.

- Файлы: `caveat-cyrillic.woff2` (кириллица), `caveat-latin.woff2` (латиница).
  Подключаются через `@font-face` с `unicode-range` — браузер качает только нужный.
- Источник: https://fonts.google.com/specimen/Caveat
- Лицензия: SIL Open Font License 1.1 — полный текст в `OFL.txt`.

Остальные шрифтовые эффекты (`typewriter`, `blackletter`) кириллицу получают
средствами CSS, без экзотических шрифтов — см. комментарии в `css/chaos-fx.css`.
