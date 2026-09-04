# feedshell

Терминальная читалка RSS и Atom для Node.js 18+. Позволяет управлять лентами, просматривать непрочитанные статьи с помощью Vim-шорткатов и читать извлечённый текст, не выходя из терминала. Оригинальные страницы можно открывать в браузере, для основных команд доступны алиасы, а ненужные статьи можно исключать по словам или регулярным выражениям в `entryTitleFilters`.

## Установка

```bash
npm link
cp config.sample.json config.json
```

После установки доступна команда `feedshell`.

## Источники

```bash
# Добавить источник; название будет взято из ленты
feedshell add https://example.com/feed.xml

# Добавить источник со своим названием
feedshell add https://example.com/feed.xml --title "Example"

# Показать источники
feedshell sources

# Удалить источник по номеру, id или URL
feedshell remove 1
feedshell remove source-id
feedshell remove https://example.com/feed.xml
```

Шорткаты команд: `list` — `sources`, `rm` — `remove`.

## Чтение

```bash
# Открыть интерактивный режим; это команда по умолчанию
feedshell
feedshell browse

# Обновить все ленты
feedshell fetch

# Показать непрочитанные статьи из всех источников
feedshell articles

# Показать статьи конкретного источника по номеру, id, title или URL
feedshell articles 1

# Прочитать статью по номеру в общем списке
feedshell read 1

# Прочитать статью конкретного источника
feedshell read 1 2
```

Шорткаты команд: `refresh` — `fetch`, `open` — `read`.

## Клавиши интерактивного режима

| Клавиши | Действие |
|---|---|
| `j` / `↓`, `k` / `↑` | Вниз, вверх |
| `Ctrl+d` / `Space` / `Page Down` | На страницу вниз |
| `Ctrl+u` / `b` / `Page Up` | На страницу вверх |
| `g` / `Home`, `G` / `End` | В начало, в конец |
| `Enter` / `l` / `→` | Открыть статью |
| `h` / `←` / `Esc` | Назад; в списке — скрыть статью |
| `o` | Открыть статью в браузере и отметить прочитанной |
| `r` | Обновить ленты |
| `n`, `p` | Следующая, предыдущая статья |
| `q` / `Ctrl+c` | Назад или выход |

Vim-клавиши работают и в русской раскладке.

## Другой конфиг

```bash
feedshell --config /path/to/config.json browse
FEEDSHELL_CONFIG=/path/to/config.json feedshell
feedshell config
```
