/* roster.js  |  VERSION 26  |  updated 2026-07-23  |  Ride-Along Trackers inbox: RPDRoster.ridealongs gains submit (cadet-tier: entry RSA-envelope encrypted with the observers public key to roster/raInbox, duplicate hash claimed at roster/raIndex), merge (records-tier: /admin and /sgt decrypt the inbox, append new entries to the log tagged via:'trackers', drop duplicates, clear the inbox), hashExists, indexAdd, indexRemove. RA_SALT 'rpdcadets-ridealongs-v1' lives only in this file (Trackers loads roster.js, so no guest.html-style cross-file coupling). Prior v25 notes: RPDRoster.observers module for the public /guest interest form (RSA-OAEP envelope, nodes observersPub/observersKeyWrap/observersEntries/observersIndex, salt shared verbatim with guest.html). */
/* ═══════════════════════════════════════════════════════════════════════
   RPD CADETS — SHARED ROSTER ENGINE
   One encrypted roster in Firebase, read by members, trackers, and
   quartermaster. Edited from one place (the Members page).

   HOW THE ENCRYPTION WORKS (envelope encryption):
     • A single random "roster key" encrypts the actual roster data.
     • That roster key is itself stored twice, wrapped once under the
       cadet passcode and once under the quartermaster password.
     • Members/trackers unlock with the cadet passcode; quartermaster
       unlocks with its own password. Both reach the same roster.
     • Editing only needs the cadet passcode: it re-encrypts the data
       with the roster key it already unwrapped. The quartermaster's
       wrapped key is untouched and keeps working. So adding a cadet is
       a one-passcode edit, but two passwords can still read.

   Firebase layout (all values are ciphertext):
     roster/data        → roster JSON, encrypted with the roster key
     roster/wrap/cadet  → roster key, wrapped under the cadet passcode
     roster/wrap/qm     → roster key, wrapped under the quartermaster pw
   ═══════════════════════════════════════════════════════════════════════ */

(function (global) {
  'use strict';

  // ── Firebase config (same project as the quartermaster page) ──
  const firebaseConfig = {
    apiKey:            "AIzaSyDV0vuyGg7gpPXJd2jRqZtUTeKiP3yPxhU",
    authDomain:        "rpdcadets-quartermaster.firebaseapp.com",
    databaseURL:       "https://rpdcadets-quartermaster-default-rtdb.firebaseio.com",
    projectId:         "rpdcadets-quartermaster",
    storageBucket:     "rpdcadets-quartermaster.firebasestorage.app",
    messagingSenderId: "832497600166",
    appId:             "1:832497600166:web:67895b333e07b8806c1667"
  };

  const ITERATIONS = 150000;
  const ROOT = 'roster';

  // ── Seed roster (used ONCE, only if Firebase has no roster yet) ──
  // rank: 'Captain' | 'Lt.' | 'Sgt.' | 'Cadet' | 'Probationary'
  // squad: 'leadership' | 1 | 2 | 3 | 4   (4 = Admin)
  // open: true marks an unfilled position (no person yet)
  const SEED = [
    { name: 'Captain', rank: 'Captain', squad: 'leadership', open: true },
    { name: 'Daniel Hemmi', rank: 'Lt.', squad: 'leadership', title: 'Lieutenant / XO' },

    { name: 'Jonathan Nidam', rank: 'Sgt.', squad: 1 },
    { name: 'Mariah Diaz', rank: 'Cadet', squad: 1 },
    { name: 'Khaled Khmaish', rank: 'Cadet', squad: 1 },
    { name: 'Scout StJohn', rank: 'Cadet', squad: 1 },
    { name: 'Luke Veldhuizen', rank: 'Cadet', squad: 1 },

    { name: 'Rhiannon Harris', rank: 'Sgt.', squad: 2 },
    { name: 'Taha Safi', rank: 'Cadet', squad: 2 },
    { name: 'Sebastion Ross', rank: 'Cadet', squad: 2 },
    { name: 'Eric Velazquez', rank: 'Cadet', squad: 2 },
    { name: 'Naveah Lee Spell', rank: 'Cadet', squad: 2 },

    { name: 'Dimas Fredrik', rank: 'Sgt.', squad: 3 },
    { name: 'Hunter Huffman', rank: 'Cadet', squad: 3 },
    { name: 'Atzyri Orozco', rank: 'Cadet', squad: 3 },
    { name: 'Knox Giles', rank: 'Cadet', squad: 3 },
    { name: 'Addison Wilham', rank: 'Probationary', squad: 3 },

    { name: 'Armando Rizvanovic', rank: 'Sgt.', squad: 4, title: 'Admin Sergeant' },

    // Alumni (status:'alumni' — shown only on the Members page, excluded from ops)
    { name: 'Kara Dupre', rank: 'Cadet', squad: 1, status: 'alumni' },
    { name: 'Evan Bowns', rank: 'Cadet', squad: 4, status: 'alumni' },
    { name: 'William Knowlton', rank: 'Cadet', squad: 'leadership', status: 'alumni', note: '– 2026' },
    { name: 'Matthew Zeigler', rank: 'Captain', squad: 'leadership', status: 'alumni', title: 'Cpt.', note: 'Sep 2022 – May 2025' },
    { name: 'Sarah Antosh', rank: 'Cadet', squad: 'leadership', status: 'alumni', note: 'Jul 2024 – Jan 2026' },
    { name: 'Shoham Ghose', rank: 'Cadet', squad: 'leadership', status: 'alumni', note: 'May 2023 – Dec 2024' }
  ];

  // ── Squad display metadata ──
  const SQUAD_META = {
    leadership: { label: 'Unit Leadership', color: 'gold',  badge: 'ADM' },
    1: { label: 'Squad 1', color: 'red',    badge: '1' },
    2: { label: 'Squad 2', color: 'yellow', badge: '2' },
    3: { label: 'Squad 3', color: 'blue',   badge: '3' },
    4: { label: 'Squad 4 (Admin)', color: 'green', badge: '4' }
  };

  // ── crypto helpers ──
  const enc = new TextEncoder();
  const dec = new TextDecoder();

  function b64ToArr(b64) { const bin = atob(b64); const a = new Uint8Array(bin.length); for (let i = 0; i < bin.length; i++) a[i] = bin.charCodeAt(i); return a; }
  function arrToB64(arr) { let s = ''; const a = new Uint8Array(arr); for (let i = 0; i < a.length; i++) s += String.fromCharCode(a[i]); return btoa(s); }

  // password-based (PBKDF2) — used to WRAP the roster key
  async function deriveKey(password, salt, usages) {
    const km = await crypto.subtle.importKey('raw', enc.encode(password), 'PBKDF2', false, ['deriveKey']);
    return crypto.subtle.deriveKey({ name: 'PBKDF2', salt, iterations: ITERATIONS, hash: 'SHA-256' },
      km, { name: 'AES-GCM', length: 256 }, false, usages);
  }
  async function pwEncrypt(plaintext, password) {
    const salt = crypto.getRandomValues(new Uint8Array(16));
    const iv = crypto.getRandomValues(new Uint8Array(12));
    const key = await deriveKey(password, salt, ['encrypt']);
    const full = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, enc.encode(plaintext)));
    const tag = full.slice(full.length - 16), ct = full.slice(0, full.length - 16);
    const header = new Uint8Array(44); header.set(salt, 0); header.set(iv, 16); header.set(tag, 28);
    return arrToB64(header) + '.' + arrToB64(ct);
  }
  async function pwDecrypt(blob, password) {
    try {
      const [h, c] = blob.split('.');
      const header = b64ToArr(h);
      const salt = header.slice(0, 16), iv = header.slice(16, 28), tag = header.slice(28, 44);
      const ct = b64ToArr(c);
      const combined = new Uint8Array(ct.length + 16); combined.set(ct); combined.set(tag, ct.length);
      const key = await deriveKey(password, salt, ['decrypt']);
      return dec.decode(await crypto.subtle.decrypt({ name: 'AES-GCM', iv }, key, combined));
    } catch (e) { return null; }
  }

  // raw-key (AES-GCM) — used to encrypt the actual roster DATA with the roster key
  async function keyEncrypt(plaintext, rawKeyBytes) {
    const iv = crypto.getRandomValues(new Uint8Array(12));
    const key = await crypto.subtle.importKey('raw', rawKeyBytes, { name: 'AES-GCM' }, false, ['encrypt']);
    const full = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, enc.encode(plaintext)));
    return arrToB64(iv) + '.' + arrToB64(full);
  }
  async function keyDecrypt(blob, rawKeyBytes) {
    const [ivB64, dataB64] = blob.split('.');
    const iv = b64ToArr(ivB64), data = b64ToArr(dataB64);
    const key = await crypto.subtle.importKey('raw', rawKeyBytes, { name: 'AES-GCM' }, false, ['decrypt']);
    return dec.decode(await crypto.subtle.decrypt({ name: 'AES-GCM', iv }, key, data));
  }

  // ── state ──
  let db = null, ref = null;
  let rosterKey = null;           // Uint8Array, the unwrapped roster key
  let cache = null;               // last decrypted array
  let role = null;                // 'cadet' | 'qm'
  const subscribers = [];

  function ensureFirebase() {
    if (db) return;
    if (typeof firebase === 'undefined') throw new Error('Firebase SDK not loaded');
    if (!firebase.apps || !firebase.apps.length) firebase.initializeApp(firebaseConfig);
    db = firebase.database();
    ref = db.ref(ROOT);
  }

  async function once(path) { const s = await db.ref(ROOT + '/' + path).once('value'); return s.exists() ? s.val() : null; }

  /* ──────────────────────────────────────────────────────────────
     connect({ passcode, role })  →  { ok, needsSetup }
     role: 'cadet' (members/trackers) or 'qm' (quartermaster)
     Returns needsSetup:true if no roster exists yet in Firebase.
     ────────────────────────────────────────────────────────────── */
  function wrapRoleName(role){ return (role === 'qm' || role === 'advisor' || role === 'ltd' || role === 'sgt') ? role : 'cadet'; }
  async function connect(opts) {
    ensureFirebase();
    role = opts.role;
    const wrapPath = 'wrap/' + wrapRoleName(role);
    const wrapped = await once(wrapPath);
    if (!wrapped) {
      // Either brand-new (no roster at all) or this role hasn't been linked.
      const dataExists = await once('data');
      return { ok: false, needsSetup: !dataExists, needsLink: !!dataExists };
    }
    const keyB64 = await pwDecrypt(wrapped, opts.passcode);
    if (!keyB64) return { ok: false, badPasscode: true };
    rosterKey = b64ToArr(keyB64);
    await refresh();
    try { await loadCatalog(); } catch (e) { catalogCache = []; }
    startListener();
    startCatalogListener();
    return { ok: true };
  }

  async function refresh() {
    const blob = await once('data');
    if (!blob) { cache = []; return cache; }
    const txt = await keyDecrypt(blob, rosterKey);
    cache = JSON.parse(txt);
    return cache;
  }

  function startListener() {
    db.ref(ROOT + '/data').on('value', async (snap) => {
      const blob = snap.val();
      if (!blob || !rosterKey) return;
      try {
        const txt = await keyDecrypt(blob, rosterKey);
        cache = JSON.parse(txt);
        subscribers.forEach(cb => { try { cb(cache); } catch (e) {} });
      } catch (e) {}
    });
  }

  /* first-time setup: generates the roster key, wraps it under BOTH
     passwords, and writes the seed. Needs both passwords once. */
  async function setup(cadetPass, qmPass, initial) {
    ensureFirebase();
    rosterKey = crypto.getRandomValues(new Uint8Array(32));
    const keyB64 = arrToB64(rosterKey);
    const data = await keyEncrypt(JSON.stringify(initial || SEED), rosterKey);
    const wrapCadet = await pwEncrypt(keyB64, cadetPass);
    const wrapQm = await pwEncrypt(keyB64, qmPass);
    await ref.set({ data, wrap: { cadet: wrapCadet, qm: wrapQm } });
    cache = (initial || SEED).slice();
    catalogCache = [];
    role = 'cadet';
    startListener();
    startCatalogListener();
    return cache;
  }

  /* link an additional role to an existing roster (e.g. first qm read,
     or granting an advisor passcode). Needs the role being linked to
     supply its password, plus a working session that holds rosterKey. */
  async function linkRole(targetRole, targetPass) {
    if (!rosterKey) throw new Error('not unlocked');
    const keyB64 = arrToB64(rosterKey);
    const wrapped = await pwEncrypt(keyB64, targetPass);
    await db.ref(ROOT + '/wrap/' + wrapRoleName(targetRole)).set(wrapped);
  }

  async function save(arr) {
    if (!rosterKey) throw new Error('not unlocked');
    cache = arr;
    const blob = await keyEncrypt(JSON.stringify(arr), rosterKey);
    await db.ref(ROOT + '/data').set(blob);
  }

  function subscribe(cb) { subscribers.push(cb); if (cache) cb(cache); }
  function get() { return cache ? cache.slice() : []; }

  /* ── Quartermaster item catalog ──
     Item definitions + on-hand counts + per-size stock breakdown.
     Stored at roster/catalog, encrypted with the same shared roster key,
     so it's editable from /admin (cadet passcode) and readable by the
     quartermaster page (qm password). No extra Firebase rules needed —
     it lives under the roster node which is already permitted. */
  let catalogCache = null;
  const catalogSubs = [];

  async function loadCatalog() {
    const blob = await once('catalog');
    if (!blob) { catalogCache = []; return catalogCache; }
    const txt = await keyDecrypt(blob, rosterKey);
    catalogCache = JSON.parse(txt);
    return catalogCache;
  }
  function startCatalogListener() {
    db.ref(ROOT + '/catalog').on('value', async (snap) => {
      const blob = snap.val();
      if (!blob || !rosterKey) return;
      try {
        const txt = await keyDecrypt(blob, rosterKey);
        catalogCache = JSON.parse(txt);
        catalogSubs.forEach(cb => { try { cb(catalogCache); } catch (e) {} });
      } catch (e) {}
    });
  }
  async function saveCatalog(arr) {
    if (!rosterKey) throw new Error('not unlocked');
    catalogCache = arr;
    const blob = await keyEncrypt(JSON.stringify(arr), rosterKey);
    await db.ref(ROOT + '/catalog').set(blob);
  }
  function subscribeCatalog(cb) { catalogSubs.push(cb); if (catalogCache) cb(catalogCache); }
  function getCatalog() { return catalogCache ? catalogCache.slice() : []; }

  // ── display helpers ──
  const RANK_ORDER = { 'Captain': 0, 'Lt.': 1, 'Sgt.': 2, 'Act. Sgt.': 3, 'Cadet': 4, 'Probationary': 5 };
  function rankRank(r) { return r in RANK_ORDER ? RANK_ORDER[r] : 6; }
  // roster sorted by rank (Captain → Lt. → Sgt. → Cadet → Probationary),
  // stable within a rank so newer entries stay at the bottom of their rank.
  function getSorted() {
    return get().map((e, i) => ({ e, i }))
      .sort((a, b) => rankRank(a.e.rank) - rankRank(b.e.rank) || a.i - b.i)
      .map(x => x.e);
  }
  function initials(name) {
    const parts = String(name).trim().split(/\s+/).filter(Boolean);
    if (!parts.length) return '?';
    if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
    return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
  }
  function displayName(entry) {
    if (entry.open) return entry.name;
    const pfx = { 'Captain': 'Capt.', 'Lt.': 'Lt.', 'Sgt.': 'Sgt.', 'Act. Sgt.': 'Act. Sgt.' }[entry.rank];
    return pfx ? pfx + ' ' + entry.name : entry.name;
  }
  function flatNames() {
    // every active person, rank-ordered, leadership prefixed (for attendance/dropdown)
    return getSorted().filter(e => !e.open && e.status !== 'alumni').map(displayName);
  }
  const ROLE_LABEL = { 'Captain': 'Captain', 'Lt.': 'Lieutenant', 'Sgt.': 'Sergeant', 'Act. Sgt.': 'Acting Sergeant', 'Cadet': 'Cadet', 'Probationary': 'Probationary' };
  function defaultRoleLabel(rank) { return ROLE_LABEL[rank] || 'Cadet'; }
  function getAlumni() { return get().filter(e => e && e.status === 'alumni'); }
  function activeSorted() { return getSorted().filter(e => !e.open && e.status !== 'alumni'); }
  function bySquad() {
    const order = ['leadership', 1, 2, 3, 4];
    const groups = {};
    order.forEach(s => groups[s] = []);
    get().forEach(e => {
      if (e.status === 'alumni') return;            // alumni live in their own section
      const s = e.squad in groups ? e.squad : 'leadership';
      groups[s].push(e);
    });
    // keep each squad rank-ordered, stable
    order.forEach(s => groups[s] = groups[s]
      .map((e, i) => ({ e, i }))
      .sort((a, b) => rankRank(a.e.rank) - rankRank(b.e.rank) || a.i - b.i)
      .map(x => x.e));
    return order.map(s => ({ squad: s, meta: SQUAD_META[s], members: groups[s] })).filter(g => g.members.length);
  }
  function squadLead(members) {
    // a real Sgt. always holds "Led by"; an Act. Sgt. leads only when no Sgt. exists
    const sgt = members.find(m => m.rank === 'Sgt.');
    if (sgt) return sgt.name;
    const act = members.find(m => m.rank === 'Act. Sgt.');
    return act ? act.name : null;
  }
  function byRankSections() {
    const list = getSorted().filter(e => !e.open && e.status !== 'alumni');
    const sec = (title, pred) => ({ section: title, members: list.filter(pred).map(displayName) });
    const groups = [
      sec('Captain', e => e.rank === 'Captain'),
      sec('Lieutenant', e => e.rank === 'Lt.'),
      sec('Sergeants', e => e.rank === 'Sgt.'),
      sec('Acting Sergeants', e => e.rank === 'Act. Sgt.'),
      sec('Cadets', e => e.rank === 'Cadet'),
      sec('Probationary', e => e.rank === 'Probationary')
    ];
    return groups.filter(g => g.members.length);
  }

  global.RPDRoster = {
    connect, setup, linkRole, save, refresh, subscribe, get, getSorted, activeSorted,
    loadCatalog, saveCatalog, subscribeCatalog, getCatalog,
    getAlumni, defaultRoleLabel, rankRank, SQUAD_META, SEED,
    initials, displayName, flatNames, bySquad, squadLead, byRankSections,
    // ── Cadet Records & Ride-Along Log: separate key, advisor passcode ──
    records: {
      connect: recordsConnect, setup: recordsSetup, get: recordsGet, save: recordsSave, isUnlocked: () => !!recordsKey
    },
    ridealongs: {
      get: ridealongsGet, save: ridealongsSave,
      // Trackers inbox (v26): submit is cadet-tier; merge is records-tier.
      // indexAdd/indexRemove maintain the duplicate ledger on add/edit/delete.
      submit: raInboxSubmit, merge: raInboxMerge,
      hashExists: raHashExists, indexAdd: raIndexAdd, indexRemove: raIndexRemove
    },
    sgtnotes: {
      get: sgtnotesGet, save: sgtnotesSave
    },
    cadetnotes: {
      get: cadetnotesGet, save: cadetnotesSave
    },
    pending: {
      get: pendingGet, save: pendingSave
    },
    access: {
      setLimited: accessSetLimited, clearLimited: accessClearLimited, hasLimited: accessHasLimited,
      setSgt: accessSetSgt, clearSgt: accessClearSgt, hasSgt: accessHasSgt
    },
    officers: {
      get: officersGet, save: officersSave
    },
    attendance: {
      get: attendanceGet, saveSession: attendanceSaveSession, saveAll: attendanceSaveAll, rollup: attRollup
    },
    // ── Uniform Standards: shared roster key, node roster/uniforms ──
    // Read by the Uniforms page (cadet passcode), written from /admin
    // (advisor passcode). Same model as the officers list.
    uniforms: {
      get: uniformsGet, save: uniformsSave
    },
    // ── Training Hub: shared roster key, node roster/training ──
    // Read by the Training page (cadet passcode), written from /admin
    // (advisor passcode). Same model as the uniforms node.
    training: {
      get: trainingGet, save: trainingSave
    },
    // Donation Tracking: separate advisor records key, node roster/donations
    donations: {
      get: donationsGet, save: donationsSave
    },
    // Event / Activity hours: shared roster key, node roster/events. The Trackers
    // page appends a record per submission (cadet passcode); /admin reads them all
    // (advisor passcode) for the Attendance & Hours roll-up. Same model as attendance.
    events: {
      get: eventsGet, add: eventsAdd, save: eventsSave
    },
    // Curated Event/Activity names (roster/eventNames), shared roster key. Managed
    // from /admin (advisor), read by the Trackers Event form (cadet) for the picker.
    eventNames: {
      get: eventNamesGet, save: eventNamesSave
    },
    // Guest Observers (public /guest form): records key required for everything
    // except hash(). ensureKeys() is a no-op after first run. See the module
    // comment above obsHash for the full encryption model and the guest.html
    // salt coupling.
    observers: {
      ensureKeys: obsEnsureKeys, get: observersGet, save: observersSave,
      remove: observersRemove, hash: obsHash
    }
  };

  /* ══════════════════════════════════════════════════════════════
     CADET RECORDS  —  operational cadet details (safe tier).
     Its own random key, wrapped under the ADVISOR passcode, so the
     same passcode that opens /admin also opens records — but the
     cadet/qm passcodes cannot (they never get this key). Stored in
     the roster node (roster/records, roster/recordsWrap) so no extra
     Firebase rule is required.
     ══════════════════════════════════════════════════════════════ */
  let recordsKey = null;
  async function recordsConnect(passphrase) {
    ensureFirebase();
    const wrap = await once('recordsWrap');
    let keyB64 = wrap ? await pwDecrypt(wrap, passphrase) : null;
    if (!keyB64) {
      const ltdWrap = await once('recordsWrapLtd');   // limited advisor passcode
      if (ltdWrap) keyB64 = await pwDecrypt(ltdWrap, passphrase);
    }
    if (!keyB64) {
      const sgtWrap = await once('recordsWrapSgt');   // sergeant read passcode
      if (sgtWrap) keyB64 = await pwDecrypt(sgtWrap, passphrase);
    }
    if (keyB64) { recordsKey = b64ToArr(keyB64); return { ok: true }; }
    if (!wrap) {
      const dataExists = await once('records');
      return { ok: false, needsSetup: !dataExists, needsLink: !!dataExists };
    }
    return { ok: false, badPass: true };
  }
  // Grant/revoke a limited advisor passcode: wraps the SAME records key under it
  // (node recordsWrapLtd). Pair with linkRole('ltd', pass) so the limited passcode
  // can also read the roster (cadet names) for the Records/Ride-Along pickers.
  async function recordsGrantLtd(pass) {
    if (!recordsKey) throw new Error('records locked');
    const wrap = await pwEncrypt(arrToB64(recordsKey), pass);
    await db.ref(ROOT + '/recordsWrapLtd').set(wrap);
  }
  async function recordsRevokeLtd() { await db.ref(ROOT + '/recordsWrapLtd').remove(); }
  // Sergeant read tier: wraps the SAME records key under the sergeant passcode
  // (node recordsWrapSgt). Pair with linkRole('sgt', pass) so the /sgt page can
  // also read the roster, attendance, and events with the one passcode.
  async function recordsGrantSgt(pass) {
    if (!recordsKey) throw new Error('records locked');
    const wrap = await pwEncrypt(arrToB64(recordsKey), pass);
    await db.ref(ROOT + '/recordsWrapSgt').set(wrap);
  }
  async function recordsRevokeSgt() { await db.ref(ROOT + '/recordsWrapSgt').remove(); }
  async function recordsSetup(passphrase) {
    ensureFirebase();
    recordsKey = crypto.getRandomValues(new Uint8Array(32));
    const keyB64 = arrToB64(recordsKey);
    const wrap = await pwEncrypt(keyB64, passphrase);
    const data = await keyEncrypt(JSON.stringify({}), recordsKey);
    await db.ref(ROOT + '/recordsWrap').set(wrap);
    await db.ref(ROOT + '/records').set(data);
    return { ok: true };
  }
  async function recordsGet() {
    if (!recordsKey) return null;
    const blob = await once('records');
    if (!blob) return {};
    try { return JSON.parse(await keyDecrypt(blob, recordsKey)); } catch (e) { return {}; }
  }
  async function recordsSave(obj) {
    if (!recordsKey) throw new Error('records locked');
    const data = await keyEncrypt(JSON.stringify(obj), recordsKey);
    await db.ref(ROOT + '/records').set(data);
  }
  // Ride-Along Log — same advisor key as records, separate node (roster/ridealongs)
  async function ridealongsGet() {
    if (!recordsKey) return null;
    const blob = await once('ridealongs');
    if (!blob) return [];
    try { return JSON.parse(await keyDecrypt(blob, recordsKey)); } catch (e) { return []; }
  }
  async function ridealongsSave(arr) {
    if (!recordsKey) throw new Error('records locked');
    const data = await keyEncrypt(JSON.stringify(arr), recordsKey);
    await db.ref(ROOT + '/ridealongs').set(data);
  }
  /* ── Ride-Along Trackers inbox (v26) ──
     Cadets on the Trackers Event form can log a ride-along without holding the
     records key: the entry is RSA-envelope encrypted in the cadet's browser
     using the OBSERVERS public key (roster/observersPub; private key wrapped
     under the records key), written to roster/raInbox/{id}, and a duplicate
     hash is claimed at roster/raIndex/{hex} (SHA-256 of
     RA_SALT|cadet(rank-stripped,lowercased)|officer(lowercased)|date). The next
     time /admin or /sgt opens a ride-along view, merge() decrypts the inbox,
     appends new entries to roster/ridealongs (tagged via:'trackers'), silently
     drops any that already exist (same cadet+officer+date), and clears the
     inbox. Unlike OBS_SALT there is NO cross-file duplication: Trackers loads
     roster.js, so the salt and recipe live only here. The consoles MUST
     maintain roster/raIndex on add/edit/delete (indexAdd/indexRemove) so that
     deleting an entry frees the cadet to resubmit it. Reuses the observers
     RSA keypair; if those keys ever rotate, in-flight inbox entries encrypted
     under the old key become unreadable and are dropped at the next merge. */
  const RA_SALT = 'rpdcadets-ridealongs-v1';
  function raNormKey(cadet, officer, date) {
    return attStripRank(cadet).trim().toLowerCase() + '|' + String(officer == null ? '' : officer).trim().toLowerCase() + '|' + String(date == null ? '' : date).trim();
  }
  async function raHash(cadet, officer, date) {
    const d = await crypto.subtle.digest('SHA-256', enc.encode(RA_SALT + '|' + raNormKey(cadet, officer, date)));
    return Array.from(new Uint8Array(d)).map(b => b.toString(16).padStart(2, '0')).join('');
  }
  async function raHashExists(cadet, officer, date) {
    ensureFirebase();
    return !!(await once('raIndex/' + await raHash(cadet, officer, date)));
  }
  async function raIndexAdd(cadet, officer, date) {
    ensureFirebase();
    await db.ref(ROOT + '/raIndex/' + await raHash(cadet, officer, date)).set(true);
  }
  async function raIndexRemove(cadet, officer, date) {
    ensureFirebase();
    await db.ref(ROOT + '/raIndex/' + await raHash(cadet, officer, date)).remove();
  }
  // Cadet-tier submit from the Trackers Event form. Strips any leadership rank
  // prefix from the cadet name so merged entries match the raw roster names the
  // consoles use. Throws an Error with .duplicate=true if the ride is claimed.
  async function raInboxSubmit(rec) {
    ensureFirebase();
    const cadet = attStripRank(rec.cadet).trim();
    if (await raHashExists(cadet, rec.officer, rec.date)) {
      const e = new Error('duplicate'); e.duplicate = true; throw e;
    }
    const env = await obsEnvelope(JSON.stringify({
      cadet, officer: rec.officer, date: rec.date,
      start: rec.start, end: rec.end, notes: rec.notes || ''
    }));
    const id = 'rin_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
    await db.ref(ROOT + '/raInbox/' + id).set({ env, at: Date.now() });
    await raIndexAdd(cadet, rec.officer, rec.date);
    return { ok: true };
  }
  // Records-tier merge, called by /admin and /sgt when a ride-along view opens.
  // Returns { all, added, dropped } where `all` is the post-merge log.
  async function raInboxMerge() {
    if (!recordsKey) throw new Error('records locked');
    ensureFirebase();
    try { await obsEnsureKeys(); } catch (e) {}   // no-op after first run; guarantees future submits can encrypt
    const all = (await ridealongsGet()) || [];
    const box = await once('raInbox');
    if (!box) return { all, added: 0, dropped: 0 };
    const seen = new Set(all.map(r => raNormKey(r.cadet, r.officer, r.date)));
    let added = 0, dropped = 0;
    const ids = Object.keys(box).sort((a, b) => ((box[a] || {}).at || 0) - ((box[b] || {}).at || 0));
    for (const id of ids) {
      let rec = null;
      try { rec = JSON.parse(await obsOpen((box[id] || {}).env)); } catch (e) { rec = null; }
      const k = rec ? raNormKey(rec.cadet, rec.officer, rec.date) : null;
      if (rec && rec.cadet && rec.officer && rec.date && !seen.has(k)) {
        seen.add(k);
        all.push({
          id: 'ra_' + Math.random().toString(36).slice(2, 9),
          cadet: rec.cadet, officer: rec.officer, date: rec.date,
          start: rec.start || '', end: rec.end || '', notes: rec.notes || '',
          via: 'trackers', at: (box[id] || {}).at || Date.now()
        });
        try { await raIndexAdd(rec.cadet, rec.officer, rec.date); } catch (e) {}
        added++;
      } else {
        dropped++;   // duplicate of an existing log row, or an unreadable envelope
      }
      try { await db.ref(ROOT + '/raInbox/' + id).remove(); } catch (e) {}
    }
    if (added) await ridealongsSave(all);
    return { all, added, dropped };
  }
  // Sergeant Notes board — same records key (advisor/ltd/sgt tiers only),
  // separate node (roster/sgtnotes). A flat array of {id, name, text, at}.
  async function sgtnotesGet() {
    if (!recordsKey) return null;
    const blob = await once('sgtnotes');
    if (!blob) return [];
    try { return JSON.parse(await keyDecrypt(blob, recordsKey)); } catch (e) { return []; }
  }
  async function sgtnotesSave(arr) {
    if (!recordsKey) throw new Error('records locked');
    const data = await keyEncrypt(JSON.stringify(arr), recordsKey);
    await db.ref(ROOT + '/sgtnotes').set(data);
  }
  // Per-cadet note lines — same records key, node roster/cadetnotes. A flat
  // array of {id, cadet, name, text, at}; each entry shows on the cadet's card
  // AND in the merged notes feed, so a delete in either place removes both.
  async function cadetnotesGet() {
    if (!recordsKey) return null;
    const blob = await once('cadetnotes');
    if (!blob) return [];
    try { return JSON.parse(await keyDecrypt(blob, recordsKey)); } catch (e) { return []; }
  }
  async function cadetnotesSave(arr) {
    if (!recordsKey) throw new Error('records locked');
    const data = await keyEncrypt(JSON.stringify(arr), recordsKey);
    await db.ref(ROOT + '/cadetnotes').set(data);
  }

  /* ── Guest Observers — submissions from the public /guest interest form ──
     Confidentiality model: the site has no Firebase Auth, so database rules
     cannot tell a sergeant's browser from a stranger's. Instead every /guest
     submission is encrypted IN THE VISITOR'S BROWSER before upload, using an
     RSA-OAEP envelope: a fresh AES-GCM key per submission, itself encrypted
     with the observers PUBLIC key. Only the records key (advisor / limited /
     sergeant tiers) can unwrap the PRIVATE key, so nothing readable ever sits
     in the database and the public page can encrypt but never decrypt.
     Nodes (all under roster/ so the existing Firebase rules already apply):
       roster/observersPub          RSA public JWK, plaintext (safe to expose)
       roster/observersKeyWrap     RSA private JWK, keyEncrypt'd with records key
       roster/observersEntries/{id} { env: 'b64Key.b64Iv.b64Ct', at: ms }
       roster/observersIndex/{hex}  true — duplicate check, hex = SHA-256 of
                                    OBS_SALT|email(lowercased,trimmed)|dob
     IMPORTANT COUPLING: guest.html is standalone (it must not load roster.js,
     which carries cadet names in its seed) and duplicates OBS_SALT and the
     hash recipe verbatim. If either ever changes, change BOTH files together
     or the duplicate check silently stops matching old submissions. */
  const OBS_SALT = 'rpdcadets-observers-v1';
  async function obsHash(email, dob) {
    const norm = OBS_SALT + '|' + String(email || '').trim().toLowerCase() + '|' + String(dob || '').trim();
    const d = await crypto.subtle.digest('SHA-256', enc.encode(norm));
    return Array.from(new Uint8Array(d)).map(b => b.toString(16).padStart(2, '0')).join('');
  }
  let obsPrivKey = null;   // per-session cache of the imported private key
  async function obsEnsureKeys() {
    if (!recordsKey) throw new Error('records locked');
    ensureFirebase();
    const pub = await once('observersPub');
    if (pub) return { ok: true, created: false };
    const pair = await crypto.subtle.generateKey(
      { name: 'RSA-OAEP', modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: 'SHA-256' },
      true, ['encrypt', 'decrypt']);
    const pubJwk = JSON.stringify(await crypto.subtle.exportKey('jwk', pair.publicKey));
    const privJwk = JSON.stringify(await crypto.subtle.exportKey('jwk', pair.privateKey));
    // keyWrap first: if the pubkey ever exists without its wrap, /guest would
    // accept submissions nobody could ever read.
    await db.ref(ROOT + '/observersKeyWrap').set(await keyEncrypt(privJwk, recordsKey));
    await db.ref(ROOT + '/observersPub').set(pubJwk);
    return { ok: true, created: true };
  }
  async function obsPriv() {
    if (obsPrivKey) return obsPrivKey;
    if (!recordsKey) throw new Error('records locked');
    const wrap = await once('observersKeyWrap');
    if (!wrap) return null;
    const jwk = JSON.parse(await keyDecrypt(wrap, recordsKey));
    obsPrivKey = await crypto.subtle.importKey('jwk', jwk, { name: 'RSA-OAEP', hash: 'SHA-256' }, false, ['decrypt']);
    return obsPrivKey;
  }
  async function obsEnvelope(plainJson) {   // encrypt with the PUBLIC key (mirrors guest.html)
    const pubTxt = await once('observersPub');
    if (!pubTxt) throw new Error('observers not initialized');
    const pubKey = await crypto.subtle.importKey('jwk', JSON.parse(pubTxt), { name: 'RSA-OAEP', hash: 'SHA-256' }, false, ['encrypt']);
    const aes = crypto.getRandomValues(new Uint8Array(32));
    const iv = crypto.getRandomValues(new Uint8Array(12));
    const key = await crypto.subtle.importKey('raw', aes, { name: 'AES-GCM' }, false, ['encrypt']);
    const ct = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, enc.encode(plainJson)));
    const ek = new Uint8Array(await crypto.subtle.encrypt({ name: 'RSA-OAEP' }, pubKey, aes));
    return arrToB64(ek) + '.' + arrToB64(iv) + '.' + arrToB64(ct);
  }
  async function obsOpen(env) {             // decrypt with the PRIVATE key
    const priv = await obsPriv();
    if (!priv) throw new Error('observers not initialized');
    const [ekB64, ivB64, ctB64] = String(env).split('.');
    const aes = new Uint8Array(await crypto.subtle.decrypt({ name: 'RSA-OAEP' }, priv, b64ToArr(ekB64)));
    const key = await crypto.subtle.importKey('raw', aes, { name: 'AES-GCM' }, false, ['decrypt']);
    return dec.decode(await crypto.subtle.decrypt({ name: 'AES-GCM', iv: b64ToArr(ivB64) }, key, b64ToArr(ctB64)));
  }
  async function observersGet() {
    if (!recordsKey) return null;
    ensureFirebase();
    const all = await once('observersEntries');
    if (!all) return [];
    const out = [];
    for (const id of Object.keys(all)) {
      const row = all[id] || {};
      try {
        const data = JSON.parse(await obsOpen(row.env));
        out.push({ id, at: row.at || 0, data, hash: await obsHash(data.email, data.dob) });
      } catch (e) {
        out.push({ id, at: row.at || 0, data: null, hash: null, broken: true });
      }
    }
    out.sort((a, b) => (b.at || 0) - (a.at || 0));
    return out;
  }
  // Re-encrypts the full record; if email or DOB changed, moves the duplicate-
  // check index entry so the old identity frees up and the new one is claimed.
  // Returns the current hash so the caller can keep its copy in sync.
  async function observersSave(id, data, oldHash) {
    if (!recordsKey) throw new Error('records locked');
    const env = await obsEnvelope(JSON.stringify(data));
    await db.ref(ROOT + '/observersEntries/' + id + '/env').set(env);
    const nh = await obsHash(data.email, data.dob);
    if (nh !== oldHash) {
      await db.ref(ROOT + '/observersIndex/' + nh).set(true);
      if (oldHash) await db.ref(ROOT + '/observersIndex/' + oldHash).remove();
    }
    return nh;
  }
  async function observersRemove(id, hash) {
    if (!recordsKey) throw new Error('records locked');
    await db.ref(ROOT + '/observersEntries/' + id).remove();
    if (hash) await db.ref(ROOT + '/observersIndex/' + hash).remove();
  }

  // Pending proposal queue — same records key, node roster/pending. The /sgt
  // page appends proposals; /admin approves (applies + removes) or rejects
  // (removes). Nothing in a proposal is live until approved.
  async function pendingGet() {
    if (!recordsKey) return null;
    const blob = await once('pending');
    if (!blob) return [];
    try { return JSON.parse(await keyDecrypt(blob, recordsKey)); } catch (e) { return []; }
  }
  async function pendingSave(arr) {
    if (!recordsKey) throw new Error('records locked');
    const data = await keyEncrypt(JSON.stringify(arr), recordsKey);
    await db.ref(ROOT + '/pending').set(data);
  }
  // Approved officers list — wrapped under the SHARED roster key (like the
  // roster itself), so cadet-facing pages (e.g. the ride-along request form)
  // can read it with the cadet passcode. Written from /admin (advisor has the
  // roster key too). Node: roster/officers.
  async function officersGet() {
    if (!rosterKey) return null;
    const blob = await once('officers');
    if (!blob) return [];
    try { return JSON.parse(await keyDecrypt(blob, rosterKey)); } catch (e) { return []; }
  }
  async function officersSave(arr) {
    if (!rosterKey) throw new Error('roster locked');
    const data = await keyEncrypt(JSON.stringify(arr), rosterKey);
    await db.ref(ROOT + '/officers').set(data);
  }
  // Weekly Attendance log — encrypted under the SHARED roster key (same model
  // as the officers list), so the Trackers page (cadet passcode) can WRITE a
  // session and /admin (advisor passcode) can READ them all. Lives under the
  // already-permitted roster node (roster/attendance), so no extra Firebase
  // rule is required. Stored as an object keyed by meeting date:
  //   { 'YYYY-MM-DD': { date, dateFmt, submittedBy, roster,
  //                     present:[], excused:[], unexcused:[], ts }, ... }
  async function attendanceGet() {
    if (!rosterKey) return null;
    const blob = await once('attendance');
    if (!blob) return {};
    try { return JSON.parse(await keyDecrypt(blob, rosterKey)); } catch (e) { return {}; }
  }
  async function attendanceSaveSession(session) {
    if (!rosterKey) throw new Error('roster locked');
    const all = (await attendanceGet()) || {};
    all[session.date] = session;                 // re-submitting a date overwrites it
    const data = await keyEncrypt(JSON.stringify(all), rosterKey);
    await db.ref(ROOT + '/attendance').set(data);
    return all;
  }
  // Overwrite the whole attendance map — used by /admin to correct a session's
  // date (re-key) or delete a session outright.
  async function attendanceSaveAll(map) {
    if (!rosterKey) throw new Error('roster locked');
    const data = await keyEncrypt(JSON.stringify(map || {}), rosterKey);
    await db.ref(ROOT + '/attendance').set(data);
    return map;
  }

  // Uniform Standards — encrypted under the SHARED roster key, node
  // roster/uniforms. The Uniforms page reads it with the cadet passcode;
  // /admin writes it with the advisor passcode (advisor holds the roster
  // key too). Lives under the already-permitted roster node, so no extra
  // Firebase rule is required. Returns null when nothing has been saved
  // yet, so the page can fall back to its built-in default.
  async function uniformsGet() {
    if (!rosterKey) return null;
    const blob = await once('uniforms');
    if (!blob) return null;
    try { return JSON.parse(await keyDecrypt(blob, rosterKey)); } catch (e) { return null; }
  }
  async function uniformsSave(obj) {
    if (!rosterKey) throw new Error('roster locked');
    const data = await keyEncrypt(JSON.stringify(obj), rosterKey);
    await db.ref(ROOT + '/uniforms').set(data);
  }

  // Training Hub — encrypted under the SHARED roster key, node roster/training.
  // The Training page reads it with the cadet passcode and renders the weekly
  // schedule; /admin writes it with the advisor passcode (advisor holds the
  // roster key too). Lives under the already-permitted roster node, so no extra
  // Firebase rule is required. Returns null when nothing has been saved yet, so
  // the page can fall back to its built-in schedule.
  async function trainingGet() {
    if (!rosterKey) return null;
    const blob = await once('training');
    if (!blob) return null;
    try { return JSON.parse(await keyDecrypt(blob, rosterKey)); } catch (e) { return null; }
  }
  async function trainingSave(obj) {
    if (!rosterKey) throw new Error('roster locked');
    const data = await keyEncrypt(JSON.stringify(obj), rosterKey);
    await db.ref(ROOT + '/training').set(data);
  }
  // Donation Tracking, encrypted under the ADVISOR records key, node
  // roster/donations. Same key as Cadet Records and Ride-Along, so the advisor
  // passcode opens all three; the cadet/qm passcodes never get this key. Lives
  // under the already-permitted roster node, so no extra Firebase rule is
  // required. Returns null when nothing has been saved yet.
  async function donationsGet() {
    if (!recordsKey) return null;
    const blob = await once('donations');
    if (!blob) return null;
    try { return JSON.parse(await keyDecrypt(blob, recordsKey)); } catch (e) { return null; }
  }
  async function donationsSave(obj) {
    if (!recordsKey) throw new Error('records locked');
    const data = await keyEncrypt(JSON.stringify(obj), recordsKey);
    await db.ref(ROOT + '/donations').set(data);
  }
  // Event / Activity hours (roster/events), encrypted under the SHARED roster key
  // like attendance and officers, so the Trackers page (cadet passcode) can append
  // and /admin (advisor passcode) can read. Stored as an array of records:
  //   { id, cadet, date:'YYYY-MM-DD', event, start:'HH:MM', end:'HH:MM', hours, comments, ts }
  async function eventsGet() {
    if (!rosterKey) return null;
    const blob = await once('events');
    if (!blob) return [];
    try { return JSON.parse(await keyDecrypt(blob, rosterKey)); } catch (e) { return []; }
  }
  async function eventsAdd(rec) {
    if (!rosterKey) throw new Error('roster locked');
    const all = (await eventsGet()) || [];
    rec.id = rec.id || ('ev_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6));
    all.push(rec);
    const data = await keyEncrypt(JSON.stringify(all), rosterKey);
    await db.ref(ROOT + '/events').set(data);
    return all;
  }
  async function eventsSave(arr) {
    if (!rosterKey) throw new Error('roster locked');
    const data = await keyEncrypt(JSON.stringify(arr), rosterKey);
    await db.ref(ROOT + '/events').set(data);
  }
  // Curated Event/Activity name list (roster/eventNames), shared roster key.
  // Returns null when unset so /admin can seed it. Cadet Trackers reads it to
  // build the Event Name picker; /admin writes it from the Event Names manager.
  async function eventNamesGet() {
    if (!rosterKey) return null;
    const blob = await once('eventNames');
    if (!blob) return null;
    try { return JSON.parse(await keyDecrypt(blob, rosterKey)); } catch (e) { return null; }
  }
  async function eventNamesSave(arr) {
    if (!rosterKey) throw new Error('roster locked');
    const data = await keyEncrypt(JSON.stringify(arr), rosterKey);
    await db.ref(ROOT + '/eventNames').set(data);
  }
  // ── Attendance + hours roll-up (shared by /admin and the Trackers "Current
  //    Attendance" tab so both show identical numbers). Pure over the passed data.
  //    Weekly meeting = 3 hours. Names are matched prefix-insensitively: attendance
  //    and event records store displayName() (rank-prefixed for leadership) while the
  //    roster key is the raw name, so stripping the prefix on both sides keeps
  //    leadership counted. If a NEW rank prefix is added to displayName(), extend
  //    attStripRank's regex here (single source of truth for this logic).
  const ATT_WEEKLY_HOURS = 3;
  function attStripRank(n){ return String(n==null?'':n).replace(/^(Act\. Sgt\.|Capt\.|Captain|Lt\.|Sgt\.)\s+/,'').trim(); }
  function attInList(list, name){ const t = attStripRank(name); return (list||[]).some(x => attStripRank(x) === t); }
  function attInRange(d, from, to){ d=d||''; if(from && d<from) return false; if(to && d>to) return false; return true; }
  function attRollup(opts){
    opts = opts || {};
    const attData = opts.attData || {};
    const from = opts.from || '', to = opts.to || '';
    const sessions = Object.values(attData).sort((a,b)=>(a.date||'').localeCompare(b.date||'')).filter(s=>attInRange(s.date, from, to) && !s.noMeeting);
    const events = (opts.events||[]).filter(e=>attInRange(e.date, from, to));
    const cadets = activeSorted();
    return cadets.map(p => {
      const name = p.name;
      let present=0, excused=0, unexcused=0, lastPresent=null, streak=0, streakBroken=false;
      const meetings = [];
      sessions.forEach(s => {
        let status='none';
        if(attInList(s.present,name)) { present++; lastPresent=s.date; status='present'; }
        else if(attInList(s.excused,name)) { excused++; status='excused'; }
        else if(attInList(s.unexcused,name)) { unexcused++; status='unexcused'; }
        meetings.push({ date:s.date, status });
      });
      for(let i=sessions.length-1;i>=0 && !streakBroken;i--){
        const s=sessions[i];
        if(attInList(s.present,name)) streakBroken=true;
        else if(attInList(s.excused,name)||attInList(s.unexcused,name)) streak++;
      }
      const myEvents = events.filter(e=>attStripRank(e.cadet)===attStripRank(name)).slice().sort((a,b)=>(a.date||'').localeCompare(b.date||''));
      const eventHours = Math.round(myEvents.reduce((a,e)=>a+(Number(e.hours)||0),0)*100)/100;
      const weeklyHours = present*ATT_WEEKLY_HOURS;
      const recorded = present+excused+unexcused;
      const rate = recorded ? Math.round((present/recorded)*100) : null;
      const watch = unexcused>=2 || (rate!==null && recorded>=3 && rate<60) || streak>=2;
      return { p, name, present, excused, unexcused, recorded, rate, lastPresent, streak, watch,
               meetings, events:myEvents, weeklyHours, eventHours,
               totalHours: Math.round((weeklyHours+eventHours)*100)/100 };
    });
  }
  // ── Limited advisor access: one extra passcode that opens ONLY Cadet Records,
  //    Ride-Along, and Donations. It gets the same roster + records keys (so those
  //    tools work), and /admin hides every other tool for it. UI-scoped, not a hard
  //    cryptographic wall, which is all that's needed here (advisors, not attackers).
  async function accessSetLimited(pass) {
    if (!rosterKey) throw new Error('not unlocked');
    if (!recordsKey) throw new Error('records locked');
    await linkRole('ltd', pass);
    await recordsGrantLtd(pass);
  }
  async function accessClearLimited() {
    await db.ref(ROOT + '/wrap/ltd').remove();
    await recordsRevokeLtd();
  }
  async function accessHasLimited() { return !!(await once('wrap/ltd')); }
  // ── Sergeant read access: one passcode that opens ONLY the /sgt page
  //    (read-only Cadet Records, Ride-Along Log, Current Attendance). It gets
  //    the same roster + records keys so those views can decrypt; the /sgt page
  //    never writes. UI-scoped, same model as the limited advisor tier.
  async function accessSetSgt(pass) {
    if (!rosterKey) throw new Error('not unlocked');
    if (!recordsKey) throw new Error('records locked');
    await linkRole('sgt', pass);
    await recordsGrantSgt(pass);
  }
  async function accessClearSgt() {
    await db.ref(ROOT + '/wrap/sgt').remove();
    await recordsRevokeSgt();
  }
  async function accessHasSgt() { return !!(await once('wrap/sgt')); }
})(window);
