// Agency Sales Workflow — Phase B: Quotation Builder + guest-safe printable
// quote. 2026-09-11.
//
// Scope reminder: a quote is ONLY a sales document (guest name, dates,
// package, guest selling total). It must never create a reservation, block
// request, or touch availability. The guest-facing document must NEVER
// contain Vilu's net cost, individual component prices, or the agency's
// margin -- only the one agreed selling total. Phase A's agency_quotes
// ownership/DRAFT/FINALIZED rules are unchanged and re-verified, not
// rebuilt, by test/agency-quotes-rules.test.js (emulator).
//
// Technique: same as the rest of this suite -- vm-sandboxed pure-function
// checks for the calculation/sanitization/rendering functions (Part 23's
// "guest document security test" needs to actually RUN the renderer and
// inspect its output, not just grep source), plus regex/structural checks
// for wiring and isolation. No Firestore, no browser.
//   node test/agency-quotation-builder.test.js
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

let passed = 0, failed = 0;
function section(t) { console.log(`\n# ${t}`); }
function test(name, fn) {
  try { fn(); passed++; console.log(`  ok  - ${name}`); }
  catch (e) { failed++; console.log(`  FAIL - ${name}`); console.log('        ' + e.message); process.exitCode = 1; }
}
function read(p) { return fs.readFileSync(p, 'utf8'); }

const PMS = read('vilu-unified.html');
const PORTAL = read('vilu-agency-portal.html');
const RULES = read('firestore.rules');

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

// ── sandbox: the pure quote calculation/sanitization/rendering functions ──
const escSrc = extractByStart(PORTAL, /function esc\(s\)\s*\{/);
const sanitizeSrc = extractByStart(PORTAL, /function sanitizeGuestLabel\(label\)\s*\{/);
const calcNetSrc = extractByStart(PORTAL, /function calcQuoteViluNet\(pkg, adults, children, childDiscountPct, arrivalDate, departureDate, agyBookingSettings\)\s*\{/);
const buildGuestHtmlSrc = extractByStart(PORTAL, /function buildGuestQuotationHTML\(quote\)\s*\{/);
const newQuoteIdSrc = extractByStart(PORTAL, /function newAgencyQuoteId\(\)\s*\{/);

function makeSandbox(extraGlobals) {
  const sandbox = Object.assign({ Date: Date, Math: Math, String: String }, extraGlobals || {});
  vm.createContext(sandbox);
  vm.runInContext([escSrc, sanitizeSrc, calcNetSrc, buildGuestHtmlSrc, newQuoteIdSrc].join('\n'), sandbox);
  return sandbox;
}
const sb = makeSandbox({ currentAgency: { email: 'angelica@example.com' } });

section('Case A — Vilu net calculation reuses the real, audited pricing semantics (Part 3: do not guess)');
{
  const pkg = { agencyPricePerRoom: 595, nights: 7, childDiscountPct: 50 };
  const settings = { extraNightRate: 40, flightSurcharge: 110 };
  test('base package price is a fixed PER-PERSON total for the whole package, never multiplied by nights, when the stay matches the package length exactly', () => {
    const net = sb.calcQuoteViluNet(pkg, 2, 0, 50, '2027-01-01', '2027-01-08', settings);
    assert.equal(net.baseTotal, 1190); // 595*2, NOT 595*2*7
    assert.equal(net.extraNights, 0);
    assert.equal(net.total, 1190);
  });
  test('children ride at the package rate minus the package\'s own Child Discount %, adults always full price', () => {
    const net = sb.calcQuoteViluNet(pkg, 2, 1, 50, '2027-01-01', '2027-01-08', settings);
    assert.equal(net.baseTotal, 595*2 + 595*0.5*1); // 1487.5
  });
  test('stay nights beyond the package\'s own fixed duration are priced separately, per adult, at the global extra-night rate -- matching updateBkSummary()\'s real booking math', () => {
    const net = sb.calcQuoteViluNet(pkg, 2, 0, 50, '2027-01-01', '2027-01-11', settings); // 10 nights vs 7-night package
    assert.equal(net.extraNights, 3);
    assert.equal(net.extraNightsCost, 3*40*2); // 240
    assert.equal(net.total, 1190+240);
  });
  test('falls back to the package\'s own base nights when dates are not yet entered (no NaN, no negative extra nights)', () => {
    const net = sb.calcQuoteViluNet(pkg, 2, 0, 50, '', '', settings);
    assert.equal(net.totalNights, 7);
    assert.equal(net.extraNights, 0);
  });
  test('this calculation mirrors updateBkSummary() in the same file -- same basePerPersonNight/childDiscountPct/extraNightRate formula shape, confirmed side by side', () => {
    const bookingSrc = extractByStart(PORTAL, /function updateBkSummary\(\)\s*\{/);
    assert.match(bookingSrc, /var basePerPersonNight = selectedPkg\.agencyPricePerRoom\|\|selectedPkg\.pricePerRoom;/);
    assert.match(bookingSrc, /var childPerPersonNight = basePerPersonNight \* \(1 - childDiscountPct\/100\);/);
    assert.match(bookingSrc, /var extraNightsCost = extraNights \* settings\.extraNightRate \* ad;/);
  });
}

section('Case B — price-in-label sanitizer (Parts 9/10)');
{
  test('strips a trailing " — $NN" price suffix', () => {
    assert.equal(sb.sanitizeGuestLabel('Whale Shark Snorkeling — $72'), 'Whale Shark Snorkeling');
  });
  test('strips a trailing " - $NN" (hyphen) and decimal prices too', () => {
    assert.equal(sb.sanitizeGuestLabel('Manta Ray Snorkeling - $85.50'), 'Manta Ray Snorkeling');
  });
  test('leaves a label with no embedded price untouched', () => {
    assert.equal(sb.sanitizeGuestLabel('Daily breakfast'), 'Daily breakfast');
  });
  test('never mutates the original stored package data -- it is a pure function returning a new string', () => {
    const original = 'Round-trip Speedboat — $110';
    const result = sb.sanitizeGuestLabel(original);
    assert.equal(original, 'Round-trip Speedboat — $110'); // unchanged
    assert.equal(result, 'Round-trip Speedboat');
  });
}

section('Case C — guest-safe document: PART 23\'s exact adversarial test (render, then assert on the OUTPUT, not the source)');
{
  // A synthetic quote whose internal data intentionally contains every kind
  // of value that must never reach the guest -- exactly Part 23's scenario.
  const quote = {
    quoteId: 'VQ-QATEST-2026-000123',
    agencyId: 'agency-a-uid',
    agencyEmail: 'angelica@example.com',
    agencyName: 'Angelica Travel',
    guestName: 'John Smith',
    arrivalDate: '2027-01-12',
    departureDate: '2027-01-19',
    nights: 7,
    adults: 2,
    children: 0,
    packageName: 'Maldives Dream Bliss',
    guestIncludes: ['Daily breakfast', 'Round-trip Speedboat'],
    guestActivities: ['Whale Shark Snorkeling', 'Manta Ray Snorkeling'],
    guestMessage: 'Honeymoon — please arrange a welcome drink.',
    currency: 'USD',
    agencyGuestSellingTotal: 1450,
    status: 'FINALIZED',
    // Everything below this line must NEVER reach buildGuestQuotationHTML's output.
    viluNetTotal: 1200,
    roomRate: 100,
    childDiscountPct: 50,
    exchangeRate: 15.42,
    exchangeRateSource: 'agency-entered',
    exchangeRateSnapshotAt: '2026-09-11T00:00:00.000Z',
    selectedComponents: [
      { name: 'Whale Shark Snorkeling', internalPrice: 85 },
      { name: 'Manta Ray Snorkeling', internalPrice: 85 },
    ],
    packageId: 'PKG-INTERNAL-ID',
    commission: 250,
    margin: 250,
    marginPct: 20.83,
  };
  const html = sb.buildGuestQuotationHTML(quote);

  test('contains the ONE guest-facing total (1450)', () => {
    assert.match(html, /1450\.00/);
  });
  test('does NOT contain the Vilu net total (1200)', () => {
    assert.doesNotMatch(html, /1200/);
  });
  test('does NOT contain the agency margin (250) or its percentage (20.83)', () => {
    assert.doesNotMatch(html, /\b250\b/);
    assert.doesNotMatch(html, /20\.83/);
  });
  test('does NOT contain the exchange rate (15.42)', () => {
    assert.doesNotMatch(html, /15\.42/);
  });
  // CSS (in <style>) and inline style="..." attributes legitimately contain
  // numerals and words that would false-positive here (e.g. "width:100%",
  // "margin:0", the print button's own "margin-top:24px") -- these two
  // checks strip every tag (attributes included) and look only at the
  // guest-VISIBLE text, matching what a person reading/printing actually sees.
  const visibleText = html.slice(html.indexOf('<body>')).replace(/<[^>]+>/g, ' ');
  test('does NOT contain any individual component/room internal price (85, 100) in the visible text', () => {
    assert.doesNotMatch(visibleText, /\b85\b/);
    assert.doesNotMatch(visibleText, /\b100\b/);
  });
  test('does NOT contain the words "commission", "margin", "Vilu net", or "internal" in the visible text', () => {
    assert.doesNotMatch(visibleText, /commission/i);
    assert.doesNotMatch(visibleText, /margin/i);
    assert.doesNotMatch(visibleText, /vilu net/i);
    assert.doesNotMatch(visibleText, /internal/i);
  });
  test('does NOT contain the raw package id, agency email, or child discount percentage', () => {
    assert.doesNotMatch(html, /PKG-INTERNAL-ID/);
    assert.doesNotMatch(html, /angelica@example\.com/);
    assert.doesNotMatch(html, /childDiscount/i);
  });
  test('DOES contain the guest-safe package/inclusion content, sanitized of any embedded price', () => {
    assert.match(html, /Whale Shark Snorkeling/);
    assert.match(html, /Manta Ray Snorkeling/);
    assert.match(html, /Daily breakfast/);
    assert.match(html, /Round-trip Speedboat/);
  });
  test('DOES contain the guest name, dates, package name, and agency name', () => {
    assert.match(html, /John Smith/);
    assert.match(html, /Maldives Dream Bliss/);
    assert.match(html, /Angelica Travel/);
    assert.match(html, /January 2027/);
  });
  test('a FINALIZED quote does not carry the DRAFT watermark/disclaimer', () => {
    assert.doesNotMatch(html, /draftwm/);
    assert.doesNotMatch(html, /subject to change/);
  });
}

section('Case D — guest-safe document: DRAFT status renders a watermark, and still hides everything internal');
{
  const draftQuote = {
    quoteId: 'VQ-QATEST-2026-000124', agencyName: 'Angelica Travel', guestName: 'Jane Doe',
    arrivalDate: '2027-02-01', departureDate: '2027-02-05', nights: 4, adults: 1, children: 0,
    packageName: 'Test Package', guestIncludes: [], guestActivities: [], guestMessage: '',
    currency: 'USD', agencyGuestSellingTotal: 800, status: 'DRAFT',
    viluNetTotal: 600, exchangeRate: 1,
  };
  const html = sb.buildGuestQuotationHTML(draftQuote);
  test('DRAFT renders a watermark and a "subject to change" disclaimer', () => {
    assert.match(html, /draftwm/);
    assert.match(html, /subject to change/);
  });
  test('still contains only the guest total (800), never the Vilu net (600)', () => {
    assert.match(html, /800\.00/);
    assert.doesNotMatch(html, /\b600\b/);
  });
}

section('Case E — buildGuestQuotationHTML() is an explicit allowlist, verified at the SOURCE level too (defense in depth beyond the render tests above)');
{
  test('the function assigns exactly the documented safe fields into `safe`, and nothing else from `quote`', () => {
    const allowedFields = ['quoteId','agencyName','guestName','arrivalDate','departureDate','nights','adults','children','packageName','includes','activities','guestMessage','currency','total','status'];
    const safeBlockMatch = buildGuestHtmlSrc.match(/var safe = \{([\s\S]*?)\};/);
    assert.ok(safeBlockMatch, 'could not find the `safe = {...}` allowlist block');
    allowedFields.forEach(f => {
      assert.match(safeBlockMatch[1], new RegExp(`\\b${f}:`), `expected "${f}:" in the safe allowlist`);
    });
    // Forbidden internal fields must never appear as a `quote.<field>` read
    // anywhere after the allowlist block (i.e. nowhere in the render logic).
    const afterAllowlist = buildGuestHtmlSrc.slice(buildGuestHtmlSrc.indexOf('};', buildGuestHtmlSrc.indexOf('var safe')));
    ['viluNetTotal','exchangeRate','selectedComponents','childDiscountPct','agencyEmail','packageId','commission','margin'].forEach(f => {
      assert.doesNotMatch(afterAllowlist, new RegExp('quote\\.'+f), `quote.${f} must never be read outside the allowlist`);
    });
  });
  test('`quote` is explicitly nulled out immediately after the allowlist is built, structurally preventing any later line from reading it', () => {
    assert.match(buildGuestHtmlSrc, /quote = null;/);
  });
}

section('Case F — quote reference format (Part 11)');
{
  test('newAgencyQuoteId() produces a human-readable VQ-<CODE>-<YEAR>-<6 digits> reference', () => {
    const id = sb.newAgencyQuoteId();
    assert.match(id, /^VQ-[A-Z0-9]+-\d{4}-\d{6}$/);
  });
}

section('Case G — Quotations UI wiring (Part 1/2/17)');
{
  test('a Quotations tab exists in the portal nav, alongside Packages/Availability/My bookings/Block rooms', () => {
    assert.match(PORTAL, /onclick="showTab\('quotations',this\)"/);
    assert.match(PORTAL, /id="tab-quotations"/);
  });
  test('showTab() wires quotations into its tab list and calls drawQuotations()', () => {
    const src = extractByStart(PORTAL, /function showTab\(name, el\)\s*\{/);
    assert.match(src, /\[.*'quotations'.*\]/);
    assert.match(src, /if\(name==='quotations'\) drawQuotations\(\);/);
  });
  test('each package card has a "Create quotation" button calling openQuoteBuilder(), separate from "Book this package"', () => {
    const src = extractByStart(PORTAL, /async function drawPackages\(\)\s*\{/);
    assert.match(src, /onclick="openBookingModal\(this\.dataset\.pid\)"/);
    assert.match(src, /onclick="openQuoteBuilder\(this\.dataset\.pid\)"/);
    assert.match(src, /Create quotation/);
  });
  test('drawQuotations() queries agency_quotes scoped by agencyId server-side (not fetch-all-then-filter)', () => {
    const src = extractByStart(PORTAL, /async function drawQuotations\(\)\s*\{/);
    assert.match(src, /fsDb\.collection\('agency_quotes'\)\.where\('agencyId','==',currentAgency\.uid\)\.get\(\)/);
    assert.doesNotMatch(src, /fsDb\.collection\('agency_quotes'\)\.get\(\)/);
  });
  test('the list splits quotes into Draft and Finalized sections', () => {
    assert.match(PORTAL, /id="quotes-draft-list"/);
    assert.match(PORTAL, /id="quotes-finalized-list"/);
    const src = extractByStart(PORTAL, /async function drawQuotations\(\)\s*\{/);
    assert.match(src, /status==='DRAFT'/);
    assert.match(src, /status==='FINALIZED'/);
  });
  test('Draft rows get [Edit]/[Preview]; Finalized rows get [View]/[Print]', () => {
    const src = extractByStart(PORTAL, /function renderQuoteCard\(q\)\s*\{/);
    assert.match(src, />Edit</);
    assert.match(src, />Preview</);
    assert.match(src, />View</);
    assert.match(src, />Print</);
  });
}

section('Case H — live preview updates without requiring finalization (Part 6)');
{
  test('updateQuotePreview() is wired to every relevant input via oninput/onchange, and refreshes the preview iframe on every call', () => {
    const modalStart = PORTAL.indexOf('id="m-quote"');
    const modalEnd = PORTAL.indexOf('<!-- Margin Ledger modal removed', modalStart);
    const modalHTML = PORTAL.slice(modalStart, modalEnd);
    ['quote-guest-name','quote-arrival','quote-departure','quote-adults','quote-children','quote-message','quote-selling-price','quote-currency'].forEach(id => {
      assert.match(modalHTML, new RegExp(`id="${id}"[^>]*on(?:input|change)="[^"]*updateQuotePreview\\(\\)`), `#${id} must call updateQuotePreview() live`);
    });
    const previewSrc = extractByStart(PORTAL, /async function updateQuotePreview\(\)\s*\{/);
    assert.match(previewSrc, /frame\.srcdoc = buildGuestQuotationHTML\(_quoteWorking\);/);
  });
  test('the preview is an iframe using srcdoc (isolated from the portal\'s own CSS/DOM), not innerHTML into a live page element', () => {
    assert.match(PORTAL, /<iframe id="quote-preview-frame"/);
  });
}

section('Case I — FINALIZED lock (Part 13/14) enforced in the builder UI, on top of the Phase A server rule');
{
  test('openQuoteBuilder() disables every commercial input and hides Save/Finalize once status is FINALIZED', () => {
    const src = extractByStart(PORTAL, /async function openQuoteBuilder\(pid, existingQuoteId\)\s*\{/);
    assert.match(src, /var locked = _quoteWorking\.status === 'FINALIZED';/);
    assert.match(src, /el\.disabled = locked;/);
    assert.match(src, /quote-save-btn'\)\.style\.display = locked \? 'none' : '';/);
    assert.match(src, /quote-finalize-btn'\)\.style\.display = locked \? 'none' : '';/);
  });
  test('finalizeQuote() requires an explicit confirmation before locking the quote, per the owner\'s exact wording', () => {
    const src = extractByStart(PORTAL, /async function finalizeQuote\(\)\s*\{/);
    assert.match(src, /Finalize this quotation\?\\n\\nAfter finalization, the commercial details will be locked\./);
  });
  test('finalizeQuote() validates guest name, dates, and a positive selling price before allowing finalization', () => {
    const src = extractByStart(PORTAL, /async function finalizeQuote\(\)\s*\{/);
    assert.match(src, /if\(!_quoteWorking\.guestName \|\| !_quoteWorking\.arrivalDate \|\| !_quoteWorking\.departureDate\)/);
    assert.match(src, /_quoteWorking\.agencyGuestSellingTotal > 0/);
  });
  test('no further workflow button (hold/booking-request/confirm) exists yet -- Phase B stops at "Quotation finalized."', () => {
    const src = extractByStart(PORTAL, /async function finalizeQuote\(\)\s*\{/);
    assert.match(src, /Quotation finalized\./);
    assert.doesNotMatch(PORTAL, /Request Hold/);
    assert.doesNotMatch(PORTAL, /Send Booking Request/);
    assert.doesNotMatch(PORTAL, /Confirm Reservation/);
  });
}

section('Case J — NO inventory effect whatsoever (Part 15) -- structurally verified across every Phase B function');
{
  const quoteBuilderFns = [
    extractByStart(PORTAL, /async function openQuoteBuilder\(pid, existingQuoteId\)\s*\{/),
    extractByStart(PORTAL, /async function updateQuotePreview\(\)\s*\{/),
    extractByStart(PORTAL, /async function saveQuoteDraft\(\)\s*\{/),
    extractByStart(PORTAL, /async function finalizeQuote\(\)\s*\{/),
    extractByStart(PORTAL, /async function drawQuotations\(\)\s*\{/),
    extractByStart(PORTAL, /function renderQuoteCard\(q\)\s*\{/),
    extractByStart(PORTAL, /async function printQuotation\(quoteId\)\s*\{/),
  ];
  test('none of the Quotation Builder functions ever touch reservations, block_requests, blocks, or room_availability', () => {
    quoteBuilderFns.forEach(src => {
      assert.doesNotMatch(src, /collection\('reservations'\)/);
      assert.doesNotMatch(src, /collection\('block_requests'\)/);
      assert.doesNotMatch(src, /collection\('blocks'\)/);
      assert.doesNotMatch(src, /collection\('room_availability'\)/);
    });
  });
  test('saveQuoteDraft()/finalizeQuote() write ONLY to agency_quotes/{quoteId}', () => {
    const saveSrc = extractByStart(PORTAL, /async function saveQuoteDraft\(\)\s*\{/);
    const finalizeSrc = extractByStart(PORTAL, /async function finalizeQuote\(\)\s*\{/);
    assert.match(saveSrc, /fsDb\.collection\('agency_quotes'\)\.doc\(_quoteWorking\.quoteId\)\.set\(_quoteWorking\)/);
    assert.match(finalizeSrc, /fsDb\.collection\('agency_quotes'\)\.doc\(_quoteWorking\.quoteId\)\.set\(_quoteWorking\)/);
  });
}

section('Case K — currency behavior (Part 5): reuses labels only, no new exchange-rate engine, no live company-rate read from the portal');
{
  test('the portal never reads tax_currency_settings (that collection is admin/staff/manager-only per firestore.rules; the agency has no access and none was added)', () => {
    assert.doesNotMatch(PORTAL, /tax_currency_settings/);
    const rulesBlock = RULES.slice(RULES.indexOf('match /tax_currency_settings/{docId}'), RULES.indexOf('match /tax_currency_settings/{docId}')+200);
    assert.match(rulesBlock, /allow read: if isAdmin\(\) \|\| isStaff\(\) \|\| isManagerRole\(\);/);
  });
  test('a non-USD quote lets the agency optionally enter a reference-only exchange rate, explicitly NOT used to auto-convert the guest total', () => {
    assert.match(PORTAL, /your own reference only — the guest total above is the agreed amount you enter, not auto-converted/);
  });
  test('exchangeRate/exchangeRateSource/exchangeRateSnapshotAt are snapshotted on the quote object, never recomputed from a live source later', () => {
    const src = extractByStart(PORTAL, /async function updateQuotePreview\(\)\s*\{/);
    assert.match(src, /_quoteWorking\.exchangeRate = isUsd \? 1 : \(rateInput>0 \? rateInput : 1\);/);
    assert.match(src, /_quoteWorking\.exchangeRateSource = \(!isUsd && rateInput>0\) \? 'agency-entered' : null;/);
  });
}

section('Case L — price snapshot safety (Part 19): a quote\'s guest-facing content is copied at open time, not re-derived live');
{
  test('openQuoteBuilder() copies guestIncludes/guestActivities from the package ONCE, when a brand-new quote is created -- never re-reads _quotePkg on every keystroke', () => {
    const src = extractByStart(PORTAL, /async function openQuoteBuilder\(pid, existingQuoteId\)\s*\{/);
    assert.match(src, /guestIncludes: \(_quotePkg\.includes\|\|\[\]\)\.map\(sanitizeGuestLabel\)/);
    assert.match(src, /guestActivities: \(_quotePkg\.activities\|\|\[\]\)\.map\(sanitizeGuestLabel\)/);
    const previewSrc = extractByStart(PORTAL, /async function updateQuotePreview\(\)\s*\{/);
    assert.doesNotMatch(previewSrc, /guestIncludes\s*=/);
    assert.doesNotMatch(previewSrc, /guestActivities\s*=/);
  });
}

section('Case M — Website Packages / agency_packages / block_requests / reservations create rule all unchanged (explicit DO-NOT-TOUCH list)');
{
  test('agency_packages rules unchanged (admin write-only)', () => {
    assert.match(RULES, /match \/agency_packages\/\{email\} \{\s*\n\s*allow read: if request\.auth != null &&\s*\n\s*\(request\.auth\.token\.email\.lower\(\) == email \|\| isAdmin\(\)\);\s*\n\s*allow write: if isAdmin\(\);/);
  });
  test('block_requests rules unchanged', () => {
    assert.match(RULES, /match \/block_requests\/\{id\} \{\s*\n\s*allow create: if request\.auth != null && request\.resource\.data\.agencyId == request\.auth\.uid;/);
  });
  test('reservations create rule still includes the (unchanged, Phase F territory) direct-agency-create branch', () => {
    const resBlock = RULES.slice(RULES.indexOf('match /reservations/{id} {'), RULES.indexOf('match /reservation_price_adjustments/'));
    assert.match(resBlock, /isAgency\(\) && request\.resource\.data\.agencyId == request\.auth\.uid && request\.resource\.data\.source == 'Agency'/);
  });
  test('agency_quotes rules unchanged from Phase A (Phase B needed no new rules)', () => {
    const rulesBlock = RULES.slice(RULES.indexOf('match /agency_quotes/{quoteId} {'), RULES.indexOf('match /room_prices/{roomId} {'));
    assert.match(rulesBlock, /allow create: if request\.auth != null\s*\n\s*&& request\.resource\.data\.agencyId == request\.auth\.uid;/);
    assert.match(rulesBlock, /allow delete: if false;/);
  });
  test('the Website tab\'s own card renderer in vilu-unified.html is unchanged', () => {
    const src = extractByStart(PMS, /function renderPkgList\(\)\s*\{/);
    assert.match(src, /WEBSITE PACKAGES — redesigned compact cards/);
  });
}

console.log(`\n${passed}/${passed + failed} agency-quotation-builder assertions passed`);
