// Bloo Arcade — shared leaderboard library
// Cloud-backed via Firebase Firestore, with localStorage cache + offline fallback.
// All score writes are mirrored to localStorage immediately so the UI never blocks
// on the network; cloud writes are fire-and-forget. Reads prefer cloud, fall back
// to local if Firebase isn't reachable.
(function (global) {
  const NS = 'bloo';
  const KEY_USER = NS + '.username';
  const KEY_PREFIX = NS + '.scores.';
  const MAX_PER_GAME = 50;

  const GAMES = {
    platformer: { name: 'Forest of Embers', metric: 'score', metricLabel: 'Score' },
    runner:     { name: 'Crowd Runner',     metric: 'score', metricLabel: 'Score' },
    tower:      { name: 'Bloo Defense',     metric: 'wave',  metricLabel: 'Wave'  },
  };

  // ----- Firebase config (public — secured by Firestore rules, not by hiding) -----
  const FIREBASE_CONFIG = {
    apiKey: "AIzaSyBBdvKGTSn2dqm9UtxcNMQu9KZDFaspi5I",
    authDomain: "bloo-13d22.firebaseapp.com",
    projectId: "bloo-13d22",
    storageBucket: "bloo-13d22.firebasestorage.app",
    messagingSenderId: "60431164346",
    appId: "1:60431164346:web:f7cda7bab797e8e6723383",
  };
  const ENABLE_CLOUD = true;
  const FIREBASE_VERSION = '10.13.0';

  // ----- localStorage shim (always-available, also used as offline cache) -----
  const _local = {
    list(game) {
      try { return JSON.parse(localStorage.getItem(KEY_PREFIX + game) || '[]'); }
      catch (_) { return []; }
    },
    save(game, arr) {
      try { localStorage.setItem(KEY_PREFIX + game, JSON.stringify(arr)); } catch (_) {}
    }
  };

  // ----- Firebase loader (dynamic ESM import; only loads when actually needed) -----
  let _fb = null; // null = not tried, false = failed, object = ready
  async function loadFirebase() {
    if (_fb !== null) return _fb;
    if (!ENABLE_CLOUD) return _fb = false;
    try {
      const appMod  = await import(`https://www.gstatic.com/firebasejs/${FIREBASE_VERSION}/firebase-app.js`);
      const fsMod   = await import(`https://www.gstatic.com/firebasejs/${FIREBASE_VERSION}/firebase-firestore.js`);
      const authMod = await import(`https://www.gstatic.com/firebasejs/${FIREBASE_VERSION}/firebase-auth.js`);
      const app = appMod.initializeApp(FIREBASE_CONFIG);
      const db = fsMod.getFirestore(app);
      const auth = authMod.getAuth(app);
      _fb = {
        app, db, auth,
        collection: fsMod.collection,
        addDoc: fsMod.addDoc,
        getDocs: fsMod.getDocs,
        deleteDoc: fsMod.deleteDoc,
        doc: fsMod.doc,
        query: fsMod.query,
        orderBy: fsMod.orderBy,
        limit: fsMod.limit,
        signInWithEmailAndPassword: authMod.signInWithEmailAndPassword,
        signOut: authMod.signOut,
      };
      return _fb;
    } catch (e) {
      console.warn('[BlooLB] Firebase load failed, using local only:', e);
      return _fb = false;
    }
  }

  // ----- Admin: wipe all leaderboard collections (passcode-gated, no auth) -----
  // Change this string whenever you want to rotate the passcode. The Firestore
  // rules need to allow delete from anyone (allow delete: if true;) for this
  // to work — security is purely obscurity (passcode + hidden URL).
  const ADMIN_PASSCODE = 'bloowipe-2026';

  async function adminWipeWithPasscode(passcode) {
    if (passcode !== ADMIN_PASSCODE) return { ok: false, error: 'Wrong passcode.' };
    const fb = await loadFirebase();
    if (!fb) return { ok: false, error: 'Firebase failed to load' };
    let total = 0;
    for (const game of Object.keys(GAMES)) {
      try {
        const snap = await fb.getDocs(fb.collection(fb.db, 'scores_' + game));
        const dels = [];
        snap.forEach(d => dels.push(fb.deleteDoc(fb.doc(fb.db, 'scores_' + game, d.id))));
        await Promise.all(dels);
        total += dels.length;
      } catch (e) {
        return { ok: false, error: 'Delete failed on ' + game + ': ' + (e.code || e.message), partial: total };
      }
    }
    for (const g of Object.keys(GAMES)) _local.save(g, []);
    return { ok: true, deleted: total };
  }

  // ----- username + profanity filter -----
  // Mild body-part words (dick / balls / ass / shit / fuck / damn / bitch) are
  // intentionally allowed. The filter targets actual slurs, sexual-violence
  // language, and aggressive compound insults.
  const BLOCKED_TERMS = [
    // racial slurs (re-added after a real-world incident)
    'nigger', 'nigga', 'niggur', 'niggar',
    // sexual violence
    'rapist', 'rape', 'raping', 'rapes',
    // pedophilia
    'pedo', 'pedophile', 'kiddiefuck',
    // aggressive compound insults
    'fucker', 'cocksucker', 'motherfucker', 'cumdumpster',
    // self-harm encouragement
    'killyourself', 'killyaself', 'kys',
  ];
  // Strip leetspeak + spacing so names like "n!gg3r" or "n i g g e r" still match.
  function normalizeForFilter(s) {
    return String(s).toLowerCase()
      .normalize('NFKD').replace(/[̀-ͯ]/g, '')   // strip accents
      .replace(/[!|]/g, 'i')
      .replace(/[1]/g, 'i')
      .replace(/[0]/g, 'o')
      .replace(/[3]/g, 'e')
      .replace(/[4@]/g, 'a')
      .replace(/[$5]/g, 's')
      .replace(/[7]/g, 't')
      .replace(/[^a-z]/g, '');                              // drop everything except letters
  }
  function findBlockedTerm(name) {
    const norm = normalizeForFilter(name);
    if (!norm) return null;
    for (const bad of BLOCKED_TERMS) {
      if (norm.includes(bad)) return bad;
    }
    return null;
  }

  function getUsername() {
    try { return localStorage.getItem(KEY_USER) || ''; } catch (_) { return ''; }
  }
  // setUsername now returns:
  //   true            — saved
  //   'empty'         — blank input
  //   'blocked:<word>' — caught by filter
  function setUsername(name) {
    name = (name || '').toString().trim().slice(0, 20);
    if (!name) return 'empty';
    const bad = findBlockedTerm(name);
    if (bad) return 'blocked:' + bad;
    try { localStorage.setItem(KEY_USER, name); } catch (_) {}
    return true;
  }
  function promptUsername(opts = {}) {
    return new Promise((resolve) => {
      if (!document.getElementById('bloo-name-style')) {
        const s = document.createElement('style');
        s.id = 'bloo-name-style';
        s.textContent = `
          .bloo-name-overlay { position: fixed; inset: 0; background: rgba(0,0,0,0.7); display: flex; align-items: center; justify-content: center; z-index: 99999; backdrop-filter: blur(8px); -webkit-backdrop-filter: blur(8px); padding: 20px; }
          .bloo-name-modal { background: linear-gradient(180deg, #1a0e3a 0%, #0f0820 100%); border: 1.5px solid rgba(255, 92, 184, 0.6); border-radius: 16px; padding: 28px 26px; max-width: 360px; width: 100%; color: #fff; box-shadow: 0 20px 60px rgba(0,0,0,0.6), 0 0 40px rgba(255, 92, 184, 0.3); font-family: system-ui, -apple-system, sans-serif; }
          .bloo-name-modal h2 { margin: 0 0 6px; font-size: 22px; background: linear-gradient(180deg, #fff 0%, #ff8de0 60%, #ff5cb8 100%); -webkit-background-clip: text; background-clip: text; -webkit-text-fill-color: transparent; }
          .bloo-name-modal p { margin: 0 0 16px; color: rgba(255,255,255,0.65); font-size: 13px; line-height: 1.5; }
          .bloo-name-modal input { width: 100%; padding: 12px 14px; background: rgba(20,8,40,0.6); border: 1.5px solid rgba(255, 92, 184, 0.4); border-radius: 10px; color: #fff; font-size: 16px; box-sizing: border-box; outline: none; font-family: inherit; }
          .bloo-name-modal input:focus { border-color: #ff5cb8; box-shadow: 0 0 0 3px rgba(255, 92, 184, 0.18); }
          .bloo-name-modal button { width: 100%; margin-top: 14px; padding: 12px; background: linear-gradient(135deg, #ff5cb8 0%, #c038ff 100%); color: #fff; border: 0; border-radius: 999px; font-weight: 700; font-size: 15px; letter-spacing: .8px; cursor: pointer; box-shadow: 0 6px 18px rgba(255, 92, 184, 0.45); font-family: inherit; }
          .bloo-name-modal button:active { transform: scale(0.98); }
          .bloo-name-error { color: #ff5c8a; font-size: 12px; margin-top: 8px; min-height: 16px; }
        `;
        document.head.appendChild(s);
      }
      const overlay = document.createElement('div');
      overlay.className = 'bloo-name-overlay';
      overlay.innerHTML = `
        <div class="bloo-name-modal" role="dialog" aria-modal="true">
          <h2>Welcome to Bloo Arcade</h2>
          <p>${opts.message || 'Pick a name for the leaderboard. Up to 20 characters.'}</p>
          <input type="text" id="bloo-name-input" maxlength="20" autocomplete="off" placeholder="Your name" />
          <div class="bloo-name-error" id="bloo-name-error"></div>
          <button id="bloo-name-submit">START</button>
        </div>`;
      document.body.appendChild(overlay);
      const input = overlay.querySelector('#bloo-name-input');
      const err = overlay.querySelector('#bloo-name-error');
      const btn = overlay.querySelector('#bloo-name-submit');
      input.value = getUsername() || '';
      setTimeout(() => input.focus(), 50);
      function submit() {
        const name = input.value.trim();
        if (!name) { err.textContent = 'Name cannot be empty'; return; }
        const result = setUsername(name);
        if (result === true) {
          document.body.removeChild(overlay);
          resolve(name);
          return;
        }
        if (result === 'empty') { err.textContent = 'Name cannot be empty'; return; }
        if (typeof result === 'string' && result.startsWith('blocked:')) {
          err.textContent = "That name isn't allowed — pick something else.";
          input.focus(); input.select();
          return;
        }
        err.textContent = 'Could not save name';
      }
      btn.addEventListener('click', submit);
      input.addEventListener('keydown', (e) => { if (e.key === 'Enter') submit(); });
    });
  }
  async function ensureUsername() {
    const n = getUsername();
    if (n) return n;
    return await promptUsername();
  }

  // ----- score IO -----
  function _localSubmit(game, entry) {
    const list = _local.list(game);
    list.push(entry);
    list.sort((a, b) => b.score - a.score);
    _local.save(game, list.slice(0, MAX_PER_GAME));
  }

  // submitScore: writes locally immediately, fires cloud write asynchronously.
  // Returns the entry object (for tests / UI).
  function submitScore(game, score, meta) {
    if (!GAMES[game]) { console.warn('Unknown game id', game); return; }
    const entry = {
      name: getUsername() || 'Anon',
      score: Number(score) || 0,
      date: Date.now(),
      meta: meta || {},
    };
    _localSubmit(game, entry);
    // Fire-and-forget cloud write
    (async () => {
      const fb = await loadFirebase();
      if (!fb) return;
      try {
        await fb.addDoc(fb.collection(fb.db, 'scores_' + game), entry);
      } catch (e) {
        console.warn('[BlooLB] cloud write failed:', e);
      }
    })();
    return entry;
  }

  // getScores: prefers cloud if available, falls back to local cache.
  // Returns a Promise<Array> sorted by score desc.
  async function getScores(game) {
    const fb = await loadFirebase();
    if (fb) {
      try {
        const q = fb.query(
          fb.collection(fb.db, 'scores_' + game),
          fb.orderBy('score', 'desc'),
          fb.limit(MAX_PER_GAME)
        );
        const snap = await fb.getDocs(q);
        const out = [];
        snap.forEach(d => out.push(d.data()));
        return out;
      } catch (e) {
        console.warn('[BlooLB] cloud read failed, using local:', e);
      }
    }
    return _local.list(game).slice().sort((a, b) => b.score - a.score);
  }

  // Cumulative: aggregates each player's best score across all 3 games,
  // normalizing each game to 0-1000 against its own all-time max.
  async function getCumulative() {
    const allScores = {};
    for (const g of Object.keys(GAMES)) {
      allScores[g] = await getScores(g);
    }
    const byUser = new Map();
    const maxByGame = {};
    for (const g of Object.keys(GAMES)) {
      let max = 1;
      for (const s of allScores[g]) if (s.score > max) max = s.score;
      maxByGame[g] = max;
      const bestByName = new Map();
      for (const s of allScores[g]) {
        const cur = bestByName.get(s.name) || 0;
        if (s.score > cur) bestByName.set(s.name, s.score);
      }
      for (const [name, best] of bestByName) {
        if (!byUser.has(name)) byUser.set(name, { name, games: {}, total: 0 });
        byUser.get(name).games[g] = best;
      }
    }
    for (const u of byUser.values()) {
      let total = 0;
      for (const g of Object.keys(GAMES)) {
        const raw = u.games[g] || 0;
        const max = maxByGame[g] || 1;
        total += Math.round((raw / max) * 1000);
      }
      u.total = total;
    }
    const arr = [...byUser.values()].sort((a, b) => b.total - a.total);
    return { entries: arr, maxByGame };
  }

  global.BlooLB = {
    GAMES,
    getUsername, setUsername, promptUsername, ensureUsername,
    submitScore, getScores, getCumulative,
    adminWipeWithPasscode,
  };
})(window);
