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
      const [sheet, ...entrySheets] = await Promise.all([
        get(base),
        ...Object.keys(ENTRIES).map(id => get(`${base}&entryId=${id}`)),
      ]);
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
          away: team(gm.away), home: team(gm.home), tb: gm.isTiebreakerGame, picks,
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

    // ---- Survivors: solo MIS entradas (las dos cuentas, sin importar cuál tenga sesión) ----
    const myUid = (mine[0] && mine[0].userId) || null;
    const acct = ACCT_BY_UID[myUid] || 'Cuenta';
    const survivors = [];
    for (const sv of SURVIVORS) {
      // Si esta cuenta no está inscrita en el concurso, Splash responde 403/404: se salta
      // y build.py conserva lo que haya guardado de la otra cuenta.
      let slates;
      try { slates = (await get(`contests/slates?contestId=${sv.id}&limit=25&offset=0`)).data; }
      catch (e) { continue; }
      const svActive = slates.filter(s => s.status !== 'scheduled');
      const gameById = {}; let pickMode = null; let deadline = null;
      for (const s of svActive) {
        const ps = await get(`team-survivor/picksheets?contestId=${sv.id}&slateId=${s.id}`);
        pickMode = pickMode || ps.data.pickMode;
        for (const gm of ps.data.games) gameById[gm.gameId] = { week: s.name, home: team(gm.home), away: team(gm.away), st: gm.status, at: gm.startsAt };
      }
      const slateById = Object.fromEntries(slates.map(s => [s.id, s.name]));
      const mkPick = p => {
        const g = gameById[p.gameId];
        const t = p.team ? p.team.alias : null;
        let opp = null, ts = null, os = null, st = null;
        const home = p.home ? { ab: p.home.alias, sc: p.home.score } : g && g.home;
        const away = p.away ? { ab: p.away.alias, sc: p.away.score } : g && g.away;
        if (home && away) {
          const mine = home.ab === t ? home : away, oth = home.ab === t ? away : home;
          opp = oth.ab; ts = mine.sc; os = oth.sc;
        }
        st = g ? g.st : (p.grade ? 'finalized' : null);
        return { t, opp, ts, os, st, g: p.grade || null, missed: !!p.isMissedPick };
      };
      // Entradas de MIS DOS cuentas desde la tabla de posiciones (visible con cualquier sesión).
      const entries = [];
      for (const [uid, name] of Object.entries(ACCT_BY_UID)) {
        let rows = [];
        try { rows = (await get(`team-survivor/standings?contestId=${sv.id}&limit=20&userId=${uid}`)).data || []; }
        catch (e) { continue; }
        for (const e of rows) {
          if (!e.user || e.user.id !== uid) continue;
          const picks = {};
          for (const sl of e.slates || []) {
            const p = sl.picks && sl.picks[0];
            const wk = slateById[sl.slateId];
            if (p && wk) picks[wk] = mkPick(p);
          }
          entries.push({
            acct: name, order: e.entry.order,
            alive: e.entry.status === 'active' && !e.eliminatedSlateId,
            lives: e.livesRemaining,
            elimWeek: e.eliminatedSlateId ? slateById[e.eliminatedSlateId] : null,
            picks,
          });
        }
      }
      // La cuenta con sesión ve además sus piques aún no revelados (semana en curso).
      try {
        const myEnts = (await get(`my-entries?contestId=${sv.id}&limit=20&offset=0&includePicks=true`)).data;
        for (const e of myEnts) {
          const tgt = entries.find(x => x.acct === acct && x.order === e.order);
          if (!tgt) continue;
          for (const sl of (e.picks && e.picks.slates) || []) {
            const p = sl.picks && sl.picks[0];
            const wk = slateById[sl.slateId];
            if (p && wk && !tgt.picks[wk]) tgt.picks[wk] = mkPick(p);
          }
        }
      } catch (e) { /* sin entradas propias en este concurso */ }
      const nextSlate = slates.find(s => s.status !== 'settled');
      // Equipos más escogidos de la semana en curso (se revelan al cerrar cada juego).
      let topPicks = null;
      const curSlate = slates.find(s => s.isCurrentSlate) || slates.find(s => s.status === 'in_progress');
      if (curSlate) {
        try {
          const st = await get(`team-survivor/statistics?contestId=${sv.id}&slateId=${curSlate.id}&offset=0&limit=40`);
          const teams = (st.data || [])
            .map(x => ({ ab: x.team.alias, n: x.picked ? x.picked.count : 0, pct: x.picked ? x.picked.percent : 0 }))
            .filter(t => t.n > 0)
            .sort((a, b) => b.n - a.n);
          topPicks = { week: curSlate.name, settled: curSlate.status === 'settled', teams };
        } catch (e) { /* sin acceso a stats: se queda null */ }
      }
      survivors.push({
        id: sv.id, name: sv.name, short: sv.short, pickMode,
        lock: nextSlate ? nextSlate.pickLockDate : null,
        curWeek: nextSlate ? nextSlate.name : null,
        topPicks, entries,
      });
    }

    const loggedAs = Object.keys(openPicks).map(id => ENTRIES[id]);
    return JSON.stringify({ fetchedAt: new Date().toISOString(), contest: 'POLLA PANAMA 2026', loggedAs, acct, entries: Object.values(ENTRIES), weeks, allPicks, standings, survivors });
  } catch (err) {
    return JSON.stringify({ error: String(err.message || err) });
  }
})()
