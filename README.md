# rss-cli

A terminal RSS and Atom reader for Node.js 18+. Manage feeds, browse unread articles with Vim-style keyboard shortcuts, and read extracted article text without leaving the terminal. You can also open the original page in your browser, use command aliases for common actions, and filter unwanted articles by title using words or regular expressions in `entryTitleFilters`.

[Русская версия](README.ru.md)

## Installation

```bash
npm link
cp config.example.json config.json
```

The `rss` command becomes available after installation.

## Sources

```bash
# Add a source; its title will be taken from the feed
rss add https://example.com/feed.xml

# Add a source with a custom title
rss add https://example.com/feed.xml --title "Example"

# List sources
rss sources

# Remove a source by number, ID, or URL
rss remove 1
rss remove source-id
rss remove https://example.com/feed.xml
```

Command aliases: `list` → `sources`, `rm` → `remove`.

## Reading

```bash
# Open interactive mode; this is the default command
rss
rss browse

# Refresh all feeds
rss fetch

# List unread articles from all sources
rss articles

# List articles from a source by number, ID, title, or URL
rss articles 1

# Read an article by number from the combined list
rss read 1

# Read an article from a specific source
rss read 1 2
```

Command aliases: `refresh` → `fetch`, `open` → `read`.

## Interactive mode shortcuts

| Keys | Action |
|---|---|
| `j` / `↓`, `k` / `↑` | Move down or up |
| `Ctrl+d` / `Space` / `Page Down` | Move one page down |
| `Ctrl+u` / `b` / `Page Up` | Move one page up |
| `g` / `Home`, `G` / `End` | Jump to the beginning or end |
| `Enter` / `l` / `→` | Open an article |
| `h` / `←` / `Esc` | Go back; hide the article when in the list |
| `o` | Open in a browser and mark as read |
| `r` | Refresh feeds |
| `n`, `p` | Open the next or previous article |
| `q` / `Ctrl+c` | Go back or quit |

Vim keys also work with the Russian keyboard layout.

## Custom configuration

```bash
rss --config /path/to/config.json browse
RSS_CONFIG=/path/to/config.json rss
rss config
```
