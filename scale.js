/* Knaggen v0.8 – husstandsskalering. Referanse: merkevare/husstand/skalering.py (må stemme bit for bit). */
(function (global) {
  'use strict';
  var VEKT = { voksen: 1, barn: 0.75, smabarn: 0.5 };
  var BASE = 4;
  var GULV = 0.5;
  var TELLE = { stk: 1, pk: 1, boks: 1, glass: 1, beger: 1, flaske: 1, fedd: 1, bunt: 1 };

  function porsjoner(p) {
    p = p || {};
    return (p.voksen || 0) * VEKT.voksen + (p.barn || 0) * VEKT.barn + (p.smabarn || 0) * VEKT.smabarn;
  }
  function kvart(x) {
    // nærmeste ¼, halvveis opp — samme som math.floor(x*4 + 1/2)/4 med Fraction
    return Math.floor(x * 4 + 0.5) / 4;
  }
  function dagensFolk(husstand, avvik) {
    avvik = avvik || {};
    if (!husstand) {
      if ((avvik.voksen || 0) < 0 || (avvik.barn || 0) < 0 || (avvik.smabarn || 0) < 0)
        throw new Error('Færre krever at husstanden er satt');
      return BASE + porsjoner(avvik);
    }
    return porsjoner({
      voksen: Math.max(0, (husstand.voksen || 0) + (avvik.voksen || 0)),
      barn: Math.max(0, (husstand.barn || 0) + (avvik.barn || 0)),
      smabarn: Math.max(0, (husstand.smabarn || 0) + (avvik.smabarn || 0))
    });
  }
  /** @returns {number|string} faktor, eller 'Tom' når 0 personer */
  function faktor(rettFraKnaggen, tilpassPa, husstand, avvik, B) {
    B = B == null ? BASE : B;
    var harAvvik = !!(avvik && (avvik.voksen || avvik.barn || avvik.smabarn));
    var Pd = dagensFolk(husstand, avvik);
    if (Pd === 0) return 'Tom';
    if (rettFraKnaggen && tilpassPa && husstand)
      return Math.max(GULV, kvart(Pd / B));
    if (!harAvvik) return 1;
    var P = husstand ? porsjoner(husstand) : BASE;
    return Math.max(GULV, kvart(Pd / P));
  }
  function skalerIngrediens(qty, unit, f, harPakning) {
    var q = Number(qty) * f;
    if (TELLE[unit] && !harPakning) {
      if (qty < 1) return Math.max(0.5, Math.floor(q * 2 + 0.5) / 2);
      return Math.max(1, Math.floor(q + 0.5));
    }
    return q;
  }
  function fmt(f) {
    if (f === 'Tom') return '';
    var n = Math.floor(f);
    var r = Math.round((f - n) * 4);
    if (r === 4) { n++; r = 0; }
    var s = { 0: '', 1: '¼', 2: '½', 3: '¾' }[r];
    return '×' + (n || !s ? String(n) : '') + (s || '');
  }
  function peopleText(p, shortNames) {
    p = p || {};
    var parts = [];
    var v = p.voksen || 0, b = (p.barn || 0) + (p.smabarn || 0), s = p.smabarn || 0, ba = p.barn || 0;
    if (v) parts.push(v + (v === 1 ? ' voksen' : ' voksne'));
    // UI: barn 6–12 + småbarn sammen som «barn» i sammensetning (merkevare §3)
    if (shortNames) {
      if (b) parts.push(b + (b === 1 ? ' barn' : ' barn'));
    } else {
      if (ba) parts.push(ba + (ba === 1 ? ' barn 6–12' : ' barn 6–12'));
      if (s) parts.push(s + (s === 1 ? ' småbarn' : ' småbarn'));
    }
    return parts.join(' + ') || '0';
  }
  function deltaText(d) {
    d = d || {};
    var parts = [];
    function add(n, one, many) {
      if (!n) return;
      var a = Math.abs(n);
      parts.push((n > 0 ? '+' : '−') + a + ' ' + (a === 1 ? one : many));
    }
    add(d.voksen || 0, 'voksen', 'voksne');
    add(d.barn || 0, 'barn', 'barn');
    add(d.smabarn || 0, 'småbarn', 'småbarn');
    return parts.join(', ');
  }
  function netPeople(d) {
    return (d.voksen || 0) + (d.barn || 0) + (d.smabarn || 0);
  }
  function hasDelta(d) {
    return !!(d && (d.voksen || d.barn || d.smabarn));
  }
  function effectivePeople(husstand, avvik) {
    if (!husstand) {
      return { voksen: Math.max(0, (avvik && avvik.voksen) || 0), barn: Math.max(0, (avvik && avvik.barn) || 0), smabarn: Math.max(0, (avvik && avvik.smabarn) || 0) };
    }
    return {
      voksen: Math.max(0, (husstand.voksen || 0) + ((avvik && avvik.voksen) || 0)),
      barn: Math.max(0, (husstand.barn || 0) + ((avvik && avvik.barn) || 0)),
      smabarn: Math.max(0, (husstand.smabarn || 0) + ((avvik && avvik.smabarn) || 0))
    };
  }
  function isKnaggen(r) {
    if (!r) return false;
    if (r.scale === false) return false;
    if (r.origin === 'knaggen') return true;
    if (/^lib-/.test(r.id || '')) return true;
    return false;
  }
  function servingsOf(r) {
    if (r && r.servings != null && isFinite(r.servings) && r.servings > 0) return Number(r.servings);
    return BASE;
  }

  global.UKESHANDEL_SCALE = {
    VEKT: VEKT, BASE: BASE, GULV: GULV, TELLE: TELLE,
    porsjoner: porsjoner, kvart: kvart, dagensFolk: dagensFolk, faktor: faktor,
    skalerIngrediens: skalerIngrediens, fmt: fmt, peopleText: peopleText, deltaText: deltaText,
    netPeople: netPeople, hasDelta: hasDelta, effectivePeople: effectivePeople,
    isKnaggen: isKnaggen, servingsOf: servingsOf
  };
})(typeof window !== 'undefined' ? window : globalThis);
