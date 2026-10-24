const assert = require('node:assert/strict');
const test = require('node:test');

const { __test } = require('../src/cli');

test('builds a wrapped preview column from the RSS summary', () => {
  const article = {
    title: 'A concise article title',
    summary: 'A preview is shown beside the list and can be scrolled without loading the full article.'
  };
  const lines = __test.buildPreviewLines(article, 20);

  assert.ok(lines.length > 4);
  assert.ok(lines.every((line) => line.length <= 20));
  assert.doesNotMatch(lines.join('\n'), /A concise article title/);
  assert.match(lines.join('\n'), /can be scrolled\nwithout loading/);
  assert.match(lines.at(-1), /^  \[ Read full/);
  assert.ok(__test.maxPreviewScroll(article, 20, 2) > 0);
});

test('replaces the preview with fetched text without repeating the title', () => {
  const article = {
    title: 'A concise article title',
    summary: 'This summary should be replaced.'
  };
  const lines = __test.buildPreviewLines(article, 30, {
    status: 'ready',
    text: 'The complete article text is now available in the preview.'
  });

  assert.match(lines.join('\n'), /complete article text/);
  assert.doesNotMatch(lines.join('\n'), /concise article title|summary should/);
  assert.doesNotMatch(lines.join('\n'), /Read full article/);
});

test('preserves line breaks and marks the selected full-text action', () => {
  const article = {
    title: 'Article title',
    summary: 'First paragraph.\n\n- first point\n- second point'
  };
  const lines = __test.buildPreviewLines(article, 30, null, { actionSelected: true });

  assert.deepEqual(lines.slice(0, 4), ['First paragraph.', '', '- first point', '- second point']);
  assert.match(lines.at(-1), /^> \[ Read full article \]$/);
});

test('keeps both article panes within the terminal width', () => {
  const layout = __test.articleColumnsLayout(100);
  const line = __test.articleColumnsLine('Articles', 'Preview', layout);

  assert.equal(layout.listWidth + layout.previewWidth + 3, 100);
  assert.equal(line.length, 100);
});

test('highlights the active column without placing a cursor on its header', () => {
  const layout = __test.articleColumnsLayout(100);
  const header = __test.articleColumnsHeader({ pane: 'articles', articleIndex: 2 }, 10, layout);

  assert.match(header, /^\[ Articles 3\/10 \]/);
  assert.doesNotMatch(header, /^> Articles/);
  assert.match(__test.articleColumnsHeader({ pane: 'preview', articleIndex: 2 }, 10, layout), /\[ Preview \]/);
});

test('resets preview scrolling when article selection changes', () => {
  const config = { articles: {} };
  const state = {
    articleIndex: 0,
    previewScroll: 8,
    articles: [
      { link: 'https://example.com/one', published: '2026-10-24T10:00:00Z' },
      { link: 'https://example.com/two', published: '2026-10-24T11:00:00Z' }
    ]
  };

  __test.setArticleSelection(config, state, 1);

  assert.equal(state.articleIndex, 1);
  assert.equal(state.previewScroll, 0);
});

test('recognizes iTerm as the terminal to restore after opening Firefox', () => {
  assert.equal(__test.terminalApplicationId('iTerm.app'), 'com.googlecode.iterm2');
  assert.equal(__test.terminalApplicationId('Apple_Terminal'), 'com.apple.Terminal');
  assert.equal(__test.terminalApplicationId('Alacritty'), '');
});
