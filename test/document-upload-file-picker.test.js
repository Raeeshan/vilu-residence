// Document upload file-picker fix — 2026-09-10.
//
// Owner report: clicking "Upload document" did nothing -- no native
// Windows file selector appeared. Root cause found live (not assumed from
// code): rdRenderTab()'s Documents tab (n===3) rendered the tab TWICE per
// open -- once synchronously (possibly stale/empty document list), then a
// second time once loadReservationDocuments()'s async fetch resolved,
// typically a few hundred ms later. The button DID correctly open the
// upload form on click, but the second render replaced the whole tab's
// DOM moments later, silently closing it again before a real user could
// act -- live-reproduced and timed (form was 'block' immediately after
// click, 'none' again ~600ms later with no further clicks). On top of
// that, "Upload document" only toggled a hidden form into view rather
// than opening the native picker directly, which is what the owner
// actually expected on a single click.
//
// Covers: the race-condition fix (single render, not two); the native
// file-picker trigger (button -> fileInput.click(), not a form reveal);
// selected-file display; size validation before ever calling the secure
// upload callable; upload progress/failure states; no DOM-id collision
// (this whole section lives in the page-level-singleton res-drawer); no
// change to the secure document backend (still routes through the
// uploadReservationDocument/getReservationDocument callables, storage.rules
// still denies direct client access).
//
// Same technique as the rest of this suite: brace-match real functions out
// of vilu-unified.html, regex-check source directly. No Firestore, no
// browser, no live reservation.
//   node test/document-upload-file-picker.test.js
const assert = require('node:assert/strict');
const fs = require('node:fs');

let passed = 0, failed = 0;
function section(t) { console.log(`\n# ${t}`); }
function test(name, fn) {
  try { fn(); passed++; console.log(`  ok  - ${name}`); }
  catch (e) { failed++; console.log(`  FAIL - ${name}`); console.log('        ' + e.message); process.exitCode = 1; }
}
function read(p) { return fs.readFileSync(p, 'utf8'); }

const PMS = read('vilu-unified.html');
const SRULES = read('storage.rules');

function extractByStart(src, startRegex) {
  const m = src.match(startRegex);
  if (!m) throw new Error('pattern not found: ' + startRegex);
  let i = src.indexOf('{', m.index) + 1, depth = 1;
  while (depth > 0 && i < src.length) {
    if (src[i] === '{') depth++;
    else if (src[i] === '}') depth--;
    i++;
  }
  return src.slice(m.index, i);
}

section('Case A — root cause: the Documents tab no longer double-renders and wipes out an open upload form');
{
  test('rdRenderTab()\'s n===3 branch renders exactly once for real content -- a loading placeholder synchronously, the actual Documents list only after the fetch resolves, never both in sequence', () => {
    const idx = PMS.indexOf('} else if(n===3){');
    const src = PMS.slice(idx, idx + 1600);
    // Exactly one call to renderDocumentsTabHTML now (inside the .then()),
    // not a synchronous call immediately followed by an async re-render.
    const renderCalls = (src.match(/renderDocumentsTabHTML\(/g) || []).length;
    assert.equal(renderCalls, 1, 'expected renderDocumentsTabHTML() to be called exactly once, from inside the resolved-fetch callback');
  });
  test('the deferred render only fires if the user is still on this exact reservation AND still on the Documents tab -- never overwrites a different view they\'ve since navigated to', () => {
    const idx = PMS.indexOf('} else if(n===3){');
    const src = PMS.slice(idx, idx + 1600);
    assert.match(src, /drawerResId===r\.id/);
    assert.match(src, /tabs\[3\] && tabs\[3\]\.classList\.contains\('on'\)/);
  });
}

section('Case B — native file picker trigger (Step 4): one click, no intermediate reveal step');
{
  test('the "Upload document" button calls triggerDocFilePicker(), not a form-toggle function', () => {
    const src = extractByStart(PMS, /function renderDocumentsTabHTML\(resId\)\s*\{/);
    assert.match(src, /onclick="triggerDocFilePicker\(\)"/);
    assert.doesNotMatch(src, /onclick="toggleDocUploadForm\(\)"/);
  });
  test('triggerDocFilePicker() calls the real <input type="file">\'s own .click() -- the one thing that reliably opens the native OS/browser chooser from a user gesture', () => {
    const src = extractByStart(PMS, /function triggerDocFilePicker\(\)\s*\{/);
    assert.match(src, /document\.getElementById\('du-file'\)/);
    assert.match(src, /\.click\(\)/);
  });
  test('the file input itself is a genuine, always-present <input type="file"> (not disabled, not a fake styled div) wired to handleDocFileChosen on change', () => {
    const src = extractByStart(PMS, /function renderDocumentsTabHTML\(resId\)\s*\{/);
    assert.match(src, /<input type="file" id="du-file" accept="image\/\*,application\/pdf" style="display:none" onchange="handleDocFileChosen\(this\)">/);
    assert.doesNotMatch(src, /du-file"[^>]*disabled/);
  });
}

section('Case C — selected-file display and cancel behavior (Steps 7/8)');
{
  test('handleDocFileChosen() no-ops safely when the user cancels the native picker (no file selected) -- nothing breaks, nothing is shown as if a file were chosen', () => {
    const src = extractByStart(PMS, /function handleDocFileChosen\(input\)\s*\{/);
    assert.match(src, /if\(!file\)\{ return; \}/);
  });
  test('a chosen file\'s name and human-readable size are shown immediately', () => {
    const src = extractByStart(PMS, /function handleDocFileChosen\(input\)\s*\{/);
    assert.match(src, /Selected: /);
    assert.match(src, /file\.name/);
    assert.match(src, /sizeLabel/);
  });
  test('cancelDocUpload() clears the file input, title, status line, and hides the form again -- a clean reset, not a partial one', () => {
    const src = extractByStart(PMS, /function cancelDocUpload\(\)\s*\{/);
    assert.match(src, /fileInput\.value=''/);
    assert.match(src, /titleInput\.value=''/);
    assert.match(src, /panel\.style\.display='none'/);
  });
}

section('Case D — file size validated BEFORE the secure callable is ever called (Step 6)');
{
  test('handleDocFileChosen() rejects an oversized file immediately on selection, with a clear message, before any upload attempt', () => {
    const src = extractByStart(PMS, /function handleDocFileChosen\(input\)\s*\{/);
    assert.match(src, /file\.size > MAX_DOC_UPLOAD_MB\*1024\*1024/);
    assert.match(src, /Maximum file size is /);
  });
  test('MAX_DOC_UPLOAD_MB matches the real, already-approved server-side cap (8MB) rather than a larger, invented limit -- chosen to stay safely inside the Cloud Function callable\'s payload limit once base64-encoded', () => {
    assert.match(PMS, /const MAX_DOC_UPLOAD_MB = 8;/);
  });
  test('uploadReservationDocument()\'s own size guard uses the same constant, not a separately-hardcoded number that could drift out of sync', () => {
    const src = extractByStart(PMS, /async function uploadReservationDocument\(resId, file, type, title\)\s*\{/);
    assert.match(src, /blob\.size > MAX_DOC_UPLOAD_MB\*1024\*1024/);
  });
}

section('Case E — upload progress/failure states (Step 9)');
{
  test('submitDocUpload() shows an "Uploading…" state before the callable resolves', () => {
    const src = extractByStart(PMS, /async function submitDocUpload\(resId\)\s*\{/);
    assert.match(src, /Uploading…/);
    assert.match(src, /btn\.disabled=true/);
  });
  test('submitDocUpload() checks uploadReservationDocument()\'s return value (not a try/catch around a function that never throws) so a real failure shows "Upload failed", never a false "Uploaded ✓"', () => {
    const src = extractByStart(PMS, /async function submitDocUpload\(resId\)\s*\{/);
    assert.match(src, /var docId = await uploadReservationDocument\(resId, file, type, title\)/);
    assert.match(src, /if\(docId\)\{/);
    assert.match(src, /Upload failed/);
  });
  test('on failure, the Upload button re-enables so the user can retry without re-selecting the file', () => {
    const src = extractByStart(PMS, /async function submitDocUpload\(resId\)\s*\{/);
    const elseIdx = src.indexOf('} else {');
    const tail = src.slice(elseIdx);
    assert.match(tail, /btn\.disabled=false/);
  });
}

section('Case F — no DOM-id collision (Step 3): this section lives in the page-level-singleton res-drawer');
{
  test('du-file/doc-upload-form/du-status/du-type/du-title/du-submit-btn are declared exactly once in the whole file (the plain, unscoped ids are safe because only one res-drawer instance can ever be open at a time)', () => {
    ['id="du-file"', 'id="doc-upload-form"', 'id="du-status"', 'id="du-type"', 'id="du-title"', 'id="du-submit-btn"'].forEach(idAttr => {
      const count = (PMS.match(new RegExp(idAttr.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'g')) || []).length;
      assert.equal(count, 1, idAttr + ' should be declared exactly once, found ' + count);
    });
  });
}

section('Case G — accepted file types and secure backend unchanged (Steps 5, 12)');
{
  test('the file input still accepts exactly image/* and application/pdf, matching what the secure uploadReservationDocument callable validates server-side', () => {
    assert.match(PMS, /accept="image\/\*,application\/pdf"/);
  });
  test('the callable server-side mimeType allowlist is unchanged: JPEG/PNG/WEBP images or PDF', () => {
    // functions-core/index.js's own regex -- read directly, not via vilu-unified.html
    const FN = read('functions-core/index.js');
    assert.match(FN, /image\\\/\(jpeg\|png\|webp\)\|application\\\/pdf/);
  });
  test('storage.rules still denies every direct client request to reservation-documents/ -- upload/view still only via the two callables, no getDownloadURL() reintroduced', () => {
    const idx = SRULES.indexOf('match /reservation-documents/{resId}/{documentId}');
    const block = SRULES.slice(idx, SRULES.indexOf('\n    }', idx));
    assert.match(block, /allow read, write:\s*if\s*false\s*;/);
  });
  test('the client never calls getDownloadURL() anywhere for reservation documents', () => {
    const viewSrc = extractByStart(PMS, /async function viewReservationDocument\(resId, docId\)\s*\{/);
    const dlSrc = extractByStart(PMS, /async function downloadReservationDocument\(resId, docId\)\s*\{/);
    assert.doesNotMatch(viewSrc, /getDownloadURL/);
    assert.doesNotMatch(dlSrc, /getDownloadURL/);
  });
}

console.log(`\n${passed}/${passed + failed} document-upload-file-picker assertions passed`);
if (failed) { console.log('\nFAILED'); process.exit(1); } else { console.log('\nALL TESTS PASSED'); }
