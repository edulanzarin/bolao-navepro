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

async function tryLogin(pass) {
  PASS = pass;
  const res = await fetch("/api/admin/matches/0/status", {
    method: "PUT",
    headers: { "Content-Type": "application/json", "x-admin-password": pass },
    body: JSON.stringify({ status: "open" }),
  });
  if (res.status === 401) return false;
  return true;
}

function enterPanel() {
  $("#loginCard").hidden = true;
  $("#panel").hidden = false;
  loadConfig();
  loadMatches();
}

$("#loginBtn").addEventListener("click", async () => {
  const pass = $("#adminPass").value.trim();
  const msg = $("#loginMsg");
  msg.className = "form-msg";
  const ok = await tryLogin(pass);
  if (ok) { sessionStorage.setItem("adminPass", pass); enterPanel(); }
  else { msg.textContent = "⚠ Senha incorreta."; msg.classList.add("err"); }
});

/* ----------------------- PREMIAÇÃO / CONFIG ----------------------- */
function prizeRow(place, prize) {
  const div = document.createElement("div");
  div.className = "prize-edit-row";
  div.innerHTML = `
    <span class="place-label">${place}º</span>
    <input class="prize-input" data-place="${place}" value="${escapeHTML(prize || "")}" placeholder="Ex: Voucher R$ 100" />
    <button class="btn-ghost danger mini" type="button" data-removeprize>×</button>`;
  div.querySelector("[data-removeprize]").addEventListener("click", () => { div.remove(); renumberPrizes(); });
  return div;
}
function renumberPrizes() {
  [...$("#prizeEditor").children].forEach((row, i) => {
    row.querySelector(".place-label").textContent = (i + 1) + "º";
    row.querySelector(".prize-input").dataset.place = i + 1;
  });
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
$("#addPrizeBtn").addEventListener("click", () => {
  const box = $("#prizeEditor");
  box.appendChild(prizeRow(box.children.length + 1, ""));
});
$("#saveCfgBtn").addEventListener("click", async () => {
  const msg = $("#cfgMsg"); msg.className = "form-msg";
  const prizes = [...document.querySelectorAll(".prize-input")]
    .map((inp, i) => ({ place: i + 1, prize: inp.value.trim() })).filter((p) => p.prize);
  try {
    await api("/api/admin/config", {
      method: "PUT", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ subtitle: $("#cfgSubtitle").value.trim(), prizes }),
    });
    msg.textContent = "✅ Premiação salva!"; msg.classList.add("ok");
  } catch (e) { msg.textContent = "⚠ " + e.message; msg.classList.add("err"); }
});

/* ----------------------- NOVA PARTIDA ----------------------- */
$("#createBtn").addEventListener("click", async () => {
  const msg = $("#createMsg"); msg.className = "form-msg";
  let questions;
  try { questions = $("#nQuestions").value.trim() ? JSON.parse($("#nQuestions").value) : []; }
  catch { msg.textContent = "⚠ JSON das perguntas inválido."; msg.classList.add("err"); return; }
  try {
    await api("/api/admin/matches", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        homeTeam: $("#nHome").value, awayTeam: $("#nAway").value,
        homeFlag: $("#nHomeFlag").value, awayFlag: $("#nAwayFlag").value,
        matchDate: toBrasiliaISO($("#nDate").value), lockAt: toBrasiliaISO($("#nLock").value),
        venue: $("#nVenue").value || null, questions,
      }),
    });
    msg.textContent = "✅ Partida criada!"; msg.classList.add("ok");
    ["nHome", "nAway", "nHomeFlag", "nAwayFlag", "nDate", "nLock", "nVenue", "nQuestions"].forEach((id) => ($("#" + id).value = ""));
    loadMatches();
  } catch (e) { msg.textContent = "⚠ " + e.message; msg.classList.add("err"); }
});

/* ----------------------- LISTA DE PARTIDAS ----------------------- */
function answerField(mid, q, answers) {
  const cur = answers ? answers[q.id] : undefined;
  if (q.type === "players") {
    const val = Array.isArray(cur) ? cur.join(", ") : "";
    return `<label class="field mini grow"><span>${escapeHTML(q.label)} <small>(separe por vírgula)</small></span>
      <input type="text" id="qa-${mid}-${q.id}" value="${escapeHTML(val)}" placeholder="Vinícius Jr., Raphinha" /></label>`;
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

async function loadMatches() {
  const matches = await fetch("/api/matches").then((r) => r.json());
  const box = $("#adminMatches");
  if (!matches.length) { box.innerHTML = `<p class="empty">Nenhuma partida.</p>`; return; }

  box.innerHTML = "";
  for (const m of matches) {
    const detail = await api(`/api/admin/matches/${m.id}`);
    MQ[m.id] = detail.questions || [];
    const el = document.createElement("div");
    el.className = "admin-match";
    el.innerHTML = `
      <div class="admin-match-head">
        <strong>${escapeHTML(m.home_team)} x ${escapeHTML(m.away_team)} ${m.current ? '<span class="badge badge-open">★ atual</span>' : ''}</strong>
        <span class="badge badge-${m.status}">${statusLabel(m.status)}</span>
      </div>

      <div class="admin-row">
        <label class="field mini grow"><span>Data e hora do jogo</span>
          <input type="datetime-local" id="md-${m.id}" value="${toLocalInput(m.match_date)}" /></label>
        <label class="field mini grow"><span>Encerrar palpites em</span>
          <input type="datetime-local" id="ml-${m.id}" value="${toLocalInput(m.lock_at)}" /></label>
        <label class="field mini grow"><span>Local</span>
          <input type="text" id="mv-${m.id}" value="${escapeHTML(m.venue || "")}" placeholder="Estádio · Cidade" /></label>
        <button class="btn-ghost mini" data-act="savemeta" data-id="${m.id}" style="align-self:flex-end;">💾 Salvar dados</button>
      </div>

      <details class="admin-preds">
        <summary>⚙️ Editar perguntas especiais (avançado · JSON)</summary>
        <textarea id="qedit-${m.id}" class="json-area" rows="8">${escapeHTML(JSON.stringify(detail.questions || [], null, 2))}</textarea>
        <button class="btn-ghost mini" data-act="saveq" data-id="${m.id}">💾 Salvar perguntas</button>
      </details>

      <div class="result-block">
        <p class="block-label">Resultado oficial</p>
        <div class="admin-row">
          <label class="field mini"><span>Gols ${escapeHTML(m.home_team)}</span>
            <input type="number" min="0" id="rh-${m.id}" value="${m.home_score ?? ""}" /></label>
          <label class="field mini"><span>Gols ${escapeHTML(m.away_team)}</span>
            <input type="number" min="0" id="ra-${m.id}" value="${m.away_score ?? ""}" /></label>
        </div>
        <div class="admin-row">
          ${(detail.questions || []).map((q) => answerField(m.id, q, detail.answers)).join("") || '<span class="empty">Sem perguntas especiais.</span>'}
        </div>
        <div class="admin-actions">
          <button class="btn-gold mini" data-act="result" data-id="${m.id}">💾 Lançar resultado</button>
          <button class="btn-ghost" data-act="finish" data-id="${m.id}">🏁 Encerrar</button>
          ${m.status === "open"
            ? `<button class="btn-ghost" data-act="lock" data-id="${m.id}">🔒 Travar palpites</button>`
            : `<button class="btn-ghost" data-act="open" data-id="${m.id}">🔓 Reabrir</button>`}
          <button class="btn-ghost danger" data-act="delete" data-id="${m.id}">🗑 Excluir</button>
        </div>
      </div>

      <details class="admin-preds">
        <summary>${detail.predictions.length} palpite(s) · ver contatos e respostas</summary>
        <table class="ranking-table">
          <thead><tr><th>Participante</th><th>CPF/CNPJ</th><th>Contato</th><th>Placar</th><th>Pts</th><th></th></tr></thead>
          <tbody>
            ${detail.predictions.map((p) => `<tr>
              <td>${escapeHTML(p.participant)}</td>
              <td><small>${fmtDoc(p.document)}</small></td>
              <td class="contact-cell">
                <a href="mailto:${escapeHTML(p.email)}">${escapeHTML(p.email)}</a>
                ${p.phone ? `<small>${escapeHTML(p.phone)}</small>` : ""}
              </td>
              <td>${p.home_score} x ${p.away_score}</td>
              <td class="pts">${p.points}</td>
              <td><button class="btn-ghost danger mini" data-act="delpred" data-id="${p.id}">×</button></td>
            </tr>`).join("") || `<tr><td colspan="6" class="empty">Sem palpites.</td></tr>`}
          </tbody>
        </table>
      </details>
    `;
    box.appendChild(el);
  }

  box.querySelectorAll("button[data-act]").forEach((btn) =>
    btn.addEventListener("click", () => handleAction(btn.dataset.act, btn.dataset.id))
  );
}

function statusLabel(s) { return { open: "Aberto", locked: "Travado", finished: "Encerrado" }[s] || s; }

async function handleAction(act, id) {
  try {
    if (act === "result" || act === "finish") {
      await api(`/api/admin/matches/${id}/result`, {
        method: "PUT", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          homeScore: $("#rh-" + id).value, awayScore: $("#ra-" + id).value,
          answers: gatherAnswers(id), finish: act === "finish",
        }),
      });
    } else if (act === "savemeta") {
      await api(`/api/admin/matches/${id}`, {
        method: "PUT", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          matchDate: toBrasiliaISO($("#md-" + id).value),
          lockAt: toBrasiliaISO($("#ml-" + id).value),
          venue: $("#mv-" + id).value || null,
        }),
      });
    } else if (act === "saveq") {
      let questions;
      try { questions = JSON.parse($("#qedit-" + id).value); }
      catch { alert("JSON das perguntas inválido."); return; }
      await api(`/api/admin/matches/${id}`, {
        method: "PUT", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ questions }),
      });
    } else if (act === "lock" || act === "open") {
      await api(`/api/admin/matches/${id}/status`, {
        method: "PUT", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: act === "lock" ? "locked" : "open" }),
      });
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

if (PASS) { tryLogin(PASS).then((ok) => { if (ok) enterPanel(); }); }
