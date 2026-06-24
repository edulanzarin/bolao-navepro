// Pontuação do bolão: placar por proximidade + perguntas especiais.
// O placar exato é a nota máxima; os demais critérios somam entre si.
// Cada pergunta especial tem seus próprios pontos (ver scoreQuestions).

export const RULES = {
  EXACT: 12,
  RESULT: 5,
  GOAL_DIFF: 3,
  TEAM_GOALS: 1,
};

const sign = (n) => (n > 0 ? 1 : n < 0 ? -1 : 0);
const norm = (s) => String(s).trim().toLowerCase();

export function scoreQuestions(questions, official, answers) {
  let pts = 0;
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
      pts += Math.min(hits, cap) * (q.points || 0);
    } else if (q.type === "number") {
      const o = Number(ov);
      const p = Number(pv);
      if (Number.isFinite(o) && Number.isFinite(p)) {
        if (p === o) pts += q.points || 0;
        else if (Math.abs(p - o) === 1) pts += Math.ceil((q.points || 0) / 2);
      }
    } else {
      // choice / texto
      if (pv !== undefined && pv !== null && norm(pv) === norm(ov)) pts += q.points || 0;
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
  } else {
    if (sign(pHome - pAway) === sign(oHome - oAway)) points += RULES.RESULT;
    if (pHome - pAway === oHome - oAway) points += RULES.GOAL_DIFF;
    if (pHome === oHome) points += RULES.TEAM_GOALS;
    if (pAway === oAway) points += RULES.TEAM_GOALS;
  }

  points += scoreQuestions(official.questions, official.answers, pred.answers);
  return points;
}
