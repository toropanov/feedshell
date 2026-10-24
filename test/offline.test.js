const assert = require('node:assert/strict');
const fs = require('node:fs');
const http = require('node:http');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

const { archiveArticle } = require('../src/offline');

test('archives formatted article with absolute media URLs, replacing the previous archive', async () => {
  const server = http.createServer((request, response) => {
    if (request.url === '/cover.png') {
      response.writeHead(200, { 'content-type': 'image/png' });
      response.end(Buffer.from('image-data'));
      return;
    }

    const heading = request.url === '/second' ? 'Second article' : 'First article';
    response.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
    response.end(`<!doctype html><html><head><title>${heading}</title></head><body><article><h1>${heading}</h1><p>One readable paragraph with enough words to select this article content.</p><p>A second paragraph keeps the formatted content together.</p><p><strong>Important text</strong></p><img src="/cover.png" srcset="/cover.png 780w, &#10; /cover-large.png 1560w" alt="Cover" style="background-image: url('/cover.png')"></article></body></html>`);
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));

  const port = server.address().port;
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'feedshell-offline-'));
  const configPath = path.join(root, 'config.json');

  try {
    const first = await archiveArticle({ link: `http://127.0.0.1:${port}/first` }, configPath);
    const firstHtml = fs.readFileSync(first.filePath, 'utf8');
    assert.match(firstHtml, /<strong>Important text<\/strong>/);
    assert.match(firstHtml, new RegExp(`src="http://127\\.0\\.0\\.1:${port}/cover\\.png"`));
    assert.match(firstHtml, new RegExp(`srcset="http://127\\.0\\.0\\.1:${port}/cover\\.png 780w, http://127\\.0\\.0\\.1:${port}/cover-large\\.png 1560w"`));
    assert.ok(firstHtml.includes(`background-image: url('http://127.0.0.1:${port}/cover.png')`));
    assert.equal(fs.existsSync(path.join(path.dirname(first.filePath), 'assets')), false);

    const second = await archiveArticle({ link: `http://127.0.0.1:${port}/second` }, configPath);
    assert.equal(fs.existsSync(first.filePath), false);
    assert.equal(fs.existsSync(second.filePath), true);
  } finally {
    await new Promise((resolve) => server.close(resolve));
    fs.rmSync(root, { recursive: true, force: true });
  }
});
