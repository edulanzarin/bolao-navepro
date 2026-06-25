const $ = (s) => document.querySelector(s);
let PASS = sessionStorage.getItem("adminPass") || "";
const MQ = {}; // perguntas por partida (id -> questions[])

async function api(path, opts = {}) {
  opts.headers = { ...(opts.headers || {}), "x-admin-password": PASS };
  const res = await fetch(path, opts);
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || "Erro inesperado.");
  return data;
}

function escapeHTML(s) {
  return String(s ?? "").replace(/[&<>"']/g, (c) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c])
  );
}

const toLocalInput = (iso) => (iso ? String(iso).slice(0, 16) : "");
const toBrasiliaISO = (v) => (v ? v.slice(0, 16) + ":00-03:00" : null);

function fmtDoc(d) {
  d = String(d || "");
  if (d.length === 11) return d.replace(/(\d{3})(\d{3})(\d{3})(\d{2})/, "$1.$2.$3-$4");
  if (d.length === 14) return d.replace(/(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})/, "$1.$2.$3/$4-$5");
  return d;
}

async function downloadCsv(path, filename) {
  try {
    const res = await fetch(path, { headers: { "x-admin-password": PASS } });
    if (!res.ok) throw new Error("Falha ao exportar.");
    const url = URL.createObjectURL(await res.blob());
    const a = document.createElement("a");
    a.href = url; a.download = filename; a.click();
    URL.revokeObjectURL(url);
  } catch (e) { alert("Erro ao exportar: " + e.message); }
}

// datalist com o elenco para sugerir nomes nos marcadores oficiais
function squadDatalist() {
  if (document.getElementById("squadList")) return;
  const dl = document.createElement("datalist");
  dl.id = "squadList";
  dl.innerHTML = (window.BRAZIL_SQUAD || []).flatMap((b) => b.players).map((n) => `<option value="${escapeHTML(n)}">`).join("");
  document.body.appendChild(dl);
}

async function tryLogin(pass) {
  PASS = pass;
  const res = await fetch("/api/admin/matches/0", { headers: { "x-admin-password": pass } });
  return res.status !== 401;
}

function enterPanel() {
  $("#loginCard").hidden = true;
  $("#panel").hidden = false;
  squadDatalist();
  loadConfig();
  loadMatches();
}

$("#loginBtn").addEventListener("click", async () => {
  const pass = $("#adminPass").value.trim();
  const msg = $("#loginMsg"); msg.className = "form-msg";
  if (await tryLogin(pass)) { sessionStorage.setItem("adminPass", pass); enterPanel(); }
  else { msg.textContent = "Senha incorreta."; msg.classList.add("err"); }
});

/* ----------------------- PREMIAÇÃO ----------------------- */
function prizeRow(place, prize) {
  const div = document.createElement("div");
  div.className = "prize-edit-row";
  div.innerHTML = `<span class="place-label">${place}º</span>
    <input class="prize-input" value="${escapeHTML(prize || "")}" placeholder="Ex: Voucher R$ 100" />
    <button class="btn-ghost danger mini" type="button" data-removeprize>×</button>`;
  div.querySelector("[data-removeprize]").addEventListener("click", () => { div.remove(); renumberPrizes(); });
  return div;
}
function renumberPrizes() {
  [...$("#prizeEditor").children].forEach((row, i) => (row.querySelector(".place-label").textContent = (i + 1) + "º"));
}
async function loadConfig() {
  try {
    const cfg = await api("/api/config");
    $("#cfgSubtitle").value = cfg.subtitle || "";
    const box = $("#prizeEditor"); box.innerHTML = "";
    (cfg.prizes || []).sort((a, b) => a.place - b.place).forEach((p) => box.appendChild(prizeRow(p.place, p.prize)));
  } catch {}
}
$("#addPrizeBtn").addEventListener("click", () => $("#prizeEditor").appendChild(prizeRow($("#prizeEditor").children.length + 1, "")));
$("#exportRankingBtn").addEventListener("click", () => downloadCsv("/api/admin/export/ranking", "ranking-geral.csv"));
$("#saveCfgBtn").addEventListener("click", async () => {
  const msg = $("#cfgMsg"); msg.className = "form-msg";
  const prizes = [...document.querySelectorAll(".prize-input")].map((inp, i) => ({ place: i + 1, prize: inp.value.trim() })).filter((p) => p.prize);
  try {
    await api("/api/admin/config", { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ subtitle: $("#cfgSubtitle").value.trim(), prizes }) });
    msg.textContent = "Premiação salva!"; msg.classList.add("ok");
  } catch (e) { msg.textContent = e.message; msg.classList.add("err"); }
});

/* ----------------------- NOVA PARTIDA ----------------------- */
$("#createBtn").addEventListener("click", async () => {
  const msg = $("#createMsg"); msg.className = "form-msg";
  try {
    await api("/api/admin/matches", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        homeTeam: $("#nHome").value, awayTeam: $("#nAway").value,
        homeFlag: $("#nHomeFlag").value, awayFlag: $("#nAwayFlag").value,
        matchDate: toBrasiliaISO($("#nDate").value), lockAt: toBrasiliaISO($("#nLock").value),
        venue: $("#nVenue").value || null, category: $("#nCategory").value,
      }),
    });
    msg.textContent = "Partida criada! As perguntas padrão já vêm configuradas."; msg.classList.add("ok");
    ["nHome", "nAway", "nHomeFlag", "nAwayFlag", "nDate", "nLock", "nVenue"].forEach((id) => ($("#" + id).value = ""));
    loadMatches();
  } catch (e) { msg.textContent = e.message; msg.classList.add("err"); }
});

/* ----------------------- RESULTADO: campos e coleta ----------------------- */
const STAT_FIELDS = [["possession", "Posse %"], ["shots", "Finalizações"], ["corners", "Escanteios"], ["fouls", "Faltas"], ["yellow", "Cartões"]];

function gatherStats(mid) {
  const s = {};
  for (const [k] of STAT_FIELDS) for (const side of ["Home", "Away"]) {
    const el = document.getElementById(`st-${mid}-${k}${side}`);
    if (el && el.value !== "") s[k + side] = Number(el.value);
  }
  return s;
}

function answerField(mid, q, answers) {
  const cur = answers ? answers[q.id] : undefined;
  if (q.type === "players") {
    const val = Array.isArray(cur) ? cur.join(", ") : "";
    return `<label class="field mini grow"><span>${escapeHTML(q.label)} <small>(quem marcou, por vírgula)</small></span>
      <input type="text" list="squadList" id="qa-${mid}-${q.id}" value="${escapeHTML(val)}" placeholder="Vinícius Jr., Raphinha" /></label>`;
  }
  // range / number → número real
  return `<label class="field mini"><span>${escapeHTML(q.label)} <small>(nº real)</small></span>
    <input type="number" min="0" id="qa-${mid}-${q.id}" value="${cur ?? ""}" /></label>`;
}
function gatherAnswers(mid) {
  const ans = {};
  for (const q of MQ[mid] || []) {
    const el = document.getElementById(`qa-${mid}-${q.id}`);
    if (!el) continue;
    if (q.type === "players") {
      const arr = el.value.split(",").map((s) => s.trim()).filter(Boolean);
      if (arr.length) ans[q.id] = arr;
    } else if (el.value !== "") ans[q.id] = Number(el.value);
  }
  return ans;
}
function answersSummary(questions, answers) {
  return (questions || []).map((q) => {
    const v = answers ? answers[q.id] : undefined;
    if (v === undefined || v === null || v === "" || (Array.isArray(v) && !v.length)) return null;
    return `${escapeHTML(q.label)}: <strong>${escapeHTML(Array.isArray(v) ? v.join(", ") : String(v))}</strong>`;
  }).filter(Boolean).join(" · ");
}

/* ----------------------- LISTA DE PARTIDAS ----------------------- */
async function loadMatches() {
  const matches = await fetch("/api/matches").then((r) => r.json());
  const box = $("#adminMatches");
  if (!matches.length) { box.innerHTML = `<p class="empty">Nenhuma partida cadastrada.</p>`; return; }

  box.innerHTML = "";
  for (const m of matches) {
    const detail = await api(`/api/admin/matches/${m.id}`);
    MQ[m.id] = detail.questions || [];
    const card = document.createElement("div");
    card.className = "admin-match";

    card.innerHTML = `
      <div class="admin-match-head">
        <strong>${escapeHTML(m.home_team)} x ${escapeHTML(m.away_team)} ${m.current ? '<span class="badge badge-open">jogo atual</span>' : ''}</strong>
        <span class="badge badge-${m.status}">${statusLabel(m.status)}</span>
      </div>

      <p class="block-label">Dados da partida</p>
      <div class="admin-row">
        <label class="field mini grow"><span>Data e hora</span><input type="datetime-local" id="md-${m.id}" value="${toLocalInput(m.match_date)}" /></label>
        <label class="field mini grow"><span>Encerrar palpites em</span><input type="datetime-local" id="ml-${m.id}" value="${toLocalInput(m.lock_at)}" /></label>
        <label class="field mini grow"><span>Local</span><input type="text" id="mv-${m.id}" value="${escapeHTML(m.venue || "")}" placeholder="Estádio · Cidade" /></label>
        <label class="field mini"><span>Categoria</span>
          <select id="mc-${m.id}"><option value="brazil" ${m.category !== "others" ? "selected" : ""}>Seleção</option><option value="others" ${m.category === "others" ? "selected" : ""}>Outros</option></select></label>
        <button class="btn-ghost mini" data-act="savemeta" data-id="${m.id}" style="align-self:flex-end;">Salvar dados</button>
      </div>
      <p class="hint-text">Os palpites encerram sozinhos no horário acima — não precisa travar na mão.</p>

      <p class="block-label">Resultado oficial</p>
      <div class="admin-sub">Placar</div>
      <div class="admin-row">
        <label class="field mini"><span>Gols ${escapeHTML(m.home_team)}</span><input type="number" min="0" id="rh-${m.id}" value="${m.home_score ?? ""}" /></label>
        <label class="field mini"><span>Gols ${escapeHTML(m.away_team)}</span><input type="number" min="0" id="ra-${m.id}" value="${m.away_score ?? ""}" /></label>
      </div>
      <div class="admin-sub">Respostas das perguntas <small>(cada acerto vale 2 pts)</small></div>
      <div class="admin-row">
        ${(detail.questions || []).map((q) => answerField(m.id, q, detail.answers)).join("")}
      </div>
      <div class="admin-sub">Estatísticas exibidas no site <small>(opcional)</small></div>
      <div class="admin-row">
        ${STAT_FIELDS.map(([k, label]) => `
          <label class="field mini"><span>${label} · ${escapeHTML(m.home_team)}</span><input type="number" min="0" id="st-${m.id}-${k}Home" value="${detail.stats?.[k + "Home"] ?? ""}" /></label>
          <label class="field mini"><span>${label} · ${escapeHTML(m.away_team)}</span><input type="number" min="0" id="st-${m.id}-${k}Away" value="${detail.stats?.[k + "Away"] ?? ""}" /></label>`).join("")}
      </div>
      <div class="admin-actions">
        <button class="btn-gold mini" data-act="save-result" data-id="${m.id}">Salvar resultado</button>
        ${m.status === "finished"
          ? `<button class="btn-ghost" data-act="reopen" data-id="${m.id}">Reabrir jogo</button>`
          : `<button class="btn-ghost" data-act="finish" data-id="${m.id}">Encerrar e publicar</button>`}
        <button class="btn-ghost" data-act="export" data-id="${m.id}">Exportar palpites</button>
        <button class="btn-ghost danger" data-act="delete" data-id="${m.id}">Excluir partida</button>
      </div>
      <p class="hint-text">"Salvar resultado" recalcula a pontuação na hora. "Encerrar" finaliza o jogo e o site avança para o próximo.</p>

      <details class="admin-preds">
        <summary>${detail.predictions.length} palpite(s) · ver detalhes e contatos</summary>
        <div class="table-scroll">
          <table class="ranking-table">
            <thead><tr><th>Participante</th><th>CPF/CNPJ</th><th>Contato</th><th>Placar</th><th>Respostas</th><th>Pts</th><th></th></tr></thead>
            <tbody>
              ${detail.predictions.map((p) => `<tr>
                <td>${escapeHTML(p.participant)}</td>
                <td><small>${fmtDoc(p.document)}</small></td>
                <td class="contact-cell"><a href="mailto:${escapeHTML(p.email)}">${escapeHTML(p.email)}</a>${p.phone ? `<small>${escapeHTML(p.phone)}</small>` : ""}</td>
                <td><strong>${p.home_score} x ${p.away_score}</strong></td>
                <td><small>${answersSummary(detail.questions, p.answers) || "—"}</small></td>
                <td class="pts">${p.points}</td>
                <td><button class="btn-ghost danger mini" data-act="delpred" data-id="${p.id}">×</button></td>
              </tr>`).join("") || `<tr><td colspan="7" class="empty">Sem palpites.</td></tr>`}
            </tbody>
          </table>
        </div>
      </details>
    `;
    box.appendChild(card);
  }

  box.querySelectorAll("button[data-act]").forEach((btn) =>
    btn.addEventListener("click", () => handleAction(btn.dataset.act, btn.dataset.id))
  );
}

function statusLabel(s) { return { open: "Aberto", locked: "Travado", finished: "Encerrado" }[s] || s; }

async function handleAction(act, id) {
  try {
    if (act === "export") { await downloadCsv(`/api/admin/export/matches/${id}`, `palpites-jogo-${id}.csv`); return; }
    if (act === "savemeta") {
      await api(`/api/admin/matches/${id}`, {
        method: "PUT", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ matchDate: toBrasiliaISO($("#md-" + id).value), lockAt: toBrasiliaISO($("#ml-" + id).value), venue: $("#mv-" + id).value || null, category: $("#mc-" + id).value }),
      });
    } else if (act === "save-result" || act === "finish") {
      const h = $("#rh-" + id).value, a = $("#ra-" + id).value;
      if (h === "" || a === "") { alert("Informe o placar oficial (gols dos dois times)."); return; }
      await api(`/api/admin/matches/${id}/result`, {
        method: "PUT", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ homeScore: h, awayScore: a, answers: gatherAnswers(id), stats: gatherStats(id), finish: act === "finish" }),
      });
    } else if (act === "reopen") {
      await api(`/api/admin/matches/${id}/status`, { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ status: "open" }) });
    } else if (act === "delete") {
      if (!confirm("Excluir esta partida e todos os palpites dela?")) return;
      await api(`/api/admin/matches/${id}`, { method: "DELETE" });
    } else if (act === "delpred") {
      if (!confirm("Excluir este palpite?")) return;
      await api(`/api/admin/predictions/${id}`, { method: "DELETE" });
    }
    loadMatches();
  } catch (e) { alert("Erro: " + e.message); }
}

if (PASS) tryLogin(PASS).then((ok) => { if (ok) enterPanel(); });
