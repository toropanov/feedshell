const assert = require('node:assert/strict');
const test = require('node:test');

const { extractReadableHtml } = require('../src/article');

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
