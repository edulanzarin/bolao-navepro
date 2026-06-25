const $ = (s) => document.querySelector(s);
let PASS = sessionStorage.getItem("adminPass") || "";
const MQ = {}; // perguntas salvas por partida (id -> questions[])

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

// download de CSV mantendo a senha no header (fora da URL)
async function downloadCsv(path, filename) {
  try {
    const res = await fetch(path, { headers: { "x-admin-password": PASS } });
    if (!res.ok) throw new Error("Falha ao exportar.");
    const blob = await res.blob();
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url; a.download = filename; a.click();
    URL.revokeObjectURL(url);
  } catch (e) { alert("Erro ao exportar: " + e.message); }
}
function fmtDoc(d) {
  d = String(d || "");
  if (d.length === 11) return d.replace(/(\d{3})(\d{3})(\d{3})(\d{2})/, "$1.$2.$3-$4");
  if (d.length === 14) return d.replace(/(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})/, "$1.$2.$3/$4-$5");
  return d;
}

// datalist com o elenco para sugerir nomes nos marcadores oficiais
function squadDatalist() {
  if (document.getElementById("squadList")) return;
  const dl = document.createElement("datalist");
  dl.id = "squadList";
  const names = (window.BRAZIL_SQUAD || []).flatMap((b) => b.players);
  dl.innerHTML = names.map((n) => `<option value="${escapeHTML(n)}">`).join("");
  document.body.appendChild(dl);
}

async function tryLogin(pass) {
  PASS = pass;
  const res = await fetch("/api/admin/matches/0", {
    headers: { "x-admin-password": pass },
  });
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
  const msg = $("#loginMsg");
  msg.className = "form-msg";
  if (await tryLogin(pass)) { sessionStorage.setItem("adminPass", pass); enterPanel(); }
  else { msg.textContent = "Senha incorreta."; msg.classList.add("err"); }
});

/* ----------------------- PREMIAÇÃO ----------------------- */
function prizeRow(place, prize) {
  const div = document.createElement("div");
  div.className = "prize-edit-row";
  div.innerHTML = `
    <span class="place-label">${place}º</span>
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
    const box = $("#prizeEditor");
    box.innerHTML = "";
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
        externalId: $("#nExternal").value || null,
      }),
    });
    msg.textContent = "Partida criada! Configure as perguntas logo abaixo."; msg.classList.add("ok");
    ["nHome", "nAway", "nHomeFlag", "nAwayFlag", "nDate", "nLock", "nVenue", "nExternal"].forEach((id) => ($("#" + id).value = ""));
    loadMatches();
  } catch (e) { msg.textContent = e.message; msg.classList.add("err"); }
});

/* ----------------------- CONSTRUTOR DE PERGUNTAS ----------------------- */
const QTYPES = { players: "Jogadores (marcadores)", number: "Número", choice: "Múltipla escolha" };
const STAT_FIELDS = [["possession", "Posse %"], ["shots", "Finalizações"], ["corners", "Escanteios"], ["fouls", "Faltas"], ["yellow", "Cartões amarelos"]];

function gatherStats(mid) {
  const s = {};
  for (const [k] of STAT_FIELDS) {
    for (const side of ["Home", "Away"]) {
      const el = document.getElementById(`st-${mid}-${k}${side}`);
      if (el && el.value !== "") s[k + side] = Number(el.value);
    }
  }
  return s;
}

function optRow(value) {
  const row = document.createElement("div");
  row.className = "qe-opt";
  row.innerHTML = `<input class="qe-opt-input" value="${escapeHTML(value || "")}" placeholder="Alternativa (ex: Até 21)" />
    <button type="button" class="btn-ghost danger mini">×</button>`;
  row.querySelector("button").addEventListener("click", () => row.remove());
  return row;
}

function buildExtra(extra, type, q) {
  extra.innerHTML = "";
  if (type === "players") {
    extra.innerHTML = `<label class="qe-mini"><span>Máx. de jogadores</span><input class="qe-max" type="number" min="1" max="26" value="${q.max || 5}" /></label>
      <span class="qe-help">Cada jogador certo vale os pontos definidos.</span>`;
  } else if (type === "number") {
    extra.innerHTML = `<label class="qe-mini"><span>Valor máximo</span><input class="qe-max" type="number" min="1" value="${q.max || 20}" /></label>
      <span class="qe-help">Acerto exato vale os pontos; errar por 1 vale metade.</span>`;
  } else {
    const wrap = document.createElement("div"); wrap.className = "qe-opts";
    const list = document.createElement("div"); list.className = "qe-opt-list";
    const opts = q.options && q.options.length ? q.options : ["", ""];
    opts.forEach((o) => list.appendChild(optRow(o)));
    const add = document.createElement("button");
    add.type = "button"; add.className = "btn-ghost mini"; add.textContent = "+ alternativa";
    add.addEventListener("click", () => list.appendChild(optRow("")));
    wrap.append(list, add);
    extra.appendChild(wrap);
  }
}

function makeQEditor(q = {}) {
  const el = document.createElement("div");
  el.className = "q-editor";
  el.dataset.qid = q.id || "q" + Math.random().toString(36).slice(2, 8);
  el.innerHTML = `
    <div class="qe-row">
      <select class="qe-type">${Object.entries(QTYPES).map(([v, l]) => `<option value="${v}">${l}</option>`).join("")}</select>
      <input class="qe-label" placeholder="Texto da pergunta" />
      <input class="qe-points" type="number" min="0" placeholder="pts" />
      <button type="button" class="btn-ghost danger mini qe-remove">remover</button>
    </div>
    <div class="qe-extra"></div>`;
  const typeSel = el.querySelector(".qe-type");
  const extra = el.querySelector(".qe-extra");
  typeSel.value = q.type || "players";
  el.querySelector(".qe-label").value = q.label || "";
  el.querySelector(".qe-points").value = q.points ?? 3;
  buildExtra(extra, typeSel.value, q);
  typeSel.addEventListener("change", () => buildExtra(extra, typeSel.value, {}));
  el.querySelector(".qe-remove").addEventListener("click", () => el.remove());
  return el;
}

function serializeQuestions(mid) {
  const out = [];
  document.querySelectorAll(`#qbuilder-${mid} .q-editor`).forEach((el) => {
    const type = el.querySelector(".qe-type").value;
    const label = el.querySelector(".qe-label").value.trim();
    const points = Number(el.querySelector(".qe-points").value) || 0;
    if (!label) return;
    const q = { id: el.dataset.qid, type, label, points };
    if (type === "players") q.max = Number(el.querySelector(".qe-max").value) || 5;
    else if (type === "number") { const mx = Number(el.querySelector(".qe-max").value); if (mx) q.max = mx; }
    else {
      q.options = [...el.querySelectorAll(".qe-opt-input")].map((i) => i.value.trim()).filter(Boolean);
      if (q.options.length < 2) return; // múltipla escolha precisa de pelo menos 2
    }
    out.push(q);
  });
  return out;
}

/* ----------------------- RESULTADO OFICIAL ----------------------- */
function answerField(mid, q, answers) {
  const cur = answers ? answers[q.id] : undefined;
  if (q.type === "players") {
    const val = Array.isArray(cur) ? cur.join(", ") : "";
    return `<label class="field mini grow"><span>${escapeHTML(q.label)} <small>(quem marcou, por vírgula)</small></span>
      <input type="text" list="squadList" id="qa-${mid}-${q.id}" value="${escapeHTML(val)}" placeholder="Vinícius Jr., Raphinha" /></label>`;
  }
  if (q.type === "number") {
    return `<label class="field mini"><span>${escapeHTML(q.label)}</span>
      <input type="number" min="0" id="qa-${mid}-${q.id}" value="${cur ?? ""}" /></label>`;
  }
  const opts = (q.options || []).map((o) => `<option ${String(cur) === String(o) ? "selected" : ""}>${escapeHTML(o)}</option>`).join("");
  return `<label class="field mini grow"><span>${escapeHTML(q.label)}</span>
    <select id="qa-${mid}-${q.id}"><option value="">— sem resposta —</option>${opts}</select></label>`;
}
function gatherAnswers(mid) {
  const ans = {};
  for (const q of MQ[mid] || []) {
    const el = document.getElementById(`qa-${mid}-${q.id}`);
    if (!el) continue;
    if (q.type === "players") {
      const arr = el.value.split(",").map((s) => s.trim()).filter(Boolean);
      if (arr.length) ans[q.id] = arr;
    } else if (q.type === "number") {
      if (el.value !== "") ans[q.id] = Number(el.value);
    } else if (el.value) ans[q.id] = el.value;
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
    const hasResult = m.home_score !== null && m.home_score !== undefined;

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
        <label class="field mini"><span>ID API</span><input type="text" id="mx-${m.id}" value="${escapeHTML(m.external_id || "")}" placeholder="opcional" /></label>
        <button class="btn-ghost mini" data-act="savemeta" data-id="${m.id}" style="align-self:flex-end;">Salvar dados</button>
      </div>
      <p class="hint-text">Os palpites encerram sozinhos no horário acima — não precisa travar na mão.</p>

      <details class="admin-preds">
        <summary>Estatísticas (preenchimento manual — ou automático com a API)</summary>
        <div class="admin-row">
          ${STAT_FIELDS.map(([k, label]) => `
            <label class="field mini"><span>${label} · ${escapeHTML(m.home_team)}</span><input type="number" min="0" id="st-${m.id}-${k}Home" value="${detail.stats?.[k + "Home"] ?? ""}" /></label>
            <label class="field mini"><span>${label} · ${escapeHTML(m.away_team)}</span><input type="number" min="0" id="st-${m.id}-${k}Away" value="${detail.stats?.[k + "Away"] ?? ""}" /></label>`).join("")}
        </div>
        <button class="btn-ghost mini" data-act="savemeta" data-id="${m.id}">Salvar dados e estatísticas</button>
      </details>

      <p class="block-label">Perguntas especiais</p>
      <div id="qbuilder-${m.id}" class="qbuilder"></div>
      <div class="qbuilder-actions">
        <button class="btn-ghost mini" data-act="addq" data-id="${m.id}">+ Adicionar pergunta</button>
        <button class="btn-gold mini" data-act="saveq" data-id="${m.id}">Salvar perguntas</button>
      </div>

      <p class="block-label">Resultado oficial</p>
      <div class="admin-row">
        <label class="field mini"><span>Gols ${escapeHTML(m.home_team)}</span><input type="number" min="0" id="rh-${m.id}" value="${m.home_score ?? ""}" /></label>
        <label class="field mini"><span>Gols ${escapeHTML(m.away_team)}</span><input type="number" min="0" id="ra-${m.id}" value="${m.away_score ?? ""}" /></label>
      </div>
      <div class="admin-row">
        ${(detail.questions || []).map((q) => answerField(m.id, q, detail.answers)).join("") || '<span class="hint-text">Nenhuma pergunta especial nesta partida.</span>'}
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
      </details>
    `;
    box.appendChild(card);

    // popular construtor de perguntas
    const qbox = card.querySelector(`#qbuilder-${m.id}`);
    (detail.questions || []).forEach((q) => qbox.appendChild(makeQEditor(q)));
    if (!detail.questions || !detail.questions.length) {
      qbox.innerHTML = `<p class="hint-text">Nenhuma pergunta ainda. Clique em "Adicionar pergunta".</p>`;
    }
  }

  box.querySelectorAll("button[data-act]").forEach((btn) =>
    btn.addEventListener("click", () => handleAction(btn.dataset.act, btn.dataset.id))
  );
}

function statusLabel(s) { return { open: "Aberto", locked: "Travado", finished: "Encerrado" }[s] || s; }

async function handleAction(act, id) {
  try {
    if (act === "addq") {
      const qbox = document.getElementById("qbuilder-" + id);
      if (qbox.querySelector(".hint-text")) qbox.innerHTML = "";
      qbox.appendChild(makeQEditor({}));
      return;
    }
    if (act === "export") {
      await downloadCsv(`/api/admin/export/matches/${id}`, `palpites-jogo-${id}.csv`);
      return;
    }
    if (act === "saveq") {
      const questions = serializeQuestions(id);
      await api(`/api/admin/matches/${id}`, { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ questions }) });
    } else if (act === "savemeta") {
      await api(`/api/admin/matches/${id}`, {
        method: "PUT", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          matchDate: toBrasiliaISO($("#md-" + id).value), lockAt: toBrasiliaISO($("#ml-" + id).value),
          venue: $("#mv-" + id).value || null, category: $("#mc-" + id).value,
          externalId: $("#mx-" + id).value || null, stats: gatherStats(id),
        }),
      });
    } else if (act === "save-result" || act === "finish") {
      const h = $("#rh-" + id).value, a = $("#ra-" + id).value;
      if (h === "" || a === "") { alert("Informe o placar oficial (gols dos dois times)."); return; }
      await api(`/api/admin/matches/${id}/result`, {
        method: "PUT", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ homeScore: h, awayScore: a, answers: gatherAnswers(id), finish: act === "finish" }),
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
