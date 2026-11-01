const assert = require('node:assert/strict');
const test = require('node:test');

const { extractReadableHtml } = require('../src/article');
const { parseFeed } = require('../src/feed');

test('keeps a nested Habr article body without author metadata and tags', () => {
  const html = `
    <article class="tm-post-presenter__content">
      <div class="tm-post-snippet__meta">Parfois · 1 час назад · 1.6K</div>
      <div class="tm-publication-hubs">Исследования и прогнозы в IT</div>
      <div class="article-formatted-body">
        <p>Первый абзац статьи с достаточным количеством слов для корректного выбора основного содержимого.</p>
        <figure><img src="cover.png" alt="Обложка"><figcaption>Подпись к изображению</figcaption></figure>
        <p>Второй абзац сохраняет форматирование и полезный текст статьи для локального чтения.</p>
      </div>
      <div class="tag-list">Теги: ai технологии токены</div>
    </article>`;

  const result = extractReadableHtml(html);
  assert.match(result, /Первый абзац статьи/);
  assert.match(result, /<img src="cover\.png"/);
  assert.doesNotMatch(result, /Parfois|1\.6K|Исследования и прогнозы|Теги:/);
});

test('parses a public Telegram channel as a feed', () => {
  const html = `
    <div class="tgme_channel_info_header_title"><span>4PDA Community</span></div>
    <div class="tgme_widget_message_wrap js-widget_message_wrap">
      <div class="tgme_widget_message" data-post="pda_4/16322">
        <div class="tgme_widget_message_text js-message_text" dir="auto"><b>WinRAR получил конкурента</b><br/><br/>HatchZip удаляет архив во время распаковки.</div>
        <a class="tgme_widget_message_date" href="https://t.me/pda_4/16322"><time datetime="2026-10-28T11:34:10+00:00">11:34</time></a>
      </div>
    </div>`;

  const feed = parseFeed(html, {
    id: 'telegram-pda',
    title: 'Telegram',
    url: 'https://telegram.me/s/pda_4'
  });

  assert.equal(feed.title, '4PDA Community');
  assert.equal(feed.items.length, 1);
  assert.equal(feed.items[0].title, 'WinRAR получил конкурента');
  assert.equal(feed.items[0].link, 'https://t.me/pda_4/16322');
  assert.equal(feed.items[0].published, '2026-10-28T11:34:10.000Z');
  assert.match(feed.items[0].summary, /HatchZip удаляет архив/);
});
