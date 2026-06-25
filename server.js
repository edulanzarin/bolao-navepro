import express from "express";
import path from "node:path";
import { fileURLToPath } from "node:url";
import db from "./db.js";
import { scorePrediction, RULES } from "./scoring.js";
import { validateDocument } from "./validators.js";
import { liveEnabled, fetchFixture } from "./live.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const PORT = process.env.PORT || 3000;
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || "navepro2026";

const app = express();
app.use(express.json());
app.use(express.static(path.join(__dirname, "public")));

/* ----------------------------- helpers ----------------------------- */

function parseMatch(row) {
  if (!row) return row;
  let questions = [];
  let answers = {};
  let stats = {};
  try { questions = JSON.parse(row.questions || "[]"); } catch {}
  try { answers = JSON.parse(row.answers || "{}"); } catch {}
  try { stats = JSON.parse(row.stats || "{}"); } catch {}
  return { ...row, questions, answers, stats };
}

function parsePred(row) {
  if (!row) return row;
  let answers = {};
  try { answers = JSON.parse(row.answers || "{}"); } catch {}
  return { ...row, answers };
}

function recalcMatchPoints(matchId) {
  const match = parseMatch(
    db.prepare("SELECT * FROM matches WHERE id = ?").get(matchId)
  );
  if (!match) return;
  const preds = db
    .prepare("SELECT * FROM predictions WHERE match_id = ?")
    .all(matchId)
    .map(parsePred);
  const update = db.prepare("UPDATE predictions SET points = ? WHERE id = ?");
  const tx = db.transaction(() => {
    for (const p of preds) {
      update.run(scorePrediction(p, match), p.id);
    }
  });
  tx();
}

// Define qual partida é a "atual" (a que deve aparecer por padrão).
// Regra: a partida mais próxima que ainda não terminou; durante e até ~3h após
// o apito ela continua sendo a atual; depois disso rola para a próxima.
// Se todas já passaram, mantém a última (mais recente).
function currentMatchId(rows) {
  if (!rows || !rows.length) return null;
  const now = Date.now();
  const GRACE_MS = 3 * 60 * 60 * 1000; // 3h após o início
  const byDate = [...rows].sort(
    (a, b) => new Date(a.match_date || 0) - new Date(b.match_date || 0)
  );
  for (const m of byDate) {
    if (m.status === "finished") continue;
    const kickoff = m.match_date ? new Date(m.match_date).getTime() : 0;
    if (!m.match_date || now <= kickoff + GRACE_MS) return m.id;
  }
  // nenhuma futura/aberta: usa a de data mais recente
  return byDate[byDate.length - 1].id;
}

function requireAdmin(req, res, next) {
  const pass = req.headers["x-admin-password"] || req.query.password;
  if (pass !== ADMIN_PASSWORD) {
    return res.status(401).json({ error: "Senha de administrador inválida." });
  }
  next();
}

/* ------------------------------ public API ------------------------------ */

app.get("/api/rules", (_req, res) => res.json(RULES));

// Configurações públicas (premiação, subtítulo)
app.get("/api/config", (_req, res) => {
  const row = db.prepare("SELECT data FROM settings WHERE id = 1").get();
  res.json(row ? JSON.parse(row.data) : {});
});

// Lista de partidas
app.get("/api/matches", (_req, res) => {
  const rows = db
    .prepare("SELECT * FROM matches ORDER BY datetime(match_date) ASC, id ASC")
    .all()
    .map(parseMatch);
  const current = currentMatchId(rows);
  res.json(rows.map((m) => ({ ...m, current: m.id === current })));
});

// Detalhe de uma partida (PÚBLICO). Os palpites de terceiros não expõem placar
// nem respostas — apenas participante e pontos — para ninguém copiar.
app.get("/api/matches/:id", (req, res) => {
  const match = parseMatch(
    db.prepare("SELECT * FROM matches WHERE id = ?").get(req.params.id)
  );
  if (!match) return res.status(404).json({ error: "Partida não encontrada." });
  const predictions = db
    .prepare(
      "SELECT id, participant, points, created_at FROM predictions WHERE match_id = ? ORDER BY points DESC, datetime(created_at) ASC"
    )
    .all(match.id);
  res.json({ ...match, predictions });
});

// sanitiza as respostas das perguntas conforme a definição da partida
function sanitizeAnswers(questions, raw) {
  const out = {};
  for (const q of questions || []) {
    const v = raw ? raw[q.id] : undefined;
    if (v === undefined || v === null || v === "") continue;
    if (q.type === "players") {
      const arr = (Array.isArray(v) ? v : [v])
        .map((s) => String(s).trim())
        .filter(Boolean)
        .slice(0, q.max || 5);
      if (arr.length) out[q.id] = [...new Set(arr)];
    } else if (q.type === "number") {
      const n = Number(v);
      if (Number.isInteger(n) && n >= 0 && n <= (q.max || 100)) out[q.id] = n;
    } else {
      const s = String(v).trim();
      if (!q.options || q.options.includes(s)) out[q.id] = s;
    }
  }
  return out;
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

// Registra o palpite. Cada CPF/CNPJ pode palpitar uma única vez por partida.
app.post("/api/predictions", (req, res) => {
  const { matchId, participant, document, email, phone, homeScore, awayScore, answers } =
    req.body || {};

  const name = String(participant || "").trim();
  if (!matchId || name.length < 3 || !name.includes(" ")) {
    return res.status(400).json({ error: "Informe seu nome completo." });
  }

  const doc = validateDocument(document);
  if (!doc.valid) {
    return res.status(400).json({ error: "CPF ou CNPJ inválido. Confira os números." });
  }

  const mail = String(email || "").trim().toLowerCase();
  if (!EMAIL_RE.test(mail)) {
    return res.status(400).json({ error: "Informe um e-mail válido." });
  }

  const tel = String(phone || "").trim();
  if (tel.replace(/\D/g, "").length < 10) {
    return res.status(400).json({ error: "Informe um telefone válido com DDD." });
  }

  const h = Number(homeScore);
  const a = Number(awayScore);
  if (!Number.isInteger(h) || !Number.isInteger(a) || h < 0 || a < 0 || h > 50 || a > 50) {
    return res.status(400).json({ error: "Placar inválido." });
  }

  const match = parseMatch(db.prepare("SELECT * FROM matches WHERE id = ?").get(matchId));
  if (!match) return res.status(404).json({ error: "Partida não encontrada." });
  if (match.status !== "open") {
    return res.status(403).json({ error: "Os palpites para esta partida estão encerrados." });
  }
  if (match.lock_at && new Date() >= new Date(match.lock_at)) {
    return res.status(403).json({ error: "O tempo para palpitar nesta partida acabou." });
  }

  const ans = JSON.stringify(sanitizeAnswers(match.questions, answers));

  const existing = db
    .prepare("SELECT id FROM predictions WHERE match_id = ? AND document = ?")
    .get(matchId, doc.normalized);
  if (existing) {
    return res.status(409).json({
      error: "Este CPF/CNPJ já enviou um palpite para este jogo. O palpite é único e não pode ser alterado.",
    });
  }

  try {
    db.prepare(
      "INSERT INTO predictions (match_id, participant, document, doc_type, email, phone, home_score, away_score, answers) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)"
    ).run(matchId, name, doc.normalized, doc.type, mail, tel, h, a, ans);
  } catch (e) {
    return res.status(400).json({ error: "Não foi possível salvar o palpite." });
  }

  recalcMatchPoints(matchId);
  res.json({ ok: true });
});

// Ranking acumulado: soma os pontos de cada participante (1 linha por CPF/CNPJ).
app.get("/api/ranking", (_req, res) => {
  const rows = db
    .prepare(
      `SELECT participant,
              SUM(points)   AS points,
              COUNT(*)      AS palpites,
              MIN(datetime(created_at)) AS first_seen
       FROM predictions
       GROUP BY document
       ORDER BY points DESC, first_seen ASC`
    )
    .all();
  res.json(rows);
});

/* ------------------------------ admin API ------------------------------ */

// Detalhe da partida COM dados de contato (somente organizador)
app.get("/api/admin/matches/:id", requireAdmin, (req, res) => {
  const match = parseMatch(
    db.prepare("SELECT * FROM matches WHERE id = ?").get(req.params.id)
  );
  if (!match) return res.status(404).json({ error: "Partida não encontrada." });
  const predictions = db
    .prepare(
      "SELECT id, participant, document, doc_type, email, phone, home_score, away_score, answers, points, created_at FROM predictions WHERE match_id = ? ORDER BY points DESC, datetime(created_at) ASC"
    )
    .all(match.id)
    .map(parsePred);
  res.json({ ...match, predictions });
});

// Criar partida
app.post("/api/admin/matches", requireAdmin, (req, res) => {
  const { homeTeam, awayTeam, homeFlag, awayFlag, matchDate, lockAt, venue, questions, category, externalId } = req.body || {};
  if (!homeTeam || !awayTeam) {
    return res.status(400).json({ error: "Informe os dois times." });
  }
  const q = Array.isArray(questions) ? JSON.stringify(questions) : "[]";
  const cat = category === "others" ? "others" : "brazil";
  const info = db
    .prepare(
      "INSERT INTO matches (home_team, away_team, home_flag, away_flag, match_date, lock_at, venue, questions, category, external_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)"
    )
    .run(homeTeam.trim(), awayTeam.trim(), homeFlag || "", awayFlag || "", matchDate || null, lockAt || null, venue || null, q, cat, externalId || null);
  res.json({ ok: true, id: info.lastInsertRowid });
});

// Editar dados da partida (inclui perguntas e estatísticas manuais)
app.put("/api/admin/matches/:id", requireAdmin, (req, res) => {
  const { homeTeam, awayTeam, homeFlag, awayFlag, matchDate, lockAt, venue, questions, category, externalId, stats } = req.body || {};
  const match = db.prepare("SELECT * FROM matches WHERE id = ?").get(req.params.id);
  if (!match) return res.status(404).json({ error: "Partida não encontrada." });
  const q = Array.isArray(questions) ? JSON.stringify(questions) : match.questions;
  const st = stats && typeof stats === "object" ? JSON.stringify(stats) : match.stats;
  const cat = category === undefined ? match.category : category === "others" ? "others" : "brazil";
  db.prepare(
    "UPDATE matches SET home_team = ?, away_team = ?, home_flag = ?, away_flag = ?, match_date = ?, lock_at = ?, venue = ?, questions = ?, category = ?, external_id = ?, stats = ? WHERE id = ?"
  ).run(
    homeTeam ?? match.home_team,
    awayTeam ?? match.away_team,
    homeFlag ?? match.home_flag,
    awayFlag ?? match.away_flag,
    matchDate ?? match.match_date,
    lockAt ?? match.lock_at,
    venue ?? match.venue,
    q,
    cat,
    externalId ?? match.external_id,
    st,
    match.id
  );
  recalcMatchPoints(match.id);
  res.json({ ok: true });
});

// Atualizar configurações (premiação, subtítulo)
app.put("/api/admin/config", requireAdmin, (req, res) => {
  const current = db.prepare("SELECT data FROM settings WHERE id = 1").get();
  const data = current ? JSON.parse(current.data) : {};
  const { subtitle, prizes } = req.body || {};
  if (typeof subtitle === "string") data.subtitle = subtitle;
  if (Array.isArray(prizes)) {
    data.prizes = prizes
      .map((p, i) => ({ place: Number(p.place) || i + 1, prize: String(p.prize || "").trim() }))
      .filter((p) => p.prize);
  }
  db.prepare("INSERT INTO settings (id, data) VALUES (1, ?) ON CONFLICT(id) DO UPDATE SET data = excluded.data")
    .run(JSON.stringify(data));
  res.json({ ok: true, ...data });
});

// Travar / reabrir palpites
app.put("/api/admin/matches/:id/status", requireAdmin, (req, res) => {
  const { status } = req.body || {};
  if (!["open", "locked", "finished"].includes(status)) {
    return res.status(400).json({ error: "Status inválido." });
  }
  db.prepare("UPDATE matches SET status = ? WHERE id = ?").run(status, req.params.id);
  res.json({ ok: true });
});

// Lançar resultado oficial + respostas das perguntas (recalcula a pontuação)
app.put("/api/admin/matches/:id/result", requireAdmin, (req, res) => {
  const { homeScore, awayScore, answers, finish } = req.body || {};
  const match = parseMatch(db.prepare("SELECT * FROM matches WHERE id = ?").get(req.params.id));
  if (!match) return res.status(404).json({ error: "Partida não encontrada." });

  const h = Number(homeScore);
  const a = Number(awayScore);
  if (!Number.isInteger(h) || !Number.isInteger(a) || h < 0 || a < 0) {
    return res.status(400).json({ error: "Placar oficial inválido." });
  }

  // respostas oficiais: aceita o mesmo formato dos palpites
  const official = sanitizeAnswers(match.questions, answers || {});

  db.prepare(
    "UPDATE matches SET home_score = ?, away_score = ?, answers = ?, status = ? WHERE id = ?"
  ).run(h, a, JSON.stringify(official), finish ? "finished" : match.status, match.id);

  recalcMatchPoints(match.id);
  res.json({ ok: true });
});

// Excluir partida
app.delete("/api/admin/matches/:id", requireAdmin, (req, res) => {
  db.prepare("DELETE FROM matches WHERE id = ?").run(req.params.id);
  res.json({ ok: true });
});

// Excluir um palpite específico
app.delete("/api/admin/predictions/:id", requireAdmin, (req, res) => {
  const pred = db.prepare("SELECT match_id FROM predictions WHERE id = ?").get(req.params.id);
  db.prepare("DELETE FROM predictions WHERE id = ?").run(req.params.id);
  if (pred) recalcMatchPoints(pred.match_id);
  res.json({ ok: true });
});

/* ------------------------------ exportações (CSV) ------------------------------ */

const csvCell = (v) => `"${String(v ?? "").replace(/"/g, '""')}"`;
const csvLine = (cells) => cells.map(csvCell).join(";");

function sendCsv(res, filename, rows) {
  const body = "\uFEFF" + rows.map(csvLine).join("\r\n"); // BOM p/ acentos no Excel
  res.setHeader("Content-Type", "text/csv; charset=utf-8");
  res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
  res.send(body);
}

function docLabel(doc, type) {
  const d = String(doc || "");
  if (type === "cpf" && d.length === 11) return d.replace(/(\d{3})(\d{3})(\d{3})(\d{2})/, "$1.$2.$3-$4");
  if (type === "cnpj" && d.length === 14) return d.replace(/(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})/, "$1.$2.$3/$4-$5");
  return d;
}

// Ranking geral com dados de contato (para premiação)
app.get("/api/admin/export/ranking", requireAdmin, (_req, res) => {
  const rows = db
    .prepare(
      `SELECT p.participant, p.document, p.doc_type, p.email, p.phone, t.points, t.palpites
       FROM (
         SELECT document, SUM(points) AS points, COUNT(*) AS palpites, MAX(id) AS last_id
         FROM predictions GROUP BY document
       ) t
       JOIN predictions p ON p.id = t.last_id
       ORDER BY t.points DESC, p.created_at ASC`
    )
    .all();
  const out = [["Posição", "Participante", "CPF/CNPJ", "E-mail", "Telefone", "Pontos", "Palpites"]];
  rows.forEach((r, i) =>
    out.push([i + 1, r.participant, docLabel(r.document, r.doc_type), r.email, r.phone, r.points, r.palpites])
  );
  sendCsv(res, "ranking-geral.csv", out);
});

// Palpites de uma partida (com respostas e contato)
app.get("/api/admin/export/matches/:id", requireAdmin, (req, res) => {
  const match = parseMatch(db.prepare("SELECT * FROM matches WHERE id = ?").get(req.params.id));
  if (!match) return res.status(404).json({ error: "Partida não encontrada." });
  const preds = db
    .prepare("SELECT * FROM predictions WHERE match_id = ? ORDER BY points DESC, datetime(created_at) ASC")
    .all(match.id)
    .map(parsePred);

  const header = ["Posição", "Participante", "CPF/CNPJ", "E-mail", "Telefone", "Placar", ...match.questions.map((q) => q.label), "Pontos"];
  const out = [header];
  preds.forEach((p, i) => {
    const answers = match.questions.map((q) => {
      const v = p.answers ? p.answers[q.id] : undefined;
      return Array.isArray(v) ? v.join(", ") : v ?? "";
    });
    out.push([
      i + 1, p.participant, docLabel(p.document, p.doc_type), p.email, p.phone,
      `${p.home_score} x ${p.away_score}`, ...answers, p.points,
    ]);
  });
  const slug = `${match.home_team}-${match.away_team}`.toLowerCase().replace(/[^a-z0-9]+/g, "-");
  sendCsv(res, `palpites-${slug}.csv`, out);
});

// Healthcheck (útil pro container/orquestrador)
app.get("/healthz", (_req, res) => res.json({ status: "ok" }));

/* ------------------------- atualização ao vivo (opcional) ------------------------- */

function brazilSideOf(match) {
  if ((match.home_team || "").toLowerCase().includes("bras")) return "home";
  if ((match.away_team || "").toLowerCase().includes("bras")) return "away";
  return null;
}

async function pollLive() {
  const now = Date.now();
  const rows = db
    .prepare("SELECT * FROM matches WHERE external_id IS NOT NULL AND status != 'finished'")
    .all()
    .map(parseMatch);
  for (const m of rows) {
    const kickoff = m.match_date ? new Date(m.match_date).getTime() : 0;
    // só consulta na janela do jogo (10 min antes até 3h depois) para poupar requisições
    if (kickoff && (now < kickoff - 10 * 60000 || now > kickoff + 3 * 3600000)) continue;
    const data = await fetchFixture(m.external_id, { brazilSide: brazilSideOf(m) });
    if (!data) continue;

    const answers = { ...m.answers };
    if (data.scorers && data.scorers.length) answers.scorers = data.scorers;
    const stats = { ...m.stats, ...data.stats };
    const home = data.homeScore ?? m.home_score;
    const away = data.awayScore ?? m.away_score;

    db.prepare(
      "UPDATE matches SET home_score = ?, away_score = ?, stats = ?, answers = ?, status = ? WHERE id = ?"
    ).run(home, away, JSON.stringify(stats), JSON.stringify(answers), data.finished ? "finished" : m.status, m.id);
    recalcMatchPoints(m.id);
  }
}

if (liveEnabled()) {
  console.log("Integração ao vivo (API-Football) ativada.");
  setInterval(() => pollLive().catch(() => {}), 120000);
}

app.listen(PORT, () => {
  console.log(`Bolão NAVEPRO rodando em http://localhost:${PORT}`);
});
