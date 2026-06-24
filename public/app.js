const $ = (sel) => document.querySelector(sel);
const TZ = "America/Sao_Paulo";

let matches = [];
let currentMatch = null;
let currentDetail = null;
let userPinned = false;
let rankingMode = "geral";
let lockTime = null;
let kickoffTime = null;

const ICONS = {
  trophy: '<svg class="ic" viewBox="0 0 24 24"><path d="M6 9H4.5a2.5 2.5 0 0 1 0-5H6"/><path d="M18 9h1.5a2.5 2.5 0 0 0 0-5H18"/><path d="M4 22h16"/><path d="M10 14.66V17c0 .55-.47.98-.97 1.21C7.85 18.75 7 20.24 7 22"/><path d="M14 14.66V17c0 .55.47.98.97 1.21C16.15 18.75 17 20.24 17 22"/><path d="M18 2H6v7a6 6 0 0 0 12 0V2Z"/></svg>',
  medal: '<svg class="ic" viewBox="0 0 24 24"><circle cx="12" cy="8" r="6"/><path d="M15.48 12.89 17 22l-5-3-5 3 1.52-9.11"/></svg>',
  check: '<svg class="ic" viewBox="0 0 24 24"><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/><polyline points="22 4 12 14.01 9 11.01"/></svg>',
};
const icon = (n) => ICONS[n] || "";

const fmtFull = (iso) => {
  if (!iso) return "A definir";
  const d = new Date(iso);
  if (isNaN(d)) return iso;
  const date = d.toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit", year: "numeric", timeZone: TZ });
  const time = d.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit", timeZone: TZ });
  return `${date} · ${time}h (Brasília)`;
};

const flagHTML = (flag) => {
  if (!flag) return "🏳️";
  if (/^https?:\/\//.test(flag)) return `<img src="${flag}" alt="" />`;
  return flag;
};

async function api(path, opts) {
  const res = await fetch(path, opts);
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || "Erro inesperado.");
  return data;
}

function escapeHTML(s) {
  return String(s).replace(/[&<>"']/g, (c) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c])
  );
}

function squadOptions() {
  if (!window.BRAZIL_SQUAD) return "";
  return window.BRAZIL_SQUAD.map((b) =>
    `<optgroup label="${b.group}">${b.players.map((p) => `<option value="${escapeHTML(p)}">${escapeHTML(p)}</option>`).join("")}</optgroup>`
  ).join("");
}

function matchLockMs(m) {
  const t = (m.lock_at || m.match_date) ? new Date(m.lock_at || m.match_date).getTime() : null;
  return Number.isNaN(t) ? null : t;
}
function isClosed(m) {
  if (!m) return true;
  if (m.status !== "open") return true;
  const t = matchLockMs(m);
  return t !== null && Date.now() >= t;
}

/* ---------- steppers (delegação: vale para placar e perguntas) ---------- */
document.addEventListener("click", (e) => {
  const btn = e.target.closest(".step-btn");
  if (!btn) return;
  const input = document.getElementById(btn.dataset.target);
  if (!input || input.disabled) return;
  const max = Number(input.dataset.max || 20);
  let v = (parseInt(input.value, 10) || 0) + (btn.dataset.step === "up" ? 1 : -1);
  v = Math.max(0, Math.min(max, v));
  input.value = v;
  input.parentElement.classList.add("bump");
  setTimeout(() => input.parentElement.classList.remove("bump"), 150);
});

/* ---------- opções (choice) ---------- */
document.addEventListener("click", (e) => {
  const opt = e.target.closest(".q-opt");
  if (!opt || opt.classList.contains("disabled")) return;
  const group = opt.closest(".q-options");
  group.querySelectorAll(".q-opt").forEach((o) => o.classList.remove("selected"));
  opt.classList.add("selected");
});

/* ---------- perguntas especiais ---------- */
function renderQuestions(m) {
  const box = $("#questionsBox");
  const qs = m.questions || [];
  if (!qs.length) { box.innerHTML = `<p class="empty">Esta partida não tem perguntas especiais.</p>`; $("#qHint").textContent = ""; return; }
  $("#qHint").textContent = "(valem pontos extras)";

  box.innerHTML = qs.map((q) => {
    let body = "";
    if (q.type === "players") {
      const n = q.max || 3;
      body = `<div class="q-players">${Array.from({ length: n }).map(() =>
        `<div class="select-wrap"><select class="q-player" data-qid="${q.id}">
          <option value="">Selecionar jogador</option>${squadOptions()}
        </select></div>`).join("")}</div>`;
    } else if (q.type === "number") {
      body = `<div class="sb-stepper q-number">
        <button type="button" class="step-btn" data-step="down" data-target="q_${q.id}">−</button>
        <input type="text" inputmode="numeric" id="q_${q.id}" class="score-display q-input" data-qid="${q.id}" data-max="${q.max || 20}" value="0" readonly />
        <button type="button" class="step-btn" data-step="up" data-target="q_${q.id}">+</button>
      </div>`;
    } else {
      body = `<div class="q-options" data-qid="${q.id}">${(q.options || []).map((o) =>
        `<button type="button" class="q-opt" data-value="${escapeHTML(o)}">${escapeHTML(o)}</button>`).join("")}</div>`;
    }
    const pts = q.type === "players" ? `+${q.points} pts / jogador` : `${q.points} pts`;
    return `<div class="q-card">
      <div class="q-head"><span class="q-label">${escapeHTML(q.label)}</span><span class="q-pts">${pts}</span></div>
      ${body}
    </div>`;
  }).join("");
}

function collectAnswers(m) {
  const ans = {};
  for (const q of m.questions || []) {
    if (q.type === "players") {
      const vals = [...document.querySelectorAll(`.q-player[data-qid="${q.id}"]`)].map((s) => s.value).filter(Boolean);
      if (vals.length) ans[q.id] = [...new Set(vals)];
    } else if (q.type === "number") {
      const el = document.getElementById(`q_${q.id}`);
      if (el) ans[q.id] = Number(el.value) || 0;
    } else {
      const sel = document.querySelector(`.q-options[data-qid="${q.id}"] .q-opt.selected`);
      if (sel) ans[q.id] = sel.dataset.value;
    }
  }
  return ans;
}

function answersSummary(m, ans) {
  const parts = [];
  for (const q of m.questions || []) {
    const v = ans[q.id];
    if (v === undefined || v === null || v === "" || (Array.isArray(v) && !v.length)) continue;
    parts.push({ label: q.label, value: Array.isArray(v) ? v.join(", ") : String(v) });
  }
  return parts;
}

/* ---------- máscara CPF/CNPJ ---------- */
function setupDocMask() {
  const inp = $("#document");
  inp.addEventListener("input", () => {
    if (window.DocUtils) inp.value = window.DocUtils.formatDocument(inp.value);
    const v = window.DocUtils ? window.DocUtils.validateDocument(inp.value) : { valid: true, normalized: "" };
    inp.classList.toggle("input-ok", v.valid);
    inp.classList.toggle("input-bad", !v.valid && v.normalized.length >= 11);
  });
}

/* ---------- wizard ---------- */
let wStep = 1;
const W_TOTAL = 4;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function showStep(n) {
  wStep = Math.max(1, Math.min(W_TOTAL, n));
  document.querySelectorAll(".wstep").forEach((el) => el.classList.toggle("active", Number(el.dataset.step) === wStep));
  document.querySelectorAll(".wp-seg").forEach((el) => el.classList.toggle("active", Number(el.dataset.seg) <= wStep));
  if (wStep === W_TOTAL) renderReview();
}

function validateStep1() {
  const msg = $("#formMsg"); msg.className = "form-msg"; msg.textContent = "";
  const name = $("#participant").value.trim();
  if (name.length < 3 || !name.includes(" ")) return fail("Informe seu nome completo.");
  const doc = window.DocUtils ? window.DocUtils.validateDocument($("#document").value) : { valid: true };
  if (!doc.valid) return fail("CPF ou CNPJ inválido. Confira os números.");
  if ($("#phone").value.replace(/\D/g, "").length < 10) return fail("Informe um telefone válido com DDD.");
  if (!EMAIL_RE.test($("#email").value.trim())) return fail("Informe um e-mail válido.");
  return true;
  function fail(t) { msg.textContent = t; msg.classList.add("err"); return false; }
}

function renderReview() {
  const m = matches.find((x) => x.id === currentMatch);
  if (!m) return;
  const extra = answersSummary(m, collectAnswers(m));
  $("#review").innerHTML = `
    <div class="review-game">
      <div class="flag">${flagHTML(m.home_flag)}</div>
      <span class="review-score">${$("#homeScore").value} <b>×</b> ${$("#awayScore").value}</span>
      <div class="flag">${flagHTML(m.away_flag)}</div>
    </div>
    <div class="review-list">
      <div class="review-row"><span>Jogo</span><strong>${escapeHTML(m.home_team)} x ${escapeHTML(m.away_team)}</strong></div>
      ${extra.map((p) => `<div class="review-row"><span>${escapeHTML(p.label)}</span><strong>${escapeHTML(p.value)}</strong></div>`).join("")}
      <div class="review-row"><span>Nome</span><strong>${escapeHTML($("#participant").value)}</strong></div>
      <div class="review-row"><span>CPF/CNPJ</span><strong>${escapeHTML($("#document").value)}</strong></div>
      <div class="review-row"><span>Telefone</span><strong>${escapeHTML($("#phone").value)}</strong></div>
      <div class="review-row"><span>E-mail</span><strong>${escapeHTML($("#email").value)}</strong></div>
    </div>`;
}

function setupWizard() {
  document.querySelectorAll("[data-next]").forEach((btn) =>
    btn.addEventListener("click", () => {
      if (wStep === 1 && !validateStep1()) return;
      showStep(wStep + 1);
    })
  );
  document.querySelectorAll("[data-prev]").forEach((btn) =>
    btn.addEventListener("click", () => showStep(wStep - 1))
  );
  showStep(1);
}

/* ---------- premiação + pontuação ---------- */
async function renderConfig() {
  try {
    const cfg = await api("/api/config");
    if (cfg.subtitle) $("#heroSub").textContent = cfg.subtitle;
    const prizes = (cfg.prizes || []).slice().sort((a, b) => a.place - b.place);
    $("#prizes").innerHTML = prizes.map((p) => `<li class="prize">
      <span class="medal">${icon("medal")}</span>
      <span class="place">${p.place}º lugar</span>
      <span class="reward">${escapeHTML(p.prize)}</span>
    </li>`).join("");
  } catch {}
}

async function renderRules() {
  try {
    const r = await api("/api/rules");
    $("#tiers").innerHTML = `
      <div class="tier"><div class="tier-pts">${r.EXACT}</div><div class="tier-name">Placar exato</div><p>Cravou o placar certinho? Pontuação máxima.</p></div>
      <div class="tier"><div class="tier-pts">${r.RESULT}</div><div class="tier-name">Resultado certo</div><p>Acertou quem venceu (ou o empate).</p></div>
      <div class="tier"><div class="tier-pts">${r.GOAL_DIFF}</div><div class="tier-name">Saldo de gols</div><p>Acertou a diferença de gols entre as equipes.</p></div>
      <div class="tier"><div class="tier-pts">${r.TEAM_GOALS}</div><div class="tier-name">Gols por equipe</div><p>Por equipe cujo número de gols você acertou.</p></div>
      <div class="tier"><div class="tier-pts">+</div><div class="tier-name">Perguntas especiais</div><p>Marcadores, gols, faltas, escanteios e mais — cada uma vale pontos.</p></div>`;
    $("#rulesFoot").innerHTML =
      `* Placar exato = <strong>${r.EXACT}</strong> · Resultado = <strong>${r.RESULT}</strong> · ` +
      `Saldo = <strong>${r.GOAL_DIFF}</strong> · Gols por equipe = <strong>${r.TEAM_GOALS}</strong> cada · + perguntas especiais`;
  } catch {}
}

/* ---------- contador ---------- */
function setLockNote(m) {
  const note = $("#lockNote");
  if (m.lock_at && m.match_date) {
    const diffMin = Math.round((new Date(m.match_date) - new Date(m.lock_at)) / 60000);
    note.textContent = diffMin > 0 ? `encerra ${diffMin} min antes do jogo` : "encerra no início do jogo";
  } else note.textContent = "encerra no início do jogo";
}
function tickCountdown() {
  const cd = $("#countdown");
  const label = $("#countdownLabel");
  if (lockTime === null) { label.textContent = "Prazo a definir"; setUnits(0, 0, 0, 0); return; }
  let diff = lockTime - Date.now();
  if (diff <= 0) {
    cd.classList.add("ended");
    if (kickoffTime && Date.now() < kickoffTime) {
      label.textContent = "Palpites encerrados · o jogo começa em";
      diff = kickoffTime - Date.now();
    } else { label.textContent = "Palpites encerrados"; setUnits(0, 0, 0, 0); return; }
  } else { cd.classList.remove("ended"); label.textContent = "Tempo para encerrar os palpites"; }
  const s = Math.floor(diff / 1000);
  setUnits(Math.floor(s / 86400), Math.floor((s % 86400) / 3600), Math.floor((s % 3600) / 60), s % 60);
}
function setUnits(d, h, m, s) {
  const p = (n) => String(n).padStart(2, "0");
  $("#cdDays").textContent = p(d); $("#cdHours").textContent = p(h);
  $("#cdMin").textContent = p(m); $("#cdSec").textContent = p(s);
}

/* ---------- carregamento ---------- */
async function loadAll() {
  matches = await api("/api/matches");
  const serverCurrent = matches.find((m) => m.current);
  const fallback = serverCurrent ? serverCurrent.id : (matches[0] && matches[0].id);
  if (!userPinned || !matches.some((m) => m.id === currentMatch)) currentMatch = fallback;
  renderTabs();
  await renderMatch();
  await renderRanking();
}

function renderTabs() {
  const tabs = $("#matchTabs");
  if (matches.length <= 1) { tabs.innerHTML = ""; return; }
  tabs.innerHTML = matches.map((m) => {
    const tag = m.status === "finished" ? "Encerrado" : isClosed(m) ? "Fechado" : "Aberto";
    const live = m.current ? " • atual" : "";
    return `<button class="match-tab ${m.id === currentMatch ? "active" : ""}" data-id="${m.id}">
      ${escapeHTML(m.home_team)} x ${escapeHTML(m.away_team)}<span class="tag">${tag}${live}</span>
    </button>`;
  }).join("");
  tabs.querySelectorAll(".match-tab").forEach((btn) =>
    btn.addEventListener("click", async () => {
      userPinned = true; currentMatch = Number(btn.dataset.id);
      renderTabs(); await renderMatch(); await renderRanking(); showStep(1);
    })
  );
}

async function renderMatch() {
  const m = matches.find((x) => x.id === currentMatch);
  if (!m) return;

  $("#mhTitle").textContent = `${m.home_team} x ${m.away_team}`;
  $("#mhHomeFlag").innerHTML = flagHTML(m.home_flag);
  $("#mhAwayFlag").innerHTML = flagHTML(m.away_flag);
  $("#mhMeta").textContent = [fmtFull(m.match_date), m.venue].filter(Boolean).join(" · ");
  $("#homeName").textContent = m.home_team.toUpperCase();
  $("#awayName").textContent = m.away_team.toUpperCase();
  $("#homeFlag").innerHTML = flagHTML(m.home_flag);
  $("#awayFlag").innerHTML = flagHTML(m.away_flag);

  renderQuestions(m);

  lockTime = matchLockMs(m);
  kickoffTime = m.match_date ? new Date(m.match_date).getTime() : null;
  setLockNote(m);
  tickCountdown();

  const locked = isClosed(m);
  $("#lockedNotice").hidden = !locked;
  ["homeScore", "awayScore", "participant", "document", "phone", "email"].forEach((id) => ($("#" + id).disabled = locked));
  document.querySelectorAll(".step-btn, .wbtn, .q-player, .q-input").forEach((b) => (b.disabled = locked));
  document.querySelectorAll(".q-opt").forEach((b) => b.classList.toggle("disabled", locked));

  const chip = $("#statusChip");
  if (m.status === "finished") { chip.textContent = "Jogo encerrado"; chip.className = "status-chip closed"; }
  else if (locked) { chip.textContent = "Palpites encerrados"; chip.className = "status-chip closed"; }
  else { chip.textContent = "Palpites abertos"; chip.className = "status-chip"; }

  currentDetail = await api(`/api/matches/${m.id}`);
}

/* ---------- ranking ---------- */
async function renderRanking() {
  const wrap = $("#rankingWrap");
  const banner = $("#resultBanner");
  if (currentDetail && currentDetail.home_score !== null && currentDetail.home_score !== undefined) {
    const officialScorers = (currentDetail.answers && currentDetail.answers.scorers) || [];
    let txt = `Resultado oficial: ${currentDetail.home_team} ${currentDetail.home_score} x ${currentDetail.away_score} ${currentDetail.away_team}`;
    if (officialScorers.length) txt += ` · Marcadores: ${officialScorers.join(", ")}`;
    banner.innerHTML = `${icon("check")}<span>${escapeHTML(txt)}</span>`;
    banner.hidden = false;
  } else banner.hidden = true;

  if (rankingMode === "match") {
    const preds = (currentDetail && currentDetail.predictions) || [];
    wrap.innerHTML = `<table class="ranking-table">
      <thead><tr><th>Pos</th><th>Participante</th><th>Pts</th></tr></thead>
      <tbody>${preds.length ? preds.map((p, i) => `<tr>
        <td class="pos">${i + 1}º</td>
        <td>${escapeHTML(p.participant)}</td>
        <td class="pts">${p.points}</td>
      </tr>`).join("") : `<tr><td colspan="3" class="empty">Ainda sem palpites para este jogo.</td></tr>`}</tbody>
    </table>`;
  } else {
    const rows = await api("/api/ranking");
    wrap.innerHTML = `<table class="ranking-table">
      <thead><tr><th>Pos</th><th>Participante</th><th>Pts</th></tr></thead>
      <tbody>${rows.length ? rows.map((r, i) => `<tr>
        <td class="pos">${i + 1}º</td>
        <td>${escapeHTML(r.participant)}</td>
        <td class="pts">${r.points ?? 0}</td>
      </tr>`).join("") : `<tr><td colspan="3" class="empty">Nenhum palpite ainda. Seja o primeiro!</td></tr>`}</tbody>
    </table>`;
  }
}

document.querySelectorAll(".seg-btn").forEach((btn) =>
  btn.addEventListener("click", () => {
    document.querySelectorAll(".seg-btn").forEach((b) => b.classList.remove("active"));
    btn.classList.add("active");
    rankingMode = btn.dataset.mode;
    renderRanking();
  })
);

/* ---------- envio ---------- */
$("#palpiteForm").addEventListener("submit", async (e) => {
  e.preventDefault();
  const msg = $("#formMsg");
  msg.textContent = ""; msg.className = "form-msg";

  if (!validateStep1()) { showStep(1); return; }
  const m = matches.find((x) => x.id === currentMatch);

  try {
    await api("/api/predictions", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        matchId: currentMatch,
        participant: $("#participant").value,
        document: $("#document").value,
        email: $("#email").value,
        phone: $("#phone").value,
        homeScore: $("#homeScore").value,
        awayScore: $("#awayScore").value,
        answers: collectAnswers(m),
      }),
    });
    msg.textContent = "Palpite enviado! Boa sorte.";
    msg.classList.add("ok");
    await renderMatch();
    await renderRanking();
    setTimeout(() => {
      ["participant", "document", "phone", "email"].forEach((id) => ($("#" + id).value = ""));
      $("#homeScore").value = "0"; $("#awayScore").value = "0";
      $("#document").classList.remove("input-ok", "input-bad");
      renderQuestions(m);
      showStep(1);
    }, 4500);
  } catch (err) {
    msg.textContent = err.message;
    msg.classList.add("err");
  }
});

setupDocMask();
setupWizard();
renderConfig();
renderRules();
loadAll();

setInterval(tickCountdown, 1000);
setInterval(loadAll, 30000);
