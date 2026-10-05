/* Knaggen (arbeidsnavn Ukeshandel) v0.7.1 — ukeplan for middager + handleliste, delt i husstanden via Firebase.
 * Uten Firebase-oppsett (eller før husstand er opprettet) lagres alt lokalt i nettleseren som før.
 */
(function () {
  'use strict';

  var STORAGE_KEY = 'ukeshandel:v1';
  var HH_KEY = 'ukeshandel:household';            // { hid, secret, core_done, migrated }
  var ONBOARD_KEY = 'ukeshandel:onboarding';      // 'dismissed' = delingstilbudet er avvist («Ikke nå»), vises ikke igjen
  var MIRROR_PREFIX = 'ukeshandel:hh-mirror:';    // siste kjente husstandsdata (rask oppstart)
  var WELCOME_KEY = 'ukeshandel:welcomeDone';     // v0.6.2: '1' = velkomstkortet er lukket / første middag er valgt (per telefon)
  var DATA_VERSION = 1;   // holdes på 1 så eldre app-versjoner ikke nullstiller data
  var SCHEMA = 3;         // intern skjemaversjon for lokale data (migreres ved lasting)
  var AISLES = ['Frukt/grønt', 'Kjøl', 'Frys', 'Tørrvare', 'Hus'];
  var AISLE_LABELS = { 'Hus': 'Husholdning' };
  var UNITS = ['stk', 'g', 'kg', 'ml', 'dl', 'l', 'ss', 'ts', 'pk', 'boks', 'glass', 'beger', 'flaske', 'fedd', 'bunt', 'kartong', 'rull', 'pose'];   // v0.7: kartong/rull/pose sist
  var DAY_NAMES = ['Mandag', 'Tirsdag', 'Onsdag', 'Torsdag', 'Fredag', 'Lørdag', 'Søndag'];
  var DAY_SHORT = ['man', 'tir', 'ons', 'tor', 'fre', 'lør', 'søn'];
  // v0.4.3b: filtervelgeren (Alle / Middag / Faste varer) er fjernet og erstattet av sorteringsvelgeren.
  // v0.4.3c: vises som «Matrett / Plassering» (i den rekkefølgen). De interne verdiene og localStorage-nøkkelen er de
  // samme som i v0.4.3b ('kilde' = Matrett, 'butikk' = Plassering), så lagrede valg beholdes uten migrering.
  // Standard er fortsatt 'butikk' (Plassering), som før.
  var SORTS = [['kilde', 'Matrett', 'Sorter etter matrett'], ['butikk', 'Plassering', 'Sorter etter plassering i butikken']];
  var SORT_KEY = 'ukeshandel:sort';               // 'butikk' | 'kilde' – huskes per telefon, synkes ikke
  var FAST_PREFIX = 'fast:';                      // v0.4.3b: adjust["fast:<fast vare-id>"] = 1 på lista / -1 ikke
  // v0.4.3b: faste varer er med bare når de er valgt for uka. Uker FØR denne datoen (til og med uke 40 2026, uka
  // v0.4.3b ble tatt i bruk) beholder den gamle oppførselen til noen velger: alle aktive faste varer er med, så ingenting
  // forsvinner midt i en handletur. Fra uke 41 er ingen faste varer med før de velges.
  var STAPLES_OPTIN_FROM = '2026-10-05';
  var SUNDAY_EVENING_HOUR = 17;  // fra søndag kl. 17 regnes inneværende uke som «over for i dag»
  var UNDO_MS = 8000;             // hvor lenge «Angre» vises etter «Fjern avkrysning»
  // I Firestore lagres avkrysning som checked[vare] = true (som før, så eldre versjoner forstår den),
  // og mengden varen hadde da den ble krysset av i checked[vare + QTY_SUFFIX] (tall, ellers false).
  var QTY_SUFFIX = '#mengde';

  var U = window.UkeshandelUnits;
  var BASIS_PREFIX = 'basis:';                 // enheter og pakninger (units.js)
  var main = document.getElementById('main');
  var state = null;
  var memoryOnly = false;
  var hadLocalData = false;
  var ui = { weekOffset: 0, weekTouched: false, staplesOpen: false, addOpen: false, welcomeClosed: false, welcomeShown: false, sort: lsGet(SORT_KEY) === 'kilde' ? 'kilde' : 'butikk', notice: '', justCreated: false, busy: false, error: '', fvOpenId: null, fvOpenAisle: null, fvQ: '' };   // v0.7: fv* = faste-varer-siden
  var Sync = window.UkeshandelSync || null;
  var hh = null;             // husstandsinfo når vi er i husstandsmodus
  var syncReady = null;      // promise: SDK lastet, innlogget, medlemskap sjekket
  var syncStatus = { pending: false, fromCache: true, failed: false, connecting: false };
  // v0.6.1 (spec v0.6.1 punkt 5): mens husstanden kobler til første gang (ingen svar fra serveren ennå) vises
  // «Kobler til …», ikke «Frakoblet». Kommer det ikke svar innen CONNECT_GRACE_MS, vises «Frakoblet» som før.
  var CONNECT_GRACE_MS = 10000, connectTimer = null;

  /* ---------- Hjelpere ---------- */

  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }
  function uid(prefix) {
    return prefix + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
  }
  function normName(s) {
    return String(s || '').replace(/[\u200B-\u200D\uFEFF]/g, '').trim().toLowerCase().replace(/\s+/g, ' ');
  }
  function cap(s) {
    s = String(s || '');
    return s.charAt(0).toUpperCase() + s.slice(1);
  }
  function aisleLabel(a) { return AISLE_LABELS[a] || a; }
  function normAisle(a) {
    var n = normName(a);
    if (n === 'hus' || n === 'husholdning' || n === 'hus (ikke mat)') return 'Hus';
    for (var i = 0; i < AISLES.length; i++) if (normName(AISLES[i]) === n) return AISLES[i];
    return 'Tørrvare';
  }
  function parseQty(v) {
    if (v == null) return null;
    v = String(v).trim().replace(',', '.');
    if (v === '') return null;
    var n = Number(v);
    return isFinite(n) && n >= 0 ? n : null;
  }
  function round3(n) { return Math.round(n * 1000) / 1000; }
  function formatQty(q) {
    if (q == null || !isFinite(q)) return '';
    var r = Math.round(q * 100) / 100;
    return String(r).replace('.', ',');
  }
  function pad(n) { return n < 10 ? '0' + n : '' + n; }
  function isoDate(d) { return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate()); }
  function parseIso(s) { var p = s.split('-'); return new Date(+p[0], +p[1] - 1, +p[2]); }
  function mondayOf(d) {
    var m = new Date(d.getFullYear(), d.getMonth(), d.getDate());
    m.setDate(m.getDate() - ((m.getDay() + 6) % 7));
    return m;
  }
  function weekDates(offset) {
    var m = mondayOf(new Date());
    m.setDate(m.getDate() + offset * 7);
    var out = [];
    for (var i = 0; i < 7; i++) out.push(isoDate(new Date(m.getFullYear(), m.getMonth(), m.getDate() + i)));
    return out;
  }
  function isoWeek(d) {
    var t = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()));
    var day = t.getUTCDay() || 7;
    t.setUTCDate(t.getUTCDate() + 4 - day);
    var y0 = new Date(Date.UTC(t.getUTCFullYear(), 0, 1));
    return Math.ceil(((t - y0) / 86400000 + 1) / 7);
  }
  function shortDate(iso) { var d = parseIso(iso); return d.getDate() + '.' + (d.getMonth() + 1) + '.'; }
  function weekLabel(dates) {
    return 'Uke ' + isoWeek(parseIso(dates[0])) + ' · ' + shortDate(dates[0]) + '–' + shortDate(dates[6]);
  }
  function weekHasDinner(offset) {
    return weekDates(offset).some(function (d) { return !!state.oneoffs[d] || !!(state.week_plan[d] && recipeById(state.week_plan[d])); });
  }
  // Ved åpning: inneværende uke, eller neste uke hvis den er planlagt og det er søndag kveld.
  function defaultWeekOffset() {
    var n = new Date();
    return n.getDay() === 0 && n.getHours() >= SUNDAY_EVENING_HOUR && weekHasDinner(1) ? 1 : 0;
  }
  // v0.6.2: stats (Liste: «5 middager · 29 igjen») står i undertittelen, etter «Denne uka»/«Neste uke»/«Til denne uka».
  function weekNav(dates, stats) {
    var tail = stats ? ' · ' + stats : '';
    return '<div class="week-nav">' +
      '<button type="button" class="icon-btn" data-action="week-prev" aria-label="Forrige uke">‹</button>' +
      '<div class="week-title"><h2>' + esc(weekLabel(dates)) + '</h2>' +
      // v0.4.2: «Til denne uka» bare når man er på en annen uke enn denne og neste (neste uke får en rolig etikett).
      (ui.weekOffset === 0 ? '<span class="sub">' + (stats ? '<span>Denne uka</span>' + tail : 'Denne uka') + '</span>'
        : ui.weekOffset === 1 ? '<span class="sub">' + '<span data-testid="neste-uke">Neste uke</span>' + tail + '</span>'
        : '<button type="button" class="linkbtn" data-action="week-now">Til denne uka</button>' + (stats ? '<span class="sub">' + stats + '</span>' : '')) + '</div>' +
      '<button type="button" class="icon-btn" data-action="week-next" aria-label="Neste uke">›</button></div>';
  }
  function dayName(iso) { return DAY_NAMES[(parseIso(iso).getDay() + 6) % 7]; }
  function optionList(values, selected, emptyLabel, labels) {
    var h = emptyLabel != null ? '<option value="">' + esc(emptyLabel) + '</option>' : '';
    var found = false;
    values.forEach(function (v) {
      if (v === selected) found = true;
      h += '<option value="' + esc(v) + '"' + (v === selected ? ' selected' : '') + '>' +
        esc(labels && labels[v] ? labels[v] : v) + '</option>';
    });
    if (selected && !found) h += '<option value="' + esc(selected) + '" selected>' + esc(selected) + '</option>';
    return h;
  }
  function aisleOptions(selected) { return optionList(AISLES, selected, null, AISLE_LABELS); }
  function unitOptions(selected) { return optionList(UNITS, selected, '–'); }
  function lsGet(k) { try { return localStorage.getItem(k); } catch (e) { return null; } }
  function lsSet(k, v) { try { localStorage.setItem(k, v); return true; } catch (e) { return false; } }

  // v0.6.1: toasten ligger rett OVER fanelinja (ikke oppå den), så trykk på fanene alltid bytter fane.
  // action: { label, run } gir en knapp (f.eks. «Angre»). Bare den knappen fanger trykk (CSS pointer-events).
  //
  // v0.6.3 (spec v0.6.3 punkt 1) – generell løsning: toasten ligger aldri oppå noe trykkbart, på noen skjerm.
  //  - Mens toasten vises, ligger den i et eget bånd (#toast-dock): en ugjennomsiktig stripe i full bredde mellom
  //    innholdet og fanelinja (eller en fast lagre-/byttelinje). Båndet er en midlertidig forlengelse av bunnlinja: det
  //    som rulles inn bak det er skjult og kan ikke trykkes (båndet tar trykket og gjør ingenting). Det er dette som gjør
  //    løsningen generell: det finnes ingen skjerm eller rulleposisjon der innhold kan ligge synlig under toasten.
  //  - Siden rulles ikke når båndet kommer (det som var der står stille). Bare hvis elementet brukeren nettopp brukte
  //    (fokus) ville havnet bak båndet, rulles akkurat nok til at det står over det.
  //  - Bunnpolstring (--dock-extra) og scroll-padding (--dock-h/--dock-lift på <html>) gjør at alt kan rulles fram over
  //    båndet, også siste dag/vare/knapp, og at fokus aldri havner bak det.
  //  - «Angre» fanger trykk først når toasten er helt fremme og har stått et øyeblikk (ANGRE_ARM_MS). Et trykk som var på
  //    vei mot noe annet idet toasten dukket opp, treffer båndet – ingenting skjer.
  //  - Mens et ark/vindu (.overlay) er åpent, skjules toast og bånd, og nedtellingen står stille til det lukkes.
  var TOAST_GAP = 8, ANGRE_ARM_MS = 450, TOAST_RESUME_MIN = 3000;
  var toastTimer = null, toastAction = null, armTimer = null, dockOffTimer = null, toastDeadline = 0, toastLeft = null;
  function toastEl() { return document.getElementById('toast'); }
  function dockEl() { return document.getElementById('toast-dock'); }
  function toast(msg, ms, action) {
    var t = toastEl(), dock = dockEl();
    t.textContent = '';
    var m = document.createElement('span');
    m.className = 'toast-msg';
    m.textContent = msg;
    t.appendChild(m);
    toastAction = action || null;
    if (action) {
      var b = document.createElement('button');
      b.type = 'button';
      b.className = 'toast-act';
      b.setAttribute('data-testid', 'toast-angre');
      b.textContent = action.label;
      t.appendChild(b);
    }
    t.classList.remove('armed');
    t.classList.toggle('has-action', !!action);
    clearTimeout(dockOffTimer); clearTimeout(armTimer);
    if (dock) dock.classList.add('show');
    placeToast();
    t.classList.add('show');
    keepFocusClear();
    if (action) armTimer = setTimeout(function () { if (toastAction === action) t.classList.add('armed'); }, ANGRE_ARM_MS);
    // En ny toast starter alltid synlig; modalCheck() skjuler den igjen hvis et ark faktisk er åpent nå. (Uten dette kunne en
    // toast som ble vist mens arket lukket seg i samme øyeblikk – f.eks. «Mer» › «Fjern avkrysning» – arve under-modal og bli usynlig.)
    t.classList.remove('under-modal'); if (dock) dock.classList.remove('under-modal');
    toastLeft = null;
    startToastTimer(ms || 2500);
    modalCheck();
  }
  function startToastTimer(ms) {
    clearTimeout(toastTimer);
    toastDeadline = Date.now() + ms;
    toastTimer = setTimeout(hideToast, ms);
  }
  function hideToast() {
    var t = toastEl(), dock = dockEl();
    clearTimeout(toastTimer); clearTimeout(armTimer);
    toastAction = null; toastLeft = null;
    t.classList.remove('show', 'has-action', 'armed', 'under-modal');
    // Båndet blir stående mens toasten glir ut (0,2 s), så ingenting dukker opp under en halvsynlig toast.
    clearTimeout(dockOffTimer);
    dockOffTimer = setTimeout(function () {
      if (t.classList.contains('show')) return;
      if (dock) dock.classList.remove('show', 'under-modal');
      document.documentElement.style.setProperty('--dock-h', '0px');
      document.documentElement.style.setProperty('--dock-extra', '0px');
    }, 220);
  }
  function toastShowing() { return toastEl().classList.contains('show'); }
  // Båndets plass: rett over fanelinja, eller over den høyeste faste bunnlinja (lagre-linja i skjemaene, byttelinja på
  // Uke) som står der båndet ellers ville ligget. --dock-lift = hvor mye over fanelinja båndet starter.
  function placeToast() {
    var t = toastEl(), nav = document.querySelector('.tabs'), root = document.documentElement;
    if (!nav) return;
    var dockH = Math.max(t.offsetHeight || 0, 48) + 2 * TOAST_GAP;
    var nt = nav.getBoundingClientRect().top, base = nt;
    var bars = main.querySelectorAll('.form-actions:not(.plain), .swap-bar');
    for (var pass = 0; pass < 3; pass++) {
      for (var i = 0; i < bars.length; i++) {
        if (bars[i].offsetParent === null) continue;
        var br = bars[i].getBoundingClientRect();
        if (br.height && br.bottom > base - dockH && br.top < base) base = Math.floor(br.top);
      }
    }
    var lift = Math.max(0, Math.ceil(nt - base));
    root.style.setProperty('--dock-lift', lift + 'px');
    root.style.setProperty('--dock-h', dockH + 'px');
    root.style.setProperty('--dock-extra', Math.max(0, dockH - 72) + 'px');
  }
  // Står elementet brukeren nettopp brukte (fokus) bak båndet, rulles det akkurat fram over det. Ellers står siden stille.
  function keepFocusClear() {
    var a = document.activeElement;
    if (!a || a === document.body || a === main || !main.contains(a)) return;
    var dock = dockEl(); if (!dock) return;
    var top = dock.getBoundingClientRect().top, r = a.getBoundingClientRect();
    if (r.height && r.bottom > top - 4) window.scrollBy(0, Math.ceil(r.bottom - top + TOAST_GAP));
  }
  var placeQueued = false;
  function queuePlaceToast() {
    if (placeQueued || !toastShowing()) return;
    placeQueued = true;
    requestAnimationFrame(function () { placeQueued = false; if (toastShowing()) placeToast(); });
  }
  window.addEventListener('scroll', queuePlaceToast, { passive: true });
  window.addEventListener('resize', queuePlaceToast);
  // Ark og vinduer (.overlay i <body>): skjul toast + bånd og stopp nedtellingen; fortsett (minst 3 s) når de lukkes.
  function modalCheck() {
    var t = toastEl(), dock = dockEl();
    var open = !!document.querySelector('body > .overlay:not([hidden])');
    if (!toastShowing()) return;
    if (open && toastLeft === null) {
      toastLeft = Math.max(0, toastDeadline - Date.now());
      clearTimeout(toastTimer);
      t.classList.add('under-modal'); if (dock) dock.classList.add('under-modal');
    } else if (!open && toastLeft !== null) {
      var left = Math.max(toastLeft, TOAST_RESUME_MIN);
      toastLeft = null;
      t.classList.remove('under-modal'); if (dock) dock.classList.remove('under-modal');
      placeToast();
      startToastTimer(left);
    }
  }
  if (window.MutationObserver) {
    new MutationObserver(modalCheck).observe(document.body, { childList: true });
    // Ny tegning (f.eks. byttelinja eller lagre-linja dukker opp) → båndet plasseres på nytt i neste bilde.
    new MutationObserver(queuePlaceToast).observe(main, { childList: true, subtree: true });
  }
  toastEl().addEventListener('click', function (e) {
    // Bare et trykk på selve «Angre»-knappen i en synlig, helt fremme toast angrer (spec v0.6.1 punkt 1, v0.6.3 punkt 1).
    var a = toastAction, t = toastEl();
    if (!a || !t.classList.contains('show') || !t.classList.contains('armed') || t.classList.contains('under-modal') ||
        !e.target.closest || !e.target.closest('.toast-act')) return;
    hideToast();
    a.run();
  });

  /* ---------- Lokal lagring og migrering ---------- */

  function freshState() {
    var seed = window.UKESHANDEL_SEED();
    return {
      version: DATA_VERSION,
      schema: SCHEMA,
      household: { id: 'h1', name: 'Husstanden' },
      recipes: seed.recipes,
      week_plan: {},        // 'YYYY-MM-DD' -> recipe_id | null (tom)
      oneoffs: {},          // 'YYYY-MM-DD' -> engangsmiddag { id, name, ingredients[] }
      staples: seed.staples,
      checks: {},           // week -> { varenøkkel: true }
      list_items: [],       // generert handleliste (week = mandag), beholdt for eldre versjoner
      list_adjust: {},      // week -> { varenøkkel -> endring i mengde (+/-) }
      list_extras: []       // engangsvarer lagt til i lista { id, week, name, qty, unit, aisle }
    };
  }
  function emptyState() {
    var s = freshState();
    s.recipes = []; s.staples = [];
    return s;
  }

  // Oppgraderer lagrede data til gjeldende skjema uten å miste noe.
  function migrate(s, raw) {
    var from = s.schema || 1;
    if (from < SCHEMA && raw) {
      var bk = STORAGE_KEY + ':backup-schema' + from;
      if (!lsGet(bk)) lsSet(bk, raw);
    }
    s.version = DATA_VERSION;
    s.household = s.household || { id: 'h1', name: 'Husstanden' };
    s.recipes = Array.isArray(s.recipes) ? s.recipes : [];
    s.week_plan = s.week_plan && typeof s.week_plan === 'object' ? s.week_plan : {};
    s.oneoffs = s.oneoffs && typeof s.oneoffs === 'object' ? s.oneoffs : {};
    s.staples = Array.isArray(s.staples) ? s.staples : [];
    s.list_items = Array.isArray(s.list_items) ? s.list_items : [];
    s.list_adjust = s.list_adjust && typeof s.list_adjust === 'object' ? s.list_adjust : {};
    s.list_extras = Array.isArray(s.list_extras) ? s.list_extras : [];
    // Eldste v0-format: avkrysning lå i list_items + list_week uten week per vare.
    if (s.list_week) {
      s.list_items.forEach(function (it) { if (!it.week) it.week = s.list_week; });
      delete s.list_week;
    }
    // Skjema 3: avkrysning lagres per uke og vare (checks), avledet fra list_items første gang.
    if (from < 3 || !s.checks || typeof s.checks !== 'object') {
      var checks = s.checks && typeof s.checks === 'object' ? s.checks : {};
      s.list_items.forEach(function (it) {
        if (it && it.week && it.key && it.checked) { (checks[it.week] = checks[it.week] || {})[it.key] = true; }
      });
      s.checks = checks;
    }
    // Avdelinger normaliseres (f.eks. «hus» -> «Hus», som vises som «Husholdning»).
    s.recipes.forEach(function (r) {
      r.ingredients = Array.isArray(r.ingredients) ? r.ingredients : [];
      r.ingredients.forEach(function (i) { i.aisle = normAisle(i.aisle); });
    });
    s.staples.forEach(function (x) { x.aisle = normAisle(x.aisle); });
    s.list_extras.forEach(function (x) { x.aisle = normAisle(x.aisle); });
    Object.keys(s.oneoffs).forEach(function (d) {
      var o = s.oneoffs[d];
      if (!o || !o.name) { delete s.oneoffs[d]; return; }
      o.ingredients = Array.isArray(o.ingredients) ? o.ingredients : [];
      o.ingredients.forEach(function (i) { i.aisle = normAisle(i.aisle); });
    });
    s.list_items.forEach(function (i) { i.aisle = normAisle(i.aisle); });
    s.schema = SCHEMA;
    return s;
  }

  function loadLocal() {
    var raw = null;
    try { raw = localStorage.getItem(STORAGE_KEY); } catch (e) { memoryOnly = true; }
    if (raw) {
      var s = null;
      try { s = JSON.parse(raw); } catch (e) { s = null; }
      if (s && typeof s === 'object' && Array.isArray(s.recipes)) {
        hadLocalData = true;
        state = migrate(s, raw);
        save();
        return state;
      }
      // Uleselige data: ta vare på dem før vi starter på nytt.
      lsSet(STORAGE_KEY + ':corrupt-' + Date.now(), raw);
    }
    state = freshState();
    save();
    return state;
  }
  // v0.4.6: appen åpner rett med startdata. «Egne data» = noe som avviker fra startdataene (retter, faste varer, uker,
  // engangsmiddager, avkrysning, +/-, egne varer). Brukes i tekstene om hva som flyttes inn / tas vare på.
  function meaningful(st) {
    var clean = function (o) { var r = {}; Object.keys(o || {}).sort().forEach(function (k) { if (o[k] && !(typeof o[k] === 'object' && !Object.keys(o[k]).length)) r[k] = o[k]; }); return r; };
    var byWeek = function (o) { var r = {}; Object.keys(o || {}).sort().forEach(function (w) { var c = clean(o[w]); if (Object.keys(c).length) r[w] = c; }); return r; };
    return JSON.stringify([st.recipes, st.staples, clean(st.week_plan), clean(st.oneoffs), byWeek(st.checks), byWeek(st.list_adjust), st.list_extras || []]);
  }
  function hasOwnData() {
    if (hh) return false;
    try { return meaningful(state) !== meaningful(freshState()); } catch (e) { return true; }
  }
  // v0.4.6: «etter første plan» = minst én middag (rett eller engangsmiddag) i en uke.
  function hasPlan() {
    if (Object.keys(state.oneoffs || {}).some(function (d) { return state.oneoffs[d]; })) return true;
    return Object.keys(state.week_plan || {}).some(function (d) { return state.week_plan[d] && recipeById(state.week_plan[d]); });
  }
  // v0.6.2 (spec v0.6.2 punkt 1): velkomstkortet vises bare for en ny bruker – ingen middag i noen uke, ingen egne data
  // (alt er som startdataene), ikke i husstand, og ikke lukket før. Eksisterende brukere med data ser det aldri, og for
  // dem skrives ingenting nytt i localStorage. Velger en ny bruker sin første middag (kortet har vært vist, eller appen ble
  // installert nå), lagres det at kortet er ferdig, så det aldri kommer tilbake (heller ikke om uka tømmes senere).
  function showWelcome() {
    if (hh || ui.welcomeClosed || lsGet(WELCOME_KEY) === '1') return false;
    if (hasPlan()) {
      if (ui.welcomeShown || !hadLocalData) lsSet(WELCOME_KEY, '1');
      return false;
    }
    if (hasOwnData()) return false;
    ui.welcomeShown = true;
    return true;
  }
  function showShareCard() {
    return !hh && !!syncMode() && lsGet(ONBOARD_KEY) !== 'dismissed' && hasPlan();
  }
  // Lagrer lokalt (bare i lokal modus – i husstandsmodus ligger dataene i Firestore).
  function save() {
    if (memoryOnly || hh) return;
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(state)); }
    catch (e) { memoryOnly = true; toast('Klarte ikke å lagre i nettleseren'); }
  }
  function recipeById(id) {
    for (var i = 0; i < state.recipes.length; i++) if (state.recipes[i].id === id) return state.recipes[i];
    return null;
  }
  function sortedRecipes() {
    return state.recipes.slice().sort(function (a, b) { return a.name.localeCompare(b.name, 'nb'); });
  }
  // wide: også varer lagt til i lista og rettbiblioteket (brukes bare for å gjette avdeling i «Legg til vare»).
  function knownIngredient(name, wide) {
    var n = normName(name);
    if (!n) return null;
    for (var i = 0; i < state.recipes.length; i++) {
      var ings = state.recipes[i].ingredients;
      for (var j = 0; j < ings.length; j++) if (normName(ings[j].name) === n) return ings[j];
    }
    for (var k = 0; k < state.staples.length; k++) if (normName(state.staples[k].name) === n) return state.staples[k];
    if (!wide) return null;
    for (var x = 0; x < state.list_extras.length; x++) if (normName(state.list_extras[x].name) === n) return state.list_extras[x];
    var lib = window.UKESHANDEL_LIBRARY || [];
    for (var l = 0; l < lib.length; l++) {
      var li = lib[l].ingredients || [];
      for (var q = 0; q < li.length; q++) if (normName(li[q].name) === n) return li[q];
    }
    return null;
  }
  // v0.6.1 (spec v0.6.1 punkt 4): innebygd gjetteliste for vanlige varer som ikke står i egne retter, faste varer
  // eller rettbiblioteket. Brukes etter knownIngredient (egne data vinner), før standarden Tørrvare.
  // Appen har ingen egen meieriavdeling: meieri og pålegg går i «Kjøl»; ikke-mat går i «Hus» (vises som «Husholdning»).
  var AISLE_GUESS = [
    // v0.7.1: eksakte treff først (Trude: agurk/paprika/skinke/kaviar/rundstykker/matpakkepapir)
    ['Frukt/grønt', /^(agurk|agurker|paprika|paprikaer)$/],
    ['Kjøl', /^(skinke|kokt skinke|kaviar|macks kaviar|påleggskaviar)$/],
    ['Frys', /^(rundstykker|rundstykke)$/],
    ['Hus', /^(matpakkepapir|matpakke papir|smørbrødpapir|vokspapir)$/],
    ['Hus', /^(tannkrem|tannbørste|tanntråd|munnskyll|bleie|bleier|våtserviett|serviett|tørkerull|kjøkkenrull|dopapir|toalettpapir|papirhåndkle|sjampo|shampo|balsam|såpe|håndsåpe|dusjsåpe|dusjgel|deodorant|deo|bodylotion|solkrem|barberblad|barberhøvel|bind|tampong|truseinnlegg|plaster|vatt|bomullspinner|q-tips|oppvaskmiddel|oppvasktabletter|maskinoppvask|vaskemiddel|tøyvask|tøymykner|flekkfjerner|klut|svamp|grillkull|tennvæske|søppelpose|bæreposer|fryseposer|plastfolie|aluminiumsfolie|bakepapir|matpapir|matpakkepapir|smørbrødpapir|vokspapir|lyspærer|lyspære|batteri|batterier|stearinlys|telys|fyrstikker|kattesand|kattemat|hundemat)$/],
    ['Hus', /(tannkrem|bleier|bleie|såpe|sjampo|vaskemiddel|oppvask|søppelpose|serviett|tørkerull|dopapir|batteri)/],
    // v0.6.3 (spec v0.6.3 punkt 3): frysevarer før Kjøl-reglene, så «frossen …»/«frosne …» og frysepizza alltid går i Frys.
    // (Frys har vært en avdeling siden v0, så eldre versjoner viser disse varene under Frys som før.)
    ['Frys', /^(rundstykker|rundstykke|grandiosa|grandiosa .*|.* grandiosa|big one|big one .*|frysepizza|frossenpizza|frossen pizza|pizza|dypfryst pizza|fiskepinner|fiskepinne|fiskeburger|fiskeburgere|fiskegrateng|fiskeboller frosne|pommes frites|pommes|potetbåter|rösti|frosne bær|frosne grønnsaker|grønnsaksblanding|wokgrønnsaker|wokblanding|frosne erter|erter|maiskorn frosne|frossen spinat|is|iskrem|isbiter|ispinner|ispinne|saftis|kroneis|sorbet|softis|nuggets|kyllingnuggets|vårruller|kyllingvinger frosne)$/],
    ['Frys', /(^|\s)(frossen|frosne|frosset|fryst|dypfryst)(\s|$)|grandiosa|frysepizza|frossenpizza|fiskepinne|iskrem|(vanilje|sjokolade|jordbær|familie|pinne|saft|mango|kokos|nøtte|krone)-?is$/],
    ['Kjøl', /^(yoghurt|yogurt|kefir|kulturmelk|cultura|skyr|kesam|kvarg|crème fraîche|creme fraiche|smøreost|kremost|brunost|geitost|gulost|norvegia|jarlsberg|ost|mozzarella|fetaost|feta|pålegg|leverpostei|servelat|salami|skinke|kaviar|juice|appelsinjuice|eplejuice|smoothie|syrnet melk|sjokolademelk|iskaffe)$/],
    ['Kjøl', /(yoghurt|kefir|skyr|kesam|kvarg|ost$|melk$|pålegg|postei)/],
    ['Frys', /^(is|iskrem|isbiter|frossenpizza|frossen pizza|frosne bær|frosne grønnsaker|fiskegrateng|pommes frites)$/],
    ['Frukt/grønt', /^(eple|epler|pære|pærer|appelsin|appelsiner|klementin|klementiner|mandarin|mandariner|druer|banan|kiwi|mango|melon|vannmelon|ananas|jordbær|bringebær|blåbær|plommer|nektarin|fersken|lime|salat|tomater|tomat|agurk|agurker|paprika|grønnkål|reddik|bønnespirer|urter|gulrot|gulrøtter|løk|rødløk)$/],
    // v0.7.1 (Trude): flere vanlige gjettebommer
    ['Kjøl', /^(skinke|kokt skinke|skinke i skiver|kaviar|macks kaviar|påleggskaviar|leverpostei|servelat|salami|bacon)$/],
    ['Frys', /^(rundstykker|rundstykke|baguetter|ciabatta)$/],   // v0.7.1: pizzabunn forblir Tørrvare (v0.6.3)
    ['Hus', /^(matpakkepapir|matpakke papir|smørbrødpapir|smørbrødpapir|vokspapir)$/]
  ];
  function guessAisle(name) {
    var n = normName(name);
    if (!n) return null;
    for (var i = 0; i < AISLE_GUESS.length; i++) if (AISLE_GUESS[i][1].test(n)) return AISLE_GUESS[i][0];
    return null;
  }
  // v0.7 (spec v0.7 / Merkevare 4.1): duplikatnøkkel – enkelt flertall, så tomat/tomater og bleie/bleier er samme vare.
  function singularStem(s) {
    s = String(s || '');
    if (/ene$/.test(s) && s.length >= 6) return s.slice(0, -3);
    if (/er$/.test(s) && s.length >= 5) return s.slice(0, -2);
    if (/e$/.test(s) && s.length >= 4) return s.slice(0, -1);
    return s;
  }
  function stapleKey(name) { return singularStem(normName(name)); }
  function findStapleByKey(name, exceptId) {
    var k = stapleKey(name);
    if (!k) return null;
    for (var i = 0; i < state.staples.length; i++) {
      var s = state.staples[i];
      if (exceptId && s.id === exceptId) continue;
      if (stapleKey(s.name) === k) return s;
    }
    return null;
  }
  // v0.7 (Merkevare 4.5): enhetsgjetting for nye faste varer / «Legg til vare». Første treff vinner.
  var UNIT_GUESS = [
    ['l', /^(melk|helmelk|lettmelk|skummet melk|skummetmelk)$/],
    ['kartong', /^(juice|appelsinjuice|eplejuice|fløte|matfløte|matflote)$/],
    ['beger', /^(yoghurt|yogurt|rømme|romme|kesam|skyr|kremost|cottage cheese|cottage)$/],
    ['flaske', /^(oppvaskmiddel|vaskemiddel|tøymykner|toymykner|sjampo|balsam|håndsåpe|handsape|dusjsåpe|dusjsape|såpe|sape|olje|olivenolje|saft|ketchup)$/],
    ['rull', /^(søppelposer|soppelposer|bakepapir|plastfolie|aluminiumsfolie|matpapir)$/],
    ['pose', /^(poteter|gulrøtter|gulrotter|løk|lok|klementiner|mandariner|frosne bær|frosne grønnsaker|rundstykker|boller|chips|nøtter|notter)$/],
    ['boks', /^(hermetiske tomater|tomatbokser|mais|tunfisk|makrell i tomat|kidneybønner|kidneybonner)$/],
    ['pk', /^(dopapir|tørkerull|torkerull|bleier|bleie|våtservietter|vatservietter|kaffe|te|havregryn|pasta|ris|knekkebrød|knekkebrod|smør|smor|pålegg|palegg)$/]
  ];
  function guessUnit(name, aisle) {
    var n = normName(name);
    if (!n) return 'stk';
    for (var i = 0; i < UNIT_GUESS.length; i++) if (UNIT_GUESS[i][1].test(n)) return UNIT_GUESS[i][0];
    var a = aisle || guessAisle(name) || 'Tørrvare';
    return (a === 'Tørrvare' || a === 'Hus') ? 'pk' : 'stk';
  }
  function unitWord(qty, unit) {
    // v0.7.1: «2 bokser», «1 glass»
    if (!unit) return '';
    var n = Number(qty);
    if (!(n > 1)) return unit;
    var plur = { boks: 'bokser', glass: 'glass', pk: 'pk', pose: 'poser', rull: 'ruller', kartong: 'kartonger',
      flaske: 'flasker', beger: 'beger', fedd: 'fedd', bunt: 'bunter', stk: 'stk' };
    return plur[unit] || unit;
  }
  function stapleAmt(s) {
    var q = s.qty != null && s.qty !== '' ? formatQty(s.qty) : '';
    if (!s.unit) return q;
    return q ? (q + ' ' + unitWord(s.qty, s.unit)) : s.unit;
  }
  // v0.7 (Sigurd 2026-10-05): «Som forrige uke» ser tilbake til siste uke som hadde faste varer (f.eks. etter ferie).
  function lastWeekWithFaste(weekKey) {
    // v0.7.1: bare uker der noen faktisk har valgt (eksplisitt fast:<id>), ikke overgangsuker der alle er «på» via legacy.
    var d = parseIso(weekKey);
    for (var i = 1; i <= 52; i++) {
      var prev = new Date(d.getFullYear(), d.getMonth(), d.getDate() - 7 * i);
      var pk = isoDate(mondayOf(prev));
      var adj = state.list_adjust[pk] || {};
      var explicit = false, anyOn = false;
      for (var j = 0; j < state.staples.length; j++) {
        var v = adj[FAST_PREFIX + state.staples[j].id];
        if (v > 0 || v < 0) explicit = true;
        if (v > 0) anyOn = true;
      }
      if (explicit && anyOn) return pk;
    }
    return null;
  }
  function staplesGrouped(list, aisleOf) {
    aisleOf = aisleOf || function (s) { return normAisle(s.aisle); };
    return AISLES.map(function (a) {
      var items = list.filter(function (s) { return aisleOf(s) === a; })
        .sort(function (x, y) { return String(x.name).localeCompare(y.name, 'nb'); });
      return { aisle: a, items: items };
    }).filter(function (g) { return g.items.length; });
  }
  var ICON_SEARCH = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="10.5" cy="10.5" r="6.5"/><path d="M15.5 15.5L20 20"/></svg>';
  var ICON_PEN = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 20h4L18.5 9.5a2.83 2.83 0 0 0-4-4L4 16v4z"/><path d="M13.5 6.5l4 4"/></svg>';
  var ICON_REPEAT = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M17 1l4 4-4 4"/><path d="M3 11V9a4 4 0 0 1 4-4h14"/><path d="M7 23l-4-4 4-4"/><path d="M21 13v2a4 4 0 0 1-4 4H3"/></svg>';

  function knownNamesDatalist() {
    var names = {};
    state.recipes.forEach(function (x) { x.ingredients.forEach(function (i) { names[normName(i.name)] = 1; }); });
    state.staples.forEach(function (s) { names[normName(s.name)] = 1; });
    return '<datalist id="known-ings">' + Object.keys(names).sort(function (a, b) { return a.localeCompare(b, 'nb'); })
      .map(function (n) { return '<option value="' + esc(n) + '">'; }).join('') + '</datalist>';
  }

  /* ---------- Husstand (Firebase) ---------- */

  function syncMode() { return Sync ? Sync.mode() : null; }
  function readHH() {
    try { var v = JSON.parse(lsGet(HH_KEY) || 'null'); return v && v.hid && v.secret ? v : null; } catch (e) { return null; }
  }
  function writeHH(v) { lsSet(HH_KEY, JSON.stringify(v)); }
  function shareLink() {
    var base = location.href.split('#')[0].split('?')[0];
    return base + '#join=' + hh.hid + '.' + hh.secret;
  }
  function oldestWeek() { return weekDates(-8)[0]; }

  function saveMirror() {
    if (!hh) return;
    clearTimeout(saveMirror.t);
    saveMirror.t = setTimeout(function () {
      lsSet(MIRROR_PREFIX + hh.hid, JSON.stringify({
        recipes: state.recipes, staples: state.staples, week_plan: state.week_plan, oneoffs: state.oneoffs,
        checks: state.checks, list_adjust: state.list_adjust, list_extras: state.list_extras
      }));
    }, 300);
  }
  function loadMirror(hid) {
    var s = emptyState();
    try {
      var m = JSON.parse(lsGet(MIRROR_PREFIX + hid) || 'null');
      if (m) Object.keys(m).forEach(function (k) { if (m[k]) s[k] = m[k]; });
    } catch (e) { /* ignorer */ }
    return s;
  }

  // Bytter til husstandsmodus: viser speilet med én gang, kobler til Firestore i bakgrunnen.
  function enterHousehold(info, initialState) {
    hh = info;
    state = initialState || loadMirror(info.hid);
    swapBusy = false; lastDays = [];
    loadSwaps(info.hid);   // v0.4.4
    syncStatus.fromCache = true; syncStatus.failed = false; syncStatus.connecting = true;
    clearTimeout(connectTimer);
    connectTimer = setTimeout(function () { syncStatus.connecting = false; renderSyncStatus(); }, CONNECT_GRACE_MS);
    renderSyncStatus();
    syncReady = Sync.init().then(function () {
      return Sync.isMember(hh.hid).then(function (m) {
        if (m === false) return Sync.joinHousehold(hh.hid, hh.secret);
      });
    }).then(function () {
      // Flyttingen ble avbrutt etter at husstanden ble opprettet (f.eks. appen ble lukket): fullfør (idempotent).
      if (!hh.migrated && !hh.joined) return createFromLocal(true);
    }).then(function () {
      subscribeHousehold();
      return Sync;
    });
    syncReady.catch(function (e) {
      syncStatus.failed = true; syncStatus.connecting = false;
      renderSyncStatus();
      if (e && e.code === 'permission-denied') toast('Ingen tilgang til husstanden. Åpne invitasjonslenka på nytt.', 5000);
    });
  }

  // Lokalt: checks[uke][vare] = mengde da den ble krysset av (tall) eller true. Se QTY_SUFFIX.
  function toRemoteChecks(map) {
    var o = {};
    Object.keys(map).forEach(function (k) {
      var v = map[k];
      o[k] = !!v;
      o[k + QTY_SUFFIX] = typeof v === 'number' && v > 0 ? v : false;
    });
    return o;
  }
  function remoteChecksByWeek(checks) {
    var o = {};
    Object.keys(checks || {}).forEach(function (w) { o[w] = toRemoteChecks(checks[w] || {}); });
    return o;
  }
  function fromRemoteChecks(m) {
    var c = {};
    Object.keys(m).forEach(function (k) {
      if (k.slice(-QTY_SUFFIX.length) === QTY_SUFFIX) return;
      var v = m[k];
      if (v !== true && !(typeof v === 'number' && v > 0)) return;
      var q = m[k + QTY_SUFFIX];
      c[k] = typeof q === 'number' && q > 0 ? q : (typeof v === 'number' ? v : true);
    });
    return c;
  }

  var unsubscribe = null;
  function subscribeHousehold() {
    if (unsubscribe) unsubscribe();
    unsubscribe = Sync.subscribe(hh.hid, oldestWeek(), {
      recipes: function (docs) {
        state.recipes = docs.map(function (d) {
          return { id: d.id, name: d.name, minutes: d.minutes == null ? null : d.minutes, note: d.note || '',
            ingredients: (d.ingredients || []).map(function (i) {
              var o = { name: i.name, qty: i.qty == null ? null : i.qty, unit: i.unit || '', aisle: normAisle(i.aisle) };
              if (typeof i.basis === 'boolean') o.basis = i.basis;   // v0.4.3
              return o;
            }) };
        });
        remoteChanged();
      },
      staples: function (docs) {
        state.staples = docs.sort(function (a, b) { return (a.order || 0) - (b.order || 0) || String(a.name).localeCompare(b.name, 'nb'); })
          .map(function (d) { return { id: d.id, name: d.name, qty: d.qty == null ? null : d.qty, unit: d.unit || '', aisle: normAisle(d.aisle), active: d.active !== false, order: d.order }; });
        remoteChanged();
      },
      days: function (docs) {
        lastDays = docs;
        applyDays();
        if (!ui.weekTouched && !subscribeHousehold.daysSeen) ui.weekOffset = defaultWeekOffset();
        subscribeHousehold.daysSeen = true;
        remoteChanged();
      },
      lists: function (docs) {
        var ch = {}, adj = {};
        docs.forEach(function (d) {
          var c = {}, a = {};
          c = fromRemoteChecks(d.checked || {});
          Object.keys(d.adjust || {}).forEach(function (k) { if (typeof d.adjust[k] === 'number' && d.adjust[k]) a[k] = round3(d.adjust[k]); });
          ch[d.week] = c; adj[d.week] = a;
        });
        state.checks = ch; state.list_adjust = adj;
        remoteChanged();
      },
      extras: function (docs) {
        state.list_extras = docs.map(function (d) { return { id: d.id, week: d.week, name: d.name, qty: d.qty, unit: d.unit || '', aisle: normAisle(d.aisle), created: d.created }; });
        remoteChanged();
      },
      status: function (st) {
        syncStatus.pending = st.pending; syncStatus.fromCache = st.fromCache; syncStatus.failed = false;
        if (!st.fromCache) syncStatus.connecting = false;
        renderSyncStatus();
        processSwaps();   // v0.4.4: bytter gjort frakoblet kjøres når telefonen er tilkoblet igjen
      },
      error: function (err) {
        if (err && err.code === 'permission-denied' && !subscribeHousehold.retried) {
          subscribeHousehold.retried = true;
          Sync.joinHousehold(hh.hid, hh.secret).then(subscribeHousehold, function () {
            toast('Ingen tilgang til husstanden. Åpne invitasjonslenka på nytt.', 5000);
          });
        }
      }
    });
  }

  function renderSyncStatus() {
    var el = document.getElementById('sync-status');
    if (!el) return;
    if (!hh) { el.hidden = true; return; }
    el.hidden = false;
    var offline = !navigator.onLine || syncStatus.fromCache || syncStatus.failed;
    var pending = syncStatus.pending || swapOverlays.length > 0;   // v0.4.4: bytter i køen
    var txt, cls;
    if (offline && navigator.onLine && !syncStatus.failed && syncStatus.connecting) { txt = 'Kobler til …'; cls = 'connecting'; }
    else if (offline) { txt = pending ? 'Frakoblet · lagres senere' : 'Frakoblet'; cls = 'off'; }
    else if (pending) { txt = 'Lagrer …'; cls = 'pending'; }
    else { txt = 'Delt'; cls = 'ok'; }
    el.textContent = txt;
    el.className = 'sync-status ' + cls;
    el.setAttribute('data-state', cls);
  }
  window.addEventListener('online', renderSyncStatus);
  window.addEventListener('online', function () { processSwaps(); });   // v0.4.4
  window.addEventListener('offline', renderSyncStatus);

  // Skriver til Firestore i rekkefølge når synkroniseringen er klar. Venter ikke på serveren (virker frakoblet).
  function remote(fn) {
    if (!hh || !syncReady) return;
    syncReady.then(function (S) {
      var p = fn(S.write, hh.hid);
      if (p && p.catch) p.catch(function (e) {
        toast(e && e.code === 'permission-denied' ? 'Kunne ikke lagre: ingen tilgang til husstanden' : 'Kunne ikke lagre endringen', 4000);
      });
    }, function () { /* feilen vises i statuslinja */ });
  }

  // Oppdatering fra den andre telefonen: tegn på nytt, men ikke mens noen skriver i et felt.
  var remoteTimer = null, pendingRender = false;
  function remoteChanged() {
    saveMirror();
    clearTimeout(remoteTimer);
    remoteTimer = setTimeout(function () {
      if (isFormRoute()) return;                 // skjemaer tegnes på nytt når man går ut av dem
      if (isTyping()) { pendingRender = true; return; }
      pendingRender = false;
      route();
    }, 60);
  }
  function isFormRoute() {
    var h = location.hash || '';
    return /^#retter\/.+/.test(h) || /^#liste\/faste/.test(h) || /^#uke\/engang\//.test(h) || /^#(husstand|join=)/.test(h);
  }
  function isTyping() {
    if (swipe) return true;                       // ikke tegn på nytt midt i et sveip
    var a = document.activeElement;
    if (!a || !main.contains(a)) return false;
    var tag = a.tagName;
    return tag === 'TEXTAREA' || tag === 'SELECT' || (tag === 'INPUT' && a.type !== 'checkbox');
  }
  main.addEventListener('focusout', function () {
    if (!pendingRender) return;
    setTimeout(function () { if (pendingRender && !isTyping() && !isFormRoute()) { pendingRender = false; route(); } }, 0);
  });

  function createFromLocal(resume) {
    var local = resume ? loadLocalCopy() : state;
    var info = resume ? hh : null;
    return Sync.createHousehold({
      recipes: local.recipes, staples: local.staples, week_plan: local.week_plan, oneoffs: local.oneoffs,
      checks: remoteChecksByWeek(local.checks), list_adjust: local.list_adjust, list_extras: local.list_extras,
      onCore: function (v) {
        if (!resume) writeHH({ hid: v.hid, secret: v.secret, core_done: false, migrated: false });
      },
      onCoreDone: function (v) {
        var cur = readHH() || { hid: v.hid, secret: v.secret };
        cur.core_done = true; writeHH(cur);
        if (hh && hh.hid === v.hid) hh.core_done = true;
      }
    }, info).then(function (v) {
      var cur = readHH() || v;
      cur.core_done = true; cur.migrated = true; writeHH(cur);
      if (hh && hh.hid === v.hid) { hh.core_done = true; hh.migrated = true; }
      return v;
    });
  }
  function loadLocalCopy() {
    try { return migrate(JSON.parse(lsGet(STORAGE_KEY) || 'null') || freshState(), null); } catch (e) { return freshState(); }
  }

  function startCreate() {
    if (ui.busy) return;
    ui.busy = true; ui.error = '';
    renderHousehold();
    // Sikkerhetskopi av lokale data før flytting (originalen i ukeshandel:v1 blir også liggende).
    var raw = lsGet(STORAGE_KEY);
    if (raw && !lsGet(STORAGE_KEY + ':backup-before-household')) lsSet(STORAGE_KEY + ':backup-before-household', raw);
    var snapshot = JSON.parse(JSON.stringify(state));
    ui.movedOwn = hasOwnData();
    Sync.init().then(function () { return createFromLocal(false); }).then(function (v) {
      ui.busy = false; ui.justCreated = true;
      enterHousehold(readHH() || { hid: v.hid, secret: v.secret, core_done: true, migrated: true }, snapshot);
      location.hash = '#husstand';
      renderHousehold();
    }, function (e) {
      ui.busy = false;
      ui.error = errorText(e);
      // Kom vi ikke så langt som å opprette husstanden, fortsetter telefonen lokalt som før.
      var cur = readHH();
      if (cur && !cur.core_done) { try { localStorage.removeItem(HH_KEY); } catch (x) { /* ignorer */ } }
      renderHousehold();
    });
  }

  function startJoin(hid, secret) {
    if (ui.busy) return;
    ui.busy = true; ui.error = '';
    renderJoin(hid, secret);
    Sync.init().then(function () { return Sync.joinHousehold(hid, secret); }).then(function () {
      ui.busy = false;
      var raw = lsGet(STORAGE_KEY);
      if (raw && !lsGet(STORAGE_KEY + ':backup-before-household')) lsSet(STORAGE_KEY + ':backup-before-household', raw);
      if (unsubscribe) { unsubscribe(); unsubscribe = null; }
      var info = { hid: hid, secret: secret, core_done: true, migrated: false, joined: true };
      writeHH(info);
      enterHousehold(info);
      history.replaceState(null, '', location.pathname + location.search + '#uke');
      route();
      toast('Du er med i husstanden');
    }, function (e) {
      ui.busy = false;
      ui.error = e && e.code === 'permission-denied' ? 'Lenka virker ikke. Be om en ny lenke fra den som delte den.' : errorText(e);
      renderJoin(hid, secret);
    });
  }
  function errorText(e) {
    var m = (e && (e.code || e.message)) || '';
    if (/no-server|unavailable|network|timeout/.test(m)) return 'Får ikke kontakt. Sjekk at du har nett og prøv igjen.';
    if (/not-configured/.test(m)) return 'Deling er ikke satt opp ennå.';
    return 'Noe gikk galt (' + m + '). Prøv igjen.';
  }
  function parseJoin(h) {
    var m = /^#join=([A-Za-z0-9]{22,64})\.([A-Za-z0-9]{22,64})$/.exec(h || '');
    return m ? { hid: m[1], secret: m[2] } : null;
  }

  function renderHousehold() {
    var h = '<section class="page" data-page="husstand">';
    if (hh) {
      h += '<div class="page-head"><h2>Husstand</h2></div>';
      if (ui.justCreated) {
        h += '<p class="notice" data-testid="opprettet">Husstanden er opprettet' + (ui.movedOwn ? ', og rettene, uka og lista fra denne telefonen er flyttet inn.' : '.') + '</p>';
      }
      h += '<p>Send denne lenka til den du handler med. Når den åpnes på en annen telefon, ser dere de samme rettene, uka og lista.</p>' +
        '<label class="field"><span>Delingslenke</span><input type="text" id="share-link" readonly value="' + esc(shareLink()) + '"></label>' +
        '<div class="form-actions plain"><button type="button" class="btn primary" data-action="copy-link" data-testid="kopier-lenke">Kopier lenke</button>' +
        '<a class="btn" href="#uke">' + (ui.justCreated ? 'Ferdig' : 'Tilbake') + '</a></div>' +
        '<p class="hint">Alle som har lenka kan se og endre dataene. Del den bare med husstanden.</p>';
    } else if (!syncMode()) {
      h += '<div class="page-head"><h2>Del med husstanden</h2></div><p class="empty">Deling er ikke satt opp ennå.</p><a class="btn" href="#uke">Tilbake</a>';
    } else {
      h += '<div class="page-head"><h2>Del med husstanden</h2></div>' +
        '<p>Opprett en husstand for å dele retter, ukeplan og handleliste. Ingen konto trengs – dere deler en lenke.</p>' +
        '<p class="hint">' + (hasOwnData() ? 'Rettene, ukeplanen og lista på denne telefonen flyttes inn i husstanden.' : 'Husstanden starter med startdataene (retter og faste varer) som er her nå.') + '</p>' +
        (ui.error ? '<p class="form-error" data-testid="feil">' + esc(ui.error) + '</p>' : '') +
        '<div class="form-actions plain"><button type="button" class="btn primary" data-action="create-household" data-testid="opprett"' + (ui.busy ? ' disabled' : '') + '>' +
        (ui.busy ? 'Oppretter …' : 'Opprett husstand') + '</button>' +
        '<a class="btn" href="#uke" data-testid="husstand-tilbake">Tilbake</a></div>' +
        '<p class="hint">Har noen i husstanden allerede opprettet en? Åpne lenka de sendte deg på denne telefonen i stedet.</p>';
    }
    h += '</section>';
    main.innerHTML = h;
  }

  function renderJoin(hid, secret) {
    var h = '<section class="page" data-page="join"><div class="page-head"><h2>Bli med i husstanden</h2></div>';
    if (!syncMode()) {
      h += '<p class="empty">Deling er ikke satt opp ennå.</p><a class="btn" href="#uke">Tilbake</a></section>';
      main.innerHTML = h;
      return;
    }
    h += '<p>Du er invitert til å dele retter, ukeplan og handleliste.</p>';
    if (hh && hh.hid !== hid) h += '<p class="hint">Denne telefonen er allerede med i en annen husstand. Blir du med her, byttes husstanden på denne telefonen.</p>';
    else if (!hh && hasOwnData()) h += '<p class="hint">Det som ligger på denne telefonen nå blir ikke slått sammen, men tas vare på som sikkerhetskopi.</p>';
    if (ui.error) h += '<p class="form-error" data-testid="feil">' + esc(ui.error) + '</p>';
    h += '<div class="form-actions plain"><button type="button" class="btn primary" data-action="join" data-hid="' + esc(hid) + '" data-secret="' + esc(secret) + '" data-testid="bli-med"' + (ui.busy ? ' disabled' : '') + '>' +
      (ui.busy ? 'Kobler til …' : 'Bli med') + '</button><a class="btn" href="#uke">Avbryt</a></div></section>';
    main.innerHTML = h;
  }

  /* ---------- Endringer (lokalt eller i husstanden) ---------- */

  /* ---------- v0.4.4: bytte kvelder ---------- */

  // Innholdet på en dag slik denne telefonen har det, med signatur ('r:<id>' / 'o:<id>' / '') som sync.js sammenligner med.
  function dayEntry(d) {
    var o = state.oneoffs[d];
    if (o) return { date: d, recipe_id: null, oneoff: o, sig: 'o:' + (o.id || o.name) };
    var id = state.week_plan[d] || null;
    return { date: d, recipe_id: id, oneoff: null, sig: id ? 'r:' + id : '' };
  }
  function putDay(d, e) {
    if (e.oneoff) { state.oneoffs[d] = e.oneoff; state.week_plan[d] = null; }
    else { delete state.oneoffs[d]; state.week_plan[d] = e.recipe_id || null; }
  }
  // Husstand: siste dager fra Firestore + bytter som ennå ikke er bekreftet av serveren (vises med en gang, også etter
  // omstart frakoblet). Køen lagres per husstand i localStorage.
  var SWAPQ_PREFIX = 'ukeshandel:swaps:';
  var lastDays = [], swapOverlays = [], swapBusy = false;
  function applyDays() {
    var wp = {}, oo = {};
    lastDays.forEach(function (d) {
      if (d.oneoff && d.oneoff.name) oo[d.date] = { id: d.oneoff.id, name: d.oneoff.name, ingredients: d.oneoff.ingredients || [] };
      else wp[d.date] = d.recipe_id || null;
    });
    state.week_plan = wp; state.oneoffs = oo;
    swapOverlays.forEach(function (ov) { putDay(ov.a, ov.ea); putDay(ov.b, ov.eb); });
  }
  function saveSwaps() { if (hh) lsSet(SWAPQ_PREFIX + hh.hid, JSON.stringify(swapOverlays)); }
  function loadSwaps(hid) {
    try { var q = JSON.parse(lsGet(SWAPQ_PREFIX + hid) || '[]'); swapOverlays = Array.isArray(q) ? q : []; } catch (e) { swapOverlays = []; }
    swapOverlays.forEach(function (ov) { putDay(ov.a, ov.ea); putDay(ov.b, ov.eb); });
  }
  function dropOverlay(ov) { swapOverlays = swapOverlays.filter(function (x) { return x !== ov; }); saveSwaps(); }
  function isOffline() { return !navigator.onLine || syncStatus.fromCache || syncStatus.failed; }
  // Et bytte i husstanden lagres som en transaksjon som leser begge dagene på serveren og bare bytter hvis de fortsatt er
  // slik denne telefonen så dem. Frakoblet venter byttet i køen og kjøres (med samme sjekk) når telefonen er tilkoblet
  // igjen, så et bytte aldri overskriver det en annen telefon har gjort i mellomtiden. Køen kjøres i rekkefølge.
  function remoteSwap(a, b, ca, cb) {
    swapOverlays.push({ a: a, b: b, ea: cb, eb: ca, sa: ca.sig, sb: cb.sig, offline: isOffline() || undefined });
    saveSwaps(); saveMirror(); renderSyncStatus();
    processSwaps();
  }
  function processSwaps() {
    if (swapBusy || !hh || !syncReady || !swapOverlays.length || isOffline()) { renderSyncStatus(); return; }
    swapBusy = true;
    var ov = swapOverlays[0], hid = hh.hid;
    renderSyncStatus();
    syncReady.then(function (S) {
      return S.write.settled().then(function () {
        return S.write.swapDays(hid, { date: ov.a, sig: ov.sa }, { date: ov.b, sig: ov.sb });
      });
    }).then(function () {
      swapBusy = false;
      dropOverlay(ov);
      renderSyncStatus();
      processSwaps();
    }, function (e) {
      swapBusy = false;
      var code = e && e.code;
      if (!hh || hh.hid !== hid || swapOverlays.indexOf(ov) < 0) return;
      if (code === 'unavailable' || code === 'deadline-exceeded' || code === 'failed-precondition' && isOffline()) {
        renderSyncStatus();       // prøver igjen når telefonen er tilkoblet (status-/online-hendelse)
        return;
      }
      dropOverlay(ov);
      applyDays(); saveMirror();
      ui.swap = null;
      toast(code === 'swap-conflict' ? (ov.offline ? 'Byttet du gjorde frakoblet ble ikke lagret – uka ble endret på en annen telefon'
        : 'Uka ble endret på en annen telefon – se over og prøv igjen')
        : code === 'permission-denied' ? 'Kunne ikke lagre: ingen tilgang til husstanden' : 'Kunne ikke bytte kveldene', 5000);
      if (!isFormRoute()) route();
      renderSyncStatus();
      processSwaps();
    });
  }
  // Vanlige endringer av en dag som har et bytte i køen: byttet lagres først som vanlige skrivinger (i rekkefølge),
  // så den nye endringen ikke skjules av byttet eller får byttet til å feile.
  function takeSwapsFor(dates) {
    var hit = swapOverlays.filter(function (ov) { return dates.indexOf(ov.a) >= 0 || dates.indexOf(ov.b) >= 0; });
    if (hit.length) {
      swapOverlays = swapOverlays.filter(function (ov) { return hit.indexOf(ov) < 0; });
      saveSwaps(); renderSyncStatus();
    }
    return hit;
  }
  function writeSwapsPlain(hit, W, hid) {
    hit.forEach(function (ov) {
      W.setDays(hid, [{ date: ov.a, recipe_id: ov.ea.recipe_id, oneoff: ov.ea.oneoff }, { date: ov.b, recipe_id: ov.eb.recipe_id, oneoff: ov.eb.oneoff }]).catch(function () { /* vises som vanlig lagringsfeil */ });
    });
  }

  function dinnerName(d) {
    var o = state.oneoffs[d];
    if (o) return o.name;
    var r = state.week_plan[d] ? recipeById(state.week_plan[d]) : null;
    return r ? r.name : '';
  }
  // Selve byttet fra UI-et: flytter/bytter, viser hva som skjedde med «Angre», og setter fokus på der retten havnet.
  function swapNow(from, to, focusSel) {
    var nf = dinnerName(from), nt = dinnerName(to);
    if (!nf && !nt) return;
    ops.swapDays(from, to);
    ui.swap = null;
    var lf = dayName(from).toLowerCase(), lt = dayName(to).toLowerCase();
    var msg = nf && nt ? nf + ' til ' + lt + ', ' + nt + ' til ' + lf
      : nf ? nf + ' flyttet til ' + lt : nt + ' flyttet til ' + lf;
    var after = { f: dayEntry(from).sig, t: dayEntry(to).sig };
    renderUke();
    focusEl(focusSel || '[data-action="swap-start"][data-date="' + to + '"]', '#day-' + to);
    toast(msg, UNDO_MS, { label: 'Angre', run: function () {
      if (dayEntry(from).sig !== after.f || dayEntry(to).sig !== after.t) { toast('Kan ikke angre – uka er endret siden'); return; }
      ops.swapDays(to, from);
      toast('Byttet tilbake');
      if (main.querySelector('[data-page="uke"]')) {
        renderUke();
        focusEl('[data-action="swap-start"][data-date="' + from + '"]', '#day-' + from);
      } else if (!isFormRoute()) route();
    } });
  }
  function focusEl() {
    for (var i = 0; i < arguments.length; i++) {
      var el = arguments[i] && main.querySelector(arguments[i]);
      if (el) { try { el.focus({ preventScroll: false }); } catch (x) { el.focus(); } return el; }
    }
    return null;
  }
  function startSwap(d) {
    ui.swap = { from: d, sig: dayEntry(d).sig };
    renderUke();
    focusEl('[data-action="swap-to"]');
  }
  function cancelSwap(focusBack) {
    if (!ui.swap) return;
    var d = ui.swap.from;
    ui.swap = null;
    renderUke();
    if (focusBack) focusEl('[data-action="swap-start"][data-date="' + d + '"]', '#day-' + d);
  }

  var ops = {
    saveRecipe: function (r, isNew) {
      if (isNew) state.recipes.push(r);
      save();
      remote(function (W, hid) { return W.setRecipe(hid, r); });
    },
    deleteRecipe: function (id, usedDates) {
      state.recipes = state.recipes.filter(function (x) { return x.id !== id; });
      usedDates.forEach(function (d) { state.week_plan[d] = null; });
      save();
      var hit = takeSwapsFor(usedDates);
      remote(function (W, hid) {
        writeSwapsPlain(hit, W, hid);   // v0.4.4
        var ps = [W.deleteRecipe(hid, id)];
        if (usedDates.length) ps.push(W.setDays(hid, usedDates.map(function (d) { return { date: d, recipe_id: null, oneoff: null }; })));
        return Promise.all(ps);
      });
    },
    // v0.4.4: bytt innholdet (rett / engangsmiddag / tom) mellom to dager. Lokalt straks; i husstanden som en
    // transaksjon som bare bytter hvis dagene fortsatt er som denne telefonen så (se remoteSwap).
    swapDays: function (a, b) {
      var ca = dayEntry(a), cb = dayEntry(b);
      putDay(a, cb); putDay(b, ca);
      save();
      if (hh && syncReady) remoteSwap(a, b, ca, cb);
    },
    // entries: [{ date, recipe_id, oneoff }]
    setDays: function (entries) {
      entries.forEach(function (e) {
        if (e.oneoff) { state.oneoffs[e.date] = e.oneoff; state.week_plan[e.date] = null; }
        else { delete state.oneoffs[e.date]; state.week_plan[e.date] = e.recipe_id || null; }
      });
      save();
      var hit = takeSwapsFor(entries.map(function (e) { return e.date; }));   // v0.4.4
      remote(function (W, hid) {
        writeSwapsPlain(hit, W, hid);
        return W.setDays(hid, entries);
      });
    },
    setChecks: function (week, map) {
      var c = state.checks[week] = state.checks[week] || {};
      Object.keys(map).forEach(function (k) { if (map[k]) c[k] = map[k]; else delete c[k]; });
      state.list_items.forEach(function (i) { if (i.week === week && map.hasOwnProperty(i.key)) i.checked = !!map[i.key]; });
      save();
      remote(function (W, hid) { return W.setChecks(hid, week, toRemoteChecks(map)); });
    },
    adjust: function (week, key, newDelta, change) {
      var m = state.list_adjust[week] = state.list_adjust[week] || {};
      if (newDelta) m[key] = newDelta; else delete m[key];
      save();
      remote(function (W, hid) { return change ? W.incAdjust(hid, week, key, change) : null; });
    },
    // v0.4.3: basisvalg per uke, lagret feltvis i samme lists-dokument som +/- («basis:<vare>» = 1 lagt til, -1 ikke nå).
    setBasis: function (week, map) {
      var m = state.list_adjust[week] = state.list_adjust[week] || {}, r = {};
      Object.keys(map).forEach(function (nn) { m[BASIS_PREFIX + nn] = map[nn]; r[BASIS_PREFIX + nn] = map[nn]; });
      save();
      remote(function (W, hid) { return W.setAdjust(hid, week, r); });
    },
    // v0.4.3b: faste varer valgt for uka, feltvis i samme adjust-kart («fast:<id>» = 1 på lista / -1 ikke).
    setFast: function (week, map) {
      var m = state.list_adjust[week] = state.list_adjust[week] || {}, r = {};
      Object.keys(map).forEach(function (id) { m[FAST_PREFIX + id] = map[id]; r[FAST_PREFIX + id] = map[id]; });
      save();
      remote(function (W, hid) { return W.setAdjust(hid, week, r); });
    },
    clearAdjust: function (week, key) {
      if (state.list_adjust[week]) delete state.list_adjust[week][key];
      save();
      remote(function (W, hid) { return W.clearAdjust(hid, week, key); });
    },
    addExtra: function (x) {
      state.list_extras.push(x);
      save();
      remote(function (W, hid) { return W.addExtra(hid, x); });
    },
    removeExtras: function (ids) {
      state.list_extras = state.list_extras.filter(function (x) { return ids.indexOf(x.id) < 0; });
      save();
      remote(function (W, hid) { return W.deleteExtras(hid, ids); });
    },
    addStaple: function (s) {
      s.order = Date.now();
      state.staples.push(s);
      save();
      remote(function (W, hid) { return W.setStaple(hid, s); });
    },
    updateStaple: function (s, fields) {
      Object.keys(fields).forEach(function (k) { s[k] = fields[k]; });
      save();
      remote(function (W, hid) { return W.updateStaple(hid, s.id, fields); });
    },
    deleteStaple: function (id) {
      state.staples = state.staples.filter(function (s) { return s.id !== id; });
      save();
      remote(function (W, hid) { return W.deleteStaple(hid, id); });
    }
  };

  /* ---------- Router ---------- */

  function route() {
    var raw = location.hash || '';
    var h = raw.replace(/^#\/?/, '');
    var parts = h.split('/');
    var tab = parts[0];
    var join = parseJoin(raw);
    var special = join || tab === 'husstand';
    if (!special && ['retter', 'uke', 'liste'].indexOf(tab) < 0) tab = 'uke';
    var links = document.querySelectorAll('.tabs a');
    for (var i = 0; i < links.length; i++) {
      var on = !special && links[i].getAttribute('data-tab') === tab;
      links[i].classList.toggle('active', on);
      if (on) links[i].setAttribute('aria-current', 'page'); else links[i].removeAttribute('aria-current');
    }
    if (join) {
      if (hh && hh.hid === join.hid) {
        history.replaceState(null, '', location.pathname + location.search + '#uke');
        toast('Du er allerede med i denne husstanden');
        return route();
      }
      return renderJoin(join.hid, join.secret);
    }
    if (tab === 'husstand') return renderHousehold();
    if (tab === 'retter') {
      if (parts[1] === 'ny') renderRecipeForm(null);
      else if (parts[1] && recipeById(decodeURIComponent(parts[1]))) renderRecipeForm(decodeURIComponent(parts[1]));
      else renderRetter();
    } else if (tab === 'uke') {
      if (parts[1] === 'engang' && /^\d{4}-\d\d-\d\d$/.test(parts[2] || '')) renderOneoffForm(parts[2]);
      else renderUke();
    } else if (tab === 'liste') {
      if (parts[1] === 'faste') renderFastePage();
      else renderListe();
    } else renderListe();
  }

  /* ---------- Felles: ingrediensrader ---------- */

  function ingredientRow(ing) {
    ing = ing || { name: '', qty: null, unit: 'stk', aisle: 'Tørrvare' };
    var isB = U.isBasis(ing);
    return '<div class="ing-row" data-new="' + (ing.name ? '0' : '1') + '">' +
      '<div class="ing-top"><input class="ing-name" type="text" placeholder="Ingrediens" aria-label="Ingrediens" value="' + esc(ing.name) + '" autocomplete="off" list="known-ings">' +
      // v0.4.3: basisvare (krydder, mel, olje o.l.) legges ikke rett på lista. Standard fra tabellen, kan endres her.
      '<label class="ing-basis" title="Basisvare: legges ikke rett på lista, men i basisvare-meldingen på Liste">' +
      '<input type="checkbox" class="ing-basis-cb"' + (isB ? ' checked' : '') + (typeof ing.basis === 'boolean' ? ' data-touched="1"' : '') + '> Basis</label></div>' +
      '<div class="ing-sub">' +
      '<input class="ing-qty" type="text" inputmode="decimal" placeholder="Mengde" aria-label="Mengde" value="' + esc(formatQty(ing.qty)) + '">' +
      '<select class="ing-unit" aria-label="Enhet">' + unitOptions(ing.unit) + '</select>' +
      '<select class="ing-aisle" aria-label="Avdeling">' + aisleOptions(ing.aisle) + '</select>' +
      '<button type="button" class="icon-btn" data-action="remove-ing" aria-label="Fjern ingrediens">✕</button>' +
      '</div></div>';
  }
  function ingredientsFieldset(ings) {
    var h = '<fieldset class="ings"><legend>Ingredienser</legend><div id="ing-list">';
    (ings || []).forEach(function (i) { h += ingredientRow(i); });
    if (!ings || !ings.length) h += ingredientRow(null);
    h += '</div><button type="button" class="btn" data-action="add-ing">+ Ingrediens</button></fieldset>';
    return h + knownNamesDatalist();
  }
  function readIngredients(form) {
    var out = [];
    var rows = form.querySelectorAll('.ing-row');
    for (var i = 0; i < rows.length; i++) {
      var n = rows[i].querySelector('.ing-name').value.trim();
      if (!n) continue;
      var ing = {
        name: n,
        qty: parseQty(rows[i].querySelector('.ing-qty').value),
        unit: rows[i].querySelector('.ing-unit').value,
        aisle: rows[i].querySelector('.ing-aisle').value
      };
      var bcb = rows[i].querySelector('.ing-basis-cb');
      if (bcb && bcb.checked !== U.isBasisName(n)) ing.basis = bcb.checked;   // lagres bare når det avviker fra tabellen
      out.push(ing);
    }
    return out;
  }
  function formError(msg, focusId) {
    var err = document.getElementById('form-error');
    err.textContent = msg;
    err.hidden = false;
    if (focusId) document.getElementById(focusId).focus();
  }

  /* ---------- Retter ---------- */

  /* ---------- Bakgrunnsbibliotek (v0.3) ---------- */

  var LIBRARY = window.UKESHANDEL_LIBRARY || [];
  function libById(id) {
    for (var i = 0; i < LIBRARY.length; i++) if (LIBRARY[i].id === id) return LIBRARY[i];
    return null;
  }
  // Bibliotekretter som ikke allerede er blant våre retter (samme id «lib-<id>» eller samme navn).
  function libCandidates() {
    var names = {};
    state.recipes.forEach(function (r) { names[normName(r.name)] = true; });
    return LIBRARY.filter(function (x) { return !recipeById('lib-' + x.id) && !names[normName(x.name)]; })
      .map(function (x) { return x.id; });
  }
  // Én tilfeldig rekkefølge per økt, så «forrige» faktisk går tilbake. lib.idx = plass i rekkefølgen for kortet som vises.
  var lib = { order: null, idx: 0, anim: '', lastSwipe: 0 };
  function libOrder() {
    if (!lib.order) {
      var a = LIBRARY.map(function (x) { return x.id; });
      for (var i = a.length - 1; i > 0; i--) { var j = Math.floor(Math.random() * (i + 1)); var t = a[i]; a[i] = a[j]; a[j] = t; }
      lib.order = a;
    }
    return lib.order;
  }
  // Kortet som vises: første aktuelle rett fra lib.idx og utover (rundt). Er den lagt til, vises neste.
  function libView() {
    var order = libOrder(), ok = {};
    libCandidates().forEach(function (id) { ok[id] = true; });
    var cands = order.filter(function (id) { return ok[id]; });
    if (!cands.length) return { cands: cands, pos: -1, id: null };
    var n = order.length, cur = null;
    for (var k = 0; k < n; k++) {
      var id = order[(lib.idx + k) % n];
      if (ok[id]) { cur = id; lib.idx = (lib.idx + k) % n; break; }
    }
    return { cands: cands, pos: cands.indexOf(cur), id: cur };
  }
  function stepSuggestion(dir) {
    var v = libView();
    if (v.cands.length < 2) return false;
    var id = v.cands[(v.pos + dir + v.cands.length) % v.cands.length];
    lib.idx = libOrder().indexOf(id);
    lib.anim = dir > 0 ? ' from-right' : ' from-left';
    refreshSuggestCard();
    return true;
  }
  function renderSuggestions() {
    if (!LIBRARY.length) return '';
    var v = libView();
    var h = '<section class="suggest" data-testid="forslag" aria-label="Forslag til nye retter">';
    if (!v.id) {
      return h + '<div class="suggest-head"><h3>Forslag til nye retter</h3></div>' +
        '<p class="hint" data-testid="forslag-tomt">Dere har alle ' + LIBRARY.length + ' rettene fra biblioteket.</p></section>';
    }
    var x = libById(v.id), many = v.cands.length > 1;
    var meta = (x.minutes ? x.minutes + ' min · ' : '') + x.ingredients.map(function (i) { return i.name; }).join(', ');
    h += '<div class="suggest-head"><h3>Forslag til nye retter</h3><div class="suggest-nav">' +
      (many ? '<button type="button" class="nav-arrow" data-action="lib-prev" data-testid="forrige-forslag" aria-label="Forrige forslag">‹</button>' : '') +
      '<span class="suggest-pos" data-testid="forslag-pos" role="status" aria-label="Forslag ' + (v.pos + 1) + ' av ' + v.cands.length + '">' + (v.pos + 1) + ' / ' + v.cands.length + '</span>' +
      (many ? '<button type="button" class="nav-arrow" data-action="lib-next" data-testid="neste-forslag" aria-label="Neste forslag">›</button>' : '') +
      '</div></div>';
    h += '<div class="card suggest-card' + lib.anim + '" data-lib-id="' + esc(x.id) + '" tabindex="0" role="group" aria-roledescription="forslag"' +
      ' aria-label="' + esc(x.name) + (many ? '. Sveip eller bruk piltastene for neste og forrige forslag.' : '') + '">' +
      '<div class="suggest-main"><span class="suggest-title">' + esc(x.name) + '</span>' +
      '<span class="suggest-meta">' + esc(meta) + '</span></div>' +
      '<button type="button" class="btn small primary" data-action="lib-add" data-lib-id="' + esc(x.id) + '" data-testid="legg-til" aria-label="Legg til ' + esc(x.name) + ' i våre retter">Legg til</button>' +
      '</div></section>';
    lib.anim = '';
    return h;
  }
  // Tegn bare forslagsdelen på nytt (siden og rullingen står i ro); behold fokus på samme knapp/kort.
  function refreshSuggestCard() {
    var el = main.querySelector('.suggest');
    if (!el) { renderRetter(); return; }
    var a = document.activeElement, keep = null;
    if (a && el.contains(a)) keep = a.getAttribute('data-action') ? '[data-action="' + a.getAttribute('data-action') + '"]' : (a.classList.contains('suggest-card') ? '.suggest-card' : null);
    el.outerHTML = renderSuggestions();
    if (keep) { var n = main.querySelector('.suggest ' + keep) || main.querySelector('.suggest-card'); if (n) n.focus(); }
  }

  // Sveip på forslagskortet: retningen avgjøres etter 10 px; loddrett bevegelse er vanlig rulling og endrer ikke kortet.
  var swipe = null;
  main.addEventListener('touchstart', function (e) {
    var card = e.target.closest && e.target.closest('.suggest-card');
    if (!card || e.touches.length !== 1) { swipe = null; return; }
    swipe = { x: e.touches[0].clientX, y: e.touches[0].clientY, dir: null, dx: 0, card: card, onBtn: !!e.target.closest('[data-action="lib-add"]') };
  }, { passive: true });
  main.addEventListener('touchmove', function (e) {
    if (!swipe || e.touches.length !== 1) return;
    var dx = e.touches[0].clientX - swipe.x, dy = e.touches[0].clientY - swipe.y;
    if (!swipe.dir) {
      if (Math.abs(dx) < 10 && Math.abs(dy) < 10) return;
      swipe.dir = Math.abs(dx) > Math.abs(dy) * 1.2 ? 'h' : 'v';
    }
    if (swipe.dir !== 'h') return;
    if (e.cancelable) e.preventDefault();
    swipe.dx = dx;
    swipe.card.style.transition = 'none';
    swipe.card.style.transform = 'translateX(' + Math.round(dx * 0.9) + 'px)';
    swipe.card.style.opacity = String(Math.max(0.35, 1 - Math.abs(dx) / 300));
  }, { passive: false });
  function endSwipe() {
    var s = swipe;
    swipe = null;
    if (s && s.dir === 'h') {
      lib.lastSwipe = s.onBtn ? Date.now() : 0;   // et sveip som startet på «Legg til» skal aldri legge til
      var done = Math.abs(s.dx) >= 50 && stepSuggestion(s.dx < 0 ? 1 : -1);
      if (!done) { s.card.style.transition = ''; s.card.style.transform = ''; s.card.style.opacity = ''; }
    }
    if (pendingRender && !isTyping() && !isFormRoute()) { pendingRender = false; route(); }
  }
  main.addEventListener('touchend', endSwipe);
  main.addEventListener('touchcancel', endSwipe);
  main.addEventListener('keydown', function (e) {
    if (!e.target.classList || !e.target.classList.contains('suggest-card')) return;
    if (e.key === 'ArrowRight' || e.key === 'ArrowLeft') { e.preventDefault(); stepSuggestion(e.key === 'ArrowRight' ? 1 : -1); }
  });
  function addFromLibrary(id) {
    var x = libById(id);
    if (!x) return;
    if (recipeById('lib-' + id) || libCandidates().indexOf(id) < 0) { toast('«' + x.name + '» finnes allerede i rettene'); renderRetter(); return; }
    ops.saveRecipe({
      id: 'lib-' + x.id, name: x.name, minutes: x.minutes || null, note: x.note || '',
      ingredients: x.ingredients.map(function (i) { return { name: i.name, qty: i.qty, unit: i.unit, aisle: normAisle(i.aisle) }; })
    }, true);
    lib.anim = ' from-right';
    toast('«' + x.name + '» er lagt til i rettene');
    renderRetter();
  }

  function renderRetter() {
    var rs = sortedRecipes();
    var h = '<section class="page" data-page="retter">';
    h += '<div class="page-head"><h2>Retter <span class="count">' + rs.length + '</span></h2>' +
      '<a class="btn primary" href="#retter/ny" data-testid="ny-rett">+ Ny rett</a></div>';
    h += renderSuggestions();
    if (rs.length) h += '<h3 class="section-title">Våre retter</h3>';
    if (!rs.length) h += '<p class="empty">Ingen retter ennå. Legg til rettene dere faktisk lager.</p>';
    h += '<ul class="cards">';
    rs.forEach(function (r) {
      var meta = [];
      if (r.minutes) meta.push(r.minutes + ' min');
      meta.push(r.ingredients.length + (r.ingredients.length === 1 ? ' ingrediens' : ' ingredienser'));
      h += '<li><a class="card recipe-card" href="#retter/' + encodeURIComponent(r.id) + '">' +
        '<span class="card-title">' + esc(r.name) + '</span>' +
        '<span class="card-meta">' + esc(meta.join(' · ')) + '</span>' +
        (r.note ? '<span class="card-note">' + esc(r.note) + '</span>' : '') +
        '</a></li>';
    });
    h += '</ul>';
    h += '<div class="footer-tools">';
    if (hh) h += '<a class="linkbtn" href="#husstand" data-testid="husstand-lenke">Husstand og delingslenke</a>';
    else {
      if (syncMode()) h += '<a class="linkbtn" href="#husstand" data-testid="husstand-lenke">Del med husstanden</a><br>';
      h += '<button type="button" class="linkbtn" data-action="reset-seed">Tilbakestill testdata</button>';
    }
    if (memoryOnly && !hh) h += '<p class="warn">Nettleseren tillater ikke lagring – endringer forsvinner når du lukker siden.</p>';
    h += '</div></section>';
    main.innerHTML = h;
  }

  function renderRecipeForm(id) {
    var r = id ? recipeById(id) : null;
    var h = '<section class="page" data-page="rett-skjema">';
    h += '<div class="page-head"><a class="back" href="#retter">‹ Retter</a><h2>' + (r ? 'Rediger rett' : 'Ny rett') + '</h2></div>';
    h += '<form id="recipe-form" data-id="' + esc(r ? r.id : '') + '" novalidate>';
    h += '<label class="field"><span>Navn</span><input id="f-name" type="text" required value="' + esc(r ? r.name : '') + '" placeholder="F.eks. Fiskesuppe"></label>';
    h += '<label class="field"><span>Tid (minutter)</span><input id="f-minutes" type="number" inputmode="numeric" min="0" step="1" value="' + esc(r && r.minutes != null ? r.minutes : '') + '" placeholder="30" aria-describedby="f-minutes-hint"></label>' +
      '<p class="field-hint" id="f-minutes-hint">«Fyll man–fre» velger helst retter på ' + RASK_MIN + ' min eller mindre.</p>';   // v0.4.5
    h += '<label class="field"><span>Merknad (valgfri)</span><input id="f-note" type="text" value="' + esc(r ? r.note || '' : '') + '" placeholder="F.eks. unger spiser dette"></label>';
    h += ingredientsFieldset(r ? r.ingredients : []);
    h += '<p class="form-error" id="form-error" hidden></p>';
    h += '<div class="form-actions"><button type="submit" class="btn primary" data-testid="lagre">Lagre</button>' +
      '<a class="btn" href="#retter">Avbryt</a>' +
      (r ? '<button type="button" class="btn danger" data-action="delete-recipe">Slett</button>' : '') + '</div>';
    h += '</form></section>';
    main.innerHTML = h;
    if (!r) document.getElementById('f-name').focus();
  }

  function saveRecipeForm(form) {
    var name = document.getElementById('f-name').value.trim();
    if (!name) return formError('Retten må ha et navn.', 'f-name');
    var minutesRaw = document.getElementById('f-minutes').value.trim();
    var minutes = minutesRaw === '' ? null : Math.max(0, Math.round(Number(minutesRaw.replace(',', '.')) || 0));
    var ingredients = readIngredients(form);
    var id = form.getAttribute('data-id');
    var note = document.getElementById('f-note').value.trim();
    var r = id ? recipeById(id) : null;
    if (r) {
      r.name = name; r.minutes = minutes; r.note = note; r.ingredients = ingredients;
      ops.saveRecipe(r, false);
    } else {
      ops.saveRecipe({ id: uid('r'), name: name, minutes: minutes, note: note, ingredients: ingredients }, true);
    }
    toast(r ? 'Lagret' : 'Rett lagt til');
    location.hash = '#retter';
  }

  function deleteRecipe(id) {
    var r = recipeById(id);
    if (!r) return;
    var used = Object.keys(state.week_plan).filter(function (d) { return state.week_plan[d] === id; });
    var msg = 'Slette «' + r.name + '»?' + (used.length ? ' Den fjernes også fra ukeplanen.' : '');
    if (!window.confirm(msg)) return;
    ops.deleteRecipe(id, used);
    toast('Rett slettet');
    location.hash = '#retter';
  }

  /* ---------- Uke ---------- */

  function renderUke() {
    var dates = weekDates(ui.weekOffset);
    var today = isoDate(new Date());
    var rs = sortedRecipes();
    var usedBy = {}; // recipe_id -> dagindeks
    var count = 0;
    dates.forEach(function (d, i) {
      var id = state.week_plan[d];
      if (state.oneoffs[d]) count++;
      else if (id && recipeById(id)) { usedBy[id] = i; count++; }
    });
    var emptyWeekdays = dates.slice(0, 5).filter(function (d) {
      return !state.oneoffs[d] && !(state.week_plan[d] && recipeById(state.week_plan[d]));
    }).length;
    // v0.4.4: byttemodus gjelder bare mens kilde-dagen er i uka som vises og fortsatt har middag.
    if (ui.swap && (dates.indexOf(ui.swap.from) < 0 || !dinnerName(ui.swap.from))) ui.swap = null;
    // Endret en annen telefon kilde-dagen mens vi valgte? Avbryt heller enn å bytte noe annet enn det som ble valgt.
    if (ui.swap && dayEntry(ui.swap.from).sig !== ui.swap.sig) {
      toast(dayName(ui.swap.from) + ' ble endret på en annen telefon – byttet er avbrutt', 4000);
      ui.swap = null;
    }
    var swapFrom = ui.swap ? ui.swap.from : null;
    var swapName = swapFrom ? dinnerName(swapFrom) : '';
    var swapDay = swapFrom ? dayName(swapFrom).toLowerCase() : '';
    // Knappen til høyre på hver dag: «Bytt» (dag med middag), i byttemodus «Bytt hit» / «Flytt hit» / «Avbryt».
    function swapBtn(d, name) {
      var dn = dayName(d).toLowerCase();
      if (swapFrom === d) return '<button type="button" class="btn small swap-btn is-from" data-action="swap-cancel" data-date="' + d + '" aria-pressed="true" aria-label="Avbryt bytting av ' + esc(name) + '">Avbryt</button>';
      if (swapFrom) return '<button type="button" class="btn small swap-btn swap-to" data-action="swap-to" data-date="' + d + '" data-testid="bytt-hit" aria-describedby="swap-hint" aria-label="' +
        esc(name ? 'Bytt ' + swapName + ' (' + swapDay + ') med ' + name + ' (' + dn + ')' : 'Flytt ' + swapName + ' til ' + dn) + '">' + (name ? '⇅ Bytt hit' : '→ Flytt hit') + '</button>';
      return name ? '<button type="button" class="btn small swap-btn" data-action="swap-start" data-date="' + d + '" data-testid="bytt" aria-label="Bytt ' + esc(name) + ' (' + dn + ') med en annen dag">⇅ Bytt</button>' : '';
    }

    var h = '<section class="page' + (swapFrom ? ' swapping' : '') + '" data-page="uke">';
    // v0.6.2 (spec v0.6.2 punkt 1): kort velkomst øverst i Uke, bare før første middag er valgt.
    if (showWelcome()) {
      h += '<section class="welcome" aria-label="Velkommen" data-testid="velkomst">' +
        '<p class="welcome-t">Velg middager for uka, så lager handlelista seg selv.</p>' +
        '<p class="welcome-tag">Husets felles huskeliste</p>' +
        '<button type="button" class="welcome-x" data-action="welcome-close" data-testid="velkomst-lukk" aria-label="Lukk velkomsten">×</button></section>';
    }
    h += weekNav(dates);
    h += '<div class="week-tools"><p class="summary" data-testid="uke-oppsummering">' + count + ' av 7 kvelder har middag</p>' +
      '<button type="button" class="btn small" data-action="fill-weekdays" data-testid="fyll"' + (emptyWeekdays ? '' : ' disabled') + '>Fyll man–fre</button></div>';
    if (ui.notice) { h += '<p class="notice" role="status" data-testid="uke-notis">' + esc(ui.notice) + '</p>'; ui.notice = ''; }
    h += '<ol class="days">';
    dates.forEach(function (d, i) {
      var o = state.oneoffs[d];
      var sel = state.week_plan[d];
      var r = !o && sel ? recipeById(sel) : null;
      var dn = o ? o.name : r ? r.name : '';
      h += '<li class="day' + (d === today ? ' today' : '') + (r || o ? '' : ' is-empty') + (o ? ' has-oneoff' : '') +
        (swapFrom === d ? ' swap-from' : swapFrom ? ' swap-target' : '') + '" data-date="' + d + '">' +
        '<label for="day-' + d + '" class="day-label"><span class="dname">' + DAY_NAMES[i] + '</span>' +
        '<span class="ddate">' + shortDate(d) + (d === today ? ' · i dag' : '') + '</span></label>';
      if (o) {
        h += '<div class="oneoff"><span class="badge">Engangsmiddag</span>' +
          '<span class="oneoff-name">' + esc(o.name) + '</span>' +
          '<span class="day-meta">' + o.ingredients.length + (o.ingredients.length === 1 ? ' ingrediens' : ' ingredienser') + '</span></div>' +
          '<div class="oneoff-actions">' + (swapFrom ? swapBtn(d, dn) : '<a class="btn small" href="#uke/engang/' + d + '">Rediger</a>' +
          '<button type="button" class="btn small" data-action="remove-oneoff" data-date="' + d + '">Fjern</button>' + swapBtn(d, dn)) + '</div>';
      } else {
        // v0.4.4: retter som er brukt en annen dag er ikke lenger sperret. Å velge en flytter den hit, og det som
        // sto her (eller tomt) går til dagen den kom fra.
        h += '<div class="day-row"><select id="day-' + d + '" class="day-select" data-date="' + d + '">' +
          '<option value="">Tom</option>';
        rs.forEach(function (x) {
          var usedIdx = usedBy[x.id];
          var takenElsewhere = usedIdx != null && usedIdx !== i;
          h += '<option value="' + esc(x.id) + '"' + (r && r.id === x.id ? ' selected' : '') + '>' + esc(x.name) +
            (takenElsewhere ? (r ? ' (bytt med ' : ' (flytt fra ') + DAY_SHORT[usedIdx] + ')' : '') + '</option>';
        });
        h += '<option value="__oneoff__">＋ Engangsmiddag …</option></select>' + swapBtn(d, dn) + '</div>';
        var meta = [];
        if (r) {
          if (r.minutes) meta.push(r.minutes + ' min');
          if (r.note) meta.push(r.note);
        }
        h += '<div class="day-foot"><span class="day-meta">' + esc(meta.join(' · ')) + '</span>' +
          (r ? '' : '<a class="linkbtn" href="#uke/engang/' + d + '">+ Engangsmiddag</a>') + '</div>';
      }
      h += '</li>';
    });
    h += '</ol>';
    if (showShareCard() && !swapFrom) {
      // v0.4.6: diskret delingskort etter første plan (ikke første skjerm).
      h += '<aside class="share-card" data-testid="del-kort" aria-labelledby="del-kort-h">' +
        '<p class="share-h" id="del-kort-h">Handler dere sammen?</p>' +
        '<p class="share-t">Del uka og lista med husstanden – ingen konto, bare en lenke.</p>' +
        '<div class="share-actions"><a class="btn small primary" href="#husstand" data-testid="del-kort-ja">Del med husstanden</a>' +
        '<button type="button" class="btn small" data-action="dismiss-share" data-testid="del-kort-nei">Ikke nå</button></div></aside>';
    }
    if (swapFrom) {
      // v0.6.1 (spec v0.6.1 punkt 5): enklere tekst. Dagen som byttes er markert i lista.
      h += '<div class="swap-bar" data-testid="bytte-linje"><p id="swap-hint" class="swap-hint">Trykk på dagen du vil bytte med</p><button type="button" class="btn small" data-action="swap-cancel" data-testid="bytt-avbryt">Avbryt</button></div>';
    }
    h += '<div class="row-actions"><a class="btn primary" href="#liste">Til handlelista →</a>' +
      (count ? '<button type="button" class="btn" data-action="clear-week" data-testid="tom-uka">Tøm uka</button>' : '') + '</div>';
    h += '</section>';
    // Ny tegning (f.eks. endring fra en annen telefon) skal ikke miste tastaturfokus.
    var ae = document.activeElement, keep = null;
    if (ae && ae !== main && main.contains(ae)) {
      keep = ae.id ? '#' + ae.id : ae.getAttribute('data-action') ? '[data-action="' + ae.getAttribute('data-action') + '"]' +
        (ae.getAttribute('data-date') ? '[data-date="' + ae.getAttribute('data-date') + '"]' : '') : null;
    }
    main.innerHTML = h;
    if (keep) { var ke = main.querySelector(keep); if (ke) try { ke.focus({ preventScroll: true }); } catch (x) { ke.focus(); } }
  }

  function setDay(date, recipeId) {
    ui.swap = null;
    if (recipeId === '__oneoff__') { location.hash = '#uke/engang/' + date; return; }
    if (recipeId) {
      // v0.4.4: retten er brukt en annen dag i uka -> flytt den hit (bytt med det som står her).
      var dates = weekDates(ui.weekOffset);
      var clash = dates.filter(function (d) { return d !== date && state.week_plan[d] === recipeId && !state.oneoffs[d]; });
      if (clash.length) { swapNow(clash[0], date, '#day-' + date); return; }
    }
    var before = dayEntry(date), oldName = dinnerName(date);
    ops.setDays([{ date: date, recipe_id: recipeId || null, oneoff: null }]);
    renderUke();
    // v0.6.1 (spec v0.6.1 punkt 2): en rett som erstatter en planlagt rett gir toast med «Angre» (8 s), som ved bytte.
    if (recipeId && oldName && before.sig && before.sig !== dayEntry(date).sig) replacedToast(date, before, oldName);
  }
  function replacedToast(date, before, oldName) {
    var after = dayEntry(date).sig;
    toast(oldName + ' på ' + dayName(date).toLowerCase() + ' er byttet ut', UNDO_MS, { label: 'Angre', run: function () {
      if (dayEntry(date).sig !== after) { toast('Kan ikke angre – uka er endret siden'); return; }
      ops.setDays([{ date: date, recipe_id: before.recipe_id, oneoff: before.oneoff }]);
      toast(oldName + ' er tilbake');
      if (main.querySelector('[data-page="uke"]')) { renderUke(); focusEl('#day-' + date); }
      else if (!isFormRoute()) route();
    } });
  }

  // v0.4.5 (spec v0.4 punkt 5): smartere «Fyll man–fre». Ren funksjon (tilfeldigheten sendes inn), brukt av
  // fillWeekdays og av testene via window.UkeshandelFill.
  //   recipes: [{ id, minutes }], used: { id: true } (allerede i uka), last: { id: true } (i forrige uke),
  //   n: antall tomme hverdager, rng: () => [0, 1).
  // Rekkefølge for valg: 1) ikke i forrige uke og rask (≤ RASK_MIN min), tilfeldig; 2) ikke i forrige uke, ikke rask,
  // lavest minutter først (tilfeldig ved likt, ukjent tid sist); 3) og 4) det samme blant forrige ukes retter, bare
  // hvis det ikke er nok andre. Plassering: raske retter tilfeldig på de første tomme dagene, tregere (hvis de måtte
  // med) til slutt i uka, raskest først – så fredag får den tregeste.
  var RASK_MIN = 30;
  function isRask(r) { return typeof r.minutes === 'number' && r.minutes > 0 && r.minutes <= RASK_MIN; }
  function minutesKey(r) { return typeof r.minutes === 'number' && r.minutes > 0 ? r.minutes : Infinity; }
  function planFill(recipes, used, last, n, rng) {
    rng = rng || Math.random;
    function shuffle(a) {
      a = a.slice();
      for (var i = a.length - 1; i > 0; i--) { var j = Math.floor(rng() * (i + 1)); var t = a[i]; a[i] = a[j]; a[j] = t; }
      return a;
    }
    function bySpeed(a) { return shuffle(a).sort(function (x, y) { return minutesKey(x) - minutesKey(y); }); }   // stabil sortering
    function tier(list) {
      return shuffle(list.filter(isRask)).concat(bySpeed(list.filter(function (r) { return !isRask(r); })));
    }
    var cand = recipes.filter(function (r) { return !used[r.id]; });
    var fresh = tier(cand.filter(function (r) { return !last[r.id]; }));
    var old = tier(cand.filter(function (r) { return !!last[r.id]; }));
    var picks = fresh.concat(old).slice(0, Math.max(0, n));
    var order = shuffle(picks.filter(isRask)).concat(bySpeed(picks.filter(function (r) { return !isRask(r); })));
    return {
      ids: order.map(function (r) { return r.id; }),
      fromLastWeek: picks.filter(function (r) { return !!last[r.id]; }).length,
      slow: picks.filter(function (r) { return !isRask(r); }).length,
      freshAvailable: fresh.length
    };
  }
  window.UkeshandelFill = { plan: planFill, RASK_MIN: RASK_MIN };

  // Tomme dager man–fre fylles (planFill). Ingen rett to ganger i uka; satte dager røres ikke.
  function fillWeekdays() {
    var dates = weekDates(ui.weekOffset);
    var used = {}, last = {};
    dates.forEach(function (d) {
      var id = state.week_plan[d];
      if (!state.oneoffs[d] && id && recipeById(id)) used[id] = true;
    });
    weekDates(ui.weekOffset - 1).forEach(function (d) {
      var id = state.week_plan[d];
      if (!state.oneoffs[d] && id) last[id] = true;
    });
    var empty = dates.slice(0, 5).filter(function (d) {
      return !state.oneoffs[d] && !(state.week_plan[d] && recipeById(state.week_plan[d]));
    });
    if (!empty.length) { ui.notice = 'Man–fre er allerede fylt.'; renderUke(); return; }
    var plan = planFill(state.recipes, used, last, empty.length);
    var entries = plan.ids.map(function (id, k) { return { date: empty[k], recipe_id: id, oneoff: null }; });
    var filled = entries.length;
    if (filled) ops.setDays(entries);
    // Melding: hva som ble valgt og hvorfor (kort, én linje i vanlig tilfelle).
    var hasLast = Object.keys(last).length > 0;
    var what = !filled ? '' : (plan.slow ? '' : ' med raske retter (' + RASK_MIN + ' min eller mindre)') +
      (hasLast && !plan.fromLastWeek ? (plan.slow ? ' med retter' : '') + ' som ikke var med forrige uke' : '');
    var why = (plan.fromLastWeek ? ' ' + (plan.fromLastWeek === filled ? (filled === 1 ? 'Den' : 'Alle') : plan.fromLastWeek + ' av dem') + ' var med forrige uke – det var ikke nok andre retter.' : '') +
      (plan.slow ? ' ' + (plan.slow === filled ? (filled === 1 ? 'Den' : 'Alle') : plan.slow + ' av dem') + ' tar over ' + RASK_MIN + ' min – det var ikke nok raske retter' + (plan.slow < filled ? (plan.slow === 1 ? '; den står sist i uka.' : '; de står sist i uka.') : '.') : '');
    if (filled === empty.length) ui.notice = 'Fylte ' + filled + (filled === 1 ? ' dag' : ' dager') + what + '.' + why + ' Bytt gjerne en kveld.';
    else if (!filled) ui.notice = 'Ingen ledige retter – alle rettene er allerede brukt denne uka.';
    else ui.notice = 'Fylte ' + filled + ' av ' + empty.length + ' tomme dager' + what + ' – det er ikke flere ledige retter.' + why + ' Legg til flere under Retter.';
    renderUke();
  }

  function renderOneoffForm(date) {
    var o = state.oneoffs[date];
    var rid = state.week_plan[date];
    var replaced = !o && rid ? recipeById(rid) : null;
    var h = '<section class="page" data-page="engang-skjema">';
    h += '<div class="page-head"><a class="back" href="#uke">‹ Uke</a><h2>Engangsmiddag</h2></div>';
    h += '<p class="hint">' + esc(dayName(date) + ' ' + shortDate(date)) + ' Kommer med i handlelista, men lagres ikke under Retter.' +
      (replaced ? ' Erstatter «' + esc(replaced.name) + '» denne dagen.' : '') + '</p>';
    h += '<form id="oneoff-form" data-date="' + date + '" novalidate>';
    h += '<label class="field"><span>Navn</span><input id="o-name" type="text" required value="' + esc(o ? o.name : '') + '" placeholder="F.eks. Gjester: fårikål"></label>';
    h += ingredientsFieldset(o ? o.ingredients : []);
    h += '<p class="form-error" id="form-error" hidden></p>';
    h += '<div class="form-actions"><button type="submit" class="btn primary" data-testid="lagre-engang">Lagre</button>' +
      '<a class="btn" href="#uke">Avbryt</a>' +
      (o ? '<button type="button" class="btn danger" data-action="remove-oneoff" data-date="' + date + '">Fjern</button>' : '') + '</div>';
    h += '</form></section>';
    main.innerHTML = h;
    if (!o) document.getElementById('o-name').focus();
  }

  function saveOneoffForm(form) {
    var name = document.getElementById('o-name').value.trim();
    if (!name) return formError('Engangsmiddagen må ha et navn.', 'o-name');
    var date = form.getAttribute('data-date');
    var prev = state.oneoffs[date];
    ops.setDays([{ date: date, recipe_id: null, oneoff: { id: prev ? prev.id : uid('o'), name: name, ingredients: readIngredients(form) } }]);
    toast('Engangsmiddag lagret');
    location.hash = '#uke';
  }

  function removeOneoff(date) {
    var o = state.oneoffs[date];
    if (!o) return;
    if (!window.confirm('Fjerne engangsmiddagen «' + o.name + '»?')) return;
    ops.setDays([{ date: date, recipe_id: null, oneoff: null }]);
    toast('Engangsmiddag fjernet');
    if (location.hash !== '#uke') location.hash = '#uke'; else renderUke();
  }

  /* ---------- Liste ---------- */

  function buildList() {
    var dates = weekDates(ui.weekOffset);
    var weekKey = dates[0];
    var map = {};
    var order = [];
    var RANK = { dinner: 0, staple: 1, extra: 2 };
    // v0.4.1: samme vare i omregnbare enheter (dl/l/ml/ss/ts, g/kg, + pakningstabellen) blir én linje.
    function add(src, from, name, qty, unit, aisle, extraId) {
      var nn = normName(name);
      if (!nn) return null;
      unit = U.normUnit(unit);             // v0.4.2: «L», " dl", «liter» … → l/dl
      // v0.4.2: en kjent pakningsvare uten enhet og uten mengde (f.eks. fast vare der mengden er tømt) = én pakning.
      if ((qty == null || qty === '') && /^(|pk|stk|kartong|beger)$/.test(unit) && U.packFor(nn) && U.conversion(nn, unit)) qty = 1;
      var conv = U.conversion(nn, unit);
      var base = conv ? conv.base : unit;
      var key = nn + '|' + base;
      var it = map[key];
      if (!it) {
        it = map[key] = { key: key, nn: nn, name: String(name).trim(), qty: null, unit: base, parts: {}, units: [],
          aisle: normAisle(aisle), checked: false, source: src, sources: [], recipes: [], extra_ids: [] };
        order.push(key);
      }
      if (it.units.indexOf(unit) < 0) it.units.push(unit);
      if (qty != null && isFinite(qty)) it.parts[unit] = round3((it.parts[unit] || 0) + Number(qty));
      if (it.sources.indexOf(src) < 0) it.sources.push(src);
      if (RANK[src] < RANK[it.source]) it.source = src;
      if (from && it.recipes.indexOf(from) < 0) it.recipes.push(from);
      if (extraId) it.extra_ids.push(extraId);
      return key;
    }
    // v0.4.3b: «Kilde»-visningen: én gruppe per middag (dagens rekkefølge) + «Lagt til selv». Hver rad har rettens
    // EGEN mengde (ingen pakningsavrunding) og peker på den sammenslåtte linja (key), så avkrysningen er felles.
    var srcGroups = [], selv = { id: 'selv', title: 'Lagt til selv', rows: [], rmap: {}, skipped: 0 };
    function srcRow(g, kind, key, name, qty, unit, extraId) {
      if (!key) return;
      var rk = kind + '/' + key, r = g.rmap[rk];
      if (!r) { r = g.rmap[rk] = { row: g.id + '/' + rk, kind: kind, key: key, name: String(name).trim(), parts: {}, units: [], extra_ids: [] }; g.rows.push(r); }
      var u = U.normUnit(unit);
      if (qty != null && qty !== '' && isFinite(qty)) {
        if (r.units.indexOf(u) < 0) r.units.push(u);
        r.parts[u] = round3((r.parts[u] || 0) + Number(qty));
      }
      if (extraId) r.extra_ids.push(extraId);
    }
    var dinners = 0;
    // v0.4.3: basisvarer. Et navn er basisvare denne uka når ALLE middagsforekomstene er basis (tabell eller merket i
    // oppskriften). Da legges middagsmengden bare på lista hvis den er valgt («basis:<vare>» = 1) i basisvare-vinduet.
    var adjW = state.list_adjust[weekKey] || {};
    var dinnerIngs = [], occ = {};
    dates.forEach(function (d) {
      var o = state.oneoffs[d];
      var r = o || (state.week_plan[d] ? recipeById(state.week_plan[d]) : null);
      if (!r) return;
      dinners++;
      var g = { id: d, date: d, title: dayName(d) + ' · ' + r.name, rows: [], rmap: {}, skipped: 0 };
      srcGroups.push(g);
      r.ingredients.forEach(function (i) {
        var nn = normName(i.name);
        if (!nn) return;
        dinnerIngs.push({ r: r, i: i, nn: nn, g: g });
        var c = occ[nn] = occ[nn] || { n: 0, b: 0 };
        c.n++; if (U.isBasis(i)) c.b++;
      });
    });
    var basisMap = {}, basisAdded = {};
    dinnerIngs.forEach(function (x) {
      var c = occ[x.nn];
      if (c.b === c.n) {
        var b = basisMap[x.nn];
        if (!b) b = basisMap[x.nn] = { nn: x.nn, name: String(x.i.name).trim(), recipes: [], entries: [], choice: adjW[BASIS_PREFIX + x.nn] || 0 };
        if (b.recipes.indexOf(x.r.name) < 0) b.recipes.push(x.r.name);
        b.entries.push({ qty: x.i.qty, unit: x.i.unit });
        if (b.choice !== 1) { x.g.skipped++; return; }   // ikke valgt (eller «ikke nå») → ikke på lista
        basisAdded[x.nn] = true;
      }
      srcRow(x.g, 'dinner', add('dinner', x.r.name, x.i.name, x.i.qty, x.i.unit, x.i.aisle), x.i.name, x.i.qty, x.i.unit);
    });
    var basis = Object.keys(basisMap).map(function (nn) { var b = basisMap[nn]; b.amount = basisAmount(nn, b.entries); return b; })
      .sort(function (a, b) { return a.name.localeCompare(b.name, 'nb'); });
    // v0.4.3b: faste varer bare når de er valgt for uka (se STAPLES_OPTIN_FROM for eldre uker).
    var staples = state.staples.map(function (s) {
      var v = adjW[FAST_PREFIX + s.id];
      return { s: s, on: stapleChosen(s, weekKey, adjW), explicit: v > 0 ? 1 : v < 0 ? -1 : 0 };
    });
    staples.forEach(function (x) {
      if (!x.on) return;
      srcRow(selv, 'staple', add('staple', null, x.s.name, x.s.qty, x.s.unit, x.s.aisle), x.s.name, x.s.qty, x.s.unit);
    });
    state.list_extras.forEach(function (x) {
      if (x.week === weekKey) srcRow(selv, 'extra', add('extra', null, x.name, x.qty, x.unit, x.aisle, x.id), x.name, x.qty, x.unit, x.id);
    });
    var adj = state.list_adjust[weekKey] || {};
    var checks = state.checks[weekKey] || {};
    var items = order.map(function (k) {
      var it = map[k];
      it.week = weekKey;
      // Nøkler fra før v0.4.1 (navn|enhet per enhet), f.eks. «melk|dl» som nå er en del av «melk|ml».
      var srcKeys = it.units.map(function (u) { return { k: it.nn + '|' + u, f: U.factorFor(it.nn, u) }; });
      it.legacyKeys = srcKeys.filter(function (x) { return x.k !== k; });
      var legacyAdj = 0;
      it.legacyKeys.forEach(function (x) { if (adj[x.k]) legacyAdj += adj[x.k] * x.f; });
      it.adjust_own = adj[k] || 0;
      it.adjust_legacy = round3(legacyAdj);
      it.adjust = round3(it.adjust_own + it.adjust_legacy);
      var hasQty = Object.keys(it.parts).length > 0;
      it.base_qty = null;
      it.plan = null;
      if (hasQty || it.adjust) {
        it.plan = U.plan(it.nn, it.unit, it.parts, it.adjust);
        it.base_qty = U.plan(it.nn, it.unit, it.parts, 0).need;
        it.qty = it.plan.need;           // behovet (grunnenhet)
        it.buy = it.plan.buy;            // det som kjøpes (hele pakninger / rundet opp)
      }
      // Avkrysning lagrer mengden som ble kjøpt (tall, grunnenhet) eller true (uten mengde / eldre versjoner).
      // Blir BEHOVET større enn det som ble krysset av, vises varen som ukrysset igjen. Økning innenfor samme
      // pakning (7 dl → 9 dl når 1 l er krysset av) lar avkrysningen stå.
      var c = checks[k];
      if (!c && it.legacyKeys.length && !srcKeys.some(function (x) { return x.k === k; }) &&
          it.legacyKeys.every(function (x) { return checks[x.k]; })) {
        c = it.legacyKeys.some(function (x) { return checks[x.k] === true; }) ? true
          : round3(it.legacyKeys.reduce(function (a, x) { return a + checks[x.k] * x.f; }, 0));
      }
      it.tick = c || false;
      it.checked = !!c && !(typeof c === 'number' && it.qty != null && it.qty > c + 1e-9);
      it.basisvare = !!basisAdded[it.nn] && it.sources.indexOf('dinner') >= 0;
      return it;
    });
    if (!hh) {
      // Lokal modus: behold generert liste (for eldre versjoner) og rydd bort gamle uker.
      var oldest = weekDates(Math.min(0, ui.weekOffset) - 8)[0];
      var otherWeeks = state.list_items.filter(function (it) { return it.week !== weekKey && it.week && it.week >= oldest; });
      Object.keys(state.list_adjust).forEach(function (w) { if (w < oldest) delete state.list_adjust[w]; });
      Object.keys(state.checks).forEach(function (w) { if (w < oldest) delete state.checks[w]; });
      state.list_extras = state.list_extras.filter(function (x) { return x.week >= oldest; });
      state.list_items = otherWeeks.concat(items.map(function (it) {
        return { key: it.key, week: it.week, name: it.name, qty: it.qty, unit: it.unit, aisle: it.aisle, checked: it.checked, source: it.source };
      }));
      save();
    }
    currentList = items;
    var byKey = {}, rowCount = {};
    items.forEach(function (it) { byKey[it.key] = it; });
    srcGroups.concat([selv]).forEach(function (g) { g.rows.forEach(function (r) { rowCount[r.key] = (rowCount[r.key] || 0) + 1; }); });
    srcGroups.concat([selv]).forEach(function (g) {
      g.rows.forEach(function (r) {
        r.shared = rowCount[r.key] > 1;
        r.item = byKey[r.key];
        r.amount = r.units.map(function (u) { return formatQty(r.parts[u]) + (u ? ' ' + u : ''); }).join(' + ');
      });
    });
    return { items: items, dates: dates, dinners: dinners, weekKey: weekKey, basis: basis,
      source: srcGroups, selv: selv, staples: staples, legacyStaples: weekKey < STAPLES_OPTIN_FROM };
  }
  function stapleChosen(s, weekKey, adjW) {
    var v = adjW[FAST_PREFIX + s.id];
    if (v > 0) return true;
    if (v < 0) return false;
    return weekKey < STAPLES_OPTIN_FROM && s.active !== false;
  }
  var currentList = [];
  // Samlet middagsmengde for en basisvare (til visning i vinduet), f.eks. «1 ss + 2 ts» eller «1 dl».
  function basisAmount(nn, entries) {
    var byBase = {}, order = [];
    entries.forEach(function (e) {
      if (e.qty == null || !isFinite(e.qty)) return;
      var u = U.normUnit(e.unit), c = U.conversion(nn, u), base = c ? c.base : u;
      if (!byBase[base]) { byBase[base] = {}; order.push(base); }
      byBase[base][u] = round3((byBase[base][u] || 0) + Number(e.qty));
    });
    // v0.6.1: kjøkkenmål i basisvinduet («3 dl»), ikke pakninger.
    return order.map(function (base) { return U.plan(nn, base, byBase[base], 0, true).text; }).join(' + ');
  }

  // v0.4.3: én samlet melding øverst på Liste. v0.6.2 (spec v0.6.2 punkt 2): bare når noe ikke er avgjort for uka, som én
  // slank linje (44 px). Når alle er avgjort, ligger basisvarene bare i «Mer».
  function basisStrip(bs) {
    if (!bs || !bs.length) return '';
    var und = bs.filter(function (b) { return !b.choice; });
    if (!und.length) return '';
    function names(arr) { var n = arr.map(function (b) { return b.name.charAt(0).toLowerCase() + b.name.slice(1); }); return n.slice(0, 3).join(', ') + (n.length > 3 ? ' …' : ''); }
    var title = und.length === bs.length
      ? bs.length + (bs.length === 1 ? ' basisvare' : ' basisvarer') + ' denne uka: ' + names(bs)
      : und.length + (und.length === 1 ? ' ny basisvare: ' : ' nye basisvarer: ') + names(und);
    return '<button type="button" class="basis-strip" data-action="basis-open" data-testid="basis" aria-haspopup="dialog">' +
      '<span class="bs-t">' + esc(title) + '</span><span class="bs-go" aria-hidden="true">Velg ›</span></button>';
  }

  function openBasisDialog() {
    var built = buildList(), bs = built.basis;
    if (!bs.length) return;
    closeBasisDialog(false);
    var week = built.weekKey, anyDecided = bs.some(function (b) { return b.choice; });
    var d = document.createElement('div');
    d.id = 'basis-dialog';
    d.className = 'overlay';
    var rows = bs.map(function (b) {
      return '<li><label class="basis-row"><input type="checkbox" data-nn="' + esc(b.nn) + '"' + (b.choice === 1 ? ' checked' : '') + '>' +
        '<span class="basis-name">' + esc(cap(b.name)) + '</span>' + (b.amount ? ' <span class="basis-amt">' + esc(b.amount) + '</span>' : '') +
        (anyDecided && !b.choice ? ' <span class="badge">ny</span>' : '') +
        '<span class="basis-src">' + esc(b.recipes.join(', ')) + '</span></label></li>';
    }).join('');
    d.innerHTML = '<div class="sheet basis-sheet" role="dialog" aria-modal="true" aria-labelledby="basis-h" aria-describedby="basis-hint" data-week="' + week + '">' +
      '<div class="sheet-head"><h3 id="basis-h">Basisvarer uke ' + isoWeek(parseIso(week)) + '</h3>' +
      '<button type="button" class="icon-btn" data-basis="close" aria-label="Lukk">✕</button></div>' +
      '<p class="hint" id="basis-hint">Brukes i ukas middager. Kryss av det dere må kjøpe – resten legges ikke på lista.</p>' +
      '<ul class="basis-rows">' + rows + '</ul>' +
      '<div class="basis-actions"><button type="button" class="btn primary" data-basis="save" data-testid="basis-lagre"></button>' +
      '<button type="button" class="btn" data-basis="ignore" data-testid="basis-ignorer">Ignorer denne uka</button></div></div>';
    document.body.appendChild(d);
    function label() {
      var n = d.querySelectorAll('.basis-rows input:checked').length;
      d.querySelector('[data-basis="save"]').textContent = n ? 'Legg ' + n + ' på lista' : 'Lagre – ingen på lista';
    }
    label();
    d.addEventListener('change', label);
    d.addEventListener('click', function (e) {
      var btn = e.target.closest('[data-basis]');
      var a = e.target === d ? 'close' : btn ? btn.getAttribute('data-basis') : null;
      if (!a) return;
      if (a === 'close') { closeBasisDialog(true); return; }
      var map = {}, n = 0;
      [].forEach.call(d.querySelectorAll('.basis-rows input'), function (cb) {
        var on = a === 'save' && cb.checked;
        map[cb.getAttribute('data-nn')] = on ? 1 : -1;
        if (on) n++;
      });
      ops.setBasis(week, map);
      closeBasisDialog(false);
      flipRender();
      closeBasisDialog.refocus();   // v0.6.2: fokus tilbake etter ny tegning (basislinja, ellers «Mer»)
      toast(a === 'ignore' ? 'Basisvarer ignorert for uke ' + isoWeek(parseIso(week))
        : n ? n + (n === 1 ? ' basisvare' : ' basisvarer') + ' lagt på lista' : 'Ingen basisvarer lagt på lista');
    });
    d.addEventListener('keydown', function (e) {
      if (e.key === 'Escape') { e.preventDefault(); closeBasisDialog(true); return; }
      if (e.key !== 'Tab') return;
      var f = [].filter.call(d.querySelectorAll('button, input'), function (x) { return !x.disabled && x.offsetParent !== null; });
      if (!f.length) return;
      var first = f[0], last = f[f.length - 1];
      if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
      else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
    });
    var firstCb = d.querySelector('.basis-rows input');
    if (firstCb) firstCb.focus();
  }
  // v0.4.3b: «Legg til fra faste varer» – alle faste husvarer med avkrysning for valgt uke.
  function trapTab(d, e) {
    var f = [].filter.call(d.querySelectorAll('button, input'), function (x) { return !x.disabled && x.offsetParent !== null; });
    if (!f.length) return;
    var first = f[0], last = f[f.length - 1];
    if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
    else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
  }
  // v0.7: ukevalget – bunnark med søk, grupper etter avdeling, «Som forrige uke» og festet «Legg N på lista».
  function openFastDialog() {
    var built = buildList(), week = built.weekKey, list = built.staples, wn = isoWeek(parseIso(week));
    closeSheet('fast-dialog', false);
    closeBasisDialog(false);
    closeListMenu(false);
    var prevKey = lastWeekWithFaste(week);
    var prevAdj = prevKey ? (state.list_adjust[prevKey] || {}) : {};
    // v0.7.1: når forrige uke hadde eksplisitt valg, kopiér bare de som faktisk var krysset (v>0) – ikke legacy «alle på».
    function prevExplicitOn(s) { return (prevAdj[FAST_PREFIX + s.id] || 0) > 0; }
    var prevN = prevKey ? state.staples.filter(prevExplicitOn).length : 0;
    var prevWn = prevKey ? isoWeek(parseIso(prevKey)) : null;
    var checked = {};
    list.forEach(function (x) { checked[x.s.id] = !!x.on; });
    var beforeCopy = null;   // for Angre etter «Som forrige uke»
    var q = '';
    var d = document.createElement('div');
    d.id = 'fast-dialog';
    d.className = 'overlay';
    function nChecked() { var n = 0; Object.keys(checked).forEach(function (id) { if (checked[id]) n++; }); return n; }
    function paint(opts) {
      opts = opts || {};
      var keepScroll = !!opts.keepScroll;
      var focusSearch = opts.focusSearch !== false && !keepScroll;   // default: focus on first paint / search; never when keepScroll
      var bodyEl = d.querySelector('.uv-body');
      var scrollTop = keepScroll && bodyEl ? bodyEl.scrollTop : 0;
      var n = nChecked(), total = state.staples.length;
      var qn = normName(q), qk = stapleKey(q);
      var rows = state.staples.filter(function (s) {
        if (!qn) return true;
        return normName(s.name).indexOf(qn) >= 0 || stapleKey(s.name).indexOf(qk) >= 0 || stapleKey(s.name) === qk;
      });
      var groups = staplesGrouped(rows);
      var body = '<div class="uv-head"><h3 id="fast-h">Faste varer uke ' + wn + '</h3>' +
        '<button type="button" class="btn small" data-fast="edit" data-testid="faste-rediger-alle">Rediger</button>' +
        '<button type="button" class="icon-btn" data-fast="close" data-testid="faste-avbryt" aria-label="Lukk">✕</button></div>';
      if (!total) {
        body += '<p class="hint" id="fast-hint">Ingen faste varer ennå.</p>' +
          '<button type="button" class="btn" data-fast="edit" data-testid="faste-tom-legg-inn">Legg inn faste varer ›</button>';
      } else {
        var anyExplicit = list.some(function (x) { return x.explicit; });
        // v0.7: hint for eldre uker (før OPTIN) også når varene er forhåndskrysset; ellers bare når ingen er krysset.
        if (!n || (built.legacyStaples && !anyExplicit)) {
          body += '<p class="hint" id="fast-hint">' + (built.legacyStaples && !anyExplicit
            ? 'Denne uka var de faste varene med fra før. Fjern haken for det dere ikke trenger.'
            : 'Kryss av det dere trenger. Ingenting kommer på lista før dere trykker på knappen nederst.') + '</p>';
        }
        body += '<div class="fv-search">' + ICON_SEARCH +
          '<input type="search" id="uv-q" placeholder="Søk …" aria-label="Søk i faste varer" value="' + esc(q) + '" autocomplete="off" data-testid="faste-uke-sok"></div>';
        if (beforeCopy) {
          // v0.7.1: status oppdateres/forsvinner når valget endres (ikke «som uke X» etter manuell endring)
          var matchesPrev = prevKey && state.staples.every(function (s) {
            return !!checked[s.id] === prevExplicitOn(s);
          });
          if (matchesPrev) {
            body += '<div class="uv-status" data-testid="faste-forrige-status"><span class="ok" aria-hidden="true">✓</span>' +
              '<span class="t"><b>' + n + ' krysset av som uke ' + prevWn + '.</b> Ta bort det dere har.</span>' +
              '<button type="button" class="uv-undo" data-fast="undo-prev" data-testid="faste-forrige-angre">Angre</button></div>';
          } else {
            body += '<div class="uv-status" data-testid="faste-forrige-status"><span class="t"><b>' + n + ' krysset av.</b></span>' +
              '<button type="button" class="uv-undo" data-fast="undo-prev" data-testid="faste-forrige-angre">Angre</button></div>';
          }
        } else if (prevKey && prevN) {
          // Vis knappen bare når forrige valg er forskjellig fra nåværende
          var same = state.staples.every(function (s) { return !!checked[s.id] === prevExplicitOn(s); });
          if (!same) {
            body += '<button type="button" class="uv-prev" data-fast="prev" data-testid="faste-forrige">' + ICON_REPEAT +
              '<span class="t"><b>Som forrige uke</b><span>Kryss av de ' + prevN + ' dere valgte i uke ' + prevWn + '</span></span></button>';
          }
        } else if (prevKey === null || prevN === 0) {
          var lookWn = prevWn || isoWeek(parseIso(isoDate(new Date(parseIso(week).getFullYear(), parseIso(week).getMonth(), parseIso(week).getDate() - 7))));
          body += '<p class="uv-none" data-testid="faste-forrige-tom">Ingen faste varer valgt i uke ' + lookWn + '</p>';
        }
        if (qn && !rows.length) {
          body += '<button type="button" class="uv-addnew" data-fast="add-q" data-testid="faste-uke-ny">+ Legg til «' + esc(q) + '» som fast vare</button>';
        }
        groups.forEach(function (g) {
          var onIn = g.items.filter(function (s) { return checked[s.id]; }).length;
          body += '<h4 class="fv-group-h">' + esc(aisleLabel(g.aisle)) + '<span>' +
            (onIn ? onIn + ' av ' + g.items.length : g.items.length) + '</span></h4><ul class="uv-rows">';
          g.items.forEach(function (s) {
            body += '<li><label class="uv-row"><input type="checkbox" data-sid="' + esc(s.id) + '"' + (checked[s.id] ? ' checked' : '') + '>' +
              '<span class="tx"><span class="nm">' + esc(cap(s.name)) + '</span>' +
              (stapleAmt(s) ? ' <span class="q">' + esc(stapleAmt(s)) + '</span>' : '') + '</span></label></li>';
          });
          body += '</ul>';
        });
      }
      var foot = total ? ('<div class="fv-foot"><span class="sub" data-testid="faste-teller">' + n + ' av ' + total + '</span>' +
        '<button type="button" class="btn primary" data-fast="save" data-testid="faste-lagre">' +
        (n ? 'Legg ' + n + ' på lista' : 'Lagre – ingen på lista') + '</button></div>') : '';
      d.innerHTML = '<div class="sheet basis-sheet uv-sheet" role="dialog" aria-modal="true" aria-labelledby="fast-h" data-week="' + week + '">' +
        '<div class="uv-body">' + body + '</div>' + foot + '</div>';
      if (keepScroll) {
        var nb = d.querySelector('.uv-body');
        if (nb) nb.scrollTop = scrollTop;
      }
      var sq = d.querySelector('#uv-q');
      if (sq && focusSearch) { sq.focus(); sq.setSelectionRange(sq.value.length, sq.value.length); }
    }
    paint({ focusSearch: false });   // første fokus settes under (første checkbox / søk)
    document.body.appendChild(d);
    d.addEventListener('input', function (e) {
      if (e.target.id === 'uv-q') { q = e.target.value; paint({ focusSearch: true }); return; }
      var cb = e.target.closest('input[data-sid]');
      if (cb) {
        checked[cb.getAttribute('data-sid')] = cb.checked;
        // v0.7.1: ikke hopp til toppen / ikke fokus i søk (Trude: 15/16 kryss)
        paint({ keepScroll: true, focusSearch: false });
      }
    });
    d.addEventListener('click', function (e) {
      if (e.target === d) { dismissFast(true); return; }
      var btn = e.target.closest('[data-fast]');
      if (!btn) return;
      var a = btn.getAttribute('data-fast');
      if (a === 'close') { dismissFast(true); return; }
      if (a === 'edit') { dismissFast(false); location.hash = '#liste/faste'; return; }
      if (a === 'prev' && prevKey) {
        beforeCopy = JSON.parse(JSON.stringify(checked));
        state.staples.forEach(function (s) { checked[s.id] = prevExplicitOn(s); });
        paint({ focusSearch: false, keepScroll: true }); return;
      }
      if (a === 'undo-prev' && beforeCopy) { checked = beforeCopy; beforeCopy = null; paint({ focusSearch: false, keepScroll: true }); return; }
      if (a === 'add-q' && q.trim()) {
        var ga = guessAisle(q) || 'Tørrvare', gu = guessUnit(q, ga);
        var id = uid('s');
        ops.addStaple({ id: id, name: q.trim(), qty: 1, unit: gu, aisle: ga, active: true });
        checked[id] = true;
        paint({ focusSearch: false }); return;
      }
      if (a === 'save') {
        var map = {}, n = 0;
        state.staples.forEach(function (s) { map[s.id] = checked[s.id] ? 1 : -1; if (checked[s.id]) n++; });
        ops.setFast(week, map);
        dismissFast(false);
        flipRender();
        closeSheet.refocus();
        toast(n ? n + (n === 1 ? ' fast vare' : ' faste varer') + ' på lista for uke ' + wn : 'Ingen faste varer på lista for uke ' + wn);
      }
    });
    function dismissFast(restore) {
      document.removeEventListener('keydown', onFastKey, true);
      closeSheet('fast-dialog', restore);
    }
    function onFastKey(e) {
      if (!document.getElementById('fast-dialog')) return;
      if (e.key === 'Escape') { e.preventDefault(); dismissFast(true); return; }
      if (e.key === 'Tab') trapTab(d, e);
    }
    document.addEventListener('keydown', onFastKey, true);
    d.addEventListener('keydown', onFastKey);
    // v0.7.1: fokus på første avkrysning (ikke søk) – Esc virker via document-capture, tastatur åpnes ikke
    var first = d.querySelector('.uv-row input') || d.querySelector('[data-fast="close"]');
    if (first) try { first.focus({ preventScroll: true }); } catch (err) { first.focus(); }
  }

  function closeSheet(id, restoreFocus) {
    if (id === 'basis-dialog') { closeBasisDialog(restoreFocus); return; }
    var d = document.getElementById(id);
    if (!d) return;
    d.parentNode.removeChild(d);
    if (restoreFocus) {
      var b = main.querySelector('[data-action="fast-open"]') || main.querySelector('[data-action="list-menu"]');   // v0.6.2: «Mer»
      if (b) try { b.focus({ preventScroll: true }); } catch (e) { b.focus(); }
    }
  }
  closeSheet.refocus = function () {
    var b = main.querySelector('[data-action="fast-open"]') || main.querySelector('[data-action="list-menu"]');
    if (b) try { b.focus({ preventScroll: true }); } catch (e) { b.focus(); }
  };
  closeBasisDialog.refocus = function () {
    var b = main.querySelector('[data-action="basis-open"]') || main.querySelector('[data-action="list-menu"]');
    if (b) try { b.focus({ preventScroll: true }); } catch (e) { b.focus(); }
  };
  function closeBasisDialog(restoreFocus) {
    var d = document.getElementById('basis-dialog');
    if (!d) return;
    d.parentNode.removeChild(d);
    if (restoreFocus) {
      var b = main.querySelector('[data-action="basis-open"]') || main.querySelector('[data-action="list-menu"]');   // v0.6.2: «Mer»
      if (b) try { b.focus({ preventScroll: true }); } catch (e) { b.focus(); }
    }
  }

  function isOpen(it) { return !it.checked && !(it.qty === 0); }

  function groupItems(items) {
    return AISLES.map(function (a) {
      return {
        aisle: a,
        // v0.4.2: avkryssede varer (og varer satt til 0) nederst i sin avdeling; alfabetisk innenfor hver del.
        items: items.filter(function (i) { return i.aisle === a; })
          .sort(function (x, y) { return (isOpen(x) ? 0 : 1) - (isOpen(y) ? 0 : 1) || x.name.localeCompare(y.name, 'nb'); })
      };
    }).filter(function (g) { return g.items.length; });
  }
  function currentItems() { return currentList; }
  // v0.4.3b: grupper og rader i «Kilde»: middager i dagens rekkefølge, så «Lagt til selv». Avkryssede rader nederst
  // i sin gruppe (samme regel som avdelingene i «Butikk»).
  function sourceGroups(built) {
    return built.source.concat(built.selv.rows.length ? [built.selv] : []).map(function (g) {
      return { g: g, rows: g.rows.filter(function (r) { return r.item; })
        .sort(function (x, y) { return (isOpen(x.item) ? 0 : 1) - (isOpen(y.item) ? 0 : 1) || x.name.localeCompare(y.name, 'nb'); }) };
    });
  }

  function listAsText() {
    var built = buildList();
    var kilde = ui.sort === 'kilde';
    var lines = ['Handleliste – ' + weekLabel(built.dates) + (kilde ? ' (etter matrett)' : '')];
    var any = false;
    if (kilde) {
      // Som på skjermen: per rett med rettens egen mengde, bare ukryssede.
      sourceGroups(built).forEach(function (x) {
        var open = x.rows.filter(function (r) { return isOpen(r.item); });
        if (!open.length) return;
        any = true;
        lines.push('');
        lines.push(x.g.title);
        open.forEach(function (r) { lines.push('- ' + cap(r.name) + (r.amount ? ', ' + r.amount : '')); });
      });
      return any ? lines.join('\n') + '\n' : '';
    }
    groupItems(built.items).forEach(function (g) {
      var open = g.items.filter(isOpen);
      if (!open.length) return;
      any = true;
      lines.push('');
      lines.push(aisleLabel(g.aisle));
      open.forEach(function (i) {
        var qu = i.plan ? i.plan.text : '';
        lines.push('- ' + cap(i.name) + (qu ? ', ' + qu : '') + (i.plan && i.plan.showNeed ? ' (behov ' + i.plan.needText + ')' : ''));
      });
    });
    return any ? lines.join('\n') + '\n' : '';
  }

  function renderListe() {
    // v0.7: «Faste husvarer»-regnearket nederst er erstattet av siden #liste/faste.
    main.innerHTML = '<section class="page" data-page="liste"><div id="list-section"></div></section>';
    renderListSection();
  }

  // v0.6.2: skjemaet åpnes med «＋» i verktøylinja (ingen <details> lenger) og står rett under den.
  function addItemForm() {
    return '<div class="add-panel" id="add-panel">' +
      '<form id="item-add" class="item-add-form" novalidate aria-label="Legg til vare">' +
      '<input type="text" id="ai-name" placeholder="Vare, f.eks. tannkrem" aria-label="Vare" autocomplete="off" list="known-ings">' +
      '<div class="ai-row"><input type="text" id="ai-qty" inputmode="decimal" placeholder="1" aria-label="Mengde">' +
      '<select id="ai-unit" aria-label="Enhet">' + unitOptions('') + '</select>' +
      '<select id="ai-aisle" aria-label="Avdeling">' + aisleOptions('Tørrvare') + '</select></div>' +
      '<label class="check"><input type="checkbox" id="ai-staple"> Legg til i faste husvarer</label>' +
      '<button type="submit" class="btn primary">Legg til</button></form>' + knownNamesDatalist() + '</div>';
  }
  // Merkevares ikoner (＋ og ⋯) i K-knagg-stil, inline så de arver farge.
  var ICON_ADD = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false"><path d="M12 5V19M5 12H19"/></svg>';
  var ICON_MORE = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false"><circle cx="5" cy="12" r="2.1" fill="currentColor" stroke="none"/><circle cx="12" cy="12" r="2.1" fill="currentColor" stroke="none"/><circle cx="19" cy="12" r="2.1" fill="currentColor" stroke="none"/></svg>';

  // v0.6.2 (spec v0.6.2 punkt 2): «⋯ Mer» – de sjeldne handlingene i et bunnark (samme .overlay/.sheet som basisvinduet).
  // Arket lukkes før handlingen kjøres. Testidene er de samme som før (kopier, fra-faste, fjern-avkrysning); basisvarer
  // har fått basis-meny, fordi basis brukes av basislinja.
  function openListMenu() {
    closeListMenu(false);
    var built = buildList();
    var nFast = built.staples.filter(function (x) { return x.on; }).length;
    var bs = built.basis, und = bs.filter(function (b) { return !b.choice; }).length, added = bs.filter(function (b) { return b.choice === 1; }).length;
    var nChecked = built.items.filter(function (i) { return i.checked; }).length;
    function row(action, testid, label, meta, extra) {
      return '<li><button type="button" class="menu-row" data-action="' + action + '" data-testid="' + testid + '"' + (extra || '') + '>' +
        '<span>' + esc(label) + '</span>' + (meta ? '<span class="mr-meta"' + (testid === 'fra-faste' ? ' data-testid="faste-antall"' : '') + '>' + esc(meta) + '</span>' : '') + '</button></li>';
    }
    var rows = row('copy-text', 'kopier', 'Kopier som tekst', '') +
      row('fast-open', 'fra-faste', 'Faste varer for uke ' + isoWeek(parseIso(built.weekKey)), nFast ? nFast + ' på lista' : 'ingen valgt', ' aria-haspopup="dialog"') +
      row('faste-page', 'alle-faste', 'Alle faste varer', state.staples.length ? state.staples.length + (state.staples.length === 1 ? ' vare' : ' varer') : 'ingen ennå') +
      (bs.length ? row('basis-open', 'basis-meny', 'Basisvarer', und ? und + ' ikke valgt' : added + ' av ' + bs.length + ' lagt til', ' aria-haspopup="dialog"') : '') +
      (nChecked ? row('uncheck-all', 'fjern-avkrysning', 'Fjern avkrysning …', nChecked + ' krysset av') : '');
    var d = document.createElement('div');
    d.id = 'list-menu';
    d.className = 'overlay';
    d.innerHTML = '<div class="sheet menu-sheet" role="dialog" aria-modal="true" aria-labelledby="mer-h">' +
      '<div class="sheet-head"><h3 id="mer-h">Lista</h3><button type="button" class="btn small" data-menu="close" data-testid="mer-lukk">Lukk</button></div>' +
      '<ul class="menu-rows">' + rows + '</ul></div>';
    document.body.appendChild(d);
    var mer = main.querySelector('[data-action="list-menu"]');
    if (mer) mer.setAttribute('aria-expanded', 'true');
    d.addEventListener('click', function (e) {
      if (e.target === d) { closeListMenu(true); return; }
      var b = e.target.closest('[data-menu], [data-action]');
      if (!b) return;
      if (b.getAttribute('data-menu') === 'close') { closeListMenu(true); return; }
      var a = b.getAttribute('data-action');
      closeListMenu(a === 'copy-text' || a === 'uncheck-all');
      if (a === 'copy-text') copyList();
      else if (a === 'fast-open') openFastDialog();
      else if (a === 'faste-page') { location.hash = '#liste/faste'; }
      else if (a === 'basis-open') openBasisDialog();
      else if (a === 'uncheck-all') uncheckAll();
    });
    d.addEventListener('keydown', function (e) {
      if (e.key === 'Escape') { e.preventDefault(); closeListMenu(true); return; }
      if (e.key === 'Tab') trapTab(d, e);
    });
    var first = d.querySelector('.menu-row');
    if (first) first.focus();
  }
  function closeListMenu(restoreFocus) {
    var d = document.getElementById('list-menu');
    if (!d) return;
    d.parentNode.removeChild(d);
    var mer = main.querySelector('[data-action="list-menu"]');
    if (mer) {
      mer.setAttribute('aria-expanded', 'false');
      if (restoreFocus) try { mer.focus({ preventScroll: true }); } catch (e) { mer.focus(); }
    }
  }
  function copyList() {
    var text = listAsText();
    if (!text) { toast('Alt er krysset av'); return; }
    copyText(text);
  }

  function srcBits(i, extra) {
    var src = [];
    if (i.plan && i.plan.showNeed) src.push('behov ' + i.plan.needText);
    if (i.recipes.length) src.push(i.recipes.join(', '));
    if (i.basisvare) src.push('basisvare');
    if (i.sources.indexOf('staple') >= 0) src.push('fast vare');
    if (i.sources.indexOf('extra') >= 0) src.push('lagt til');
    if (i.adjust && i.plan) src.push('justert ' + i.plan.adjText(i.adjust));
    return src.concat(extra || []);
  }
  function itemLi(i, o) {
    // Trengs mer enn det som ble krysset av: egen linje som brytes og aldri kuttes (v0.4.2).
    var note = !i.checked && typeof i.tick === 'number' ? U.sizeText(i.tick, i.unit) + ' krysset av' : '';
    return '<li class="item' + (i.checked ? ' checked' : '') + (i.qty === 0 ? ' zero' : '') + ' src-' + o.kind + '" data-key="' + esc(i.key) + '" data-row="' + esc(o.row) + '">' +
      '<label><input type="checkbox" data-key="' + esc(i.key) + '"' + (i.checked ? ' checked' : '') + '>' +
      '<span class="item-text"><span class="item-name">' + esc(cap(o.name)) + '</span>' +
      (o.qu ? ' <span class="item-qty">' + esc(o.qu) + '</span>' : '') +
      '<span class="item-src">' + (o.src.length ? '<span class="src-line">' + esc(o.src.join(' · ')) + '</span>' : '') +
      (note ? '<span class="src-note" data-testid="krysset-av">' + esc(note) + '</span>' : '') + '</span></span></label>' +
      (o.ctl ? '<div class="qty-ctl">' + o.ctl + '</div>' : '') + '</li>';
  }
  function butikkLi(i) {
    var pureExtra = i.sources.length === 1 && i.sources[0] === 'extra';
    return itemLi(i, { kind: i.source, row: i.key, name: i.name, qu: i.plan ? i.plan.text : '', src: srcBits(i),
      ctl: (pureExtra ? '<button type="button" class="qbtn" data-action="remove-extra" aria-label="Fjern ' + esc(i.name) + '">✕</button>' : '') +
        '<button type="button" class="qbtn" data-action="qty-dec" aria-label="Mindre ' + esc(i.name) + '"' + (i.qty ? '' : ' disabled') + '>−</button>' +
        '<button type="button" class="qbtn" data-action="qty-inc" aria-label="Mer ' + esc(i.name) + '">+</button>' });
  }
  // «Kilde»-rad: rettens egen mengde; hva som faktisk kjøpes (sammenslått + pakninger) står i liten tekst.
  // +/- finnes bare i «Butikk» (de endrer den sammenslåtte linja); egne varer kan fjernes med ✕ her også.
  function kildeLi(r) {
    var i = r.item, src = [];
    var tot = i.plan ? i.plan.text : '';
    // Bare når den sammenslåtte linja avviker: flere kilder, pakningsavrunding eller +/- (ikke «1 beger» vs «3 dl»).
    if (tot && tot !== r.amount && (r.shared || i.plan.showNeed || i.adjust)) src.push('i butikken: ' + tot);
    if (r.kind === 'dinner' && i.basisvare) src.push('basisvare');
    if (r.kind === 'staple') src.push('fast vare');
    return itemLi(i, { kind: r.kind === 'dinner' ? 'dinner' : r.kind, row: r.row, name: r.name, qu: r.amount, src: src,
      ctl: r.kind === 'extra' ? '<button type="button" class="qbtn" data-action="remove-extra" data-extras="' + esc(r.extra_ids.join(',')) + '" aria-label="Fjern ' + esc(r.name) + '">✕</button>' : '' });
  }

  function renderListSection() {
    var el = document.getElementById('list-section');
    if (!el) return;
    var built = buildList();
    var kilde = ui.sort === 'kilde';
    var left = built.items.filter(isOpen).length;
    // v0.6.2 (spec v0.6.2 punkt 2): kompakt topp – ukevelger (med «N middager · N igjen» i undertittelen), overskriften
    // «Sortering» (beholdt etter Sjefens valg, v0.4.3c), verktøylinje (sortering + ＋ + ⋯), basislinje bare når noe ikke er
    // avgjort, og skjemaet når ＋ er trykket. Kopier, faste varer, basisvarer og Fjern avkrysning ligger i «⋯ Mer».
    var stats = '<span data-testid="middager">' + built.dinners + ' middag' + (built.dinners === 1 ? '' : 'er') + '</span> · ' +
      '<span class="left" data-testid="igjen">' + left + ' igjen</span>';
    var h = weekNav(built.dates, stats);
    h += '<div class="sort-h" id="sort-h">Sortering</div>';
    h += '<div class="list-tools"><div class="seg sort" role="group" aria-labelledby="sort-h" data-testid="sortering">' + SORTS.map(function (x) {
      var on = ui.sort === x[0];
      return '<button type="button" data-action="sort" data-sort="' + x[0] + '" aria-pressed="' + on + '" title="' + x[2] + '"' +
        (on ? ' class="on"' : '') + '>' + x[1] + '</button>';
    }).join('') + '</div>' +
      '<button type="button" class="tool-btn" data-action="add-toggle" aria-label="Legg til vare" aria-expanded="' + (ui.addOpen ? 'true' : 'false') + '" data-testid="legg-til">' + ICON_ADD + '</button>' +
      '<button type="button" class="tool-btn more" data-action="list-menu" aria-haspopup="dialog" aria-expanded="false" aria-label="Mer: kopier, faste varer, basisvarer, fjern avkrysning" data-testid="mer">' + ICON_MORE + '<span>Mer</span></button></div>';   // v0.6.3 (spec v0.6.3 punkt 2): synlig tekst «Mer»
    h += basisStrip(built.basis);
    if (ui.addOpen) h += addItemForm();
    if (!built.items.length) {
      h += '<p class="empty">Lista er tom. Velg middager under <a href="#uke">Uke</a>, eller legg til varer.</p>';
      el.innerHTML = h;
      return;
    }
    if (!built.dinners) h += '<p class="hint">Ingen middager valgt ennå. <a href="#uke">Velg middager</a>.</p>';
    if (kilde) {
      sourceGroups(built).forEach(function (x) {
        h += '<h3 class="aisle src-head" data-group="' + esc(x.g.id) + '">' + esc(x.g.title) + '</h3>';
        if (!x.rows.length) {
          h += '<p class="src-empty">' + (x.g.skipped ? 'Bare basisvarer – ingen på lista' : 'Ingen varer') + '</p>';
          return;
        }
        h += '<ul class="items">' + x.rows.map(kildeLi).join('') + '</ul>';
      });
    } else {
      groupItems(built.items).forEach(function (g) {
        h += '<h3 class="aisle">' + esc(aisleLabel(g.aisle)) + '</h3><ul class="items">' + g.items.map(butikkLi).join('') + '</ul>';
      });
    }
    el.innerHTML = h;
  }

  // Lagrer det som kjøpes (hele pakninger), så en økning innenfor samme pakning ikke fjerner avkrysningen.
  function tickValue(it) { return it.buy != null && it.buy > 0 ? it.buy : true; }

  function uncheckAll() {
    var wk = weekDates(ui.weekOffset)[0];
    var n = currentItems().filter(function (i) { return i.week === wk && i.checked; }).length;
    if (!n) return;
    var stored = state.checks[wk] || {};
    var prev = {}, m = {};
    Object.keys(stored).forEach(function (k) { if (stored[k]) { prev[k] = stored[k]; m[k] = false; } });
    var wn = isoWeek(parseIso(wk));
    if (!window.confirm('Fjerne avkrysningen på ' + n + (n === 1 ? ' vare' : ' varer') + ' i uke ' + wn + '?' +
      (hh ? ' Dette gjelder hele husstanden.' : ''))) return;
    ops.setChecks(wk, m);
    flipRender();
    toast('Avkrysning fjernet (' + n + (n === 1 ? ' vare)' : ' varer)'), UNDO_MS, { label: 'Angre', run: function () {
      ops.setChecks(wk, prev);   // gjenoppretter nøyaktig de samme avkrysningene (også hos den andre telefonen)
      flipRender();               // rekkefølgen følger av avkrysningene, så plasseringene blir de samme som før
      toast('Avkrysningen er tilbake');
    } });
  }

  function adjustItem(key, dir) {
    var it = currentItems().filter(function (i) { return i.key === key; })[0];
    if (!it) return;
    // +/- tar utgangspunkt i det som kjøpes: neste mulige kjøp for kjente varer (v0.6.1: 7 dl melk → 1 l → «+» → 1,75 l → «+» → 2 l),
    // ellers ett steg i visningsenheten (100 g, 0,5 kg, 1 dl, 0,5 l, 1 ss, 1 stk …).
    var pl = it.plan;
    var step = pl ? pl.step : 1;
    var cur = pl ? pl.buy : 0;
    var next = dir > 0 ? cur + step : Math.max(0, cur - step);
    if (pl && pl.sizes) next = U.nextBuy(pl, dir);   // v0.6.1: neste mulige kjøp (én pakningsstørrelse)
    // Runder til nærmeste steg når vi går fra et «skjevt» tall (f.eks. 0,5 dl -> 1 dl).
    var ratio = round3(cur / step);
    if (!(pl && pl.packs) && ratio !== Math.round(ratio)) next = round3((dir > 0 ? Math.ceil(ratio) : Math.floor(ratio)) * step);
    var own = round3(next - (it.base_qty || 0) - (it.adjust_legacy || 0));
    ops.adjust(it.week, key, own, round3(own - (it.adjust_own || 0)));
    flipRender();                 // auto-ukrysset vare glir opp igjen
  }

  // v0.4.2: tegn lista på nytt og la radene gli til ny plass (FLIP). Siden ruller ikke: varen flyttes innenfor
  // sin avdeling, så alt over avdelingen står stille, og rulleposisjonen settes tilbake om nettleseren flytter den.
  var FLIP_MS = 220;
  function flipRender(fn) {
    var before = {};
    // v0.4.3b: radene identifiseres med data-row (i «Kilde» kan samme vare stå under flere retter).
    main.querySelectorAll('.item[data-row]').forEach(function (el) { before[el.getAttribute('data-row')] = el.getBoundingClientRect().top; });
    var active = document.activeElement, focusKey = active && active.matches && active.matches('.item input[type=checkbox]') ? active.closest('.item').getAttribute('data-row') : null;
    var sx = window.scrollX, sy = window.scrollY;
    (fn || renderListSection)();
    if (window.scrollY !== sy) window.scrollTo(sx, sy);
    if (focusKey && document.activeElement !== active) {
      var fk = main.querySelector('.item[data-row="' + (window.CSS && CSS.escape ? CSS.escape(focusKey) : focusKey) + '"] input[type=checkbox]');
      if (fk) try { fk.focus({ preventScroll: true }); } catch (e) { /* ignorer */ }
    }
    if (window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    var moved = [];
    main.querySelectorAll('.item[data-row]').forEach(function (el) {
      var b = before[el.getAttribute('data-row')];
      if (b == null) return;
      var d = b - el.getBoundingClientRect().top;
      if (Math.abs(d) < 1) return;
      el.style.transition = 'none';
      el.style.transform = 'translateY(' + d + 'px)';
      el.classList.add('moving');
      moved.push(el);
    });
    if (!moved.length) return;
    void document.body.offsetHeight;
    moved.forEach(function (el) { el.style.transition = 'transform ' + FLIP_MS + 'ms ease'; el.style.transform = ''; });
    setTimeout(function () { moved.forEach(function (el) { el.style.transition = ''; el.classList.remove('moving'); }); }, FLIP_MS + 40);
  }
  // Avkrysning: flytt de eksisterende radene (samme elementer, så fokus og avkrysningsboksen beholdes) i stedet for å
  // tegne alt på nytt. Faller tilbake til full tegning hvis noe ikke stemmer.
  function reorderInPlace() {
    var built = buildList();
    if (ui.sort === 'kilde') { renderListSection(); return; }
    var shown = built.items;
    var groups = groupItems(shown), ok = true, plan = [];
    groups.forEach(function (g) {
      var h = [].filter.call(main.querySelectorAll('h3.aisle'), function (e) { return e.textContent === aisleLabel(g.aisle); })[0];
      var ul = h && h.nextElementSibling;
      if (!ul || ul.children.length !== g.items.length) { ok = false; return; }
      var lis = g.items.map(function (i) {
        return [].filter.call(ul.children, function (li) { return li.getAttribute('data-key') === i.key; })[0];
      });
      if (lis.some(function (li) { return !li; })) { ok = false; return; }
      plan.push([ul, lis, g.items]);
    });
    if (!ok) { renderListSection(); return; }
    plan.forEach(function (p) {
      p[1].forEach(function (li, n) {
        var i = p[2][n];
        li.classList.toggle('checked', i.checked);
        var cb = li.querySelector('input[type=checkbox]');
        if (cb && cb.checked !== i.checked) cb.checked = i.checked;
        var note = li.querySelector('.src-note');
        if (note && i.checked) note.parentNode.removeChild(note);
        if (p[0].children[n] !== li) p[0].insertBefore(li, p[0].children[n] || null);
      });
    });
    var l = main.querySelector('[data-testid="igjen"]');
    if (l) l.textContent = shown.filter(isOpen).length + ' igjen';
    var ub = main.querySelector('[data-action="uncheck-all"]');
    if (ub) ub.hidden = !built.items.some(function (i) { return i.checked; });
  }
  // Dobbelttrykk: mens raden glir bort (og neste vare glir inn under fingeren) ignoreres et nytt trykk på nøyaktig
  // samme sted, så et utilsiktet dobbelttrykk verken krysser av feil vare eller fjerner avkrysningen igjen.
  // Alle andre trykk (andre steder, eller etter animasjonen) virker som normalt.
  var lastTick = null;

  main.addEventListener('input', function (e) {
    var t = e.target;
    if (t.id === 'fv-q') {
      ui.fvQ = t.value;
      // Debounce-ish: tegn på nytt med en gang (liste er liten)
      var pos = t.selectionStart;
      renderFastePage();
      var n = document.getElementById('fv-q');
      if (n) { n.focus(); try { n.setSelectionRange(pos, pos); } catch (x) {} }
    } else if (t.id === 'ai-name') {
      updateAddItemMatch();
    }
  });
  main.addEventListener('keydown', function (e) {
    if (e.key === 'Escape' && ui.fvOpenId && /^#liste\/faste/.test(location.hash || '')) {
      e.preventDefault();
      var id = ui.fvOpenId; fvCloseOpen(); renderFastePage();
      var rb = main.querySelector('.fv-item[data-id="' + id + '"]');
      if (rb) try { rb.focus({ preventScroll: true }); } catch (x) { rb.focus(); }
      return;
    }
    if (e.key === 'Enter' && e.target.id === 'fv-q') {
      e.preventDefault();
      var exact = findStapleByKey(e.target.value);
      if (exact) {
        ui.fvOpenId = exact.id; ui.fvOpenAisle = normAisle(exact.aisle); renderFastePage();
      } else if ((ui.fvQ || '').trim() && !exact) {
        var add = main.querySelector('[data-action="fv-add"]');
        if (add) add.click();
      }
    }
  });

  main.addEventListener('click', function (e) {
    var lab = e.target.closest && e.target.closest('.item label');
    if (!lab) return;
    var row = lab.closest('.item'), key = row.getAttribute('data-key');
    var now = Date.now();
    if (lastTick && row.classList.contains('moving') && now - lastTick.t < FLIP_MS && e.clientX && Math.abs(e.clientX - lastTick.x) < 12 && Math.abs(e.clientY - lastTick.y) < 12) {
      e.preventDefault(); e.stopPropagation(); return;
    }
    if (e.clientX || e.clientY) lastTick = { t: now, x: e.clientX, y: e.clientY, key: key };   // ikke tastatur/syntetiske klikk
  }, true);

  // ---------- v0.7: siden «Faste varer» (#liste/faste) ----------
  function renderFastePage() {
    var week = weekDates(ui.weekOffset)[0], wn = isoWeek(parseIso(week));
    var adj = state.list_adjust[week] || {};
    var nOn = state.staples.filter(function (s) { return stapleChosen(s, week, adj); }).length;
    var q = ui.fvQ || '';
    var qn = normName(q), qk = stapleKey(q);
    var exact = qk ? findStapleByKey(q) : null;
    var filtered = !qn ? state.staples.slice() : state.staples.filter(function (s) {
      return normName(s.name).indexOf(qn) >= 0 || stapleKey(s.name).indexOf(qk) >= 0 || stapleKey(s.name) === qk;
    });
    // Mens en rad er åpen: hold den i avdelingen den ble åpnet i (selv om avdeling er byttet).
    function aisleOf(s) {
      if (ui.fvOpenId && s.id === ui.fvOpenId && ui.fvOpenAisle) return ui.fvOpenAisle;
      return normAisle(s.aisle);
    }
    var groups = staplesGrouped(filtered, aisleOf);
    var h = '<section class="page fv-page" data-page="liste" data-testid="faste-side">';
    h += '<div class="fv-top"><a class="icon-btn" href="#liste" aria-label="Tilbake til lista" data-testid="faste-tilbake">‹</a>';
    h += '<div class="t"><h2>Faste varer</h2><span class="sub">' +
      (state.staples.length ? state.staples.length + (state.staples.length === 1 ? ' vare' : ' varer') + ' · i butikkens rekkefølge' : 'Ingen faste varer ennå') +
      '</span></div></div>';
    h += '<div class="fv-search">' + ICON_SEARCH +
      '<input type="search" id="fv-q" placeholder="Søk eller legg til …" aria-label="Søk eller legg til fast vare" value="' + esc(q) + '" autocomplete="off" data-testid="faste-sok"></div>';
    if (!state.staples.length && !qn) {
      h += '<div class="fv-empty" data-testid="faste-tom"><p class="lead">Her samler dere det huset kjøper igjen og igjen. Skriv det inn én gang.</p>' +
        '<p class="hint" style="margin:0">Avdeling og enhet gjettes fra navnet, for eksempel:</p>' +
        '<ul class="fv-ex" aria-label="Eksempler"><li><span>melk</span><span class="g">→ 1 l · Kjøl</span></li>' +
        '<li><span>bananer</span><span class="g">→ 1 stk · Frukt/grønt</span></li>' +
        '<li><span>dopapir</span><span class="g">→ 1 pk · Husholdning</span></li></ul>' +
        '<p class="hint" style="margin:2px 0 0">Hver uke velger dere selv hva som skal på lista. Ingenting kommer på av seg selv.</p></div>';
    } else {
      if (!qn) {
        var bridge = nOn
          ? ('Uke ' + wn + ': ' + nOn + ' faste varer på lista')
          : ('Uke ' + wn + ': ingen faste varer valgt ennå');
        h += '<button type="button" class="fv-bridge" data-action="fast-open" data-testid="faste-bro">' +
          '<span class="t">' + esc(bridge) + '</span><span class="go" aria-hidden="true">' + (nOn ? 'Endre ›' : 'Velg ›') + '</span></button>';
      }
      if (qn && exact) {
        h += '<p class="fv-msg" data-testid="faste-finnes">«' + esc(cap(q)) + '» finnes allerede' +
          (normName(q) === normName(exact.name) ? '' : ' («' + esc(cap(exact.name)) + '» er samme vare)') +
          ', så det blir ingen ny. Trykk på den for å endre.</p>';
      } else if (qn && !exact) {
        var ga = guessAisle(q) || 'Tørrvare', gu = guessUnit(q, ga);
        h += '<p class="fv-hit">Ingen faste varer heter «' + esc(q) + '».</p>';
        h += '<div class="fv-new" data-testid="faste-ny" data-aisle="' + esc(ga) + '" data-unit="' + esc(gu) + '" data-qty="1">' +
          '<span class="nm">' + esc(cap(q)) + '</span>' +
          '<div class="guess">' +
          '<button type="button" class="g" data-action="fv-edit-guess" data-field="amt" data-testid="faste-ny-mengde"><span class="k">Mengde</span>1 ' + esc(gu) + '</button>' +
          '<button type="button" class="g" data-action="fv-edit-guess" data-field="aisle" data-testid="faste-ny-avdeling"><span class="k">Avdeling</span>' + esc(aisleLabel(ga)) + '</button>' +
          '</div><span class="small">Gjettet fra navnet. Trykk for å endre.</span>' +
          '<div class="acts"><label class="check"><input type="checkbox" id="fv-on-list" data-testid="faste-ny-pa-lista">På lista uke ' + wn + '</label>' +
          '<button type="button" class="btn primary" data-action="fv-add" data-testid="faste-legg-til">Legg til</button></div></div>';
        if (filtered.length) h += '<p class="fv-hit" style="margin-top:14px">' + filtered.length + ' faste varer passer.</p>';
      } else if (qn && filtered.length) {
        h += '<p class="fv-hit">' + filtered.length + ' faste varer passer.</p>';
      }
      groups.forEach(function (g) {
        h += '<h4 class="fv-group-h">' + esc(aisleLabel(g.aisle)) + '<span>' + g.items.length + '</span></h4><ul class="fv-rows">';
        g.items.forEach(function (s) {
          var open = ui.fvOpenId === s.id;
          var isExact = exact && exact.id === s.id;
          h += '<li class="' + (open ? 'open' : '') + (isExact ? ' dup' : '') + '" data-id="' + esc(s.id) + '">';
          h += '<button type="button" class="fv-item" data-action="fv-toggle" data-id="' + esc(s.id) + '" aria-expanded="' + (open ? 'true' : 'false') + '" data-testid="faste-rad">' +
            '<span class="tx"><span class="nm">' + esc(cap(s.name)) + '</span> <span class="q">' + esc(stapleAmt(s)) + '</span>' +
            (isExact ? '<span class="fv-same">Finnes</span>' : '') + '</span>' +
            '<span class="pen" aria-hidden="true">' + ICON_PEN + '</span></button>';
          if (open) h += fvEditorHtml(s);
          h += '</li>';
        });
        h += '</ul>';
      });
    }
    h += '</section>';
    main.innerHTML = h;
    var inp = document.getElementById('fv-q');
    if (inp) {
      if (!state.staples.length && !qn) try { inp.focus({ preventScroll: true }); } catch (e) { inp.focus(); }
      else if (ui.fvOpenId) {
        var ed = main.querySelector('.fv-editor .st-name');
        if (ed) try { ed.focus({ preventScroll: true }); } catch (e2) { ed.focus(); }
      }
    }
  }
  function fvEditorHtml(s) {
    var h = '<div class="fv-editor" data-testid="faste-rediger">' +
      '<p class="note">Lagres med en gang og gjelder alle uker.</p>' +
      '<div><label class="lbl" for="fv-name-' + esc(s.id) + '">Navn</label>' +
      '<input type="text" class="st-name" id="fv-name-' + esc(s.id) + '" value="' + esc(s.name) + '" aria-label="Navn" autocomplete="off" data-testid="faste-navn">' +
      '<p class="err" hidden data-testid="faste-navn-feil"></p></div>' +
      '<div><span class="lbl">Mengde</span><div class="fv-amt">' +
      '<button type="button" class="qbtn" data-action="fv-qty" data-dir="-1" aria-label="Mindre">−</button>' +
      '<input type="text" class="st-qty" inputmode="decimal" value="' + esc(formatQty(s.qty == null ? 1 : s.qty)) + '" aria-label="Mengde" data-testid="faste-mengde">' +
      '<button type="button" class="qbtn" data-action="fv-qty" data-dir="1" aria-label="Mer">+</button>' +
      '<select class="st-unit" aria-label="Enhet" data-testid="faste-enhet">' + unitOptions(s.unit || 'stk') + '</select></div></div>' +
      '<div><span class="lbl">Avdeling</span><div class="fv-chips" role="group" aria-label="Avdeling">';
    AISLES.forEach(function (a) {
      var on = normAisle(s.aisle) === a;
      h += '<button type="button" class="fv-chip' + (on ? ' on' : '') + '" data-action="fv-aisle" data-aisle="' + esc(a) + '" aria-pressed="' + (on ? 'true' : 'false') + '">' + esc(aisleLabel(a)) + '</button>';
    });
    h += '</div></div><div class="fv-ed-acts">' +
      '<button type="button" class="fv-del" data-action="fv-delete" data-testid="faste-slett">Slett vare</button>' +
      '<button type="button" class="btn primary" data-action="fv-done" data-testid="faste-ferdig">Ferdig</button></div></div>';
    return h;
  }
  function fvCloseOpen() {
    ui.fvOpenId = null; ui.fvOpenAisle = null;
  }
  function fvSaveField(id, fields) {
    var s = state.staples.filter(function (x) { return x.id === id; })[0];
    if (!s) return;
    if (fields.name != null) {
      var nm = String(fields.name).trim();
      if (!nm) { fields.name = s.name; }
      else {
        var dup = findStapleByKey(nm, id);
        if (dup) {
          var err = main.querySelector('.fv-editor .err');
          if (err) { err.hidden = false; err.textContent = cap(dup.name) + ' finnes allerede'; }
          var inp = main.querySelector('.fv-editor .st-name');
          if (inp) inp.value = s.name;
          return false;
        }
        fields.name = nm;
      }
    }
    if (fields.qty != null) fields.qty = parseQty(fields.qty);
    if (fields.aisle != null) fields.aisle = normAisle(fields.aisle);
    ops.updateStaple(s, fields);
    var err2 = main.querySelector('.fv-editor .err');
    if (err2) { err2.hidden = true; err2.textContent = ''; }
    return true;
  }

  function renderStaplesSection() { /* v0.7: fjernet – se renderFastePage */ }

  function copyText(text, okMsg) {
    okMsg = okMsg || 'Lista er kopiert';
    function fallback() {
      var ta = document.createElement('textarea');
      ta.value = text;
      ta.setAttribute('readonly', '');
      ta.style.position = 'fixed'; ta.style.top = '0'; ta.style.left = '0'; ta.style.opacity = '0';
      document.body.appendChild(ta);
      ta.focus(); ta.select();
      try { ta.setSelectionRange(0, text.length); } catch (e) { /* ignorer */ }
      var ok = false;
      try { ok = document.execCommand('copy'); } catch (e) { ok = false; }
      document.body.removeChild(ta);
      if (ok) toast(okMsg); else showCopyDialog(text);
    }
    if (navigator.clipboard && navigator.clipboard.writeText && window.isSecureContext) {
      navigator.clipboard.writeText(text).then(function () { toast(okMsg); }, fallback);
    } else {
      fallback();
    }
  }

  function showCopyDialog(text) {
    var old = document.getElementById('copy-dialog');
    if (old) old.parentNode.removeChild(old);
    var d = document.createElement('div');
    d.id = 'copy-dialog';
    d.className = 'overlay';
    d.innerHTML = '<div class="sheet" role="dialog" aria-label="Kopier"><h3>Kopier</h3>' +
      '<p class="hint">Kopiering virket ikke automatisk. Merk teksten og kopier.</p>' +
      '<textarea readonly rows="12"></textarea><button type="button" class="btn primary" data-close>Lukk</button></div>';
    d.querySelector('textarea').value = text;
    d.addEventListener('click', function (e) {
      if (e.target === d || e.target.hasAttribute('data-close')) d.parentNode.removeChild(d);
    });
    document.body.appendChild(d);
    var ta = d.querySelector('textarea');
    ta.focus(); ta.select();
  }


  // v0.7 (Merkevare 3.4 / skjerm 4b): «＋ Legg til vare» gjenkjenner eksisterende fast vare.
  function updateAddItemMatch() {
    var form = document.getElementById('item-add'); if (!form) return;
    var nameEl = document.getElementById('ai-name'); if (!nameEl) return;
    var hit = findStapleByKey(nameEl.value);
    var old = form.querySelector('.ai-match'); if (old) old.parentNode.removeChild(old);
    var sub = form.querySelector('[type=submit]');
    if (hit) {
      form.classList.add('staple-match');
      var wn = isoWeek(parseIso(weekDates(ui.weekOffset)[0]));
      var box = document.createElement('div');
      box.className = 'ai-match'; box.setAttribute('role', 'status'); box.setAttribute('data-testid', 'ai-fast-treff');
      box.innerHTML = '<span class="ok" aria-hidden="true">✓</span><span><b>' + esc(cap(hit.name)) + '</b> er en fast vare. Den legges på lista uke ' + wn + ' som fast vare.' +
        '<span class="m">' + esc(stapleAmt(hit) || '1') + ' · ' + esc(aisleLabel(normAisle(hit.aisle))) + '</span></span>';
      nameEl.insertAdjacentElement('afterend', box);
      if (sub) sub.textContent = 'Legg på lista';
    } else {
      form.classList.remove('staple-match');
      if (sub) sub.textContent = 'Legg til';
    }
  }

  /* ---------- Hendelser ---------- */

  main.addEventListener('click', function (e) {
    var btn = e.target.closest('[data-action]');
    if (!btn) return;
    var a = btn.getAttribute('data-action');
    if (a === 'add-ing') {
      var list = document.getElementById('ing-list');
      list.insertAdjacentHTML('beforeend', ingredientRow(null));
      list.lastElementChild.querySelector('.ing-name').focus();
    } else if (a === 'remove-ing') {
      var row = btn.closest('.ing-row');
      row.parentNode.removeChild(row);
    } else if (a === 'delete-recipe') {
      deleteRecipe(document.getElementById('recipe-form').getAttribute('data-id'));
    } else if (a === 'reset-seed') {
      if (hh) return;
      if (!window.confirm('Tilbakestille til testdata? Alle retter, ukeplaner og faste varer erstattes.')) return;
      state = freshState();
      save();
      toast('Testdata er tilbakestilt');
      renderRetter();
    } else if (a === 'swap-start') {
      startSwap(btn.getAttribute('data-date'));
    } else if (a === 'swap-cancel') {
      cancelSwap(true);
    } else if (a === 'swap-to') {
      if (ui.swap) swapNow(ui.swap.from, btn.getAttribute('data-date'));
    } else if (a === 'week-prev' || a === 'week-next' || a === 'week-now') {
      // Én felles uke for Uke og Liste.
      ui.swap = null;
      ui.weekOffset = a === 'week-now' ? 0 : ui.weekOffset + (a === 'week-next' ? 1 : -1);
      ui.weekTouched = true;
      route();
    }
    else if (a === 'fill-weekdays') { fillWeekdays(); }
    else if (a === 'remove-oneoff') { removeOneoff(btn.getAttribute('data-date')); }
    else if (a === 'lib-add') { if (Date.now() - lib.lastSwipe > 300) addFromLibrary(btn.getAttribute('data-lib-id')); }
    else if (a === 'lib-next' || a === 'lib-prev') { stepSuggestion(a === 'lib-next' ? 1 : -1); }
    else if (a === 'clear-week') {
      // Alle sju dagene settes til tom (også engangsmiddager). Handlelistas egne varer, faste varer, avkrysning og +/- røres ikke.
      var wk = weekDates(ui.weekOffset);
      var wn = isoWeek(parseIso(wk[0]));
      if (!window.confirm(hh
        ? 'Tømme alle kvelder i uke ' + wn + ', også engangsmiddager? Dette gjelder hele husstanden. Varer lagt til selv og faste varer blir stående.'
        : 'Tømme alle kvelder i uke ' + wn + ', også engangsmiddager? Varer lagt til selv og faste varer blir stående.')) return;
      ops.setDays(wk.map(function (d) { return { date: d, recipe_id: null, oneoff: null }; }));
      toast('Uke ' + wn + ' er tømt');
      renderUke();
    } else if (a === 'copy-text') {
      copyList();
    } else if (a === 'welcome-close') {
      // v0.6.2: lukket for godt (per telefon). Fokus til «Fyll man–fre», neste naturlige handling.
      ui.welcomeClosed = true;
      lsSet(WELCOME_KEY, '1');
      renderUke();
      focusEl('[data-testid="fyll"]', '.week-nav [data-action="week-next"]');
    } else if (a === 'add-toggle') {
      ui.addOpen = !ui.addOpen;
      renderListSection();
      var af = ui.addOpen ? document.getElementById('ai-name') : main.querySelector('[data-action="add-toggle"]');
      if (af) try { af.focus({ preventScroll: true }); } catch (x) { af.focus(); }
    } else if (a === 'list-menu') {
      openListMenu();
    } else if (a === 'uncheck-all') {
      uncheckAll();
    } else if (a === 'basis-open') {
      openBasisDialog();
    } else if (a === 'fast-open') {
      openFastDialog();
    } else if (a === 'sort') {
      // v0.4.3b/c: Matrett ('kilde') / Plassering ('butikk'), huskes per telefon (localStorage), synkes ikke.
      ui.sort = btn.getAttribute('data-sort') === 'kilde' ? 'kilde' : 'butikk';
      lsSet(SORT_KEY, ui.sort);
      renderListSection();
      var sb = main.querySelector('[data-action="sort"][data-sort="' + ui.sort + '"]');
      if (sb) try { sb.focus({ preventScroll: true }); } catch (x) { sb.focus(); }
    } else if (a === 'qty-inc' || a === 'qty-dec') {
      adjustItem(btn.closest('.item').getAttribute('data-key'), a === 'qty-inc' ? 1 : -1);
    } else if (a === 'remove-extra') {
      var key = btn.closest('.item').getAttribute('data-key');
      var it = currentItems().filter(function (i) { return i.key === key; })[0];
      if (!it) return;
      // «Kilde»: ✕ fjerner bare egne varer på denne raden (data-extras); «Butikk»: hele den rene egen-linja.
      var ids = btn.hasAttribute('data-extras') ? btn.getAttribute('data-extras').split(',').filter(Boolean) : it.extra_ids.slice();
      ops.removeExtras(ids);
      var pure = it.sources.length === 1 && it.sources[0] === 'extra';
      if (it.adjust && pure && it.extra_ids.every(function (x) { return ids.indexOf(x) >= 0; })) ops.clearAdjust(it.week, key);
      renderListSection();
    } else if (a === 'fv-toggle') {
      var id = btn.getAttribute('data-id');
      if (ui.fvOpenId === id) fvCloseOpen();
      else {
        var s0 = state.staples.filter(function (x) { return x.id === id; })[0];
        ui.fvOpenId = id; ui.fvOpenAisle = s0 ? normAisle(s0.aisle) : null;
      }
      renderFastePage();
    } else if (a === 'fv-done') {
      var doneId = ui.fvOpenId; fvCloseOpen(); renderFastePage();
      var rb = main.querySelector('.fv-item[data-id="' + doneId + '"]');
      if (rb) try { rb.focus({ preventScroll: true }); } catch (x) { rb.focus(); }
    } else if (a === 'fv-delete') {
      var ds = state.staples.filter(function (x) { return x.id === ui.fvOpenId; })[0];
      if (!ds) return;
      var copy = { id: ds.id, name: ds.name, qty: ds.qty, unit: ds.unit, aisle: ds.aisle, active: ds.active !== false };
      ops.deleteStaple(ds.id); fvCloseOpen();
      toast(cap(copy.name) + ' er slettet', UNDO_MS, { label: 'Angre', run: function () {
        ops.addStaple(copy);
        toast(cap(copy.name) + ' er tilbake');
        if (/^#liste\/faste/.test(location.hash || '')) renderFastePage();
      }});
      renderFastePage();
    } else if (a === 'fv-aisle') {
      if (!ui.fvOpenId) return;
      fvSaveField(ui.fvOpenId, { aisle: btn.getAttribute('data-aisle') });
      renderFastePage();
    } else if (a === 'fv-qty') {
      if (!ui.fvOpenId) return;
      var qi = main.querySelector('.fv-editor .st-qty');
      var qv = (parseQty(qi && qi.value) || 0) + (+btn.getAttribute('data-dir') || 0);
      if (qv < 0) qv = 0;
      fvSaveField(ui.fvOpenId, { qty: qv });
      renderFastePage();
    } else if (a === 'fv-add') {
      var card = main.querySelector('.fv-new'); if (!card) return;
      var nm = (ui.fvQ || '').trim(); if (!nm) return;
      if (findStapleByKey(nm)) { renderFastePage(); return; }
      var nid = uid('s');
      var aisle = card.getAttribute('data-aisle') || 'Tørrvare';
      var unit = card.getAttribute('data-unit') || 'stk';
      var qty = parseQty(card.getAttribute('data-qty')) || 1;
      ops.addStaple({ id: nid, name: nm, qty: qty, unit: unit, aisle: aisle, active: true });
      var onList = document.getElementById('fv-on-list');
      if (onList && onList.checked) {
        var fm = {}; fm[nid] = 1; ops.setFast(weekDates(ui.weekOffset)[0], fm);
      }
      toast(cap(nm) + ' er lagt til (' + aisleLabel(aisle) + ')');
      ui.fvQ = ''; fvCloseOpen(); renderFastePage();
      var sq = document.getElementById('fv-q'); if (sq) sq.focus();
    } else if (a === 'fv-edit-guess') {
      var card2 = main.querySelector('.fv-new'); if (!card2) return;
      var field = btn.getAttribute('data-field');
      if (field === 'aisle') {
        var curA = card2.getAttribute('data-aisle') || 'Tørrvare';
        var ix = AISLES.indexOf(curA); card2.setAttribute('data-aisle', AISLES[(ix + 1) % AISLES.length]);
      } else {
        var curU = card2.getAttribute('data-unit') || 'stk';
        var units = ['stk', 'pk', 'l', 'kartong', 'beger', 'flaske', 'glass', 'rull', 'pose', 'boks'];
        var ux = units.indexOf(curU); card2.setAttribute('data-unit', units[(ux + 1) % units.length]);
      }
      // Oppdater brikkene uten full omtegning (behold søketekst og fokus)
      var ga2 = card2.getAttribute('data-aisle'), gu2 = card2.getAttribute('data-unit');
      var bAmt = card2.querySelector('[data-field="amt"]'), bAisle = card2.querySelector('[data-field="aisle"]');
      if (bAmt) bAmt.innerHTML = '<span class="k">Mengde</span>1 ' + esc(gu2);
      if (bAisle) bAisle.innerHTML = '<span class="k">Avdeling</span>' + esc(aisleLabel(ga2));
    } else if (a === 'create-household') {
      startCreate();
    } else if (a === 'dismiss-share') {
      // v0.4.6: «Ikke nå» på delingskortet – vises ikke igjen (ingen ekstra beskjed); deling finnes fortsatt under Retter.
      lsSet(ONBOARD_KEY, 'dismissed');
      renderUke();
      focusEl('.row-actions a');
    } else if (a === 'join') {
      startJoin(btn.getAttribute('data-hid'), btn.getAttribute('data-secret'));
    } else if (a === 'copy-link') {
      copyText(shareLink(), 'Lenka er kopiert');
    }
  });

  main.addEventListener('change', function (e) {
    var t = e.target;
    if (t.classList.contains('day-select')) {
      setDay(t.getAttribute('data-date'), t.value);
    } else if (t.type === 'checkbox' && t.hasAttribute('data-key')) {
      var key = t.getAttribute('data-key');
      var cur = currentItems();
      var week = cur.length ? cur[0].week : weekDates(ui.weekOffset)[0];
      var m = {};
      var wchecks = state.checks[week] || {};
      cur.forEach(function (i) {
        if (i.key !== key) return;
        i.checked = t.checked; i.tick = m[key] = t.checked ? tickValue(i) : false;
        (i.legacyKeys || []).forEach(function (x) { if (wchecks[x.k]) m[x.k] = false; });   // gamle nøkler ryddes
      });
      if (!m.hasOwnProperty(key)) m[key] = t.checked;
      ops.setChecks(week, m);
      // v0.4.2: avkrysset vare glir ned nederst i avdelingen (ukrysset glir opp igjen).
      flipRender(reorderInPlace);
    } else if (t.classList.contains('ing-basis-cb')) {
      t.setAttribute('data-touched', '1');
    } else if (t.classList.contains('ing-name') || t.id === 'ai-name') {
      var row = t.classList.contains('ing-name') ? t.closest('.ing-row') : null;
      var bcb = row && row.querySelector('.ing-basis-cb');
      if (bcb && !bcb.hasAttribute('data-touched')) {
        var kb = knownIngredient(t.value, false);
        bcb.checked = kb && typeof kb.basis === 'boolean' ? kb.basis : U.isBasisName(t.value);
      }
      if (row && row.getAttribute('data-new') !== '1') return;
      var k = knownIngredient(t.value, !row);
      if (k) {
        if (row) {
          row.querySelector('.ing-unit').value = k.unit || '';
          row.querySelector('.ing-aisle').value = normAisle(k.aisle);
        } else {
          document.getElementById('ai-aisle').value = normAisle(k.aisle);
        }
      } else if (!row && !document.getElementById('ai-aisle').hasAttribute('data-picked')) {
        document.getElementById('ai-aisle').value = guessAisle(t.value) || 'Tørrvare';   // v0.6.1
      }
      if (row) row.setAttribute('data-new', '0');
      if (!row) updateAddItemMatch();   // v0.7: gjenkjenn fast vare i «Legg til vare»
    } else if (t.id === 'ai-aisle') {
      t.setAttribute('data-picked', '1');
    } else if (t.closest('.fv-editor')) {
      // v0.7: live-lagring i redigering på stedet
      if (!ui.fvOpenId) return;
      if (t.classList.contains('st-name')) {
        if (!fvSaveField(ui.fvOpenId, { name: t.value })) return;
      } else if (t.classList.contains('st-qty')) {
        fvSaveField(ui.fvOpenId, { qty: t.value });
        t.value = formatQty(parseQty(t.value));
      } else if (t.classList.contains('st-unit')) {
        fvSaveField(ui.fvOpenId, { unit: t.value });
      }
      // Ikke tegn hele siden på nytt for navn/mengde (behold fokus); avdeling tegnes via klikk.
    }
  });

  main.addEventListener('toggle', function (e) {
    if (!e.target.classList) return;
    if (e.target.classList.contains('staples')) ui.staplesOpen = e.target.open;
  }, true);

  main.addEventListener('submit', function (e) {
    e.preventDefault();
    var id = e.target.id;
    if (id === 'recipe-form') saveRecipeForm(e.target);
    else if (id === 'oneoff-form') saveOneoffForm(e.target);
    else if (id === 'item-add') {
      var name = document.getElementById('ai-name').value.trim();
      if (!name) { document.getElementById('ai-name').focus(); return; }
      var wkDates = weekDates(ui.weekOffset), wn = isoWeek(parseIso(wkDates[0]));
      var hit = findStapleByKey(name);
      var msg;
      if (hit) {
        // v0.7: treff på fast vare → legg på som fast vare (ingen list_extras, ingen ny fast vare)
        var adj = state.list_adjust[wkDates[0]] || {};
        if (stapleChosen(hit, wkDates[0], adj)) {
          toast(cap(hit.name) + ' står allerede på lista');
        } else {
          var fm2 = {}; fm2[hit.id] = 1; ops.setFast(wkDates[0], fm2);
          toast(cap(hit.name) + ' (fast vare) er på lista for uke ' + wn);
        }
      } else if (document.getElementById('ai-staple') && document.getElementById('ai-staple').checked) {
        // Duplikatsjekk også når «Legg til i faste husvarer» er krysset av
        if (findStapleByKey(name)) { toast(cap(name) + ' finnes allerede som fast vare'); return; }
        var q = parseQty(document.getElementById('ai-qty').value);
        var item = { id: uid('s'), name: name, qty: q == null ? 1 : q, unit: document.getElementById('ai-unit').value || guessUnit(name),
          aisle: document.getElementById('ai-aisle').value || guessAisle(name) || 'Tørrvare', active: true };
        ops.addStaple(item);
        var fm3 = {}; fm3[item.id] = 1; ops.setFast(wkDates[0], fm3);
        msg = 'Lagt til i lista og i faste husvarer';
        toast(msg);
      } else {
        var q2 = parseQty(document.getElementById('ai-qty').value);
        var item2 = { id: uid('x'), name: name, qty: q2 == null ? 1 : q2, unit: document.getElementById('ai-unit').value,
          aisle: document.getElementById('ai-aisle').value, week: wkDates[0], created: Date.now() };
        ops.addExtra(item2);
        toast('Lagt til i lista for uke ' + wn);
      }
      ui.addOpen = true;
      renderListSection();
      var an = document.getElementById('ai-name'); if (an) { an.value = ''; an.focus(); updateAddItemMatch(); }
    }
  });

  // v0.4.4: Esc avbryter byttemodus (fokus tilbake til «Bytt» på dagen).
  document.addEventListener('keydown', function (e) {
    if (e.key === 'Escape' && ui.swap && !document.querySelector('.overlay:not([hidden])')) { e.preventDefault(); cancelSwap(true); }
  });

  window.addEventListener('hashchange', function () {
    ui.swap = null;
    if (!/^#liste\/faste/.test(location.hash || '')) { ui.fvOpenId = null; ui.fvOpenAisle = null; ui.fvQ = ''; }
    closeBasisDialog(false);
    closeSheet('fast-dialog', false);
    closeListMenu(false);
    ui.error = '';
    if (!/^#husstand/.test(location.hash)) ui.justCreated = false;
    route(); window.scrollTo(0, 0);
    if (toastShowing()) placeToast();   // v0.6.2/v0.6.3: båndet over lagre-linja i skjemaene, ellers rett over fanelinja
  });

  /* ---------- Oppstart ---------- */

  loadLocal();
  var info = readHH();
  if (info && syncMode() && info.core_done) {
    enterHousehold(info);
  } else if (info && syncMode()) {
    // Oppretting ble avbrutt før husstanden var bekreftet: bli lokal, og sjekk i bakgrunnen om den faktisk ble opprettet.
    Sync.init().then(function () { return Sync.isMember(info.hid); }).then(function (m) {
      if (m) { info.core_done = true; writeHH(info); enterHousehold(info); route(); }
      else if (m === false) { try { localStorage.removeItem(HH_KEY); } catch (x) { /* ignorer */ } }
    }, function () { /* prøver igjen neste gang */ });
  }
  // v0.4.6 (spec v0.4 punkt 6): første åpning viser appen med startdata. Deling tilbys ikke som første skjerm, men som
  // et lite kort i Uke etter første plan (showShareCard). Firebase (SDK, anonym innlogging) startes først når man
  // oppretter/blir med i en husstand, eller hvis telefonen allerede er med i en.
  ui.weekOffset = defaultWeekOffset();
  route();

  // Åpnes appen igjen etter en stund (f.eks. søndag kveld → mandag), velges riktig uke på nytt.
  var hiddenAt = 0;
  document.addEventListener('visibilitychange', function () {
    if (document.hidden) { hiddenAt = Date.now(); return; }
    if (!hiddenAt || Date.now() - hiddenAt < 30 * 60000) return;
    hiddenAt = 0;
    var d = defaultWeekOffset();
    if (d === ui.weekOffset && !ui.weekTouched) return;
    ui.weekOffset = d; ui.weekTouched = false;
    if (!isTyping() && !isFormRoute()) route();
  });

  if ('serviceWorker' in navigator && (location.protocol === 'https:' || location.hostname === 'localhost' || location.hostname === '127.0.0.1')) {
    window.addEventListener('load', function () {
      navigator.serviceWorker.register('sw.js').catch(function () { /* frakoblet-støtte er valgfri */ });
    });
  }
})();
