/* ══════════════════════════════════════════════════════════════
   GLOBAL NAV SHELL — Phase 10
   Shared, site-chrome-only interaction logic for the header
   (dropdowns, hamburger, mobile drawer, scroll state) and the
   "Check Availability" CTA. Loaded by all 12 English source pages
   (and, via build-i18n-pages.js's existing resource-path rewrite,
   all 120 generated pages) — including the homepage.

   Deliberately excludes anything booking/PMS-specific: this file
   never touches Firestore/Supabase, room data, or the booking
   popup/full-page internals. It only ever calls the homepage's
   own `openBookingPopup()` when that function happens to exist on
   the page (i.e. only on the homepage) — on every other page it
   falls back to a plain navigation to `/#booking`, so this file
   has no dependency on homepage-only code being present.
   ══════════════════════════════════════════════════════════════ */
(function(){

  // ── HEADER SCROLL STATE (transparent-over-hero -> solid) ──
  function initHeaderScroll(){
    var nav = document.getElementById('nav');
    if (!nav) return;
    function update(){ nav.classList.toggle('scrolled', window.scrollY > 60); }
    update();
    window.addEventListener('scroll', update, {passive:true});
  }

  // ── HAMBURGER + MOBILE DRAWER ──
  var _lastFocused = null;
  function openDrawer(){
    var drawer = document.getElementById('mobileMenu');
    var hamburger = document.getElementById('hamburger');
    if (!drawer || !hamburger) return;
    _lastFocused = document.activeElement;
    drawer.classList.add('open');
    hamburger.setAttribute('aria-expanded', 'true');
    document.body.style.overflow = 'hidden';
    var closeBtn = drawer.querySelector('.mm-close');
    if (closeBtn) closeBtn.focus();
  }
  function closeDrawer(){
    var drawer = document.getElementById('mobileMenu');
    var hamburger = document.getElementById('hamburger');
    if (!drawer || !hamburger) return;
    drawer.classList.remove('open');
    hamburger.setAttribute('aria-expanded', 'false');
    document.body.style.overflow = '';
    if (_lastFocused && typeof _lastFocused.focus === 'function') _lastFocused.focus();
    else hamburger.focus();
  }
  function toggleDrawer(){
    var drawer = document.getElementById('mobileMenu');
    if (!drawer) return;
    if (drawer.classList.contains('open')) closeDrawer(); else openDrawer();
  }

  function getFocusable(container){
    return Array.prototype.slice.call(container.querySelectorAll(
      'a[href], button:not([disabled]), select, [tabindex]:not([tabindex="-1"])'
    )).filter(function(el){ return el.offsetParent !== null; });
  }

  function initDrawer(){
    var drawer = document.getElementById('mobileMenu');
    var hamburger = document.getElementById('hamburger');
    if (!drawer || !hamburger) return;
    hamburger.addEventListener('click', toggleDrawer);
    drawer.querySelectorAll('[data-mm-close]').forEach(function(el){
      el.addEventListener('click', closeDrawer);
    });
    document.addEventListener('keydown', function(e){
      if (!drawer.classList.contains('open')) return;
      if (e.key === 'Escape') { closeDrawer(); return; }
      if (e.key === 'Tab') {
        var focusable = getFocusable(drawer);
        if (!focusable.length) return;
        var first = focusable[0], last = focusable[focusable.length - 1];
        if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
        else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
      }
    });
    // Mobile accordion groups — one open at a time
    drawer.querySelectorAll('.mm-group-trigger').forEach(function(trigger){
      trigger.addEventListener('click', function(){
        var group = trigger.closest('.mm-group');
        var wasOpen = group.classList.contains('open');
        drawer.querySelectorAll('.mm-group.open').forEach(function(g){
          g.classList.remove('open');
          g.querySelector('.mm-group-trigger').setAttribute('aria-expanded', 'false');
        });
        if (!wasOpen) { group.classList.add('open'); trigger.setAttribute('aria-expanded', 'true'); }
      });
    });
  }

  // ── DESKTOP DROPDOWNS ──
  function closeAllDropdowns(except){
    document.querySelectorAll('.nav-drop.open').forEach(function(d){
      if (d === except) return;
      d.classList.remove('open');
      var trigger = d.querySelector('.nav-drop-trigger');
      if (trigger) trigger.setAttribute('aria-expanded', 'false');
    });
  }
  function initDropdowns(){
    var drops = document.querySelectorAll('.nav-drop');
    if (!drops.length) return;
    drops.forEach(function(drop){
      var trigger = drop.querySelector('.nav-drop-trigger');
      if (!trigger) return;
      var closeTimer = null;
      function open(){ clearTimeout(closeTimer); closeAllDropdowns(drop); drop.classList.add('open'); trigger.setAttribute('aria-expanded', 'true'); }
      function scheduleClose(){ closeTimer = setTimeout(function(){ drop.classList.remove('open'); trigger.setAttribute('aria-expanded', 'false'); }, 120); }
      drop.addEventListener('mouseenter', open);
      drop.addEventListener('mouseleave', scheduleClose);
      trigger.addEventListener('click', function(e){
        e.preventDefault();
        if (drop.classList.contains('open')) { drop.classList.remove('open'); trigger.setAttribute('aria-expanded', 'false'); }
        else open();
      });
      var suppressFocusOpen = false;
      trigger.addEventListener('focus', function(){ if (!suppressFocusOpen) open(); });
      // Disclosure keyboard model (Phase 12B-D): ArrowDown from the trigger
      // enters the panel; Up/Down move between links; Escape returns to the
      // trigger without re-opening. Plain Tab keeps its natural order (the
      // panel is in DOM flow).
      function panelLinks(){ return Array.prototype.slice.call(drop.querySelectorAll('.nav-drop-panel a[href]')); }
      function focusTrigger(){ suppressFocusOpen = true; trigger.focus(); suppressFocusOpen = false; }
      trigger.addEventListener('keydown', function(e){
        if (e.key === 'ArrowDown') { e.preventDefault(); e.stopPropagation(); open(); var l = panelLinks(); if (l.length) l[0].focus(); }
      });
      drop.addEventListener('keydown', function(e){
        if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp' && e.key !== 'Escape') return;
        if (e.target === trigger) return;   // handled above
        var l = panelLinks(); var i = l.indexOf(document.activeElement);
        if (e.key === 'Escape') { if (drop.classList.contains('open')) { e.stopPropagation(); closeAllDropdowns(); focusTrigger(); } return; }
        if (i < 0) return;
        e.preventDefault();
        var next = e.key === 'ArrowDown' ? (i + 1) % l.length : (i - 1 + l.length) % l.length;
        l[next].focus();
      });
    });
    document.addEventListener('keydown', function(e){
      if (e.key === 'Escape') closeAllDropdowns();
    });
    document.addEventListener('click', function(e){
      if (!e.target.closest('.nav-drop')) closeAllDropdowns();
    });
    document.addEventListener('focusin', function(e){
      if (!e.target.closest('.nav-drop')) closeAllDropdowns();
    });
  }

  // ── ACTIVE NAV GROUP (per current page) ──
  var PAGE_GROUP = {
    'whale-shark-snorkeling.html': 'experiences',
    'manta-ray-snorkeling.html': 'experiences',
    'things-to-do-maamigili.html': 'experiences',
    'maamigili-guide.html': 'south-ari',
    'south-ari-atoll-guide.html': 'south-ari',
    'best-local-islands-snorkeling.html': 'south-ari',
    'south-ari-vs-other-regions.html': 'south-ari',
    // Phase 12B-D: the planning guides live under the "South Ari" panel
    // (Destination / Planning columns) — the former "Plan Your Trip" group.
    'best-time-to-visit.html': 'south-ari',
    'maldives-holiday-cost.html': 'south-ari',
    'guesthouse-vs-resort.html': 'south-ari',
    'holiday-packages.html': 'packages'
  };
  function initActiveGroup(){
    var path = location.pathname.split('/').pop() || 'index.html';
    var group = PAGE_GROUP[path];
    if (!group) return;
    document.querySelectorAll('[data-nav-group="' + group + '"]').forEach(function(el){
      el.classList.add('nav-active');
    });
  }

  // ── CHECK AVAILABILITY / LIVE AVAILABILITY (consistent cross-page behavior) ──
  // Two distinct, pre-existing homepage entry points are preserved rather than
  // collapsed into one: the fast modal (openBookingPopup, used by the header's
  // "Check Availability" CTA) and the full multi-room browser (openBookingPage,
  // used by "Live Availability" — the direct descendant of the old footer's
  // "Book Direct" link). On any page where the relevant function isn't present
  // (i.e. every page except the homepage), both fall back identically to a
  // plain navigation to /#booking, handled by initBookingHashHandoff() below.
  function initCheckAvailability(){
    document.querySelectorAll('.js-check-availability').forEach(function(el){
      el.addEventListener('click', function(e){
        if (typeof window.trackEvent === 'function') window.trackEvent('availability_click', {source_context: 'navigation'});
        if (typeof window.openBookingPopup === 'function') {
          e.preventDefault();
          window.openBookingPopup();
        }
      });
    });
    document.querySelectorAll('.js-live-availability').forEach(function(el){
      el.addEventListener('click', function(e){
        if (typeof window.trackEvent === 'function') window.trackEvent('availability_click', {source_context: 'navigation'});
        if (typeof window.openBookingPage === 'function') {
          e.preventDefault();
          window.openBookingPage();
        }
      });
    });
  }

  // ── HOMEPAGE-ONLY: auto-open booking popup when arriving via #booking hash ──
  // (e.g. from a guide page's Check Availability link). Only wired if the
  // homepage's booking-popup function is actually present on this page.
  function initBookingHashHandoff(){
    if (typeof window.openBookingPopup !== 'function') return;
    if (location.hash === '#booking') {
      window.openBookingPopup();
    }
  }

  function init(){
    initHeaderScroll();
    initDrawer();
    initDropdowns();
    initActiveGroup();
    initCheckAvailability();
    initBookingHashHandoff();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
