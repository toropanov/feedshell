# FeedShell

[![CI](https://github.com/toropanov/feedshell/actions/workflows/ci.yml/badge.svg)](https://github.com/toropanov/feedshell/actions/workflows/ci.yml)
[![Homebrew Formula CI](https://github.com/toropanov/homebrew-tap/actions/workflows/ci.yml/badge.svg)](https://github.com/toropanov/homebrew-tap/actions/workflows/ci.yml)
[![Latest release](https://img.shields.io/github/v/release/toropanov/feedshell?display_name=tag&sort=semver)](https://github.com/toropanov/feedshell/releases)
[![License](https://img.shields.io/github/license/toropanov/feedshell)](https://github.com/toropanov/feedshell/blob/master/LICENSE)
[![Homebrew](https://img.shields.io/badge/Homebrew-toropanov%2Ftap-FBB040?logo=homebrew&logoColor=white)](https://github.com/toropanov/homebrew-tap)

**FeedShell** is a terminal RSS and Atom reader. Manage feeds, browse unread articles with Vim-style navigation, read extracted article text without leaving the terminal, and open the original page when needed.

## Install

```sh
brew install toropanov/tap/feedshell
```

Homebrew 6 may ask you to trust the third-party formula explicitly:

```sh
brew trust --formula toropanov/tap/feedshell
```

To run the project from a checkout instead:

```sh
npm link
```

## Quick start

```sh
# Add a feed; its title is detected automatically.
feedshell add https://example.com/feed.xml

# Open the interactive reader.
feedshell

# Refresh feeds and list unread articles.
feedshell fetch
feedshell articles
```

## Commands

| Command | Description |
| --- | --- |
| `feedshell add <url> [--title <name>]` | Add a feed. |
| `feedshell sources` | List feeds. Alias: `list`. |
| `feedshell remove <num\|id\|url>` | Remove a feed. Alias: `rm`. |
| `feedshell fetch` | Refresh RSS and Atom feeds. Alias: `refresh`. |
| `feedshell articles [source]` | List unread articles. |
| `feedshell read [source] <num>` | Read an article's extracted text. Alias: `open`. |
| `feedshell browse` | Open the interactive reader. This is the default command. |
| `feedshell config` | Print the active config path. |

## Keyboard shortcuts

| Keys | Action |
| --- | --- |
| `j` / `↓`, `k` / `↑` | Move down or up. |
| `Ctrl+d` / `Space`, `Ctrl+u` / `b` | Move one page down or up. |
| `g` / `Home`, `G` / `End` | Jump to the beginning or end. |
| `Enter` / `l` / `→` | Open an article. |
| `h` / `←` / `Esc` | Go back. |
| `o` | Open the original page in a browser and mark it read. |
| `r` | Refresh feeds. |
| `n`, `p` | Open the next or previous article. |
| `q` / `Ctrl+c` | Go back or quit. |

Vim-style keys work with a Russian keyboard layout too.

## Configuration and data

Feedshell keeps user data outside the application directory:

- `$XDG_CONFIG_HOME/feedshell/config.json`, when `XDG_CONFIG_HOME` is set;
- `~/.config/feedshell/config.json` otherwise.

Use a separate config file when needed:

```sh
feedshell --config /path/to/config.json browse
FEEDSHELL_CONFIG=/path/to/config.json feedshell
```

Use `entryTitleFilters` in the config to exclude unwanted articles by a word or regular expression.

## Development

Requires Node.js 18 or later.

```sh
npm run check
npm test
```

## License

[MIT](LICENSE)
