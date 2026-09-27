// Extractor de la Polla NFL (Splash Sports).
// Se ejecuta DENTRO de una pestaña de *.splashsports.com con sesión iniciada
// (usa la cookie accessToken de la sesión). Devuelve un JSON compacto en texto.
(async () => {
  const CONTEST = 'contest_01KZPQ5VY6JW7J8MD54KDN44M1';
  const ENTRIES = {
    'entry_01M0D750T6DCQTKTC9F5NEE8C2': 'Kvetchers',
    'entry_01M0D73P3RM6TH90VAD4M6VRYV': 'KIBBEH',
  };
  // Cuál cuenta corresponde a cada userId (para etiquetar los survivor "solo mis picks").
  const ACCT_BY_UID = {
    'fa45a33b-33fb-4c0c-8c29-6ce833a95e6d': 'Kvetchers',
    '14a8ce64-866c-4b10-b8af-04b067b5a348': 'KIBBEH',
  };
  // Survivors a incluir (solo mis entradas). pickMode se lee del picksheet.
  const SURVIVORS = [
    { id: 'contest_01KZ96TR6DJDDQV57SRJT0EDF2', name: 'Super Survivor Betcris', short: 'Survivor' },
    { id: 'contest_01KZPRD4798HZ593H9QBWCWR0T', name: 'Polla Homicida', short: 'Homicida' },
  ];

  const ck = document.cookie.split('; ').find(c => c.startsWith('accessToken='));
  if (!ck) return JSON.stringify({ error: 'NOT_LOGGED_IN' });
  const tok = decodeURIComponent(ck.split('=')[1]);
  const get = async p => {
    const r = await fetch('https://api.splashsports.com/contests-service-v2/api/' + p,
      { headers: { Authorization: 'Bearer ' + tok } });
    if (r.status === 401 || r.status === 403) throw new Error('AUTH ' + r.status);
    if (!r.ok) throw new Error(p + ' -> ' + r.status);
    return r.json();
  };
  const team = t => t ? ({ ab: t.alias, name: t.name, sc: t.score, sp: t.spread }) : null;
  // Ejecuta las promesas en tandas para no saturar el API.
  const pool = async (items, size, fn) => {
    const out = [];
    for (let i = 0; i < items.length; i += size) out.push(...await Promise.all(items.slice(i, i + size).map(fn)));
    return out;
  };

  try {
    const now = Date.now();
    const slates = (await get(`contests/slates?contestId=${CONTEST}&limit=25&offset=0`)).data;
    // Semanas ya cerradas Y con piques de todos ya guardados: no se vuelven a bajar.
    const skip = new Set(window.POLLA_SKIP || []);
    const active = slates.filter(s => !(s.status === 'settled' && skip.has(s.name)) && (
      s.status !== 'scheduled' || s.isCurrentSlate || new Date(s.windowStartDate).getTime() <= now));

    // Tabla completa: define el orden y da handle + entryId de cada participante.
    const standings = [];
    const roster = []; // { id, handle }
    let cur = null;
    for (let i = 0; i < 10; i++) {
      const lb = await get(`leaderboards?contestId=${CONTEST}&limit=50` + (cur ? `&cursor=${cur}` : ''));
      for (const e of lb.data) {
        standings.push({ r: e.rank, dr: e.displayRank, h: e.user.handle, w: e.metadata.record.wins, l: e.metadata.record.losses, t: e.metadata.record.ties || 0, me: !!ENTRIES[e.entry.id] });
        roster.push({ id: e.entry.id, handle: e.user.handle });
      }
      cur = lb.nextCursor;
      if (!cur) break;
    }

    // Piques de mis dos cuentas aún sin cerrar (incluye la semana en curso).
    const mine = (await get(`my-entries?contestId=${CONTEST}&limit=20&offset=0&includePicks=true`)).data;
    const openPicks = {};
    for (const e of mine) {
      if (!ENTRIES[e.id] || !e.picks) continue;
      openPicks[e.id] = {};
      for (const p of e.picks.picks) openPicks[e.id][p.game.id] = { t: p.pick.alias, g: p.grade };
    }

    const weeks = [];
    const allPicks = {}; // nombre de semana -> { gids:[...], p:{ handle: "AL,AL,-,..." } }
    for (const s of active) {
      const base = `team-pickem/picksheets?contestId=${CONTEST}&slateId=${s.id}`;
      const [sheet, stats, ...entrySheets] = await Promise.all([
        get(base),
        get(`team-pickem/statistics?contestId=${CONTEST}&slateId=${s.id}&offset=0&limit=25`).catch(() => ({ data: [] })),
        ...Object.keys(ENTRIES).map(id => get(`${base}&entryId=${id}`)),
      ]);
      const dist = {};
      for (const gs of stats.data || []) {
        dist[gs.gameId] = {};
        for (const p of gs.picks) dist[gs.gameId][p.team.alias] = { pct: p.picked.percent, n: p.picked.count, auto: p.autoPicked.count };
      }
      const idAlias = {};
      for (const gm of sheet.data.games) { idAlias[gm.home.id] = gm.home.alias; idAlias[gm.away.id] = gm.away.alias; }
      const gids = sheet.data.games.map(gm => gm.gameId);

      const games = sheet.data.games.map(gm => {
        const idToAlias = { [gm.home.id]: gm.home.alias, [gm.away.id]: gm.away.alias };
        const picks = {};
        Object.keys(ENTRIES).forEach((id, i) => {
          const eg = entrySheets[i].data.games.find(x => x.gameId === gm.gameId);
          const p = eg && eg.picks && eg.picks[0];
          if (p) picks[ENTRIES[id]] = { t: idToAlias[p.value] || p.value, g: p.grade || null, m: p.margin ?? null };
          else if (openPicks[id] && openPicks[id][gm.gameId]) picks[ENTRIES[id]] = { t: openPicks[id][gm.gameId].t, g: openPicks[id][gm.gameId].g, m: null, open: true };
        });
        const team = t => ({ ab: t.alias, name: t.name, sc: t.score, sp: t.spread, rec: t.record ? `${t.record.wins}-${t.record.losses}${t.record.ties ? '-' + t.record.ties : ''}` : '' });
        return {
          id: gm.gameId, at: gm.startsAt, lockAt: gm.lockAt, st: gm.status, state: gm.state,
          away: team(gm.away), home: team(gm.home), tb: gm.isTiebreakerGame, picks, dist: dist[gm.gameId] || null,
        };
      });
      weeks.push({ n: s.name, status: s.status, current: s.isCurrentSlate, lock: s.pickLockDate, start: s.startDate, end: s.endDate, games });

      // Piques de TODOS los participantes en esta semana (solo se revelan al cerrar cada juego).
      const p = {};
      await pool(roster, 10, async en => {
        try {
          const es = await get(`${base}&entryId=${en.id}`);
          const byGid = {};
          for (const gg of es.data.games) { const pk = gg.picks && gg.picks[0]; if (pk) byGid[gg.gameId] = idAlias[pk.value] || ''; }
          if (Object.keys(byGid).length) p[en.handle] = gids.map(gid => byGid[gid] || '-').join(',');
        } catch (e) { /* un entry que falle no detiene la semana */ }
      });
      allPicks[s.name] = { gids, p };
    }

    // ---- Survivors: solo MIS entradas de la cuenta con sesión iniciada ----
    const myUid = (mine[0] && mine[0].userId) || null;
    const acct = ACCT_BY_UID[myUid] || 'Cuenta';
    const survivors = [];
    for (const sv of SURVIVORS) {
      const slates = (await get(`contests/slates?contestId=${sv.id}&limit=25&offset=0`)).data;
      const svActive = slates.filter(s => s.status !== 'scheduled');
      const gameById = {}; let pickMode = null; let deadline = null;
      for (const s of svActive) {
        const ps = await get(`team-survivor/picksheets?contestId=${sv.id}&slateId=${s.id}`);
        pickMode = pickMode || ps.data.pickMode;
        for (const gm of ps.data.games) gameById[gm.gameId] = { week: s.name, home: team(gm.home), away: team(gm.away), st: gm.status, at: gm.startsAt };
      }
      const slateById = Object.fromEntries(slates.map(s => [s.id, s.name]));
      const myEnts = (await get(`my-entries?contestId=${sv.id}&limit=20&offset=0&includePicks=true`)).data;
      const entries = myEnts.map(e => {
        const picks = {};
        for (const sl of (e.picks && e.picks.slates) || []) {
          const p = sl.picks && sl.picks[0];
          const wk = slateById[sl.slateId];
          if (!p || !wk) continue;
          const g = gameById[p.gameId];
          const t = p.team ? p.team.alias : null;
          let opp = null, ts = null, os = null, st = null;
          if (g && g.home && g.away) {
            const mine = g.home.ab === t ? g.home : g.away, oth = g.home.ab === t ? g.away : g.home;
            opp = oth.ab; ts = mine.sc; os = oth.sc; st = g.st;
          }
          picks[wk] = { t, opp, ts, os, st, g: p.grade || null, missed: !!p.isMissedPick };
        }
        return {
          acct, order: e.order,
          alive: !!(e.state && e.state.alive),
          lives: e.state ? e.state.livesRemaining : null,
          elimWeek: e.state && e.state.eliminatedSlateId ? slateById[e.state.eliminatedSlateId] : null,
          picks,
        };
      });
      const nextSlate = slates.find(s => s.status !== 'settled');
      survivors.push({
        id: sv.id, name: sv.name, short: sv.short, pickMode,
        lock: nextSlate ? nextSlate.pickLockDate : null,
        curWeek: nextSlate ? nextSlate.name : null,
        entries,
      });
    }

    const loggedAs = Object.keys(openPicks).map(id => ENTRIES[id]);
    return JSON.stringify({ fetchedAt: new Date().toISOString(), contest: 'POLLA PANAMA 2026', loggedAs, acct, entries: Object.values(ENTRIES), weeks, allPicks, standings, survivors });
  } catch (err) {
    return JSON.stringify({ error: String(err.message || err) });
  }
})()
