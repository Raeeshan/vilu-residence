// Regression test for the Phase 27 mainland-China conversion-path fix.
//
// Run: node test/china-cta-priority.test.js
//
// Context: WhatsApp is blocked in mainland China without a VPN, but the
// shared English markup styles the WhatsApp CTA as .btn-primary (visually
// dominant) and the Email CTA as .btn-outline (secondary) in every package
// card and the closing CTA band. Rather than forking markup per locale,
// shared-page.css carries a small html[lang="zh"]-scoped override that
// swaps the two CTAs' visual roles (and reading order) for zh only. This
// test guards that the override exists, is correctly scoped, and that no
// equivalent unscoped rule ever leaks the swap to other locales.

const assert = require('node:assert/strict');
const fs = require('node:fs');

let passed = 0;
function test(name, fn) {
  try {
    fn();
    passed++;
    console.log(`  ok  - ${name}`);
  } catch (e) {
    console.log(`  FAIL - ${name}`);
    console.log(e.message);
    process.exitCode = 1;
  }
}

const css = fs.readFileSync('shared-page.css', 'utf8');

console.log('Case A — the China conversion-path override exists and is scoped to html[lang="zh"]');
test('a WhatsApp-demoting rule exists, scoped to html[lang="zh"]', () => {
  const re = /html\[lang="zh"\][^{]*a\.btn-primary\[href\^="https:\/\/wa\.me"\][^{]*\{[^}]*order:2/;
  assert.ok(re.test(css), 'expected an html[lang="zh"] ... a.btn-primary[href^="https://wa.me"] rule setting order:2');
});
test('an Email-promoting rule exists, scoped to html[lang="zh"]', () => {
  const re = /html\[lang="zh"\][^{]*a\.btn-outline\[href\^="mailto:"\][^{]*\{[^}]*order:1/;
  assert.ok(re.test(css), 'expected an html[lang="zh"] ... a.btn-outline[href^="mailto:"] rule setting order:1');
});
test('the promoted Email CTA uses the shared --accent token, not a hardcoded color', () => {
  const match = css.match(/html\[lang="zh"\][^{]*a\.btn-outline\[href\^="mailto:"\][^{]*\{([^}]*)\}/);
  assert.ok(match, 'expected to find the Email-promoting rule body');
  assert.ok(/var\(--accent\)/.test(match[1]), 'expected background:var(--accent) so Dark/Light theming keeps working automatically');
});

console.log('Case B — the override never leaks to other locales (no unscoped equivalent exists)');
test('no unscoped (non-html[lang="zh"]) rule sets order:2 on a.btn-primary[href^="https://wa.me"]', () => {
  // Strip every html[lang="zh"] ... { ... } block, then confirm the pattern is gone from what remains.
  const withoutZhBlocks = css.replace(/html\[lang="zh"\][^{]*\{[^}]*\}/g, '');
  assert.ok(!/a\.btn-primary\[href\^="https:\/\/wa\.me"\][^{]*\{[^}]*order:2/.test(withoutZhBlocks),
    'a WhatsApp-demoting rule exists outside the html[lang="zh"] scope -- this would affect every locale');
});

console.log('Case C — generated locale mirrors: zh gets the swap, others do not (source-level, matches live behavior)');
const LANGS_UNCHANGED = ['ar', 'cs', 'de', 'fr', 'it', 'ja', 'ko', 'ru', 'sk'];
test('holiday-packages.html for English and 9 other locales still link the same shared-page.css (no per-locale fork)', () => {
  const en = fs.readFileSync('holiday-packages.html', 'utf8');
  assert.ok(/href="shared-page\.css"/.test(en), 'English holiday-packages.html should link shared-page.css directly');
  for (const lang of LANGS_UNCHANGED) {
    const html = fs.readFileSync(`${lang}/holiday-packages.html`, 'utf8');
    assert.ok(/href="\/shared-page\.css"/.test(html), `${lang}/holiday-packages.html should link the same root shared-page.css, not a fork`);
    assert.ok(/<html lang="(?!zh)/.test(html) || !/<html lang="zh"/.test(html), `${lang}/holiday-packages.html must not carry lang="zh"`);
  }
});
test('zh/holiday-packages.html carries lang="zh" and links the same shared-page.css', () => {
  const html = fs.readFileSync('zh/holiday-packages.html', 'utf8');
  assert.ok(/<html lang="zh"/.test(html), 'zh/holiday-packages.html must carry lang="zh" for the CSS scope to apply');
  assert.ok(/href="\/shared-page\.css"/.test(html), 'zh/holiday-packages.html should link the same root shared-page.css');
});

console.log(`\n${passed} test(s) passed.`);
if (process.exitCode) {
  console.log('SOME TESTS FAILED');
} else {
  console.log('ALL TESTS PASSED');
}
