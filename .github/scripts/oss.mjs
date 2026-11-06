// Rewrites the block between <!-- oss:start --> and <!-- oss:end --> in both
// READMEs with my pull requests to projects I don't own. Runs daily in CI.
import { readFile, writeFile } from 'node:fs/promises';

const AUTHOR = 'rafactx';
const MINE = ['rafactx', 'usevendee', 'SalesBud'];
const MAX_MERGED = 5;
const MAX_OPEN = 2;
const FILES = {
  'README.md': { locale: 'en-US', open: 'open' },
  'README.pt-BR.md': { locale: 'pt-BR', open: 'aberto' },
};

// Non-breaking spaces keep the last word of the title, the separator and
// the date on one line, so a date never wraps on its own.
const NBSP = '\u00a0';
const glue = (text) => text.replace(/ /g, NBSP);

async function search(state) {
  const q = ['is:pr', `author:${AUTHOR}`, state, ...MINE.map((o) => `-user:${o}`)].join(' ');
  const res = await fetch(`https://api.github.com/search/issues?per_page=100&q=${encodeURIComponent(q)}`, {
    headers: { Accept: 'application/vnd.github+json', Authorization: `Bearer ${process.env.GITHUB_TOKEN}` },
  });
  if (!res.ok) throw new Error(`GitHub search failed: ${res.status}`);
  return (await res.json()).items;
}

// Escape markdown outside code spans, and put @scope/package names in code
// spans so GitHub doesn't turn them into mentions of real accounts.
function title(raw) {
  return raw
    .split(/(`[^`]*`)/)
    .map((part, i) =>
      i % 2
        ? part
        : part
            .replace(/([\\[\]<>*_|])/g, '\\$1')
            .replace(/@[\w.-]+(?:\/[\w.-]+)?/g, (m) => '`' + m.replace(/\\/g, '') + '`'),
    )
    .join('');
}

const repo = (pr) => pr.repository_url.split('/repos/')[1];
const date = (iso, locale) =>
  new Date(iso).toLocaleDateString(locale, { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC' });

function render(merged, open, { locale, open: openLabel }) {
  const item = (pr, when) => {
    const text = title(pr.title).replace(/ (?=\S+$)/, NBSP);
    return `- [${repo(pr)}#${pr.number}](${pr.html_url}) ${text}${NBSP}·${NBSP}${glue(when)}`;
  };
  const items = [
    ...merged.map((pr) => item(pr, date(pr.pull_request.merged_at, locale))),
    ...open.map((pr) => item(pr, openLabel)),
  ];
  if (!items.length) return '';
  return ['#### Upstream', '', ...items, ''].join('\n');
}

const merged = (await search('is:merged'))
  .sort((a, b) => b.pull_request.merged_at.localeCompare(a.pull_request.merged_at))
  .slice(0, MAX_MERGED);
const open = (await search('is:open'))
  .sort((a, b) => b.created_at.localeCompare(a.created_at))
  .slice(0, MAX_OPEN);

for (const [file, copy] of Object.entries(FILES)) {
  const text = await readFile(file, 'utf8');
  const next = text.replace(
    /<!-- oss:start -->[\s\S]*?<!-- oss:end -->/,
    `<!-- oss:start -->\n${render(merged, open, copy)}<!-- oss:end -->`,
  );
  if (next !== text) await writeFile(file, next);
}
