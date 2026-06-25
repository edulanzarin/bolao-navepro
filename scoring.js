// Pontuação do bolão: placar + perguntas especiais.
//  - Placar EXATO ............ 12 pts
//  - Resultado (quem vence/empate) .. 5 pts
//  - Cada acerto em pergunta especial .. 2 pts (fixo)

export const RULES = {
  EXACT: 12,
  RESULT: 5,
  SPECIAL: 2,
};

const sign = (n) => (n > 0 ? 1 : n < 0 ? -1 : 0);
const norm = (s) => String(s).trim().toLowerCase();

export function scoreQuestions(questions, official, answers) {
  let pts = 0;
  const PER = RULES.SPECIAL; // pontos fixos por acerto especial
  for (const q of questions || []) {
    const ov = official ? official[q.id] : undefined;
    const pv = answers ? answers[q.id] : undefined;
    const officialEmpty =
      ov === undefined || ov === null || ov === "" || (Array.isArray(ov) && ov.length === 0);
    if (officialEmpty) continue; // pergunta ainda não foi respondida oficialmente

    if (q.type === "players") {
      const off = (Array.isArray(ov) ? ov : []).map(norm);
      const guesses = [...new Set((Array.isArray(pv) ? pv : []).map(norm).filter(Boolean))];
      let hits = 0;
      for (const g of guesses) if (off.includes(g)) hits++;
      const cap = q.max || guesses.length;
      pts += Math.min(hits, cap) * PER;
    } else if (q.type === "number") {
      const o = Number(ov);
      const p = Number(pv);
      if (Number.isFinite(o) && Number.isFinite(p) && p === o) pts += PER;
    } else if (q.type === "range") {
      const n = Number(ov);
      if (Number.isFinite(n) && pv != null) {
        const band = (q.bands || []).find(
          (b) => n >= (b.min ?? -Infinity) && n <= (b.max == null ? Infinity : b.max)
        );
        if (band && norm(pv) === norm(band.label)) pts += PER;
      }
    } else {
      if (pv !== undefined && pv !== null && norm(pv) === norm(ov)) pts += PER;
    }
  }
  return pts;
}

export function scorePrediction(pred, official) {
  if (
    !official ||
    official.home_score === null ||
    official.home_score === undefined ||
    official.away_score === null ||
    official.away_score === undefined
  ) {
    // sem placar oficial: ainda assim pontua perguntas já respondidas
    return scoreQuestions(official && official.questions, official && official.answers, pred.answers);
  }

  const pHome = pred.home_score;
  const pAway = pred.away_score;
  const oHome = official.home_score;
  const oAway = official.away_score;

  let points = 0;
  if (pHome === oHome && pAway === oAway) {
    points += RULES.EXACT;
  } else if (sign(pHome - pAway) === sign(oHome - oAway)) {
    points += RULES.RESULT;
  }

  points += scoreQuestions(official.questions, official.answers, pred.answers);
  return points;
}
