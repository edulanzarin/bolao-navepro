import Database from "better-sqlite3";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, "data");
if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });

const db = new Database(path.join(DATA_DIR, "bolao.db"));
db.pragma("journal_mode = WAL");

db.exec(`
  CREATE TABLE IF NOT EXISTS matches (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    home_team     TEXT NOT NULL,
    away_team     TEXT NOT NULL,
    home_flag     TEXT,
    away_flag     TEXT,
    match_date    TEXT,
    lock_at       TEXT,
    venue         TEXT,
    status        TEXT NOT NULL DEFAULT 'open',
    category      TEXT NOT NULL DEFAULT 'brazil',  -- brazil | others
    external_id   TEXT,                             -- id do jogo no provedor de dados (API-Football)
    home_score    INTEGER,
    away_score    INTEGER,
    questions     TEXT DEFAULT '[]',   -- definição das perguntas especiais (JSON)
    answers       TEXT DEFAULT '{}',   -- respostas oficiais das perguntas (JSON)
    stats         TEXT DEFAULT '{}',   -- estatísticas oficiais (posse, escanteios, faltas...) (JSON)
    created_at    TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS settings (
    id    INTEGER PRIMARY KEY CHECK (id = 1),
    data  TEXT NOT NULL
  );
`);

const matchCols = db.prepare("PRAGMA table_info(matches)").all();
if (!matchCols.some((c) => c.name === "venue")) db.exec("ALTER TABLE matches ADD COLUMN venue TEXT");
if (!matchCols.some((c) => c.name === "lock_at")) db.exec("ALTER TABLE matches ADD COLUMN lock_at TEXT");
if (!matchCols.some((c) => c.name === "questions")) db.exec("ALTER TABLE matches ADD COLUMN questions TEXT DEFAULT '[]'");
if (!matchCols.some((c) => c.name === "answers")) db.exec("ALTER TABLE matches ADD COLUMN answers TEXT DEFAULT '{}'");
if (!matchCols.some((c) => c.name === "category")) db.exec("ALTER TABLE matches ADD COLUMN category TEXT NOT NULL DEFAULT 'brazil'");
if (!matchCols.some((c) => c.name === "external_id")) db.exec("ALTER TABLE matches ADD COLUMN external_id TEXT");
if (!matchCols.some((c) => c.name === "stats")) db.exec("ALTER TABLE matches ADD COLUMN stats TEXT DEFAULT '{}'");

/* ---- Palpites: identidade por CPF/CNPJ (1 palpite por documento/partida) ---- */
const predCols = db.prepare("PRAGMA table_info(predictions)").all();
if (predCols.length && !predCols.some((c) => c.name === "answers")) {
  db.exec("DROP TABLE predictions"); // esquema antigo (pré-lançamento)
}

db.exec(`
  CREATE TABLE IF NOT EXISTS predictions (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    match_id      INTEGER NOT NULL,
    participant   TEXT NOT NULL,
    document      TEXT NOT NULL,
    doc_type      TEXT,
    email         TEXT NOT NULL,
    phone         TEXT,
    home_score    INTEGER NOT NULL,
    away_score    INTEGER NOT NULL,
    answers       TEXT NOT NULL DEFAULT '{}',  -- respostas das perguntas especiais (JSON)
    points        INTEGER NOT NULL DEFAULT 0,
    created_at    TEXT NOT NULL DEFAULT (datetime('now')),
    FOREIGN KEY (match_id) REFERENCES matches(id) ON DELETE CASCADE,
    UNIQUE (match_id, document)
  );
`);

/* ---- Configurações (premiação etc.) ---- */
const DEFAULT_SETTINGS = {
  subtitle: "Acerte o placar, crave os detalhes e suba no ranking. Premiação exclusiva NAVEPRO.",
  prizes: [
    { place: 1, prize: "Voucher R$ 300" },
    { place: 2, prize: "Voucher R$ 200" },
    { place: 3, prize: "Voucher R$ 150" },
    { place: 4, prize: "Voucher R$ 100" },
    { place: 5, prize: "Voucher R$ 100" },
  ],
};
if (!db.prepare("SELECT data FROM settings WHERE id = 1").get()) {
  db.prepare("INSERT INTO settings (id, data) VALUES (1, ?)").run(JSON.stringify(DEFAULT_SETTINGS));
}

/* ---- Perguntas especiais padrão para a partida inicial ---- */
const DEFAULT_QUESTIONS = [
  { id: "scorers", type: "players", label: "Quem marca gol pelo Brasil?", points: 3, max: 3 },
  { id: "fouls", type: "choice", label: "Quantas faltas na partida?", points: 3, options: ["Até 21", "22 a 25", "26 a 29", "30 ou mais"] },
  { id: "corners", type: "choice", label: "Total de escanteios?", points: 3, options: ["Até 6", "7 a 9", "10 a 12", "13 ou mais"] },
  { id: "yellowCards", type: "choice", label: "Cartões amarelos no jogo?", points: 2, options: ["0 a 2", "3 a 4", "5 a 6", "7 ou mais"] },
];

if (db.prepare("SELECT COUNT(*) AS n FROM matches").get().n === 0) {
  db.prepare(
    `INSERT INTO matches (home_team, away_team, home_flag, away_flag, match_date, lock_at, venue, questions, answers, status)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, '{}', 'open')`
  ).run(
    "Brasil",
    "Escócia",
    "https://flagcdn.com/w320/br.png",
    "https://flagcdn.com/w320/gb-sct.png",
    "2026-06-24T19:00:00-03:00",
    "2026-06-24T18:50:00-03:00",
    "Hard Rock Stadium · Miami",
    JSON.stringify(DEFAULT_QUESTIONS)
  );
}

export default db;
