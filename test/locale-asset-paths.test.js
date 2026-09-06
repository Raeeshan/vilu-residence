// Regression test for the locale-mirror image-404 fix (POST-PHASE-20 compliance/QA pass).
//
// Run: node test/locale-asset-paths.test.js
//
// Root cause being guarded against: build-i18n-pages.js's rewriteResourcePaths()
// only walks real DOM attributes (src/href/srcset/etc.) via cheerio, so it can
// never reach a relative image path written as a plain JS string literal inside
// a <script> block (EXPERIENCES_CONFIG, HP_PKG_IMAGES, the hero-video source
// picker). Any such literal must be root-absolute ('/images/...') in the
// SOURCE file itself, since the build pipeline cannot fix it after the fact.
// This test scans the English source and a sample of generated locale mirrors
// directly for the broken pattern, without assuming any particular file list.

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

// Matches a single-quoted JS string literal that starts with a relative
// "images/" path -- i.e. exactly the broken pattern this fix repairs.
// Root-absolute ('/images/...') and double-quoted HTML-attribute forms
// (already handled by the existing build-time DOM rewriter) do not match.
const RELATIVE_JS_IMAGE_LITERAL = /'images\//;

console.log('Case A — English source has zero relative JS image-string literals');
test('vilu-website.html contains no \'images/... string literal (all such paths are root-absolute)', () => {
  const html = fs.readFileSync('vilu-website.html', 'utf8');
  const matches = html.match(new RegExp(RELATIVE_JS_IMAGE_LITERAL, 'g')) || [];
  assert.equal(matches.length, 0, `found ${matches.length} relative 'images/... JS string literal(s) in vilu-website.html -- these will 404 on every locale mirror since the build-time DOM rewriter cannot reach JS string content`);
});

test('EXPERIENCES_CONFIG photo entries are all root-absolute', () => {
  const html = fs.readFileSync('vilu-website.html', 'utf8');
  const configMatch = html.match(/EXPERIENCES_CONFIG\s*=\s*\[([\s\S]*?)\n\];/);
  assert.ok(configMatch, 'EXPERIENCES_CONFIG array not found in vilu-website.html');
  const photoPaths = [...configMatch[1].matchAll(/photo:\s*\['([^']+)'/g)].map((m) => m[1]);
  assert.ok(photoPaths.length > 0, 'expected at least one photo: [...] entry in EXPERIENCES_CONFIG');
  for (const path of photoPaths) {
    assert.ok(path.startsWith('/images/'), `EXPERIENCES_CONFIG photo path "${path}" must be root-absolute`);
  }
});

test('HP_PKG_IMAGES entries are all root-absolute', () => {
  const html = fs.readFileSync('vilu-website.html', 'utf8');
  const objMatch = html.match(/HP_PKG_IMAGES\s*=\s*\{([\s\S]*?)\n\};/);
  assert.ok(objMatch, 'HP_PKG_IMAGES object not found in vilu-website.html');
  const imagePaths = [...objMatch[1].matchAll(/:\s*\['([^']+)'/g)].map((m) => m[1]);
  assert.ok(imagePaths.length > 0, 'expected at least one image entry in HP_PKG_IMAGES');
  for (const path of imagePaths) {
    assert.ok(path.startsWith('/images/'), `HP_PKG_IMAGES path "${path}" must be root-absolute`);
  }
});

test('hero-video JS source picker uses root-absolute paths for both mobile and desktop variants', () => {
  const html = fs.readFileSync('vilu-website.html', 'utf8');
  const heroMatch = html.match(/src\.src\s*=\s*isMobile\s*\?\s*'([^']+)'\s*:\s*'([^']+)'/);
  assert.ok(heroMatch, 'hero-video src.src assignment not found in vilu-website.html');
  assert.ok(heroMatch[1].startsWith('/images/'), `hero mobile video path "${heroMatch[1]}" must be root-absolute`);
  assert.ok(heroMatch[2].startsWith('/images/'), `hero desktop video path "${heroMatch[2]}" must be root-absolute`);
});

console.log('Case B — locale mirrors inherit the fix from the unchanged build pipeline (no per-locale patching)');
const LOCALES = ['ar', 'cs', 'de', 'fr', 'it', 'ja', 'ko', 'ru', 'sk', 'zh'];
test('every generated locale index.html has zero relative \'images/... JS string literals', () => {
  for (const lang of LOCALES) {
    const html = fs.readFileSync(`${lang}/index.html`, 'utf8');
    const matches = html.match(new RegExp(RELATIVE_JS_IMAGE_LITERAL, 'g')) || [];
    assert.equal(matches.length, 0, `${lang}/index.html contains ${matches.length} relative 'images/... JS string literal(s)`);
  }
});

console.log(`\n${passed} test(s) passed.`);
if (process.exitCode) {
  console.log('SOME TESTS FAILED');
} else {
  console.log('ALL TESTS PASSED');
}
