// Bloo Arcade — shared leaderboard library
// Local-first: uses localStorage. Designed so a cloud backend (Firebase / Supabase / Vercel KV)
// can be swapped in later without touching game code — just replace _store with a remote impl.
(function (global) {
  const NS = 'bloo';
  const KEY_USER = NS + '.username';
  const KEY_PREFIX = NS + '.scores.';
  const MAX_PER_GAME = 50;

  // Game IDs and friendly metadata.
  const GAMES = {
    platformer: { name: 'Forest of Embers', metric: 'score', metricLabel: 'Score' },
    runner:     { name: 'Crowd Runner',     metric: 'score', metricLabel: 'Score' },
    tower:      { name: 'Bloo Defense',     metric: 'wave',  metricLabel: 'Wave'  },
  };

  // ---------- storage abstraction ----------
  const _store = {
    list(game) {
      try { return JSON.parse(localStorage.getItem(KEY_PREFIX + game) || '[]'); }
      catch (_) { return []; }
    },
    save(game, arr) {
      try { localStorage.setItem(KEY_PREFIX + game, JSON.stringify(arr)); } catch (_) {}
    }
  };

  // ---------- username ----------
  function getUsername() {
    try { return localStorage.getItem(KEY_USER) || ''; } catch (_) { return ''; }
  }
  function setUsername(name) {
    name = (name || '').toString().trim().slice(0, 20);
    if (!name) return false;
    try { localStorage.setItem(KEY_USER, name); } catch (_) {}
    return true;
  }
  // Show the inline modal. Returns a promise that resolves with the chosen name.
  function promptUsername(opts = {}) {
    return new Promise((resolve) => {
      // Inject styles once
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
        if (!setUsername(name)) { err.textContent = 'Could not save name'; return; }
        document.body.removeChild(overlay);
        resolve(name);
      }
      btn.addEventListener('click', submit);
      input.addEventListener('keydown', (e) => { if (e.key === 'Enter') submit(); });
    });
  }
  // Convenience: returns the saved username, prompting if not set.
  async function ensureUsername() {
    let n = getUsername();
    if (n) return n;
    return await promptUsername();
  }

  // ---------- score IO ----------
  function submitScore(game, score, meta) {
    if (!GAMES[game]) { console.warn('Unknown game id', game); return; }
    const list = _store.list(game);
    const entry = {
      name: getUsername() || 'Anon',
      score: Number(score) || 0,
      date: Date.now(),
      meta: meta || {},
    };
    list.push(entry);
    list.sort((a, b) => b.score - a.score);
    _store.save(game, list.slice(0, MAX_PER_GAME));
    return entry;
  }
  function getScores(game) {
    return _store.list(game).slice().sort((a, b) => b.score - a.score);
  }
  // Cumulative: sum of each player's BEST score across all 3 games.
  // Different games have different scales, so we normalize each game's scores
  // to 0..1000 based on the all-time max for that game.
  function getCumulative() {
    const byUser = new Map();           // name → { games: { gameId: rawBest }, total: 0 }
    const maxByGame = {};               // gameId → max raw
    for (const g of Object.keys(GAMES)) {
      const scores = _store.list(g);
      let max = 1;
      for (const s of scores) if (s.score > max) max = s.score;
      maxByGame[g] = max;
      // best per name
      const bestByName = new Map();
      for (const s of scores) {
        const cur = bestByName.get(s.name) || 0;
        if (s.score > cur) bestByName.set(s.name, s.score);
      }
      for (const [name, best] of bestByName) {
        if (!byUser.has(name)) byUser.set(name, { name, games: {}, total: 0 });
        byUser.get(name).games[g] = best;
      }
    }
    // Compute normalized total
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

  // ---------- exposed API ----------
  global.BlooLB = {
    GAMES,
    getUsername, setUsername, promptUsername, ensureUsername,
    submitScore, getScores, getCumulative,
  };
})(window);
