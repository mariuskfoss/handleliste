/* Knaggen (arbeidsnavn Ukeshandel) v0.6.0 — enheter og pakninger på handlelista (v0.4.1, enhetsnormalisering v0.4.2, basisvarer v0.4.3).
 * Rene funksjoner (ingen DOM), lastes før app.js og kan testes i Node.
 *
 * Regler:
 *  1. Én linje per vare og enhetsfamilie: volum (ml, dl, l, ss = 15 ml, ts = 5 ml) regnes om til ml,
 *     vekt (g, kg) til g. Stykkenheter (stk, pk, boks …) summeres bare med samme enhet, med mindre
 *     pakningstabellen sier hvordan de regnes om (f.eks. smør: 1 pk = 250 g, 1 ss = 15 g).
 *  2. Behovet summeres først (inkl. +/-), så rundes det ALLTID opp:
 *     - kjente varer: til hele pakninger (minst mulig til overs, ved likhet færrest pakninger);
 *     - ellers til et fornuftig steg: ≥ 1 kg → 0,1 kg, ≥ 1 l → 0,1 l, dl → 0,5 dl, stykkenheter → hele.
 *     Skje-mål alene (ss/ts) er ikke noe man kjøper; de vises nøyaktig («1 ss + 1 ts»).
 *  3. Det faktiske behovet vises i liten tekst når det avviker («behov 7 dl»).
 */
(function (root) {
  'use strict';

  var UNIT = {
    ml: ['vol', 1], dl: ['vol', 100], l: ['vol', 1000], ss: ['vol', 15], ts: ['vol', 5],
    g: ['mass', 1], kg: ['mass', 1000]
  };
  var BASE = { vol: 'ml', mass: 'g' };
  var COUNT = ['stk', 'pk', 'boks', 'glass', 'beger', 'flaske', 'fedd', 'bunt'];

  // Kjente norske pakningsstørrelser (i grunnenhet). conv: hvordan andre enheter regnes om for denne varen.
  // Uten enhet («Melk 1») betyr antall pakninger (minste pakning) for varer målt i ml/g, antall stk ellers.
  // v0.4.2: «stk» betyr også én pakning der det er entydig (1 stk melk = 1 kartong), men ikke for poteter/sjampinjong (stykker).
  var PACK_TABLE = [
    { names: ['melk', 'helmelk', 'lettmelk', 'skummet melk', 'ekstra lett melk', 'h-melk'], base: 'ml', packs: [1000, 1750], conv: { stk: 1000, kartong: 1000 } },
    { names: ['matfløte', 'lett matfløte', 'kremfløte', 'fløte'], base: 'ml', packs: [300, 500], conv: { stk: 300, kartong: 300 } },
    { names: ['rømme', 'lettrømme', 'seterrømme'], base: 'ml', packs: [300], conv: { beger: 300, stk: 300 } },
    { names: ['kjøttdeig', 'karbonadedeig', 'kyllingkjøttdeig', 'svinekjøttdeig'], base: 'g', packs: [400], conv: { stk: 400 } },
    { names: ['smør', 'meierismør'], base: 'g', packs: [250, 500], conv: { ss: 15, ts: 5, pk: 250, stk: 250 } },
    { names: ['poteter', 'potet', 'mandelpoteter'], base: 'g', packs: [1000, 2500] },
    { names: ['spaghetti', 'penne', 'fusilli', 'makaroni', 'tagliatelle', 'linguine'], base: 'g', packs: [500] },
    { names: ['champignon', 'sjampinjong'], base: 'g', packs: [250] },
    { names: ['egg'], base: 'stk', packs: [6, 12], conv: { pk: 12 } },
    { names: ['hvitløk'], base: 'stk', packs: [1], conv: { fedd: 0.1 } }
  ];
  // Buljong: skjeer er konsentrat/pulver, liter er ferdig buljong. Samme linje, men delene vises hver for seg.
  var SEPARATE_SPOONS = /(buljong|kraft)$/;

  // v0.4.3: basisvarer (spec v0.4 punkt 3: krydder, mel, olje o.l.) – ting man vanligvis har i skapet.
  // Middagsingredienser med disse navnene legges ikke rett på lista; de samles i én melding øverst på Liste.
  // Treff på hele navnet, uten hensyn til store/små bokstaver og mellomrom. En ingrediens kan merkes av/på i
  // oppskriften (basis: true/false), det overstyrer tabellen.
  var BASIS_TABLE = {
    krydder: ['salt', 'havsalt', 'flaksalt', 'pepper', 'sort pepper', 'kvernet pepper', 'hel sort pepper', 'hvit pepper',
      'karri', 'karripulver', 'paprikapulver', 'røkt paprikapulver', 'chilipulver', 'chiliflak', 'kajennepepper', 'kanel',
      'spisskummen', 'timian', 'oregano', 'tørket basilikum', 'tørket timian', 'tørket oregano', 'rosmarin', 'laurbærblad',
      'muskat', 'muskatnøtt', 'nellik', 'kardemomme', 'ingefærpulver', 'hvitløkspulver', 'løkpulver', 'allehånde',
      'gurkemeie', 'malt koriander', 'garam masala', 'sesamfrø'],
    mel: ['hvetemel', 'byggmel', 'rugmel', 'grovt mel', 'sammalt hvete', 'potetmel', 'maismel', 'maisenna', 'griljermel',
      'strømel', 'bakepulver', 'natron', 'tørrgjær', 'sukker', 'brunt sukker', 'melis', 'vaniljesukker'],
    olje: ['olje', 'matolje', 'olivenolje', 'rapsolje', 'solsikkeolje', 'nøytral olje', 'sesamolje', 'eddik',
      'balsamicoeddik', 'soyasaus', 'fiskesaus', 'østerssaus']
  };
  var BASIS = {};
  Object.keys(BASIS_TABLE).forEach(function (g) { BASIS_TABLE[g].forEach(function (n) { BASIS[n] = g; }); });
  function basisKey(name) { return String(name || '').replace(/[\u200B-\u200D\uFEFF]/g, '').trim().toLowerCase().replace(/\s+/g, ' '); }
  function isBasisName(name) { return BASIS.hasOwnProperty(basisKey(name)); }
  // Gjelder denne ingrediensen som basisvare? Eget merke i oppskriften vinner over tabellen.
  function isBasis(ing) { return ing && typeof ing.basis === 'boolean' ? ing.basis : isBasisName(ing && ing.name); }

  var PACKS = {};
  PACK_TABLE.forEach(function (e) { e.names.forEach(function (n) { PACKS[n] = e; }); });

  function round3(n) { return Math.round(n * 1000) / 1000; }
  function ceilTo(x, step) { return round3(Math.ceil(x / step - 1e-9) * step); }
  function fmt(q) { var r = Math.round(q * 100) / 100; return String(r).replace('.', ','); }
  function fmtU(q, u) { return u ? fmt(q) + ' ' + u : fmt(q); }

  function packFor(nn) { return PACKS[nn] || null; }

  // v0.4.2: enheter fra eldre data/andre klienter kan ha store bokstaver, mellomrom eller skrives ut («L», " dl", «liter»).
  var ALIAS = { liter: 'l', litre: 'l', ltr: 'l', desiliter: 'dl', milliliter: 'ml', gram: 'g', gr: 'g', kilo: 'kg', kilogram: 'kg',
    stykk: 'stk', stykker: 'stk', pakke: 'pk', pakker: 'pk', pakning: 'pk', pkt: 'pk', spiseskje: 'ss', spiseskjeer: 'ss', teskje: 'ts', teskjeer: 'ts' };
  function normUnit(u) {
    u = String(u == null ? '' : u).replace(/[\u200B-\u200D\uFEFF]/g, '').trim().toLowerCase().replace(/\.$/, '');
    return ALIAS[u] || u;
  }

  // Hvordan én ingredienslinje (navn + enhet) regnes om. Gir grunnenhet og faktor, eller null (ingen omregning).
  function conversion(nn, unit) {
    unit = normUnit(unit);
    var p = PACKS[nn];
    if (p) {
      if (p.conv && p.conv[unit] != null) return { base: p.base, factor: p.conv[unit] };
      var u = UNIT[unit];
      if (u && BASE[u[0]] === p.base) return { base: p.base, factor: u[1] };
      if (unit === p.base) return { base: p.base, factor: 1 };
      if (unit === '' || unit === 'pk') return { base: p.base, factor: p.base === 'stk' ? 1 : p.packs[0] };
      return null;
    }
    var v = UNIT[unit];
    if (v) return { base: BASE[v[0]], factor: v[1] };
    return null;
  }
  // Nøkkel for linja på handlelista: navn|grunnenhet (ml/g/…) når enheten kan regnes om, ellers navn|enhet som før.
  function keyFor(nn, unit) {
    var c = conversion(nn, unit);
    return nn + '|' + (c ? c.base : normUnit(unit));
  }
  function factorFor(nn, unit) { var c = conversion(nn, unit); return c ? c.factor : 1; }

  // Minst mulig til overs (≥ behov); ved likhet færrest pakninger. Gir liste med størrelser (størst først).
  function packCombo(need, sizes) {
    sizes = sizes.slice().sort(function (a, b) { return b - a; });
    if (need <= 1e-9) return [];
    var best = null;
    function rec(i, left, picked, total) {
      if (i === sizes.length - 1) {
        var n = Math.max(0, Math.ceil(left / sizes[i] - 1e-9));
        var combo = picked.concat(Array(n).fill(sizes[i]));
        var tot = round3(total + n * sizes[i]);
        if (!best || tot < best.total - 1e-9 || (Math.abs(tot - best.total) < 1e-9 && combo.length < best.combo.length)) best = { total: tot, combo: combo };
        return;
      }
      var max = Math.ceil(left / sizes[i] - 1e-9);
      for (var k = 0; k <= max; k++) rec(i + 1, round3(left - k * sizes[i]), picked.concat(Array(k).fill(sizes[i])), round3(total + k * sizes[i]));
    }
    rec(0, need, [], 0);
    return best.combo;
  }

  function sizeText(v, base) {
    if (base === 'ml') return v >= 1000 ? fmtU(v / 1000, 'l') : fmtU(v / 100, 'dl');
    if (base === 'g') return v >= 1000 ? fmtU(v / 1000, 'kg') : fmtU(v, 'g');
    return fmtU(v, base);
  }
  function packsText(combo, base) {
    var groups = [];
    combo.forEach(function (s) {
      var g = groups[groups.length - 1];
      if (g && g.s === s) g.n++; else groups.push({ s: s, n: 1 });
    });
    return groups.map(function (g) {
      if (base !== 'ml' && base !== 'g' && g.s === 1) return fmtU(g.n, base);        // 2 stk, ikke «2 × 1 stk»
      return (g.n > 1 ? g.n + ' × ' : '') + sizeText(g.s, base);
    }).join(' + ');
  }
  function spoonText(ml) {
    ml = round3(ml);
    if (ml >= 15) {
      var ss = Math.floor(ml / 15 + 1e-9), rest = round3(ml - ss * 15);
      return fmtU(ss, 'ss') + (rest > 1e-9 ? ' + ' + fmtU(rest / 5, 'ts') : '');
    }
    return fmtU(ml / 5, 'ts');
  }
  function has(units, list) { return units.some(function (u) { return list.indexOf(u) >= 0; }); }
  function only(units, list) { return units.length > 0 && units.every(function (u) { return list.indexOf(u) >= 0; }); }

  // Volum uten pakning: velg visningsenhet ut fra kildeenhetene og behovet.
  function volUnit(ml, units) {
    if (ml >= 1000 || only(units, ['l'])) return 'l';
    if (only(units, ['ml'])) return 'ml';
    return 'dl';
  }
  var ROUND = { l: 0.1, dl: 0.5, ml: 1, kg: 0.1, g: 1 };
  var STEP = { g: 100, kg: 0.5, l: 0.5, dl: 1, ml: 100 };

  function amountPlan(need, du, factor) {
    var buy = ceilTo(need / factor, ROUND[du]);
    return { buy: round3(buy * factor), text: fmtU(buy, du), needText: fmtU(round3(need / factor), du), step: STEP[du] * factor, unit: du };
  }

  /* Plan for én linje. parts: { enhet: mengde } slik ingrediensene står (før omregning), adj: +/- i grunnenhet.
   * Gir { need, buy, text, needText, showNeed, step, packs, adjText(d) }, alt i grunnenhet. */
  function plan(nn, base, parts, adj) {
    adj = adj || 0;
    var units = Object.keys(parts).filter(function (u) { return parts[u] != null; });
    var sum = 0;
    units.forEach(function (u) { sum += parts[u] * factorFor(nn, u); });
    var need = Math.max(0, round3(sum + adj));
    var p = PACKS[nn], r;
    if (p && p.base === base) {
      var combo = packCombo(need, p.packs);
      var buy = round3(combo.reduce(function (a, b) { return a + b; }, 0));
      r = { buy: buy, text: need > 0 ? packsText(combo, base) : sizeText(0, base).replace(/^0 dl$/, '0 l'),
        needText: sizeText(need, base), step: Math.min.apply(null, p.packs), packs: combo, unit: base };
    } else if (base === 'ml') {
      var spoonMl = 0, liquidMl = 0;
      units.forEach(function (u) { if (u === 'ss' || u === 'ts') spoonMl += parts[u] * UNIT[u][1]; else liquidMl += parts[u] * UNIT[u][1]; });
      if (only(units, ['ss', 'ts'])) {
        r = { buy: need, text: spoonText(need), needText: spoonText(need), step: has(units, ['ss']) || need >= 15 ? 15 : 5, unit: 'ss' };
      } else if (SEPARATE_SPOONS.test(nn) && spoonMl > 0 && liquidMl > 0) {
        var liq = Math.max(0, round3(liquidMl + adj));
        var lu = volUnit(liq, units.filter(function (u) { return u !== 'ss' && u !== 'ts'; }));
        var lp = amountPlan(liq, lu, UNIT[lu][1]);
        spoonMl = round3(spoonMl);
        r = { buy: round3(lp.buy + spoonMl), text: lp.text + ' + ' + spoonText(spoonMl), needText: lp.needText + ' + ' + spoonText(spoonMl), step: lp.step, unit: lu };
      } else {
        var du = volUnit(need, units);
        r = amountPlan(need, du, UNIT[du][1]);
      }
    } else if (base === 'g') {
      var mu = need >= 1000 || only(units, ['kg']) ? 'kg' : 'g';
      r = amountPlan(need, mu, UNIT[mu][1]);
    } else if (COUNT.indexOf(base) >= 0) {
      var cb = ceilTo(need, 1);
      r = { buy: cb, text: fmtU(cb, base), needText: fmtU(need, base), step: 1, unit: base };
    } else {
      r = { buy: need, text: fmtU(need, base), needText: fmtU(need, base), step: 1, unit: base };
    }
    r.need = need;
    // Står alt i én «kjøkken-/stykkenhet» (fedd, ss, beger …) uten +/-, vises behovet i den enheten («behov 4 fedd»).
    if (units.length === 1 && !adj && !(units[0] in { ml: 1, dl: 1, l: 1, g: 1, kg: 1 }) && units[0] !== base && units[0] !== r.unit) {
      r.needText = units[0] === 'ss' || units[0] === 'ts' ? spoonText(parts[units[0]] * UNIT[units[0]][1]) : fmtU(parts[units[0]], units[0]);
    }
    r.showNeed = need > 0 && r.buy > need + 1e-9;
    r.adjText = function (d) {
      var s = d > 0 ? '+' : '−', a = Math.abs(d);
      if (base === 'ml') return s + (r.unit === 'ss' ? spoonText(a) : sizeText(a, 'ml'));
      if (base === 'g') return s + sizeText(a, 'g');
      return s + fmtU(a, base);
    };
    return r;
  }

  root.UkeshandelUnits = {
    UNIT: UNIT, PACK_TABLE: PACK_TABLE, BASIS_TABLE: BASIS_TABLE, isBasisName: isBasisName, isBasis: isBasis, packFor: packFor, normUnit: normUnit, conversion: conversion, keyFor: keyFor,
    factorFor: factorFor, packCombo: packCombo, plan: plan, spoonText: spoonText, sizeText: sizeText
  };
})(typeof window !== 'undefined' ? window : globalThis);
