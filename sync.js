/* Ukeshandel v0.2 – synkronisering av husstandens data via Firebase (Firestore + anonym innlogging).
 * Firebase-SDK lastes først når den trengs (dynamisk import fra gstatic), så appen virker som før uten oppsett.
 */
const SDK = 'https://www.gstatic.com/firebasejs/12.19.0/';
const EMULATOR_HOSTS = ['localhost', '127.0.0.1'];
const EMULATOR_CONFIG = { apiKey: 'demo-key', authDomain: 'demo-ukeshandel.firebaseapp.com', projectId: 'demo-ukeshandel', appId: 'demo-app' };

let ctx = null;        // { fs, au, db, auth, uid }
let initPromise = null;

function isEmulator() {
  return EMULATOR_HOSTS.indexOf(location.hostname) >= 0;
}
function prodConfig() {
  const c = window.UKESHANDEL_FIREBASE_CONFIG;
  if (!c || !c.apiKey || !c.projectId || /LIM_INN/.test(c.apiKey + c.projectId + (c.appId || ''))) return null;
  return c;
}
function mode() {
  if (isEmulator()) return 'emulator';
  return prodConfig() ? 'prod' : null;
}

// Tilfeldig kode, 24 tegn base62 ≈ 143 bit.
function randomCode(len = 24) {
  const abc = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  const out = [];
  while (out.length < len) {
    const buf = crypto.getRandomValues(new Uint8Array(len * 2));
    for (const b of buf) { if (b < 248 && out.length < len) out.push(abc[b % 62]); }
  }
  return out.join('');
}

async function init() {
  if (ctx) return ctx;
  if (initPromise) return initPromise;
  initPromise = (async () => {
    const m = mode();
    if (!m) throw new Error('not-configured');
    const [appMod, au, fs] = await Promise.all([
      import(SDK + 'firebase-app.js'), import(SDK + 'firebase-auth.js'), import(SDK + 'firebase-firestore.js')
    ]);
    const app = appMod.initializeApp(m === 'emulator' ? EMULATOR_CONFIG : prodConfig(), 'ukeshandel');
    const auth = au.getAuth(app);
    let db;
    try {
      db = fs.initializeFirestore(app, {
        localCache: fs.persistentLocalCache({ tabManager: fs.persistentMultipleTabManager() }),
        ignoreUndefinedProperties: true
      });
    } catch (e) {
      db = fs.initializeFirestore(app, { ignoreUndefinedProperties: true });
    }
    if (m === 'emulator') {
      au.connectAuthEmulator(auth, 'http://127.0.0.1:9099', { disableWarnings: true });
      fs.connectFirestoreEmulator(db, '127.0.0.1', 8080);
    }
    await auth.authStateReady();
    if (!auth.currentUser) await au.signInAnonymously(auth);
    ctx = { fs, au, db, auth, uid: auth.currentUser.uid };
    return ctx;
  })();
  try { return await initPromise; } catch (e) { initPromise = null; throw e; }
}

function withTimeout(p, ms, msg) {
  return Promise.race([p, new Promise((_, rej) => setTimeout(() => rej(new Error(msg || 'timeout')), ms))]);
}

const hh = (hid, ...rest) => [ctx.db, 'households', hid, ...rest];

function recipeDoc(r) {
  return {
    name: r.name, minutes: r.minutes == null ? null : r.minutes, note: r.note || '',
    // v0.4.3: basis (true/false) bare når ingrediensen er merket annerledes enn standardtabellen.
    ingredients: (r.ingredients || []).map(i => Object.assign({ name: i.name, qty: i.qty == null ? null : i.qty, unit: i.unit || '', aisle: i.aisle },
      typeof i.basis === 'boolean' ? { basis: i.basis } : {})),
    updated_at: Date.now()
  };
}
function stapleDoc(s, order) {
  return { name: s.name, qty: s.qty == null ? null : s.qty, unit: s.unit || '', aisle: s.aisle, active: s.active !== false,
    order: s.order != null ? s.order : (order != null ? order : Date.now()) };
}
function oneoffDoc(o) {
  return o ? { id: o.id, name: o.name, ingredients: recipeDoc(o).ingredients } : null;
}
// v0.4.4: kort signatur for en dag slik den ligger i Firestore (samme som app.js bruker for det telefonen viser).
function daySig(d) {
  if (!d) return '';
  if (d.oneoff && d.oneoff.name) return 'o:' + (d.oneoff.id || d.oneoff.name);
  return d.recipe_id ? 'r:' + d.recipe_id : '';
}
function dayBody(date, d) {
  const o = d && d.oneoff && d.oneoff.name ? d.oneoff : null;
  return { date, recipe_id: o ? null : ((d && d.recipe_id) || null),
    oneoff: o ? { id: o.id || null, name: o.name, ingredients: o.ingredients || [] } : null };
}
function extraDoc(x) {
  return { week: x.week, name: x.name, qty: x.qty == null ? null : x.qty, unit: x.unit || '', aisle: x.aisle, created: x.created || Date.now() };
}

// Oppretter husstand + hemmelighet + eget medlemskap i én batch, og flytter lokale data inn (idempotent).
async function createHousehold(local, existing) {
  const c = await init();
  const { fs } = c;
  const hid = existing ? existing.hid : randomCode();
  const secret = existing ? existing.secret : randomCode();
  if (!existing || !existing.core_done) {
    const b = fs.writeBatch(c.db);
    b.set(fs.doc(...hh(hid)), { created_by: c.uid, created_at: fs.serverTimestamp(), schema: 2, app_version: '0.2.0' });
    b.set(fs.doc(...hh(hid, 'private', 'join')), { secret });
    b.set(fs.doc(...hh(hid, 'members', c.uid)), { secret, joined_at: fs.serverTimestamp() });
    if (local.onCore) local.onCore({ hid, secret });
    await withTimeout(b.commit(), 20000, 'no-server');
  }
  if (local.onCoreDone) local.onCoreDone({ hid, secret });
  // Data i biter (maks 500 skriv per batch)
  const writes = [];
  (local.recipes || []).forEach(r => writes.push(['set', hh(hid, 'recipes', r.id), recipeDoc(r)]));
  (local.staples || []).forEach((s, i) => writes.push(['set', hh(hid, 'staples', s.id), stapleDoc(s, i + 1)]));
  const dates = {};
  Object.keys(local.week_plan || {}).forEach(d => { if (local.week_plan[d]) dates[d] = true; });
  Object.keys(local.oneoffs || {}).forEach(d => { dates[d] = true; });
  Object.keys(dates).forEach(d => {
    if (!/^\d{4}-\d\d-\d\d$/.test(d)) return;
    const o = (local.oneoffs || {})[d];
    writes.push(['set', hh(hid, 'days', d), { date: d, recipe_id: o ? null : (local.week_plan[d] || null), oneoff: oneoffDoc(o) }]);
  });
  const weeks = {};
  Object.keys(local.checks || {}).forEach(w => { weeks[w] = weeks[w] || {}; weeks[w].checked = local.checks[w]; });
  Object.keys(local.list_adjust || {}).forEach(w => { weeks[w] = weeks[w] || {}; weeks[w].adjust = local.list_adjust[w]; });
  Object.keys(weeks).forEach(w => {
    if (!/^\d{4}-\d\d-\d\d$/.test(w)) return;
    writes.push(['set', hh(hid, 'lists', w), { week: w, checked: weeks[w].checked || {}, adjust: weeks[w].adjust || {} }]);
  });
  (local.list_extras || []).forEach(x => writes.push(['set', hh(hid, 'extras', x.id), extraDoc(x)]));
  for (let i = 0; i < writes.length; i += 400) {
    const b = fs.writeBatch(c.db);
    writes.slice(i, i + 400).forEach(w => b.set(fs.doc(...w[1]), w[2]));
    await withTimeout(b.commit(), 30000, 'no-server');
  }
  return { hid, secret };
}

async function isMember(hid) {
  const c = await init();
  try {
    const s = await c.fs.getDoc(c.fs.doc(...hh(hid, 'members', c.uid)));
    return s.exists();
  } catch (e) {
    if (e && e.code === 'unavailable') return null; // frakoblet: ukjent
    throw e;
  }
}

async function joinHousehold(hid, secret) {
  const c = await init();
  const m = await isMember(hid);
  if (m) return true;
  await withTimeout(c.fs.setDoc(c.fs.doc(...hh(hid, 'members', c.uid)), { secret, joined_at: c.fs.serverTimestamp() }), 20000, 'no-server');
  return true;
}

// Sanntid: lytter på husstandens samlinger. handlers.<navn>(docs, meta), handlers.status({pending, fromCache}), handlers.error(e)
function subscribe(hid, oldest, handlers) {
  const { fs, db } = ctx;
  const metas = {};
  const unsubs = [];
  function status() {
    const vals = Object.values(metas);
    handlers.status && handlers.status({
      pending: vals.some(m => m.hasPendingWrites),
      fromCache: vals.some(m => m.fromCache)
    });
  }
  function listen(name, q) {
    let first = true;
    unsubs.push(fs.onSnapshot(q, { includeMetadataChanges: true }, snap => {
      metas[name] = snap.metadata;
      const changed = first || snap.docChanges().length > 0;
      first = false;
      if (changed) handlers[name](snap.docs.map(d => Object.assign({ id: d.id }, d.data())));
      status();
    }, err => handlers.error && handlers.error(err, name)));
  }
  listen('recipes', fs.collection(...hh(hid, 'recipes')));
  listen('staples', fs.collection(...hh(hid, 'staples')));
  listen('days', fs.query(fs.collection(...hh(hid, 'days')), fs.where('date', '>=', oldest)));
  listen('lists', fs.query(fs.collection(...hh(hid, 'lists')), fs.where('week', '>=', oldest)));
  listen('extras', fs.query(fs.collection(...hh(hid, 'extras')), fs.where('week', '>=', oldest)));
  return () => unsubs.forEach(u => u());
}

// Skriving. Returnerer promise som løses når serveren har bekreftet (kan ta tid frakoblet – ikke vent på den i UI).
const W = {
  setRecipe: (hid, r) => ctx.fs.setDoc(ctx.fs.doc(...hh(hid, 'recipes', r.id)), recipeDoc(r)),
  deleteRecipe: (hid, id) => ctx.fs.deleteDoc(ctx.fs.doc(...hh(hid, 'recipes', id))),
  setDays: (hid, entries) => {
    const b = ctx.fs.writeBatch(ctx.db);
    entries.forEach(e => b.set(ctx.fs.doc(...hh(hid, 'days', e.date)), { date: e.date, recipe_id: e.oneoff ? null : (e.recipe_id || null), oneoff: oneoffDoc(e.oneoff) }));
    return b.commit();
  },
  // v0.4.4: bytt to kvelder atomisk. a/b = { date, sig } der sig er det telefonen så ('r:<id>' / 'o:<id>' / '').
  // Transaksjonen leser begge dagene på serveren og bytter bare hvis de fortsatt er som telefonen så; ellers kastes
  // en feil med code 'swap-conflict' (ingenting skrives). Innholdet som flyttes er serverens, så en engangsmiddag som
  // nettopp ble redigert på en annen telefon følger med uendret. Krever nett (se app.js for frakoblet).
  swapDays: async (hid, a, b) => {
    const { fs, db } = ctx;
    const ra = fs.doc(...hh(hid, 'days', a.date)), rb = fs.doc(...hh(hid, 'days', b.date));
    return fs.runTransaction(db, async tx => {
      const [sa, sb] = [await tx.get(ra), await tx.get(rb)];
      const da = sa.exists() ? sa.data() : null, dbb = sb.exists() ? sb.data() : null;
      if (daySig(da) !== a.sig || daySig(dbb) !== b.sig) {
        const e = new Error('swap-conflict'); e.code = 'swap-conflict'; throw e;
      }
      tx.set(ra, dayBody(a.date, dbb));
      tx.set(rb, dayBody(b.date, da));
      return true;
    });
  },
  setChecks: (hid, week, map) => ctx.fs.setDoc(ctx.fs.doc(...hh(hid, 'lists', week)), { week, checked: map }, { merge: true }),
  incAdjust: (hid, week, key, change) => ctx.fs.setDoc(ctx.fs.doc(...hh(hid, 'lists', week)), { week, adjust: { [key]: ctx.fs.increment(change) } }, { merge: true }),
  // v0.4.3: basisvalg per uke som felt i adjust-kartet («basis:<vare>» = 1 lagt til / -1 ikke nå), feltvis flettet.
  setAdjust: (hid, week, map) => ctx.fs.setDoc(ctx.fs.doc(...hh(hid, 'lists', week)), { week, adjust: map }, { merge: true }),
  clearAdjust: (hid, week, key) => ctx.fs.setDoc(ctx.fs.doc(...hh(hid, 'lists', week)), { week, adjust: { [key]: ctx.fs.deleteField() } }, { merge: true }),
  addExtra: (hid, x) => ctx.fs.setDoc(ctx.fs.doc(...hh(hid, 'extras', x.id)), extraDoc(x)),
  deleteExtras: (hid, ids) => {
    const b = ctx.fs.writeBatch(ctx.db);
    ids.forEach(id => b.delete(ctx.fs.doc(...hh(hid, 'extras', id))));
    return b.commit();
  },
  setStaple: (hid, s) => ctx.fs.setDoc(ctx.fs.doc(...hh(hid, 'staples', s.id)), stapleDoc(s)),
  updateStaple: (hid, id, fields) => ctx.fs.updateDoc(ctx.fs.doc(...hh(hid, 'staples', id)), fields),
  deleteStaple: (hid, id) => ctx.fs.deleteDoc(ctx.fs.doc(...hh(hid, 'staples', id))),
  // v0.4.4: venter til telefonens egne ventende skrivinger er bekreftet (før en bytte-transaksjon).
  settled: () => ctx.fs.waitForPendingWrites(ctx.db)
};

window.UkeshandelSync = { mode, init, randomCode, createHousehold, joinHousehold, isMember, subscribe, write: W, uid: () => ctx && ctx.uid };
window.dispatchEvent(new Event('ukeshandel-sync-ready'));
