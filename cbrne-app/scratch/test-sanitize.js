// Quick test for the enhanced sanitizeTgHtml

// Inline the function for testing (avoids TypeScript compilation)
function sanitizeTgHtml(str) {
  if (!str) return '';
  let result = String(str);

  result = result.replace(/<br\s*\/?>/gi, '\n');
  result = result.replace(/<\/p>/gi, '\n');
  result = result.replace(/<p\b[^>]*>/gi, '');

  const ALLOWED_TAGS = new Set([
    'b', '/b', 'strong', '/strong', 'i', '/i', 'em', '/em',
    'u', '/u', 'ins', '/ins', 's', '/s', 'strike', '/strike',
    'del', '/del', 'a', '/a', 'code', '/code', 'pre', '/pre',
    'tg-spoiler', '/tg-spoiler'
  ]);

  const placeholders = [];
  result = result.replace(/<(\/?[a-zA-Z][^>]*)>/g, (match, inner) => {
    const tagName = inner.toLowerCase().split(/\s/)[0];
    if (ALLOWED_TAGS.has(tagName)) {
      const idx = placeholders.length;
      placeholders.push(match);
      return `\x00TG${idx}\x00`;
    }
    return '';
  });

  result = result.replace(/&(?!amp;|lt;|gt;|quot;|#\d+;|#x[0-9a-fA-F]+;)/g, '&amp;');
  result = result.replace(/</g, '&lt;');
  result = result.replace(/>/g, '&gt;');

  result = result.replace(/\x00TG(\d+)\x00/g, (_, idx) => placeholders[parseInt(idx)]);

  const TAG_RE = /<(\/?)(b|strong|i|em|u|ins|s|strike|del|a|code|pre|tg-spoiler)(\s[^>]*)?>/gi;
  const openStack = [];
  const orphanRanges = [];
  let m;

  while ((m = TAG_RE.exec(result)) !== null) {
    const isClose = m[1] === '/';
    const tag = m[2].toLowerCase();

    if (!isClose) {
      openStack.push(tag);
    } else {
      const idx = openStack.lastIndexOf(tag);
      if (idx !== -1) {
        openStack.splice(idx, 1);
      } else {
        orphanRanges.push({ start: m.index, end: m.index + m[0].length });
      }
    }
  }

  for (let i = orphanRanges.length - 1; i >= 0; i--) {
    const { start, end } = orphanRanges[i];
    result = result.substring(0, start) + result.substring(end);
  }

  while (openStack.length > 0) {
    result += `</${openStack.pop()}>`;
  }

  return result;
}

// Test cases
const tests = [
  {
    name: 'Normal balanced tags',
    input: '<b>bold</b> and <i>italic</i>',
    expect: '<b>bold</b> and <i>italic</i>',
  },
  {
    name: 'REPRO: Unclosed <i> tag (the 11:05 PM failure)',
    input: '🤖 <b>Gemini Assessment:</b>\n<i>1. <b>Assessment:</b>\nSome text with <i>nested italic',
    expectContains: '</i>',  // must auto-close
    expectNotContains: undefined,
  },
  {
    name: 'Orphaned closing tag',
    input: 'Hello </b> world',
    expect: 'Hello  world',
  },
  {
    name: 'Stray angle brackets in AI output',
    input: '<b>Title:</b> Value must be < 100 and > 50',
    expect: '<b>Title:</b> Value must be &lt; 100 and &gt; 50',
  },
  {
    name: 'Stray & in text',
    input: '<b>AT&T</b> news &amp; more',
    expect: '<b>AT&amp;T</b> news &amp; more',
  },
  {
    name: 'Unsupported HTML tags stripped',
    input: '<div>Hello <b>world</b></div>',
    expect: 'Hello <b>world</b>',
  },
  {
    name: '<a> tag with href preserved',
    input: '<a href="https://example.com">Link</a>',
    expect: '<a href="https://example.com">Link</a>',
  },
  {
    name: '<br> converted to newline',
    input: 'Line 1<br>Line 2<br/>Line 3',
    expect: 'Line 1\nLine 2\nLine 3',
  },
  {
    name: 'Multiple unclosed tags',
    input: '<b>bold <i>italic <u>underline',
    expectContains: '</u></i></b>',
  },
];

let passed = 0;
let failed = 0;

for (const t of tests) {
  const result = sanitizeTgHtml(t.input);
  let ok = true;

  if (t.expect !== undefined && result !== t.expect) {
    ok = false;
    console.log(`❌ FAIL: ${t.name}`);
    console.log(`   Input:    ${JSON.stringify(t.input)}`);
    console.log(`   Expected: ${JSON.stringify(t.expect)}`);
    console.log(`   Got:      ${JSON.stringify(result)}`);
  }
  if (t.expectContains && !result.includes(t.expectContains)) {
    ok = false;
    console.log(`❌ FAIL: ${t.name} — missing "${t.expectContains}"`);
    console.log(`   Got: ${JSON.stringify(result)}`);
  }
  if (ok) {
    console.log(`✅ PASS: ${t.name}`);
    passed++;
  } else {
    failed++;
  }
}

console.log(`\n${passed} passed, ${failed} failed out of ${tests.length} tests`);
process.exit(failed > 0 ? 1 : 0);
