// Phase 37 — AI/AEO/Entity Optimization regression suite.
//
// Run: node test/entity-graph.test.js
//
// Guards the entity-architecture and citation-quality fixes made during
// Phase 37: stable @id identifiers, a coherent Organization/LodgingBusiness/
// WebSite graph, consistent Article author/publisher/mainEntityOfPage/
// isPartOf across all 11 content pages, factual containedInPlace geography,
// the two weak-citation replacements, the "multiple sources" overclaim fix,
// and the new in-body entity links -- across every locale mirror, not just
// English. Reads the actual generated locale mirrors -- run
// `node build-i18n-pages.js` first if source files changed.

const assert = require('node:assert/strict');
const fs = require('node:fs');

let passed = 0, failed = 0;
function section(t) { console.log(`\n# ${t}`); }
function test(name, fn) {
  try { fn(); passed++; console.log(`  ok  - ${name}`); }
  catch (e) { failed++; console.log(`  FAIL - ${name}`); console.log('        ' + e.message); process.exitCode = 1; }
}
function read(p) { return fs.readFileSync(p, 'utf8'); }

const FULL_LOCALES = ['ar', 'cs', 'de', 'fr', 'it', 'ja', 'ko', 'ru', 'sk', 'zh'];
const ARTICLE_PAGES = [
  'best-local-islands-snorkeling.html', 'best-time-to-visit.html', 'getting-to-maamigili.html',
  'guesthouse-vs-resort.html', 'maamigili-guide.html', 'maldives-holiday-cost.html',
  'manta-ray-snorkeling.html', 'south-ari-atoll-guide.html', 'south-ari-vs-other-regions.html',
  'things-to-do-maamigili.html', 'whale-shark-snorkeling.html',
];

function jsonLdNodes(html) {
  const nodes = [];
  for (const m of html.matchAll(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/g)) {
    try {
      const parsed = JSON.parse(m[1]);
      for (const n of (Array.isArray(parsed) ? parsed : [parsed])) nodes.push(n);
    } catch (e) { /* skip malformed */ }
  }
  return nodes;
}

section('Case A — homepage Organization/LodgingBusiness/WebSite form one coherent, stable-@id entity graph');
{
  test('LodgingBusiness and Organization share the same @id (same real-world entity, two schema.org types)', () => {
    const nodes = jsonLdNodes(read('vilu-website.html'));
    const lb = nodes.find(n => n['@type'] === 'LodgingBusiness');
    const org = nodes.find(n => n['@type'] === 'Organization');
    assert.ok(lb && lb['@id'], 'LodgingBusiness missing @id');
    assert.ok(org && org['@id'], 'Organization missing @id');
    assert.equal(lb['@id'], org['@id'], 'LodgingBusiness and Organization @id do not match');
    assert.equal(lb['@id'], 'https://viluresidence.net/#organization', 'unexpected @id value');
  });
  test('a WebSite node exists, with a stable @id and a publisher reference back to the Organization', () => {
    const nodes = jsonLdNodes(read('vilu-website.html'));
    const site = nodes.find(n => n['@type'] === 'WebSite');
    assert.ok(site, 'no WebSite node found');
    assert.equal(site['@id'], 'https://viluresidence.net/#website');
    assert.equal(site.url, 'https://viluresidence.net/');
    assert.deepEqual(site.publisher, { '@id': 'https://viluresidence.net/#organization' });
  });
  test('WebSite carries no SearchAction (no real site search exists)', () => {
    const nodes = jsonLdNodes(read('vilu-website.html'));
    const site = nodes.find(n => n['@type'] === 'WebSite');
    assert.equal(site.potentialAction, undefined, 'a SearchAction was added without a real site search feature');
  });
}

section('Case B — every Article page has consistent, complete author/publisher/mainEntityOfPage/isPartOf');
{
  for (const file of ARTICLE_PAGES) {
    test(`${file}: Article node has the full, consistent entity shape`, () => {
      const nodes = jsonLdNodes(read(file));
      const art = nodes.find(n => n['@type'] === 'Article');
      assert.ok(art, `${file}: no Article node`);
      assert.deepEqual(art.author, { '@type': 'Organization', name: 'Vilu Residence', url: 'https://viluresidence.net/' }, `${file}: author shape inconsistent`);
      assert.deepEqual(art.publisher, { '@type': 'Organization', name: 'Vilu Residence', logo: { '@type': 'ImageObject', url: 'https://viluresidence.net/images/vilu-logo.jpg' } }, `${file}: publisher shape inconsistent`);
      assert.ok(art.mainEntityOfPage && art.mainEntityOfPage['@type'] === 'WebPage' && typeof art.mainEntityOfPage['@id'] === 'string', `${file}: mainEntityOfPage missing or not the WebPage/@id object form`);
      assert.deepEqual(art.isPartOf, { '@type': 'WebSite', name: 'Vilu Residence', url: 'https://viluresidence.net/' }, `${file}: isPartOf missing or inconsistent`);
    });
  }
  test('mainEntityOfPage.@id is correctly locale-prefixed on every full-locale mirror (not left pointing at the English URL)', () => {
    for (const loc of FULL_LOCALES) {
      for (const file of ARTICLE_PAGES) {
        const mirror = `${loc}/${file}`;
        if (!fs.existsSync(mirror)) continue;
        const art = jsonLdNodes(read(mirror)).find(n => n['@type'] === 'Article');
        assert.ok(art, `${mirror}: no Article node`);
        assert.ok(art.mainEntityOfPage['@id'].startsWith(`https://viluresidence.net/${loc}/`), `${mirror}: mainEntityOfPage.@id not locale-prefixed: ${art.mainEntityOfPage['@id']}`);
      }
    }
  });
}

section('Case C — factual geographic containment (Maamigili → South Ari Atoll → Maldives)');
{
  test('maamigili-guide.html TouristDestination is containedInPlace South Ari Atoll, which is containedInPlace Maldives', () => {
    const dest = jsonLdNodes(read('maamigili-guide.html')).find(n => n['@type'] === 'TouristDestination');
    assert.ok(dest.containedInPlace, 'no containedInPlace');
    assert.equal(dest.containedInPlace.name, 'South Ari Atoll, Maldives');
    assert.equal(dest.containedInPlace.containedInPlace.name, 'Maldives');
  });
  test('south-ari-atoll-guide.html TouristDestination is containedInPlace Maldives, and carries a real Wikipedia sameAs', () => {
    const dest = jsonLdNodes(read('south-ari-atoll-guide.html')).find(n => n['@type'] === 'TouristDestination');
    assert.deepEqual(dest.containedInPlace, { '@type': 'Country', name: 'Maldives' });
    assert.ok(Array.isArray(dest.sameAs) && dest.sameAs.includes('https://en.wikipedia.org/wiki/Alif_Dhaalu_Atoll'), 'missing real Alif Dhaalu Atoll Wikipedia sameAs');
  });
}

section('Case D — weak/awkward citations replaced with authoritative or neutral sources (English + every full locale)');
{
  test('maamigili-guide.html no longer links a competitor\'s own Facebook post or a Tripadvisor forum thread as a citation', () => {
    const html = read('maamigili-guide.html');
    assert.ok(!/facebook\.com\/koimalahotel/.test(html), 'competitor Facebook post citation still present');
    assert.ok(!/ShowTopic-g293953-i7445-k14840123-Alcohol-Maldives/.test(html), 'Tripadvisor forum thread citation still present');
  });
  test('the replacement sources (Koimala Inn via Tripadvisor, Maldives.com) are present', () => {
    const html = read('maamigili-guide.html');
    assert.ok(html.includes('Koimala_Inn-Maamigili'), 'Koimala Inn Tripadvisor photo citation missing');
    assert.ok(html.includes('maldives.com/articles/rules-and-regulations/drinking-alcohol-in-the-maldives'), 'Maldives.com alcohol-law citation missing');
  });
  test('no full-locale mirror of maamigili-guide.html leaked the old weak citations via a stale per-locale translation', () => {
    for (const loc of FULL_LOCALES) {
      const file = `${loc}/maamigili-guide.html`;
      if (!fs.existsSync(file)) continue;
      const html = read(file);
      assert.ok(!/facebook\.com\/koimalahotel/.test(html), `${file}: still has the competitor Facebook citation`);
      assert.ok(!/ShowTopic-g293953-i7445-k14840123-Alcohol-Maldives/.test(html), `${file}: still has the Tripadvisor forum citation`);
    }
  });
  test('the manta-season "multiple sources" overclaim is corrected to accurately describe the single (Divernet) source, in English and every full locale', () => {
    for (const prefix of ['', ...FULL_LOCALES.map(l => l + '/')]) {
      const file = `${prefix}maamigili-guide.html`;
      if (!fs.existsSync(file)) continue;
      const html = read(file);
      assert.ok(!/multiple dive-tourism sources/i.test(html), `${file}: still claims "multiple ... sources" for a single citation`);
    }
  });
}

section('Case E — new in-body entity links (Task 25)');
{
  test('getting-to-maamigili.html links to south-ari-atoll-guide.html in body content (not just nav/footer)', () => {
    const html = read('getting-to-maamigili.html');
    const introStart = html.indexOf('gtmPage.intro');
    const introEnd = html.indexOf('</p>', introStart);
    assert.ok(html.slice(introStart, introEnd).includes('south-ari-atoll-guide.html'), 'intro paragraph does not link to south-ari-atoll-guide.html');
  });
  test('holiday-packages.html links to maamigili-guide.html, south-ari-atoll-guide.html and whale-shark-snorkeling.html in body content (English + every full locale)', () => {
    for (const prefix of ['', ...FULL_LOCALES.map(l => l + '/')]) {
      const file = `${prefix}holiday-packages.html`;
      if (!fs.existsSync(file)) continue;
      const html = read(file);
      const introStart = html.indexOf('hpPage.introText');
      const introEnd = html.indexOf('</p>', introStart);
      const intro = html.slice(introStart, introEnd);
      assert.ok(intro.includes('maamigili-guide.html'), `${file}: intro missing link to maamigili-guide.html`);
      assert.ok(intro.includes('south-ari-atoll-guide.html'), `${file}: intro missing link to south-ari-atoll-guide.html`);
      assert.ok(intro.includes('whale-shark-snorkeling.html'), `${file}: intro missing link to whale-shark-snorkeling.html`);
    }
  });
}

section('Case F — brand/entity name consistency, no fabrication regressions');
{
  test('every JSON-LD "name" or "author.name"/"publisher.name" referring to the business says "Vilu Residence", never bare "Vilu" (protects the Sun Siyam Vilu Reef disambiguation)', () => {
    const pages = fs.readdirSync('.').filter(f => f.endsWith('.html') && !f.startsWith('vilu-'));
    for (const file of [...pages, 'vilu-website.html']) {
      const nodes = jsonLdNodes(read(file));
      for (const n of nodes) {
        for (const key of ['name', 'author', 'publisher', 'brand']) {
          const v = n[key];
          const name = typeof v === 'string' ? v : (v && v.name);
          if (name === 'Vilu') assert.fail(`${file}: a "${key}" field is the bare, ambiguous "Vilu" rather than "Vilu Residence"`);
        }
      }
    }
  });
  test('no Organization/LodgingBusiness anywhere carries an alternateName of bare "Vilu" (would undermine the established disambiguation)', () => {
    const nodes = jsonLdNodes(read('vilu-website.html'));
    for (const n of nodes) {
      assert.notEqual(n.alternateName, 'Vilu', 'alternateName "Vilu" was added, undermining Sun Siyam Vilu Reef disambiguation');
    }
  });
}

section('Summary');
console.log(`\n${passed}/${passed + failed} entity-graph/AEO assertions passed`);
if (failed > 0) process.exitCode = 1;
