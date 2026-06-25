const $ = (sel) => document.querySelector(sel);
const TZ = "America/Sao_Paulo";

let matches = [];
let currentMatch = null;
let currentDetail = null;
let userPinned = false;
let rankingMode = "geral";
let activeCategory = "brazil";
let liveEnabled = false;
let lockTime = null;
let kickoffTime = null;

const ICONS = {
  trophy: '<svg class="ic" viewBox="0 0 24 24"><path d="M6 9H4.5a2.5 2.5 0 0 1 0-5H6"/><path d="M18 9h1.5a2.5 2.5 0 0 0 0-5H18"/><path d="M4 22h16"/><path d="M10 14.66V17c0 .55-.47.98-.97 1.21C7.85 18.75 7 20.24 7 22"/><path d="M14 14.66V17c0 .55.47.98.97 1.21C16.15 18.75 17 20.24 17 22"/><path d="M18 2H6v7a6 6 0 0 0 12 0V2Z"/></svg>',
  medal: '<svg class="ic" viewBox="0 0 24 24"><circle cx="12" cy="8" r="6"/><path d="M15.48 12.89 17 22l-5-3-5 3 1.52-9.11"/></svg>',
  check: '<svg class="ic" viewBox="0 0 24 24"><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/><polyline points="22 4 12 14.01 9 11.01"/></svg>',
  ball: '<svg class="ic" viewBox="0 0 24 24"><circle cx="12" cy="12" r="10"/><path d="m12 7 3.1 2.3-1.2 3.7h-3.8L8.9 9.3 12 7Z"/></svg>',
  flag: '<svg class="ic" viewBox="0 0 24 24"><path d="M4 22V3"/><path d="M4 4h13l-2.2 4L17 12H4"/></svg>',
  card: '<svg class="ic" viewBox="0 0 24 24"><rect x="7" y="3" width="10" height="18" rx="2"/></svg>',
  whistle: '<svg class="ic" viewBox="0 0 24 24"><circle cx="8" cy="14" r="6"/><path d="M14 11.5 21 8M14 14h7"/></svg>',
  percent: '<svg class="ic" viewBox="0 0 24 24"><line x1="19" y1="5" x2="5" y2="19"/><circle cx="6.5" cy="6.5" r="2.5"/><circle cx="17.5" cy="17.5" r="2.5"/></svg>',
  target: '<svg class="ic" viewBox="0 0 24 24"><circle cx="12" cy="12" r="9"/><circle cx="12" cy="12" r="4"/></svg>',
};
const icon = (n) => ICONS[n] || "";
let RULES_DATA = { EXACT: 12, RESULT: 5, GOAL_DIFF: 3, TEAM_GOALS: 1, SPECIAL: 2 };

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
function isLive(m) {
  if (!m || m.status === "finished") return false;
  const k = m.match_date ? new Date(m.match_date).getTime() : 0;
  if (!k) return false;
  const now = Date.now();
  return now >= k && now < k + 3 * 3600000; // do apito até ~3h depois
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

/* ---------- marcadores em "chips" ---------- */
function updateChipAdd(cont) {
  const max = Number(cont.dataset.max) || 3;
  const count = cont.querySelectorAll(".chip").length;
  cont.querySelector(".chip-add").style.display = count >= max ? "none" : "";
}
document.addEventListener("change", (e) => {
  const sel = e.target.closest(".chip-select");
  if (!sel) return;
  const cont = sel.closest(".q-players-chips");
  const max = Number(cont.dataset.max) || 3;
  const chips = cont.querySelector(".chips");
  const val = sel.value;
  sel.value = "";
  if (!val) return;
  const existing = [...chips.querySelectorAll(".chip")].map((c) => c.dataset.value);
  if (existing.includes(val) || existing.length >= max) return;
  const chip = document.createElement("span");
  chip.className = "chip";
  chip.dataset.value = val;
  chip.innerHTML = `${escapeHTML(val)} <button type="button" class="chip-remove" aria-label="remover">×</button>`;
  chips.appendChild(chip);
  updateChipAdd(cont);
});
document.addEventListener("click", (e) => {
  const rm = e.target.closest(".chip-remove");
  if (!rm) return;
  const cont = rm.closest(".q-players-chips");
  rm.closest(".chip").remove();
  updateChipAdd(cont);
});

/* ---------- resultado + estatísticas da partida ---------- */
const STAT_ROWS = [
  ["possession", "Posse de bola", "%", "percent"],
  ["shots", "Finalizações", "", "target"],
  ["corners", "Escanteios", "", "flag"],
  ["fouls", "Faltas", "", "whistle"],
  ["yellow", "Cartões amarelos", "", "card"],
];
function renderStats(m) {
  const sec = $("#statsSection");
  const card = $("#statsCard");
  const d = currentDetail || {};
  const s = d.stats || {};
  const hasResult = d.home_score !== null && d.home_score !== undefined;
  const statRows = STAT_ROWS.filter(([k]) => s[k + "Home"] != null || s[k + "Away"] != null);
  const scorers = (d.answers && d.answers.scorers) || [];

  if (!hasResult && !statRows.length) { sec.hidden = true; return; }
  sec.hidden = false;

  let html = "";
  if (hasResult) {
    const live = isLive(m) && m.status !== "finished";
    html += `<div class="res-score">
      <div class="res-team"><div class="flag">${flagHTML(m.home_flag)}</div><span>${escapeHTML(m.home_team)}</span></div>
      <div class="res-mid">
        <div class="res-nums">${d.home_score} <i>×</i> ${d.away_score}</div>
        <span class="res-tag ${live ? "live" : ""}">${m.status === "finished" ? "Encerrado" : live ? "Ao vivo" + (s.minute ? " · " + escapeHTML(String(s.minute)) : "") : "Parcial"}</span>
      </div>
      <div class="res-team"><div class="flag">${flagHTML(m.away_flag)}</div><span>${escapeHTML(m.away_team)}</span></div>
    </div>`;
    if (scorers.length) {
      html += `<div class="res-scorers">${icon("ball")}<span>${scorers.map(escapeHTML).join(" · ")}</span></div>`;
    }
  }

  if (statRows.length) {
    html += `<div class="stat-block">` + statRows.map(([k, label, suf, ic]) => {
      const h = Number(s[k + "Home"] || 0), a = Number(s[k + "Away"] || 0), tot = h + a || 1;
      return `<div class="stat-line">
        <div class="stat-nums"><span>${h}${suf}</span><em>${icon(ic)} ${escapeHTML(label)}</em><span>${a}${suf}</span></div>
        <div class="stat-bar"><span style="width:${((h / tot) * 100).toFixed(0)}%"></span><i style="width:${((a / tot) * 100).toFixed(0)}%"></i></div>
      </div>`;
    }).join("") + `</div>`;
  } else if (hasResult) {
    html += `<p class="hint-center">Estatísticas detalhadas serão publicadas pela organização.</p>`;
  }
  card.innerHTML = html;
}

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
      body = `<div class="q-players-chips" data-qid="${q.id}" data-max="${n}">
        <div class="chips"></div>
        <div class="select-wrap chip-add">
          <select class="chip-select"><option value="">Selecionar jogador</option>${squadOptions()}</select>
        </div>
        <p class="chip-hint">Escolha até ${n} jogador${n > 1 ? "es" : ""}.</p>
      </div>`;
    } else if (q.type === "number") {
      body = `<div class="sb-stepper q-number">
        <button type="button" class="step-btn" data-step="down" data-target="q_${q.id}">−</button>
        <input type="text" inputmode="numeric" id="q_${q.id}" class="score-display q-input" data-qid="${q.id}" data-max="${q.max || 20}" value="0" readonly />
        <button type="button" class="step-btn" data-step="up" data-target="q_${q.id}">+</button>
      </div>`;
    } else if (q.type === "range") {
      body = `<div class="q-options" data-qid="${q.id}">${(q.bands || []).map((b) =>
        `<button type="button" class="q-opt" data-value="${escapeHTML(b.label)}">${escapeHTML(b.label)}</button>`).join("")}</div>`;
    } else {
      body = `<div class="q-options" data-qid="${q.id}">${(q.options || []).map((o) =>
        `<button type="button" class="q-opt" data-value="${escapeHTML(o)}">${escapeHTML(o)}</button>`).join("")}</div>`;
    }
    const pts = q.type === "players" ? `+${RULES_DATA.SPECIAL} pts por jogador` : `+${RULES_DATA.SPECIAL} pts`;
    return `<div class="q-card">
      <div class="q-head"><span class="q-label">${q.icon ? icon(q.icon) : ""}${escapeHTML(q.label)}</span><span class="q-pts">${pts}</span></div>
      ${body}
    </div>`;
  }).join("");
}

function collectAnswers(m) {
  const ans = {};
  for (const q of m.questions || []) {
    if (q.type === "players") {
      const cont = document.querySelector(`.q-players-chips[data-qid="${q.id}"]`);
      const vals = cont ? [...cont.querySelectorAll(".chip")].map((c) => c.dataset.value) : [];
      if (vals.length) ans[q.id] = vals;
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
    liveEnabled = !!cfg.live;
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
    RULES_DATA = { ...RULES_DATA, ...r };
    $("#tiers").innerHTML = `
      <div class="tier"><div class="tier-pts">${r.EXACT}</div><div class="tier-name">Placar exato</div><p>Cravou o placar certinho? Pontuação máxima.</p></div>
      <div class="tier"><div class="tier-pts">${r.RESULT}</div><div class="tier-name">Quem ganha</div><p>Acertou o vencedor (ou o empate), mas não o placar.</p></div>
      <div class="tier tier-special"><div class="tier-pts">+${r.SPECIAL}</div><div class="tier-name">Cada pergunta especial</div><p>Marcador, faltas, escanteios, cartões... cada acerto vale ${r.SPECIAL} pts.</p></div>`;
    $("#rulesFoot").innerHTML =
      `Placar exato <strong>${r.EXACT}</strong> · Quem ganha <strong>${r.RESULT}</strong> · cada pergunta especial <strong>+${r.SPECIAL}</strong>`;
  } catch {}
}

/* ---------- contador ---------- */
function setLockNote(m) {
  const note = $("#lockNote");
  if (m.lock_at && m.match_date) {
    const diffMin = Math.round((new Date(m.match_date) - new Date(m.lock_at)) / 60000);
    if (diffMin <= 0) note.textContent = "encerra no início do jogo";
    else if (diffMin % 60 === 0) note.textContent = `encerra ${diffMin / 60}h antes do jogo`;
    else note.textContent = `encerra ${diffMin} min antes do jogo`;
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
const catMatches = () => matches.filter((m) => (m.category || "brazil") === activeCategory);

async function loadAll() {
  matches = await api("/api/matches");
  const list = catMatches();
  const serverCurrent = list.find((m) => m.current);
  const fallback = serverCurrent ? serverCurrent.id : (list[0] && list[0].id);
  if (!userPinned || !list.some((m) => m.id === currentMatch)) currentMatch = fallback ?? null;
  renderTabs();
  await renderMatch();
  await renderRanking();
}

function renderTabs() {
  const tabs = $("#matchTabs");
  const list = catMatches();
  if (list.length <= 1) { tabs.innerHTML = ""; return; }
  tabs.innerHTML = list.map((m) => {
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

document.querySelectorAll(".cat-tab").forEach((btn) =>
  btn.addEventListener("click", () => {
    if (btn.disabled) return;
    document.querySelectorAll(".cat-tab").forEach((b) => b.classList.remove("active"));
    btn.classList.add("active");
    activeCategory = btn.dataset.cat;
    userPinned = false;
    loadAll();
  })
);

async function renderMatch() {
  const m = matches.find((x) => x.id === currentMatch);
  if (!m) return;

  $("#bHome").textContent = m.home_team.toUpperCase();
  $("#bAway").textContent = m.away_team.toUpperCase();
  $("#bHomeFlag").innerHTML = flagHTML(m.home_flag);
  $("#bAwayFlag").innerHTML = flagHTML(m.away_flag);
  $("#bMeta").textContent = [fmtFull(m.match_date), m.venue].filter(Boolean).join(" · ");
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
  document.querySelectorAll(".step-btn, .wbtn, .q-input, .chip-select, .chip-remove").forEach((b) => (b.disabled = locked));
  document.querySelectorAll(".q-opt").forEach((b) => b.classList.toggle("disabled", locked));

  const chip = $("#statusChip");
  if (m.status === "finished") { chip.textContent = "Jogo encerrado"; chip.className = "status-chip closed"; }
  else if (isLive(m)) { chip.textContent = "AO VIVO"; chip.className = "status-chip live"; }
  else if (locked) { chip.textContent = "Palpites encerrados"; chip.className = "status-chip closed"; }
  else { chip.textContent = "Palpites abertos"; chip.className = "status-chip"; }

  currentDetail = await api(`/api/matches/${m.id}`);
  renderStats(m);

  // mostra o minuto no selo AO VIVO, se a integração trouxer
  if (isLive(m) && m.status !== "finished" && currentDetail.stats && currentDetail.stats.minute) {
    const min = String(currentDetail.stats.minute);
    chip.innerHTML = `AO VIVO · ${escapeHTML(min)}${/^\d+$/.test(min) ? "'" : ""}`;
    chip.className = "status-chip live";
  }
}

/* ---------- ranking ---------- */
async function renderRanking() {
  const wrap = $("#rankingWrap");
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
    const data = await api("/api/predictions", {
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
    msg.textContent = data.updated ? "Palpite atualizado com sucesso!" : "Palpite enviado! Boa sorte.";
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

// atualiza mais rápido quando o jogo está ao vivo
function scheduleRefresh() {
  const m = matches.find((x) => x.id === currentMatch);
  const delay = liveEnabled && isLive(m) ? 15000 : 30000;
  setTimeout(async () => { await loadAll(); scheduleRefresh(); }, delay);
}
scheduleRefresh();
