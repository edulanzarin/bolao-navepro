// Integração opcional com o API-Football (api-sports.io) para placar e
// estatísticas ao vivo. Fica inativa enquanto a variável API_FOOTBALL_KEY
// não estiver definida — nesse caso o resultado é lançado manualmente no painel.

const API_BASE = process.env.API_FOOTBALL_BASE || "https://v3.football.api-sports.io";
const KEY = process.env.API_FOOTBALL_KEY || "";

export function liveEnabled() {
  return Boolean(KEY);
}

async function apiGet(pathQuery) {
  const res = await fetch(`${API_BASE}${pathQuery}`, {
    headers: { "x-apisports-key": KEY },
  });
  if (!res.ok) throw new Error(`API-Football respondeu ${res.status}`);
  const json = await res.json();
  return json.response || [];
}

const FINISHED = new Set(["FT", "AET", "PEN"]);

const STAT_KEYS = {
  "Ball Possession": "possession",
  "Corner Kicks": "corners",
  Fouls: "fouls",
  "Yellow Cards": "yellow",
  "Total Shots": "shots",
};

const num = (v) => {
  if (v === null || v === undefined) return 0;
  const n = parseInt(String(v).replace(/[^\d-]/g, ""), 10);
  return Number.isFinite(n) ? n : 0;
};

// Busca placar, estatísticas e marcadores de um jogo pelo id do provedor.
// Retorna null se não conseguir (a chamada falha de forma silenciosa).
export async function fetchFixture(externalId, { brazilSide } = {}) {
  if (!liveEnabled() || !externalId) return null;
  try {
    const fixtures = await apiGet(`/fixtures?id=${encodeURIComponent(externalId)}`);
    const fx = fixtures[0];
    if (!fx) return null;

    const homeId = fx.teams?.home?.id;
    const awayId = fx.teams?.away?.id;
    const out = {
      finished: FINISHED.has(fx.fixture?.status?.short),
      homeScore: fx.goals?.home ?? null,
      awayScore: fx.goals?.away ?? null,
      stats: {},
      scorers: [],
    };

    // Estatísticas por time
    try {
      const stats = await apiGet(`/fixtures/statistics?fixture=${encodeURIComponent(externalId)}`);
      for (const teamStats of stats) {
        const side = teamStats.team?.id === homeId ? "Home" : teamStats.team?.id === awayId ? "Away" : null;
        if (!side) continue;
        for (const item of teamStats.statistics || []) {
          const key = STAT_KEYS[item.type];
          if (key) out.stats[key + side] = num(item.value);
        }
      }
    } catch {}

    // Marcadores (gols) — pelo lado do Brasil, se informado
    try {
      const events = await apiGet(`/fixtures/events?fixture=${encodeURIComponent(externalId)}`);
      const wantId = brazilSide === "away" ? awayId : homeId;
      out.scorers = events
        .filter((e) => e.type === "Goal" && (brazilSide ? e.team?.id === wantId : true) && e.player?.name)
        .map((e) => e.player.name);
    } catch {}

    return out;
  } catch {
    return null; // mantém o modo manual em caso de falha
  }
}
