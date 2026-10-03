/* Knaggen (arbeidsnavn Ukeshandel) v0.6.1 — enheter og pakninger på handlelista (v0.4.1, enhetsnormalisering v0.4.2, basisvarer v0.4.3).
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
 *  4. v0.6.1 (spec v0.6.1 punkt 3): én enkel pakkeoppskrift – bare én pakningsstørrelse per vare («Melk 3 l»,
 *     «3 × 250 g»), aldri blandet («1,75 l + 2 × 1 l»). Pakninger på 1 l / 1 kg vises som totalen («3 l»).
 *     Varer som står i dl/ss/ts i oppskriftene (mel, ris, sukker, soyasaus, olje, krydder …) får pakningsstørrelse
 *     via VOLUME_GOODS («Hvetemel 1 kg · behov 3 dl»). Andre varer som bare står i ss/ts blir «1 pk».
 *     Linjenøklene (navn|ml) og omregningen er uendret, så avkrysninger og justeringer beholdes.
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
  // v0.6.1: varer som står i volum (ml/dl/ss/ts) i oppskriftene, men kjøpes i pakning. Linja beholder grunnenheten ml
  // (samme nøkkel som før); bare kjøpet regnes om. sale: enheten pakningen selges i (g, ml eller pk),
  // per: hvor mye av sale-enheten 1 ml tilsvarer (g per ml for mel o.l., pk per ml for krydder).
  var VOLUME_GOODS = [
    { names: ['hvetemel', 'byggmel', 'rugmel', 'grovt mel', 'sammalt hvete', 'speltmel'], sale: 'g', packs: [1000, 2000], per: 0.6 },
    { names: ['potetmel', 'maismel', 'maisenna'], sale: 'g', packs: [500], per: 0.7 },
    { names: ['griljermel', 'strømel', 'panko'], sale: 'g', packs: [200], per: 0.4 },
    { names: ['sukker', 'strøsukker'], sale: 'g', packs: [1000], per: 0.85 },
    { names: ['brunt sukker', 'melis'], sale: 'g', packs: [500], per: 0.6 },
    { names: ['ris', 'basmatiris', 'jasminris', 'langkornet ris', 'parboiled ris', 'risottoris', 'grøtris'], sale: 'g', packs: [1000], per: 0.85 },
    { names: ['couscous', 'bulgur', 'quinoa'], sale: 'g', packs: [500], per: 0.8 },
    { names: ['røde linser', 'linser', 'grønne linser'], sale: 'g', packs: [500], per: 0.85 },
    { names: ['havregryn', 'lettkokte havregryn'], sale: 'g', packs: [1000], per: 0.35 },
    { names: ['cornflakes'], sale: 'g', packs: [500], per: 0.13 },
    { names: ['tomatpuré'], sale: 'g', packs: [200], per: 1.1 },
    { names: ['peanøttsmør'], sale: 'g', packs: [350], per: 1.05 },
    { names: ['sennep'], sale: 'g', packs: [490], per: 1.05 },
    { names: ['rød karripasta', 'grønn karripasta', 'gul karripasta', 'karripasta'], sale: 'g', packs: [110], per: 1 },
    { names: ['soyasaus', 'lys soyasaus', 'mørk soyasaus', 'østerssaus', 'sesamolje'], sale: 'ml', packs: [150], per: 1 },
    { names: ['fiskesaus', 'limejuice', 'sitronsaft', 'sitronjuice'], sale: 'ml', packs: [200], per: 1 },
    { names: ['olje', 'matolje', 'olivenolje', 'rapsolje', 'solsikkeolje', 'nøytral olje', 'eddik'], sale: 'ml', packs: [500], per: 1 },
    { names: ['balsamicoeddik'], sale: 'ml', packs: [250], per: 1 },
    { names: ['salt', 'havsalt', 'flaksalt'], sale: 'pk', packs: [1], per: 1 / 500 },
    { names: ['pepper', 'sort pepper', 'kvernet pepper', 'hel sort pepper', 'hvit pepper', 'karri', 'karripulver', 'paprikapulver',
      'røkt paprikapulver', 'chilipulver', 'chiliflak', 'kajennepepper', 'kanel', 'spisskummen', 'timian', 'oregano', 'tørket basilikum',
      'tørket timian', 'tørket oregano', 'rosmarin', 'laurbærblad', 'muskat', 'muskatnøtt', 'nellik', 'kardemomme', 'ingefærpulver',
      'hvitløkspulver', 'løkpulver', 'allehånde', 'gurkemeie', 'malt koriander', 'garam masala', 'sesamfrø', 'bakepulver', 'natron',
      'tørrgjær', 'vaniljesukker', 'tacokrydder', 'fajitaskrydder'], sale: 'pk', packs: [1], per: 1 / 100 }
  ];
  // Andre varer som bare står i ss/ts: én pakning (1 pk per 250 ml).
  var SPOON_GOOD = { sale: 'pk', packs: [1], per: 1 / 250 };
  var VOLS = {};
  VOLUME_GOODS.forEach(function (e) { e.names.forEach(function (n) { VOLS[n] = e; }); });

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

  // v0.6.1: én pakningsstørrelse (enkel pakkeoppskrift): minst mulig til overs (≥ behov); ved likhet færrest
  // pakninger. Gir liste med størrelser, f.eks. [1000, 1000, 1000] for 2,75 l melk.
  function packCombo(need, sizes) {
    if (need <= 1e-9) return [];
    var best = null;
    sizes.slice().sort(function (a, b) { return b - a; }).forEach(function (sz) {
      var n = Math.max(1, Math.ceil(need / sz - 1e-9)), tot = round3(n * sz);
      if (!best || tot < best.total - 1e-9) best = { total: tot, n: n, s: sz };
    });
    return Array(best.n).fill(best.s);
  }

  // v0.6.1: +/- på en pakningsvare går til neste mulige kjøp (n × én størrelse) over/under det som kjøpes nå, så
  // + og − alltid går tilbake til samme mengde (3,5 l → + → 4 l → − → 3,5 l; 1 kg → + → 2 kg → − → 1 kg).
  // Gir neste kjøp i grunnenhet, 0 når det ikke finnes noe mindre kjøp.
  // pl: resultatet fra plan() for en pakningsvare; regnes i salgsenheten (g/ml/pk) for å unngå avrundingsfeil.
  function nextBuy(pl, dir) {
    var per = pl.sale ? pl.sale.per : 1, sizes = pl.sizes, cur = round3(pl.buy * per), best = dir > 0 ? Infinity : 0;
    sizes.forEach(function (sz) {
      if (dir > 0) best = Math.min(best, round3((Math.floor(cur / sz + 1e-4) + 1) * sz));
      else { var m = Math.ceil(cur / sz - 1e-4) - 1; if (m > 0) best = Math.max(best, round3(m * sz)); }
    });
    return round3(best / per);
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
      if ((base === 'ml' || base === 'g') && g.s === 1000) return sizeText(g.n * 1000, base);   // v0.6.1: «3 l», ikke «3 × 1 l»
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
  // kitchen: bare kjøkkenmål, uten pakninger fra VOLUME_GOODS (brukes i basisvinduet: «hvetemel 3 dl»).
  function plan(nn, base, parts, adj, kitchen) {
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
        needText: sizeText(need, base), step: Math.min.apply(null, p.packs), packs: combo, sizes: p.packs.slice(), unit: base };
    } else if (base === 'ml' && !kitchen && (VOLS[nn] || (only(units, ['ss', 'ts']) && need > 0))) {
      // v0.6.1: kjøpes i pakning («Hvetemel 1 kg · behov 3 dl», «Soyasaus 1,5 dl · behov 3 ss», «Karri 1 pk»).
      var g = VOLS[nn] || SPOON_GOOD;
      var vc = packCombo(round3(need * g.per), g.packs);
      var vbuy = round3(vc.reduce(function (a, b) { return a + b; }, 0));
      r = { buy: round3(vbuy / g.per), text: need > 0 ? packsText(vc, g.sale) : (g.sale === 'pk' ? '0 pk' : sizeText(0, g.sale).replace(/^0 dl$/, '0 l')),
        needText: only(units, ['ss', 'ts']) ? spoonText(need) : sizeText(need, 'ml'), step: round3(Math.min.apply(null, g.packs) / g.per),
        packs: vc, sizes: g.packs.slice(), unit: g.sale, sale: g };
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
      if (r.sale) return s + (r.sale.sale === 'pk' ? fmtU(Math.round(a * r.sale.per * 100) / 100, 'pk') : sizeText(round3(a * r.sale.per), r.sale.sale));
      if (base === 'ml') return s + (r.unit === 'ss' ? spoonText(a) : sizeText(a, 'ml'));
      if (base === 'g') return s + sizeText(a, 'g');
      return s + fmtU(a, base);
    };
    return r;
  }

  root.UkeshandelUnits = {
    UNIT: UNIT, PACK_TABLE: PACK_TABLE, VOLUME_GOODS: VOLUME_GOODS, BASIS_TABLE: BASIS_TABLE, isBasisName: isBasisName, isBasis: isBasis, packFor: packFor, normUnit: normUnit, conversion: conversion, keyFor: keyFor,
    factorFor: factorFor, packCombo: packCombo, nextBuy: nextBuy, plan: plan, spoonText: spoonText, sizeText: sizeText
  };
})(typeof window !== 'undefined' ? window : globalThis);
