/* Ukeshandel v0 — ukeplan for middager + handleliste. Ren JS, lagring i localStorage. */
(function () {
  'use strict';

  var STORAGE_KEY = 'ukeshandel:v1';
  var DATA_VERSION = 1;
  var AISLES = ['Frukt/grønt', 'Kjøl', 'Frys', 'Tørrvare', 'Hus'];
  var UNITS = ['stk', 'g', 'kg', 'dl', 'l', 'ss', 'ts', 'pk', 'boks', 'glass', 'beger', 'flaske', 'fedd', 'bunt'];
  var DAY_NAMES = ['Mandag', 'Tirsdag', 'Onsdag', 'Torsdag', 'Fredag', 'Lørdag', 'Søndag'];
  var DAY_SHORT = ['man', 'tir', 'ons', 'tor', 'fre', 'lør', 'søn'];

  var main = document.getElementById('main');
  var state = null;
  var memoryOnly = false;
  var ui = { weekOffset: 0, staplesOpen: false };

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
  function parseQty(v) {
    if (v == null) return null;
    v = String(v).trim().replace(',', '.');
    if (v === '') return null;
    var n = Number(v);
    return isFinite(n) && n >= 0 ? n : null;
  }
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
    for (var i = 0; i < 7; i++) {
      var d = new Date(m.getFullYear(), m.getMonth(), m.getDate() + i);
      out.push(isoDate(d));
    }
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
  function optionList(values, selected, emptyLabel) {
    var h = emptyLabel != null ? '<option value="">' + esc(emptyLabel) + '</option>' : '';
    var found = false;
    values.forEach(function (v) {
      if (v === selected) found = true;
      h += '<option value="' + esc(v) + '"' + (v === selected ? ' selected' : '') + '>' + esc(v) + '</option>';
    });
    if (selected && !found) h += '<option value="' + esc(selected) + '" selected>' + esc(selected) + '</option>';
    return h;
  }

  var toastTimer = null;
  function toast(msg) {
    var t = document.getElementById('toast');
    t.textContent = msg;
    t.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { t.classList.remove('show'); }, 2500);
  }

  /* ---------- Lagring ---------- */

  function freshState() {
    var seed = window.UKESHANDEL_SEED();
    return {
      version: DATA_VERSION,
      household: { id: 'h1', name: 'Husstanden' },
      recipes: seed.recipes,
      week_plan: {},        // 'YYYY-MM-DD' -> recipe_id | null (tom)
      staples: seed.staples,
      list_items: []        // genererte handlelister med avkrysning (week = mandag i uka lista gjelder)
    };
  }
  function load() {
    var raw = null;
    try { raw = localStorage.getItem(STORAGE_KEY); } catch (e) { memoryOnly = true; }
    if (raw) {
      try {
        var s = JSON.parse(raw);
        if (s && s.version === DATA_VERSION && Array.isArray(s.recipes)) {
          s.week_plan = s.week_plan || {};
          s.staples = s.staples || [];
          s.list_items = s.list_items || [];
          s.household = s.household || { id: 'h1', name: 'Husstanden' };
          return s;
        }
      } catch (e) { /* ødelagte data: start på nytt */ }
    }
    var f = freshState();
    state = f;
    save();
    return f;
  }
  function save() {
    if (memoryOnly) return;
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

  /* ---------- Router ---------- */

  function route() {
    var h = (location.hash || '').replace(/^#\/?/, '');
    var parts = h.split('/');
    var tab = parts[0];
    if (['retter', 'uke', 'liste'].indexOf(tab) < 0) tab = 'uke';
    var links = document.querySelectorAll('.tabs a');
    for (var i = 0; i < links.length; i++) {
      var on = links[i].getAttribute('data-tab') === tab;
      links[i].classList.toggle('active', on);
      if (on) links[i].setAttribute('aria-current', 'page'); else links[i].removeAttribute('aria-current');
    }
    if (tab === 'retter') {
      if (parts[1] === 'ny') renderRecipeForm(null);
      else if (parts[1] && recipeById(decodeURIComponent(parts[1]))) renderRecipeForm(decodeURIComponent(parts[1]));
      else renderRetter();
    } else if (tab === 'uke') renderUke();
    else renderListe();
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
    h += '<div class="footer-tools"><button type="button" class="linkbtn" data-action="reset-seed">Tilbakestill testdata</button>' +
      (memoryOnly ? '<p class="warn">Nettleseren tillater ikke lagring – endringer forsvinner når du lukker siden.</p>' : '') +
      '</div>';
    h += '</section>';
    main.innerHTML = h;
  }

  function ingredientRow(ing) {
    ing = ing || { name: '', qty: null, unit: 'stk', aisle: 'Tørrvare' };
    return '<div class="ing-row" data-new="' + (ing.name ? '0' : '1') + '">' +
      '<input class="ing-name" type="text" placeholder="Ingrediens" aria-label="Ingrediens" value="' + esc(ing.name) + '" autocomplete="off" list="known-ings">' +
      '<div class="ing-sub">' +
      '<input class="ing-qty" type="text" inputmode="decimal" placeholder="Mengde" aria-label="Mengde" value="' + esc(formatQty(ing.qty)) + '">' +
      '<select class="ing-unit" aria-label="Enhet">' + optionList(UNITS, ing.unit, '–') + '</select>' +
      '<select class="ing-aisle" aria-label="Avdeling">' + optionList(AISLES, ing.aisle) + '</select>' +
      '<button type="button" class="icon-btn" data-action="remove-ing" aria-label="Fjern ingrediens">✕</button>' +
      '</div></div>';
  }

  function renderRecipeForm(id) {
    var r = id ? recipeById(id) : null;
    var names = {};
    state.recipes.forEach(function (x) { x.ingredients.forEach(function (i) { names[normName(i.name)] = 1; }); });
    state.staples.forEach(function (s) { names[normName(s.name)] = 1; });
    var h = '<section class="page" data-page="rett-skjema">';
    h += '<div class="page-head"><a class="back" href="#retter">‹ Retter</a><h2>' + (r ? 'Rediger rett' : 'Ny rett') + '</h2></div>';
    h += '<form id="recipe-form" data-id="' + esc(r ? r.id : '') + '" novalidate>';
    h += '<label class="field"><span>Navn</span><input id="f-name" type="text" required value="' + esc(r ? r.name : '') + '" placeholder="F.eks. Fiskesuppe"></label>';
    h += '<label class="field"><span>Tid (minutter)</span><input id="f-minutes" type="number" inputmode="numeric" min="0" step="1" value="' + esc(r && r.minutes != null ? r.minutes : '') + '" placeholder="30"></label>';
    h += '<label class="field"><span>Merknad (valgfri)</span><input id="f-note" type="text" value="' + esc(r ? r.note || '' : '') + '" placeholder="F.eks. unger spiser dette"></label>';
    h += '<fieldset class="ings"><legend>Ingredienser</legend><div id="ing-list">';
    var ings = r ? r.ingredients : [];
    ings.forEach(function (i) { h += ingredientRow(i); });
    if (!ings.length) h += ingredientRow(null);
    h += '</div><button type="button" class="btn" data-action="add-ing">+ Ingrediens</button></fieldset>';
    h += '<datalist id="known-ings">' + Object.keys(names).sort(function (a, b) { return a.localeCompare(b, 'nb'); })
      .map(function (n) { return '<option value="' + esc(n) + '">'; }).join('') + '</datalist>';
    h += '<p class="form-error" id="form-error" hidden></p>';
    h += '<div class="form-actions"><button type="submit" class="btn primary" data-testid="lagre">Lagre</button>' +
      '<a class="btn" href="#retter">Avbryt</a>' +
      (r ? '<button type="button" class="btn danger" data-action="delete-recipe">Slett</button>' : '') + '</div>';
    h += '</form></section>';
    main.innerHTML = h;
    if (!r) document.getElementById('f-name').focus();
  }

  function saveRecipeForm(form) {
    var err = document.getElementById('form-error');
    var name = document.getElementById('f-name').value.trim();
    if (!name) {
      err.textContent = 'Retten må ha et navn.';
      err.hidden = false;
      document.getElementById('f-name').focus();
      return;
    }
    var minutesRaw = document.getElementById('f-minutes').value.trim();
    var minutes = minutesRaw === '' ? null : Math.max(0, Math.round(Number(minutesRaw.replace(',', '.')) || 0));
    var ingredients = [];
    var rows = form.querySelectorAll('.ing-row');
    for (var i = 0; i < rows.length; i++) {
      var n = rows[i].querySelector('.ing-name').value.trim();
      if (!n) continue;
      ingredients.push({
        name: n,
        qty: parseQty(rows[i].querySelector('.ing-qty').value),
        unit: rows[i].querySelector('.ing-unit').value,
        aisle: rows[i].querySelector('.ing-aisle').value
      });
    }
    var id = form.getAttribute('data-id');
    var note = document.getElementById('f-note').value.trim();
    if (id) {
      var r = recipeById(id);
      r.name = name; r.minutes = minutes; r.note = note; r.ingredients = ingredients;
    } else {
      state.recipes.push({ id: uid('r'), name: name, minutes: minutes, note: note, ingredients: ingredients });
    }
    save();
    toast(id ? 'Lagret' : 'Rett lagt til');
    location.hash = '#retter';
  }

  function deleteRecipe(id) {
    var r = recipeById(id);
    if (!r) return;
    var used = Object.keys(state.week_plan).filter(function (d) { return state.week_plan[d] === id; });
    var msg = 'Slette «' + r.name + '»?' + (used.length ? ' Den fjernes også fra ukeplanen.' : '');
    if (!window.confirm(msg)) return;
    state.recipes = state.recipes.filter(function (x) { return x.id !== id; });
    used.forEach(function (d) { state.week_plan[d] = null; });
    save();
    toast('Rett slettet');
    location.hash = '#retter';
  }

  /* ---------- Uke ---------- */

  function renderUke() {
    var dates = weekDates(ui.weekOffset);
    var today = isoDate(new Date());
    var rs = sortedRecipes();
    var usedBy = {}; // recipe_id -> dagindeks
    dates.forEach(function (d, i) {
      var id = state.week_plan[d];
      if (id && recipeById(id)) usedBy[id] = i;
    });
    var count = Object.keys(usedBy).length;

    var h = '<section class="page" data-page="uke">';
    h += '<div class="week-nav">' +
      '<button type="button" class="icon-btn" data-action="week-prev" aria-label="Forrige uke">‹</button>' +
      '<div class="week-title"><h2>' + esc(weekLabel(dates)) + '</h2>' +
      (ui.weekOffset !== 0 ? '<button type="button" class="linkbtn" data-action="week-now">Til denne uka</button>'
        : '<span class="sub">Denne uka</span>') + '</div>' +
      '<button type="button" class="icon-btn" data-action="week-next" aria-label="Neste uke">›</button></div>';
    h += '<p class="summary" data-testid="uke-oppsummering">' + count + ' av 7 kvelder har middag</p>';
    h += '<ol class="days">';
    dates.forEach(function (d, i) {
      var sel = state.week_plan[d];
      var r = sel ? recipeById(sel) : null;
      h += '<li class="day' + (d === today ? ' today' : '') + (r ? '' : ' is-empty') + '">' +
        '<label for="day-' + d + '" class="day-label"><span class="dname">' + DAY_NAMES[i] + '</span>' +
        '<span class="ddate">' + shortDate(d) + (d === today ? ' · i dag' : '') + '</span></label>' +
        '<select id="day-' + d + '" class="day-select" data-date="' + d + '">' +
        '<option value="">Tom</option>';
      rs.forEach(function (x) {
        var usedIdx = usedBy[x.id];
        var takenElsewhere = usedIdx != null && usedIdx !== i;
        h += '<option value="' + esc(x.id) + '"' + (r && r.id === x.id ? ' selected' : '') +
          (takenElsewhere ? ' disabled' : '') + '>' + esc(x.name) +
          (takenElsewhere ? ' (brukt ' + DAY_SHORT[usedIdx] + ')' : '') + '</option>';
      });
      h += '</select>';
      if (r) {
        var meta = [];
        if (r.minutes) meta.push(r.minutes + ' min');
        if (r.note) meta.push(r.note);
        h += meta.length ? '<div class="day-meta">' + esc(meta.join(' · ')) + '</div>' : '';
      }
      h += '</li>';
    });
    h += '</ol>';
    h += '<div class="row-actions"><a class="btn primary" href="#liste">Til handlelista →</a>' +
      (count ? '<button type="button" class="btn" data-action="clear-week">Tøm uka</button>' : '') + '</div>';
    h += '</section>';
    main.innerHTML = h;
  }

  function setDay(date, recipeId) {
    if (recipeId) {
      var dates = weekDates(ui.weekOffset);
      var clash = dates.filter(function (d) { return d !== date && state.week_plan[d] === recipeId; });
      if (clash.length) { toast('Den retten er allerede brukt denne uka'); renderUke(); return; }
    }
    state.week_plan[date] = recipeId || null;
    save();
    renderUke();
  }

  /* ---------- Liste ---------- */

  function buildList() {
    var dates = weekDates(ui.weekOffset);
    var weekKey = dates[0];
    var map = {};
    var order = [];
    function add(src, from, name, qty, unit, aisle) {
      var nn = normName(name);
      if (!nn) return;
      unit = unit || '';
      var key = nn + '|' + unit;
      var it = map[key];
      if (!it) {
        it = map[key] = { key: key, name: String(name).trim(), qty: null, unit: unit,
          aisle: AISLES.indexOf(aisle) >= 0 ? aisle : 'Tørrvare', checked: false,
          source: src, sources: [], recipes: [] };
        order.push(key);
      }
      if (qty != null && isFinite(qty)) it.qty = Math.round(((it.qty || 0) + Number(qty)) * 1000) / 1000;
      if (it.sources.indexOf(src) < 0) it.sources.push(src);
      if (src === 'dinner') it.source = 'dinner';
      if (from && it.recipes.indexOf(from) < 0) it.recipes.push(from);
    }
    var dinners = 0;
    dates.forEach(function (d) {
      var r = state.week_plan[d] ? recipeById(state.week_plan[d]) : null;
      if (!r) return;
      dinners++;
      r.ingredients.forEach(function (i) { add('dinner', r.name, i.name, i.qty, i.unit, i.aisle); });
    });
    state.staples.forEach(function (s) {
      if (s.active === false) return;
      add('staple', null, s.name, s.qty, s.unit, s.aisle);
    });
    // Behold avkrysning for samme vare (navn + enhet) i samme uke når lista lages på nytt.
    var prevChecked = {};
    var oldest = weekDates(ui.weekOffset - 8)[0];
    var otherWeeks = state.list_items.filter(function (it) {
      if (it.week === weekKey) { if (it.checked) prevChecked[it.key] = true; return false; }
      return it.week && it.week >= oldest;
    });
    var items = order.map(function (k) { var it = map[k]; it.week = weekKey; it.checked = !!prevChecked[k]; return it; });
    state.list_items = otherWeeks.concat(items);
    save();
    return { items: items, dates: dates, dinners: dinners };
  }

  function currentItems() {
    var wk = weekDates(ui.weekOffset)[0];
    return state.list_items.filter(function (i) { return i.week === wk; });
  }

  function groupItems(items) {
    return AISLES.map(function (a) {
      return {
        aisle: a,
        items: items.filter(function (i) { return i.aisle === a; })
          .sort(function (x, y) { return x.name.localeCompare(y.name, 'nb'); })
      };
    }).filter(function (g) { return g.items.length; });
  }

  function listAsText() {
    var built = buildList();
    var lines = ['Handleliste – ' + weekLabel(built.dates)];
    var any = false;
    groupItems(built.items).forEach(function (g) {
      var open = g.items.filter(function (i) { return !i.checked; });
      if (!open.length) return;
      any = true;
      lines.push('');
      lines.push(g.aisle);
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

  function renderListSection() {
    var el = document.getElementById('list-section');
    if (!el) return;
    var built = buildList();
    var left = built.items.filter(function (i) { return !i.checked; }).length;
    var h = '<div class="page-head list-head"><div><h2>Handleliste</h2>' +
      '<span class="sub">' + esc(weekLabel(built.dates)) + ' · ' + built.dinners + ' middag' + (built.dinners === 1 ? '' : 'er') + '</span></div>' +
      '<span class="left" data-testid="igjen">' + left + ' igjen</span></div>';
    if (!built.items.length) {
      h += '<p class="empty">Lista er tom. Velg middager under <a href="#uke">Uke</a>, eller legg til faste husvarer nedenfor.</p>';
      el.innerHTML = h;
      return;
    }
    if (!built.dinners) h += '<p class="hint">Ingen middager valgt ennå – lista viser bare faste husvarer. <a href="#uke">Velg middager</a>.</p>';
    h += '<div class="list-actions"><button type="button" class="btn primary" data-action="copy-text" data-testid="kopier">Kopier som tekst</button>' +
      '<button type="button" class="btn" data-action="uncheck-all"' + (built.items.length - left ? '' : ' hidden') + '>Fjern avkrysning</button></div>';
    groupItems(built.items).forEach(function (g) {
      h += '<h3 class="aisle">' + esc(g.aisle) + '</h3><ul class="items">';
      g.items.forEach(function (i) {
        var src = [];
        if (i.recipes.length) src.push(i.recipes.join(', '));
        if (i.sources.indexOf('staple') >= 0) src.push('fast vare');
        var qu = qtyUnit(i.qty, i.unit);
        h += '<li class="item' + (i.checked ? ' checked' : '') + ' src-' + i.source + '">' +
          '<label><input type="checkbox" data-key="' + esc(i.key) + '"' + (i.checked ? ' checked' : '') + '>' +
          '<span class="item-text"><span class="item-name">' + esc(cap(i.name)) + '</span>' +
          (qu ? ' <span class="item-qty">' + esc(qu) + '</span>' : '') +
          '<span class="item-src">' + esc(src.join(' · ')) + '</span></span></label></li>';
      });
      h += '</ul>';
    });
    el.innerHTML = h;
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
        '<select class="st-unit" aria-label="Enhet">' + optionList(UNITS, s.unit, '–') + '</select>' +
        '<select class="st-aisle" aria-label="Avdeling">' + optionList(AISLES, s.aisle) + '</select>' +
        '<button type="button" class="icon-btn" data-action="delete-staple" aria-label="Slett ' + esc(s.name) + '">✕</button></li>';
    });
    h += '</ul><form id="staple-add" class="staple-row add">' +
      '<input type="text" class="st-name" id="st-new-name" placeholder="Ny fast vare" aria-label="Ny fast vare">' +
      '<input type="text" class="st-qty" id="st-new-qty" inputmode="decimal" placeholder="1" aria-label="Mengde">' +
      '<select class="st-unit" id="st-new-unit" aria-label="Enhet">' + optionList(UNITS, 'stk', '–') + '</select>' +
      '<select class="st-aisle" id="st-new-aisle" aria-label="Avdeling">' + optionList(AISLES, 'Tørrvare') + '</select>' +
      '<button type="submit" class="btn">Legg til</button></form></details>';
    el.innerHTML = h;
  }

  function copyText(text) {
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
      if (ok) toast('Lista er kopiert'); else showCopyDialog(text);
    }
    if (navigator.clipboard && navigator.clipboard.writeText && window.isSecureContext) {
      navigator.clipboard.writeText(text).then(function () { toast('Lista er kopiert'); }, fallback);
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
    d.innerHTML = '<div class="sheet" role="dialog" aria-label="Kopier lista"><h3>Kopier lista</h3>' +
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
      if (!window.confirm('Tilbakestille til testdata? Alle retter, ukeplaner og faste varer erstattes.')) return;
      state = freshState();
      save();
      toast('Testdata er tilbakestilt');
      renderRetter();
    } else if (a === 'week-prev') { ui.weekOffset--; renderUke(); }
    else if (a === 'week-next') { ui.weekOffset++; renderUke(); }
    else if (a === 'week-now') { ui.weekOffset = 0; renderUke(); }
    else if (a === 'clear-week') {
      if (!window.confirm('Tømme alle kvelder denne uka?')) return;
      weekDates(ui.weekOffset).forEach(function (d) { state.week_plan[d] = null; });
      save(); renderUke();
    } else if (a === 'copy-text') {
      var text = listAsText();
      if (!text) { toast('Alt er krysset av'); return; }
      copyText(text);
    } else if (a === 'uncheck-all') {
      currentItems().forEach(function (i) { i.checked = false; });
      save(); renderListSection();
    } else if (a === 'delete-staple') {
      var li = btn.closest('.staple-row');
      state.staples = state.staples.filter(function (s) { return s.id !== li.getAttribute('data-id'); });
      save(); renderListSection(); renderStaplesSection();
    }
  });

  main.addEventListener('change', function (e) {
    var t = e.target;
    if (t.classList.contains('day-select')) {
      setDay(t.getAttribute('data-date'), t.value);
    } else if (t.type === 'checkbox' && t.hasAttribute('data-key')) {
      var key = t.getAttribute('data-key');
      var cur = currentItems();
      cur.forEach(function (i) { if (i.key === key) i.checked = t.checked; });
      save();
      t.closest('.item').classList.toggle('checked', t.checked);
      var left = cur.filter(function (i) { return !i.checked; }).length;
      var l = main.querySelector('[data-testid="igjen"]');
      if (l) l.textContent = left + ' igjen';
      var ub = main.querySelector('[data-action="uncheck-all"]');
      if (ub) ub.hidden = left === cur.length;
    } else if (t.classList.contains('ing-name')) {
      var row = t.closest('.ing-row');
      if (row.getAttribute('data-new') === '1') {
        var k = knownIngredient(t.value);
        if (k) {
          row.querySelector('.ing-unit').value = k.unit || '';
          row.querySelector('.ing-aisle').value = k.aisle;
        }
        row.setAttribute('data-new', '0');
      }
    } else if (t.closest('.staple-row') && !t.closest('#staple-add')) {
      var srow = t.closest('.staple-row');
      var s = state.staples.filter(function (x) { return x.id === srow.getAttribute('data-id'); })[0];
      if (!s) return;
      if (t.classList.contains('st-active')) s.active = t.checked;
      else if (t.classList.contains('st-name')) { if (t.value.trim()) s.name = t.value.trim(); else t.value = s.name; }
      else if (t.classList.contains('st-qty')) { s.qty = parseQty(t.value); t.value = formatQty(s.qty); }
      else if (t.classList.contains('st-unit')) s.unit = t.value;
      else if (t.classList.contains('st-aisle')) s.aisle = t.value;
      save();
      renderListSection();
    }
  });

  main.addEventListener('toggle', function (e) {
    if (e.target.classList && e.target.classList.contains('staples')) ui.staplesOpen = e.target.open;
  }, true);

  main.addEventListener('submit', function (e) {
    e.preventDefault();
    if (e.target.id === 'recipe-form') saveRecipeForm(e.target);
    else if (e.target.id === 'staple-add') {
      var name = document.getElementById('st-new-name').value.trim();
      if (!name) { document.getElementById('st-new-name').focus(); return; }
      var q = parseQty(document.getElementById('st-new-qty').value);
      state.staples.push({ id: uid('s'), name: name, qty: q == null ? 1 : q,
        unit: document.getElementById('st-new-unit').value,
        aisle: document.getElementById('st-new-aisle').value, active: true });
      save();
      renderListSection(); renderStaplesSection();
      document.getElementById('st-new-name').focus();
    }
  });

  window.addEventListener('hashchange', function () { route(); window.scrollTo(0, 0); });

  state = load();
  route();
})();
