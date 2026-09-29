/* Ukeshandel v0.2 — ukeplan for middager + handleliste, delt i husstanden via Firebase.
 * Uten Firebase-oppsett (eller før husstand er opprettet) lagres alt lokalt i nettleseren som før.
 */
(function () {
  'use strict';

  var STORAGE_KEY = 'ukeshandel:v1';
  var HH_KEY = 'ukeshandel:household';            // { hid, secret, core_done, migrated }
  var ONBOARD_KEY = 'ukeshandel:onboarding';      // 'dismissed'
  var MIRROR_PREFIX = 'ukeshandel:hh-mirror:';    // siste kjente husstandsdata (rask oppstart)
  var DATA_VERSION = 1;   // holdes på 1 så eldre app-versjoner ikke nullstiller data
  var SCHEMA = 3;         // intern skjemaversjon for lokale data (migreres ved lasting)
  var AISLES = ['Frukt/grønt', 'Kjøl', 'Frys', 'Tørrvare', 'Hus'];
  var AISLE_LABELS = { 'Hus': 'Husholdning' };
  var UNITS = ['stk', 'g', 'kg', 'dl', 'l', 'ss', 'ts', 'pk', 'boks', 'glass', 'beger', 'flaske', 'fedd', 'bunt'];
  var DAY_NAMES = ['Mandag', 'Tirsdag', 'Onsdag', 'Torsdag', 'Fredag', 'Lørdag', 'Søndag'];
  var DAY_SHORT = ['man', 'tir', 'ons', 'tor', 'fre', 'lør', 'søn'];
  var FILTERS = [['alle', 'Alle'], ['middag', 'Middag'], ['faste', 'Faste varer']];

  var main = document.getElementById('main');
  var state = null;
  var memoryOnly = false;
  var hadLocalData = false;
  var ui = { weekOffset: 0, staplesOpen: false, addOpen: false, filter: 'alle', notice: '', justCreated: false, busy: false, error: '' };
  var Sync = window.UkeshandelSync || null;
  var hh = null;             // husstandsinfo når vi er i husstandsmodus
  var syncReady = null;      // promise: SDK lastet, innlogget, medlemskap sjekket
  var syncStatus = { pending: false, fromCache: true, failed: false };

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
    return String(s || '').trim().toLowerCase().replace(/\s+/g, ' ');
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
  function qtyUnit(q, unit) {
    var f = formatQty(q);
    if (!f) return '';
    return unit ? f + ' ' + unit : f;
  }
  function stepFor(unit) {
    return { g: 100, kg: 0.5, l: 0.5 }[unit] || 1;
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

  var toastTimer = null;
  function toast(msg, ms) {
    var t = document.getElementById('toast');
    t.textContent = msg;
    t.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { t.classList.remove('show'); }, ms || 2500);
  }

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
  function knownIngredient(name) {
    var n = normName(name);
    if (!n) return null;
    for (var i = 0; i < state.recipes.length; i++) {
      var ings = state.recipes[i].ingredients;
      for (var j = 0; j < ings.length; j++) if (normName(ings[j].name) === n) return ings[j];
    }
    for (var k = 0; k < state.staples.length; k++) if (normName(state.staples[k].name) === n) return state.staples[k];
    return null;
  }
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
      syncStatus.failed = true;
      renderSyncStatus();
      if (e && e.code === 'permission-denied') toast('Ingen tilgang til husstanden. Åpne invitasjonslenka på nytt.', 5000);
    });
  }

  var unsubscribe = null;
  function subscribeHousehold() {
    if (unsubscribe) unsubscribe();
    unsubscribe = Sync.subscribe(hh.hid, oldestWeek(), {
      recipes: function (docs) {
        state.recipes = docs.map(function (d) {
          return { id: d.id, name: d.name, minutes: d.minutes == null ? null : d.minutes, note: d.note || '',
            ingredients: (d.ingredients || []).map(function (i) { return { name: i.name, qty: i.qty == null ? null : i.qty, unit: i.unit || '', aisle: normAisle(i.aisle) }; }) };
        });
        remoteChanged();
      },
      staples: function (docs) {
        state.staples = docs.sort(function (a, b) { return (a.order || 0) - (b.order || 0) || String(a.name).localeCompare(b.name, 'nb'); })
          .map(function (d) { return { id: d.id, name: d.name, qty: d.qty == null ? null : d.qty, unit: d.unit || '', aisle: normAisle(d.aisle), active: d.active !== false, order: d.order }; });
        remoteChanged();
      },
      days: function (docs) {
        var wp = {}, oo = {};
        docs.forEach(function (d) {
          if (d.oneoff && d.oneoff.name) oo[d.date] = { id: d.oneoff.id, name: d.oneoff.name, ingredients: d.oneoff.ingredients || [] };
          else wp[d.date] = d.recipe_id || null;
        });
        state.week_plan = wp; state.oneoffs = oo;
        remoteChanged();
      },
      lists: function (docs) {
        var ch = {}, adj = {};
        docs.forEach(function (d) {
          var c = {}, a = {};
          Object.keys(d.checked || {}).forEach(function (k) { if (d.checked[k] === true) c[k] = true; });
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
        renderSyncStatus();
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
    var txt, cls;
    if (offline) { txt = syncStatus.pending ? 'Frakoblet · lagres senere' : 'Frakoblet'; cls = 'off'; }
    else if (syncStatus.pending) { txt = 'Lagrer …'; cls = 'pending'; }
    else { txt = 'Delt'; cls = 'ok'; }
    el.textContent = txt;
    el.className = 'sync-status ' + cls;
    el.setAttribute('data-state', cls);
  }
  window.addEventListener('online', renderSyncStatus);
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
    return /^#retter\/.+/.test(h) || /^#uke\/engang\//.test(h) || /^#(husstand|join=)/.test(h);
  }
  function isTyping() {
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
      checks: local.checks, list_adjust: local.list_adjust, list_extras: local.list_extras,
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
        h += '<p class="notice" data-testid="opprettet">Husstanden er opprettet' + (hadLocalData ? ', og rettene, uka og lista fra denne telefonen er flyttet inn.' : '.') + '</p>';
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
        '<p class="hint">' + (hadLocalData ? 'Rettene, ukeplanen og lista på denne telefonen flyttes inn i husstanden.' : 'Husstanden starter med testdataene.') + '</p>' +
        (ui.error ? '<p class="form-error" data-testid="feil">' + esc(ui.error) + '</p>' : '') +
        '<div class="form-actions plain"><button type="button" class="btn primary" data-action="create-household" data-testid="opprett"' + (ui.busy ? ' disabled' : '') + '>' +
        (ui.busy ? 'Oppretter …' : 'Opprett husstand') + '</button>' +
        '<button type="button" class="linkbtn" data-action="dismiss-onboarding" data-testid="ikke-naa">Ikke nå</button></div>' +
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
    else if (!hh && hadLocalData) h += '<p class="hint">Det som ligger på denne telefonen nå blir ikke slått sammen, men tas vare på som sikkerhetskopi.</p>';
    if (ui.error) h += '<p class="form-error" data-testid="feil">' + esc(ui.error) + '</p>';
    h += '<div class="form-actions plain"><button type="button" class="btn primary" data-action="join" data-hid="' + esc(hid) + '" data-secret="' + esc(secret) + '" data-testid="bli-med"' + (ui.busy ? ' disabled' : '') + '>' +
      (ui.busy ? 'Kobler til …' : 'Bli med') + '</button><a class="btn" href="#uke">Avbryt</a></div></section>';
    main.innerHTML = h;
  }

  /* ---------- Endringer (lokalt eller i husstanden) ---------- */

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
      remote(function (W, hid) {
        var ps = [W.deleteRecipe(hid, id)];
        if (usedDates.length) ps.push(W.setDays(hid, usedDates.map(function (d) { return { date: d, recipe_id: null, oneoff: null }; })));
        return Promise.all(ps);
      });
    },
    // entries: [{ date, recipe_id, oneoff }]
    setDays: function (entries) {
      entries.forEach(function (e) {
        if (e.oneoff) { state.oneoffs[e.date] = e.oneoff; state.week_plan[e.date] = null; }
        else { delete state.oneoffs[e.date]; state.week_plan[e.date] = e.recipe_id || null; }
      });
      save();
      remote(function (W, hid) { return W.setDays(hid, entries); });
    },
    setChecks: function (week, map) {
      var c = state.checks[week] = state.checks[week] || {};
      Object.keys(map).forEach(function (k) { if (map[k]) c[k] = true; else delete c[k]; });
      state.list_items.forEach(function (i) { if (i.week === week && map.hasOwnProperty(i.key)) i.checked = !!map[i.key]; });
      save();
      remote(function (W, hid) { return W.setChecks(hid, week, map); });
    },
    adjust: function (week, key, newDelta, change) {
      var m = state.list_adjust[week] = state.list_adjust[week] || {};
      if (newDelta) m[key] = newDelta; else delete m[key];
      save();
      remote(function (W, hid) { return change ? W.incAdjust(hid, week, key, change) : null; });
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
    } else renderListe();
  }

  /* ---------- Felles: ingrediensrader ---------- */

  function ingredientRow(ing) {
    ing = ing || { name: '', qty: null, unit: 'stk', aisle: 'Tørrvare' };
    return '<div class="ing-row" data-new="' + (ing.name ? '0' : '1') + '">' +
      '<input class="ing-name" type="text" placeholder="Ingrediens" aria-label="Ingrediens" value="' + esc(ing.name) + '" autocomplete="off" list="known-ings">' +
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
      out.push({
        name: n,
        qty: parseQty(rows[i].querySelector('.ing-qty').value),
        unit: rows[i].querySelector('.ing-unit').value,
        aisle: rows[i].querySelector('.ing-aisle').value
      });
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

  function renderRetter() {
    var rs = sortedRecipes();
    var h = '<section class="page" data-page="retter">';
    h += '<div class="page-head"><h2>Retter <span class="count">' + rs.length + '</span></h2>' +
      '<a class="btn primary" href="#retter/ny" data-testid="ny-rett">+ Ny rett</a></div>';
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
    h += '<label class="field"><span>Tid (minutter)</span><input id="f-minutes" type="number" inputmode="numeric" min="0" step="1" value="' + esc(r && r.minutes != null ? r.minutes : '') + '" placeholder="30"></label>';
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

    var h = '<section class="page" data-page="uke">';
    h += '<div class="week-nav">' +
      '<button type="button" class="icon-btn" data-action="week-prev" aria-label="Forrige uke">‹</button>' +
      '<div class="week-title"><h2>' + esc(weekLabel(dates)) + '</h2>' +
      (ui.weekOffset !== 0 ? '<button type="button" class="linkbtn" data-action="week-now">Til denne uka</button>'
        : '<span class="sub">Denne uka</span>') + '</div>' +
      '<button type="button" class="icon-btn" data-action="week-next" aria-label="Neste uke">›</button></div>';
    h += '<div class="week-tools"><p class="summary" data-testid="uke-oppsummering">' + count + ' av 7 kvelder har middag</p>' +
      '<button type="button" class="btn small" data-action="fill-weekdays" data-testid="fyll"' + (emptyWeekdays ? '' : ' disabled') + '>Fyll man–fre</button></div>';
    if (ui.notice) { h += '<p class="notice" role="status" data-testid="uke-notis">' + esc(ui.notice) + '</p>'; ui.notice = ''; }
    h += '<ol class="days">';
    dates.forEach(function (d, i) {
      var o = state.oneoffs[d];
      var sel = state.week_plan[d];
      var r = !o && sel ? recipeById(sel) : null;
      h += '<li class="day' + (d === today ? ' today' : '') + (r || o ? '' : ' is-empty') + (o ? ' has-oneoff' : '') + '" data-date="' + d + '">' +
        '<label for="day-' + d + '" class="day-label"><span class="dname">' + DAY_NAMES[i] + '</span>' +
        '<span class="ddate">' + shortDate(d) + (d === today ? ' · i dag' : '') + '</span></label>';
      if (o) {
        h += '<div class="oneoff"><span class="badge">Engangsmiddag</span>' +
          '<span class="oneoff-name">' + esc(o.name) + '</span>' +
          '<span class="day-meta">' + o.ingredients.length + (o.ingredients.length === 1 ? ' ingrediens' : ' ingredienser') + '</span></div>' +
          '<div class="oneoff-actions"><a class="btn small" href="#uke/engang/' + d + '">Rediger</a>' +
          '<button type="button" class="btn small" data-action="remove-oneoff" data-date="' + d + '">Fjern</button></div>';
      } else {
        h += '<select id="day-' + d + '" class="day-select" data-date="' + d + '">' +
          '<option value="">Tom</option>';
        rs.forEach(function (x) {
          var usedIdx = usedBy[x.id];
          var takenElsewhere = usedIdx != null && usedIdx !== i;
          h += '<option value="' + esc(x.id) + '"' + (r && r.id === x.id ? ' selected' : '') +
            (takenElsewhere ? ' disabled' : '') + '>' + esc(x.name) +
            (takenElsewhere ? ' (brukt ' + DAY_SHORT[usedIdx] + ')' : '') + '</option>';
        });
        h += '<option value="__oneoff__">＋ Engangsmiddag …</option></select>';
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
    h += '<div class="row-actions"><a class="btn primary" href="#liste">Til handlelista →</a>' +
      (count ? '<button type="button" class="btn" data-action="clear-week" data-testid="tom-uka">Tøm uka</button>' : '') + '</div>';
    h += '</section>';
    main.innerHTML = h;
  }

  function setDay(date, recipeId) {
    if (recipeId === '__oneoff__') { location.hash = '#uke/engang/' + date; return; }
    if (recipeId) {
      var dates = weekDates(ui.weekOffset);
      var clash = dates.filter(function (d) { return d !== date && state.week_plan[d] === recipeId && !state.oneoffs[d]; });
      if (clash.length) { toast('Den retten er allerede brukt denne uka'); renderUke(); return; }
    }
    ops.setDays([{ date: date, recipe_id: recipeId || null, oneoff: null }]);
    renderUke();
  }

  // Tilfeldige retter på tomme dager man–fre. Ingen rett to ganger i uka; satte dager røres ikke.
  function fillWeekdays() {
    var dates = weekDates(ui.weekOffset);
    var used = {};
    dates.forEach(function (d) {
      var id = state.week_plan[d];
      if (!state.oneoffs[d] && id && recipeById(id)) used[id] = true;
    });
    var empty = dates.slice(0, 5).filter(function (d) {
      return !state.oneoffs[d] && !(state.week_plan[d] && recipeById(state.week_plan[d]));
    });
    if (!empty.length) { ui.notice = 'Man–fre er allerede fylt.'; renderUke(); return; }
    var pool = state.recipes.filter(function (r) { return !used[r.id]; }).map(function (r) { return r.id; });
    for (var i = pool.length - 1; i > 0; i--) {
      var j = Math.floor(Math.random() * (i + 1));
      var t = pool[i]; pool[i] = pool[j]; pool[j] = t;
    }
    var entries = [];
    empty.forEach(function (d) {
      if (!pool.length) return;
      entries.push({ date: d, recipe_id: pool.shift(), oneoff: null });
    });
    var filled = entries.length;
    if (filled) ops.setDays(entries);
    if (filled === empty.length) ui.notice = 'Fylte ' + filled + (filled === 1 ? ' dag.' : ' dager.') + ' Bytt gjerne en kveld.';
    else if (!filled) ui.notice = 'Ingen ledige retter – alle rettene er allerede brukt denne uka.';
    else ui.notice = 'Fylte ' + filled + ' av ' + empty.length + ' tomme dager – det er ikke flere ledige retter. Legg til flere under Retter.';
    renderUke();
  }

  function renderOneoffForm(date) {
    var o = state.oneoffs[date];
    var rid = state.week_plan[date];
    var replaced = !o && rid ? recipeById(rid) : null;
    var h = '<section class="page" data-page="engang-skjema">';
    h += '<div class="page-head"><a class="back" href="#uke">‹ Uke</a><h2>Engangsmiddag</h2></div>';
    h += '<p class="hint">' + esc(dayName(date) + ' ' + shortDate(date)) + '. Kommer med i handlelista, men lagres ikke under Retter.' +
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
    function add(src, from, name, qty, unit, aisle, extraId) {
      var nn = normName(name);
      if (!nn) return;
      unit = unit || '';
      var key = nn + '|' + unit;
      var it = map[key];
      if (!it) {
        it = map[key] = { key: key, name: String(name).trim(), qty: null, unit: unit,
          aisle: normAisle(aisle), checked: false, source: src, sources: [], recipes: [], extra_ids: [] };
        order.push(key);
      }
      if (qty != null && isFinite(qty)) it.qty = round3((it.qty || 0) + Number(qty));
      if (it.sources.indexOf(src) < 0) it.sources.push(src);
      if (RANK[src] < RANK[it.source]) it.source = src;
      if (from && it.recipes.indexOf(from) < 0) it.recipes.push(from);
      if (extraId) it.extra_ids.push(extraId);
    }
    var dinners = 0;
    dates.forEach(function (d) {
      var o = state.oneoffs[d];
      var r = o || (state.week_plan[d] ? recipeById(state.week_plan[d]) : null);
      if (!r) return;
      dinners++;
      r.ingredients.forEach(function (i) { add('dinner', r.name, i.name, i.qty, i.unit, i.aisle); });
    });
    state.staples.forEach(function (s) {
      if (s.active === false) return;
      add('staple', null, s.name, s.qty, s.unit, s.aisle);
    });
    state.list_extras.forEach(function (x) {
      if (x.week === weekKey) add('extra', null, x.name, x.qty, x.unit, x.aisle, x.id);
    });
    var adj = state.list_adjust[weekKey] || {};
    var checks = state.checks[weekKey] || {};
    var items = order.map(function (k) {
      var it = map[k];
      it.week = weekKey;
      it.checked = !!checks[k];
      it.base_qty = it.qty;
      it.adjust = adj[k] || 0;
      if (it.adjust) it.qty = Math.max(0, round3((it.base_qty || 0) + it.adjust));
      return it;
    });
    if (!hh) {
      // Lokal modus: behold generert liste (for eldre versjoner) og rydd bort gamle uker.
      var oldest = weekDates(ui.weekOffset - 8)[0];
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
    return { items: items, dates: dates, dinners: dinners, weekKey: weekKey };
  }
  var currentList = [];

  function matchesFilter(it, f) {
    if (f === 'middag') return it.sources.indexOf('dinner') >= 0;
    if (f === 'faste') return it.sources.indexOf('staple') >= 0;
    return true;
  }
  function isOpen(it) { return !it.checked && !(it.qty === 0); }

  function groupItems(items) {
    return AISLES.map(function (a) {
      return {
        aisle: a,
        items: items.filter(function (i) { return i.aisle === a; })
          .sort(function (x, y) { return x.name.localeCompare(y.name, 'nb'); })
      };
    }).filter(function (g) { return g.items.length; });
  }
  function currentItems() { return currentList; }
  function filterLabel(f) {
    for (var i = 0; i < FILTERS.length; i++) if (FILTERS[i][0] === f) return FILTERS[i][1];
    return '';
  }

  function listAsText() {
    var built = buildList();
    var f = ui.filter;
    var lines = ['Handleliste – ' + weekLabel(built.dates) + (f !== 'alle' ? ' (' + filterLabel(f) + ')' : '')];
    var any = false;
    groupItems(built.items.filter(function (i) { return matchesFilter(i, f); })).forEach(function (g) {
      var open = g.items.filter(isOpen);
      if (!open.length) return;
      any = true;
      lines.push('');
      lines.push(aisleLabel(g.aisle));
      open.forEach(function (i) {
        var qu = qtyUnit(i.qty, i.unit);
        lines.push('- ' + cap(i.name) + (qu ? ', ' + qu : ''));
      });
    });
    return any ? lines.join('\n') + '\n' : '';
  }

  function renderListe() {
    main.innerHTML = '<section class="page" data-page="liste"><div id="list-section"></div>' +
      '<div id="staples-section"></div></section>';
    renderListSection();
    renderStaplesSection();
  }

  function addItemForm() {
    return '<details class="add-item"' + (ui.addOpen ? ' open' : '') + '><summary>＋ Legg til vare</summary>' +
      '<form id="item-add" class="item-add-form" novalidate>' +
      '<input type="text" id="ai-name" placeholder="Vare, f.eks. tannkrem" aria-label="Vare" autocomplete="off" list="known-ings">' +
      '<div class="ai-row"><input type="text" id="ai-qty" inputmode="decimal" placeholder="1" aria-label="Mengde">' +
      '<select id="ai-unit" aria-label="Enhet">' + unitOptions('stk') + '</select>' +
      '<select id="ai-aisle" aria-label="Avdeling">' + aisleOptions('Tørrvare') + '</select></div>' +
      '<label class="check"><input type="checkbox" id="ai-staple"> Legg til i faste husvarer</label>' +
      '<button type="submit" class="btn primary">Legg til</button></form>' + knownNamesDatalist() + '</details>';
  }

  function renderListSection() {
    var el = document.getElementById('list-section');
    if (!el) return;
    var built = buildList();
    var f = ui.filter;
    var shown = built.items.filter(function (i) { return matchesFilter(i, f); });
    var left = shown.filter(isOpen).length;
    var anyChecked = built.items.some(function (i) { return i.checked; });
    var h = '<div class="page-head list-head"><div><h2>Handleliste</h2>' +
      '<span class="sub">' + esc(weekLabel(built.dates)) + ' · ' + built.dinners + ' middag' + (built.dinners === 1 ? '' : 'er') + '</span></div>' +
      '<span class="left" data-testid="igjen">' + left + ' igjen</span></div>';
    h += '<div class="seg" role="group" aria-label="Filter">' + FILTERS.map(function (x) {
      return '<button type="button" data-action="filter" data-filter="' + x[0] + '" aria-pressed="' + (f === x[0]) + '"' +
        (f === x[0] ? ' class="on"' : '') + '>' + x[1] + '</button>';
    }).join('') + '</div>';
    if (!built.items.length) {
      h += '<p class="empty">Lista er tom. Velg middager under <a href="#uke">Uke</a>, eller legg til varer.</p>' + addItemForm();
      el.innerHTML = h;
      return;
    }
    if (!built.dinners && f !== 'faste') h += '<p class="hint">Ingen middager valgt ennå. <a href="#uke">Velg middager</a>.</p>';
    h += '<div class="list-actions"><button type="button" class="btn primary" data-action="copy-text" data-testid="kopier">Kopier som tekst</button>' +
      '<button type="button" class="btn" data-action="uncheck-all"' + (anyChecked ? '' : ' hidden') + '>Fjern avkrysning</button></div>';
    h += addItemForm();
    if (!shown.length) h += '<p class="empty">Ingen varer i dette filteret.</p>';
    groupItems(shown).forEach(function (g) {
      h += '<h3 class="aisle">' + esc(aisleLabel(g.aisle)) + '</h3><ul class="items">';
      g.items.forEach(function (i) {
        var src = [];
        if (i.recipes.length) src.push(i.recipes.join(', '));
        if (i.sources.indexOf('staple') >= 0) src.push('fast vare');
        if (i.sources.indexOf('extra') >= 0) src.push('lagt til');
        if (i.adjust) src.push('justert ' + (i.adjust > 0 ? '+' : '−') + formatQty(Math.abs(i.adjust)));
        var qu = qtyUnit(i.qty, i.unit);
        var pureExtra = i.sources.length === 1 && i.sources[0] === 'extra';
        h += '<li class="item' + (i.checked ? ' checked' : '') + (i.qty === 0 ? ' zero' : '') + ' src-' + i.source + '" data-key="' + esc(i.key) + '">' +
          '<label><input type="checkbox" data-key="' + esc(i.key) + '"' + (i.checked ? ' checked' : '') + '>' +
          '<span class="item-text"><span class="item-name">' + esc(cap(i.name)) + '</span>' +
          (qu ? ' <span class="item-qty">' + esc(qu) + '</span>' : '') +
          '<span class="item-src">' + esc(src.join(' · ')) + '</span></span></label>' +
          '<div class="qty-ctl">' +
          (pureExtra ? '<button type="button" class="qbtn" data-action="remove-extra" aria-label="Fjern ' + esc(i.name) + '">✕</button>' : '') +
          '<button type="button" class="qbtn" data-action="qty-dec" aria-label="Mindre ' + esc(i.name) + '"' + (i.qty ? '' : ' disabled') + '>−</button>' +
          '<button type="button" class="qbtn" data-action="qty-inc" aria-label="Mer ' + esc(i.name) + '">+</button></div></li>';
      });
      h += '</ul>';
    });
    el.innerHTML = h;
  }

  function adjustItem(key, dir) {
    var it = currentItems().filter(function (i) { return i.key === key; })[0];
    if (!it) return;
    var step = stepFor(it.unit);
    var cur = it.qty == null ? 0 : it.qty;
    var next = dir > 0 ? cur + step : Math.max(0, cur - step);
    // Runder til nærmeste steg når vi går fra et «skjevt» tall (f.eks. 0,5 dl -> 1 dl).
    var ratio = round3(cur / step);
    if (ratio !== Math.round(ratio)) next = round3((dir > 0 ? Math.ceil(ratio) : Math.floor(ratio)) * step);
    var delta = round3(next - (it.base_qty || 0));
    ops.adjust(it.week, key, delta, round3(delta - (it.adjust || 0)));
    renderListSection();
  }

  function renderStaplesSection() {
    var el = document.getElementById('staples-section');
    if (!el) return;
    var h = '<details class="staples"' + (ui.staplesOpen ? ' open' : '') + '><summary>Faste husvarer <span class="count">' +
      state.staples.length + '</span></summary>' +
      '<p class="hint">Tas med i lista hver uke. Fjern haken for å hoppe over en vare.</p><ul class="staple-rows">';
    state.staples.forEach(function (s) {
      h += '<li class="staple-row" data-id="' + esc(s.id) + '">' +
        '<input type="checkbox" class="st-active" aria-label="Med i lista"' + (s.active !== false ? ' checked' : '') + '>' +
        '<input type="text" class="st-name" aria-label="Vare" value="' + esc(s.name) + '">' +
        '<input type="text" class="st-qty" inputmode="decimal" aria-label="Mengde" value="' + esc(formatQty(s.qty)) + '">' +
        '<select class="st-unit" aria-label="Enhet">' + unitOptions(s.unit) + '</select>' +
        '<select class="st-aisle" aria-label="Avdeling">' + aisleOptions(s.aisle) + '</select>' +
        '<button type="button" class="icon-btn" data-action="delete-staple" aria-label="Slett ' + esc(s.name) + '">✕</button></li>';
    });
    h += '</ul><form id="staple-add" class="staple-row add">' +
      '<input type="text" class="st-name" id="st-new-name" placeholder="Ny fast vare" aria-label="Ny fast vare">' +
      '<input type="text" class="st-qty" id="st-new-qty" inputmode="decimal" placeholder="1" aria-label="Mengde">' +
      '<select class="st-unit" id="st-new-unit" aria-label="Enhet">' + unitOptions('stk') + '</select>' +
      '<select class="st-aisle" id="st-new-aisle" aria-label="Avdeling">' + aisleOptions('Tørrvare') + '</select>' +
      '<button type="submit" class="btn">Legg til</button></form></details>';
    el.innerHTML = h;
  }

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
    } else if (a === 'week-prev') { ui.weekOffset--; renderUke(); }
    else if (a === 'week-next') { ui.weekOffset++; renderUke(); }
    else if (a === 'week-now') { ui.weekOffset = 0; renderUke(); }
    else if (a === 'fill-weekdays') { fillWeekdays(); }
    else if (a === 'remove-oneoff') { removeOneoff(btn.getAttribute('data-date')); }
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
      var text = listAsText();
      if (!text) { toast('Alt er krysset av'); return; }
      copyText(text);
    } else if (a === 'uncheck-all') {
      var m = {};
      currentItems().forEach(function (i) { if (i.checked) m[i.key] = false; });
      ops.setChecks(currentItems().length ? currentItems()[0].week : weekDates(ui.weekOffset)[0], m);
      renderListSection();
    } else if (a === 'filter') {
      ui.filter = btn.getAttribute('data-filter');
      renderListSection();
    } else if (a === 'qty-inc' || a === 'qty-dec') {
      adjustItem(btn.closest('.item').getAttribute('data-key'), a === 'qty-inc' ? 1 : -1);
    } else if (a === 'remove-extra') {
      var key = btn.closest('.item').getAttribute('data-key');
      var it = currentItems().filter(function (i) { return i.key === key; })[0];
      if (!it) return;
      ops.removeExtras(it.extra_ids.slice());
      if (it.adjust) ops.clearAdjust(it.week, key);
      renderListSection();
    } else if (a === 'delete-staple') {
      ops.deleteStaple(btn.closest('.staple-row').getAttribute('data-id'));
      renderListSection(); renderStaplesSection();
    } else if (a === 'create-household') {
      startCreate();
    } else if (a === 'dismiss-onboarding') {
      lsSet(ONBOARD_KEY, 'dismissed');
      location.hash = '#uke';
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
      cur.forEach(function (i) { if (i.key === key) i.checked = t.checked; });
      var m = {}; m[key] = t.checked;
      ops.setChecks(week, m);
      t.closest('.item').classList.toggle('checked', t.checked);
      var shown = cur.filter(function (i) { return matchesFilter(i, ui.filter); });
      var l = main.querySelector('[data-testid="igjen"]');
      if (l) l.textContent = shown.filter(isOpen).length + ' igjen';
      var ub = main.querySelector('[data-action="uncheck-all"]');
      if (ub) ub.hidden = !cur.some(function (i) { return i.checked; });
    } else if (t.classList.contains('ing-name') || t.id === 'ai-name') {
      var row = t.classList.contains('ing-name') ? t.closest('.ing-row') : null;
      if (row && row.getAttribute('data-new') !== '1') return;
      var k = knownIngredient(t.value);
      if (k) {
        if (row) {
          row.querySelector('.ing-unit').value = k.unit || '';
          row.querySelector('.ing-aisle').value = normAisle(k.aisle);
        } else {
          document.getElementById('ai-unit').value = k.unit || '';
          document.getElementById('ai-aisle').value = normAisle(k.aisle);
        }
      }
      if (row) row.setAttribute('data-new', '0');
    } else if (t.closest('.staple-row') && !t.closest('#staple-add')) {
      var srow = t.closest('.staple-row');
      var s = state.staples.filter(function (x) { return x.id === srow.getAttribute('data-id'); })[0];
      if (!s) return;
      var f = {};
      if (t.classList.contains('st-active')) f.active = t.checked;
      else if (t.classList.contains('st-name')) { if (t.value.trim()) f.name = t.value.trim(); else { t.value = s.name; return; } }
      else if (t.classList.contains('st-qty')) { f.qty = parseQty(t.value); t.value = formatQty(f.qty); }
      else if (t.classList.contains('st-unit')) f.unit = t.value;
      else if (t.classList.contains('st-aisle')) f.aisle = t.value;
      ops.updateStaple(s, f);
      renderListSection();
    }
  });

  main.addEventListener('toggle', function (e) {
    if (!e.target.classList) return;
    if (e.target.classList.contains('staples')) ui.staplesOpen = e.target.open;
    if (e.target.classList.contains('add-item')) ui.addOpen = e.target.open;
  }, true);

  main.addEventListener('submit', function (e) {
    e.preventDefault();
    var id = e.target.id;
    if (id === 'recipe-form') saveRecipeForm(e.target);
    else if (id === 'oneoff-form') saveOneoffForm(e.target);
    else if (id === 'item-add') {
      var name = document.getElementById('ai-name').value.trim();
      if (!name) { document.getElementById('ai-name').focus(); return; }
      var q = parseQty(document.getElementById('ai-qty').value);
      var item = { name: name, qty: q == null ? 1 : q, unit: document.getElementById('ai-unit').value,
        aisle: document.getElementById('ai-aisle').value };
      if (document.getElementById('ai-staple').checked) {
        item.id = uid('s'); item.active = true;
        ops.addStaple(item);
        toast('Lagt til i lista og i faste husvarer');
      } else {
        item.id = uid('x'); item.week = weekDates(ui.weekOffset)[0]; item.created = Date.now();
        ops.addExtra(item);
        toast('Lagt til i lista for denne uka');
      }
      ui.addOpen = true;
      renderListSection(); renderStaplesSection();
      document.getElementById('ai-name').focus();
    } else if (id === 'staple-add') {
      var sname = document.getElementById('st-new-name').value.trim();
      if (!sname) { document.getElementById('st-new-name').focus(); return; }
      var sq = parseQty(document.getElementById('st-new-qty').value);
      ops.addStaple({ id: uid('s'), name: sname, qty: sq == null ? 1 : sq,
        unit: document.getElementById('st-new-unit').value,
        aisle: document.getElementById('st-new-aisle').value, active: true });
      renderListSection(); renderStaplesSection();
      document.getElementById('st-new-name').focus();
    }
  });

  window.addEventListener('hashchange', function () {
    ui.error = '';
    if (!/^#husstand/.test(location.hash)) ui.justCreated = false;
    route(); window.scrollTo(0, 0);
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
  } else if (!info && syncMode() && lsGet(ONBOARD_KEY) !== 'dismissed' && !parseJoin(location.hash)) {
    // Første gang med deling tilgjengelig: tilby å opprette husstand.
    history.replaceState(null, '', location.pathname + location.search + '#husstand');
  }
  route();

  if ('serviceWorker' in navigator && (location.protocol === 'https:' || location.hostname === 'localhost' || location.hostname === '127.0.0.1')) {
    window.addEventListener('load', function () {
      navigator.serviceWorker.register('sw.js').catch(function () { /* frakoblet-støtte er valgfri */ });
    });
  }
})();
