// Atualização ao vivo de placar/marcadores. Dois provedores:
//
//  - "worldcup2026" (padrão, gratuito): dataset público da Copa 2026
//    (github.com/rezarahiminia/worldcup2026). Traz placar, marcadores e
//    status (minuto/ao vivo). Não traz estatística detalhada.
//  - "apifootball": api-sports.io (requer API_FOOTBALL_KEY, plano pago para 2026).
//    Traz também estatísticas (escanteios, faltas, posse...).
//
// Defina LIVE_PROVIDER=none para desligar e usar só o lançamento manual.

const KEY = process.env.API_FOOTBALL_KEY || "";
const PROVIDER = process.env.LIVE_PROVIDER || (KEY ? "apifootball" : "worldcup2026");

export function liveEnabled() {
  return PROVIDER !== "none";
}
export function liveProvider() {
  return PROVIDER;
}

/* ---------------------------- cache simples ---------------------------- */
const cache = new Map();
async function getJSON(url, ttlMs, headers) {
  const hit = cache.get(url);
  if (hit && Date.now() - hit.at < ttlMs) return hit.data;
  const res = await fetch(url, headers ? { headers } : undefined);
  if (!res.ok) throw new Error(`HTTP ${res.status} em ${url}`);
  const data = await res.json();
  cache.set(url, { at: Date.now(), data });
  return data;
}

/* ----------------------- provedor: worldcup2026 ----------------------- */
const WC_BASE = "https://raw.githubusercontent.com/rezarahiminia/worldcup2026/main";

function parseScorers(raw) {
  if (!raw || raw === "null") return [];
  if (Array.isArray(raw)) return raw.map((s) => (typeof s === "string" ? s : s.name || s.player || "")).filter(Boolean);
  try {
    const j = JSON.parse(raw);
    if (Array.isArray(j)) return j.map((s) => (typeof s === "string" ? s : s.name || s.player || "")).filter(Boolean);
  } catch {}
  return String(raw)
    .split(/[,;]+/)
    .map((s) => s.replace(/\d+'?\+?\d*/g, "").replace(/\(.*?\)/g, "").trim())
    .filter(Boolean);
}

async function fetchWorldcup(externalId) {
  const [matches, teams] = await Promise.all([
    getJSON(`${WC_BASE}/football.matches.json`, 60 * 1000),
    getJSON(`${WC_BASE}/football.teams.json`, 24 * 3600 * 1000),
  ]);
  const m = matches.find((x) => String(x.id) === String(externalId));
  if (!m) return null;

  const nameById = (id) => (teams.find((t) => String(t.id) === String(id)) || {}).name_en || "";
  const brazilHome = nameById(m.home_team_id).toLowerCase().includes("bra");

  const brScore = Number(brazilHome ? m.home_score : m.away_score) || 0;
  const opScore = Number(brazilHome ? m.away_score : m.home_score) || 0;
  const scorers = parseScorers(brazilHome ? m.home_scorers : m.away_scorers);

  const finished = String(m.finished).toUpperCase() === "TRUE";
  const elapsed = m.time_elapsed;
  const started = finished || (elapsed && elapsed !== "notstarted");

  return {
    finished,
    homeScore: started ? brScore : null, // nosso mandante é sempre o Brasil
    awayScore: started ? opScore : null,
    scorers,
    minute: started && !finished ? elapsed : null,
    stats: {},
  };
}

/* ----------------------- provedor: api-football ----------------------- */
const AF_BASE = process.env.API_FOOTBALL_BASE || "https://v3.football.api-sports.io";
const FINISHED = new Set(["FT", "AET", "PEN"]);
const STAT_KEYS = { "Ball Possession": "possession", "Corner Kicks": "corners", Fouls: "fouls", "Yellow Cards": "yellow", "Total Shots": "shots" };
const num = (v) => { const n = parseInt(String(v ?? "").replace(/[^\d-]/g, ""), 10); return Number.isFinite(n) ? n : 0; };

async function afGet(pathQuery) {
  const json = await getJSON(`${AF_BASE}${pathQuery}`, 30 * 1000, { "x-apisports-key": KEY });
  return json.response || [];
}

async function fetchApiFootball(externalId, { brazilSide } = {}) {
  const fixtures = await afGet(`/fixtures?id=${encodeURIComponent(externalId)}`);
  const fx = fixtures[0];
  if (!fx) return null;
  const homeId = fx.teams?.home?.id;
  const awayId = fx.teams?.away?.id;
  const out = { finished: FINISHED.has(fx.fixture?.status?.short), homeScore: fx.goals?.home ?? null, awayScore: fx.goals?.away ?? null, minute: fx.fixture?.status?.elapsed || null, stats: {}, scorers: [] };
  try {
    const stats = await afGet(`/fixtures/statistics?fixture=${encodeURIComponent(externalId)}`);
    for (const ts of stats) {
      const side = ts.team?.id === homeId ? "Home" : ts.team?.id === awayId ? "Away" : null;
      if (!side) continue;
      for (const it of ts.statistics || []) { const k = STAT_KEYS[it.type]; if (k) out.stats[k + side] = num(it.value); }
    }
  } catch {}
  try {
    const events = await afGet(`/fixtures/events?fixture=${encodeURIComponent(externalId)}`);
    const wantId = brazilSide === "away" ? awayId : homeId;
    out.scorers = events.filter((e) => e.type === "Goal" && (brazilSide ? e.team?.id === wantId : true) && e.player?.name).map((e) => e.player.name);
  } catch {}
  return out;
}

/* ------------------------------ dispatch ------------------------------ */
export async function fetchFixture(externalId, opts = {}) {
  if (!liveEnabled() || !externalId) return null;
  try {
    if (PROVIDER === "apifootball") return await fetchApiFootball(externalId, opts);
    return await fetchWorldcup(externalId);
  } catch {
    return null; // mantém o modo manual em caso de falha
  }
}
