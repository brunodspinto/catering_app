/* ============================================================
   Bandeja — Lógica da aplicação
   ============================================================ */

// ---------- Ligação ao Supabase ----------
let sb = null;
const cfg = window.APP_CONFIG || {};
const configOK = cfg.SUPABASE_URL && cfg.SUPABASE_URL.startsWith("http")
  && cfg.SUPABASE_ANON_KEY && cfg.SUPABASE_ANON_KEY.length > 20;

if (configOK) {
  sb = supabase.createClient(cfg.SUPABASE_URL, cfg.SUPABASE_ANON_KEY);
}

// ---------- Estado ----------
const state = {
  quintas: [],
  servicos: [],
  poupancas: [],
  view: "resumo",
  filtroServico: "todos",
  mes: new Date(),            // mês mostrado no resumo
  editandoServico: null,      // serviço a ser editado (para manter o valor/hora histórico)
};

// ---------- Atalhos ----------
const $  = (s) => document.querySelector(s);
const $$ = (s) => Array.from(document.querySelectorAll(s));

// ---------- Formatação ----------
const fmtEUR = (n) =>
  (Number(n) || 0).toLocaleString("pt-PT", { style: "currency", currency: "EUR" });

const fmtData = (d) => {
  const dt = (d instanceof Date) ? d : new Date(d + "T00:00:00");
  return dt.toLocaleDateString("pt-PT", { day: "2-digit", month: "short" });
};

const fmtHoras = (h) => {
  const horas = Math.floor(h);
  const min = Math.round((h - horas) * 60);
  return min ? `${horas}h${String(min).padStart(2, "0")}` : `${horas}h`;
};

const nomeMes = (d) =>
  d.toLocaleDateString("pt-PT", { month: "long", year: "numeric" });

// horas entre "HH:MM" e "HH:MM" (lida com passar da meia-noite)
function calcHoras(inicio, fim) {
  if (!inicio || !fim) return 0;
  const [h1, m1] = inicio.split(":").map(Number);
  const [h2, m2] = fim.split(":").map(Number);
  let ini = h1 * 60 + m1;
  let f = h2 * 60 + m2;
  if (f <= ini) f += 24 * 60; // terminou no dia seguinte
  return (f - ini) / 60;
}

function totalServico(s) {
  return calcHoras(s.hora_inicio, s.hora_fim) * Number(s.valor_hora) + Number(s.gorjeta || 0);
}

function mesmoMes(dataStr, ref) {
  const d = new Date(dataStr + "T00:00:00");
  return d.getFullYear() === ref.getFullYear() && d.getMonth() === ref.getMonth();
}

// ---------- Toast ----------
let toastTimer;
function toast(msg) {
  const t = $("#toast");
  t.textContent = msg;
  t.classList.remove("hidden");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.add("hidden"), 2600);
}

/* ============================================================
   AUTENTICAÇÃO
   ============================================================ */
let modoCriarConta = false;

function setupAuthUI() {
  if (!configOK) {
    $("#config-warning").classList.remove("hidden");
  }
  $("#switch-link").addEventListener("click", (e) => {
    e.preventDefault();
    modoCriarConta = !modoCriarConta;
    $("#auth-submit").textContent = modoCriarConta ? "Criar conta" : "Entrar";
    $("#switch-text").textContent = modoCriarConta ? "Já tens conta?" : "Ainda não tens conta?";
    $("#switch-link").textContent = modoCriarConta ? "Entrar" : "Criar conta";
    $("#auth-error").classList.add("hidden");
  });

  $("#auth-form").addEventListener("submit", async (e) => {
    e.preventDefault();
    if (!configOK) { showAuthError("Falta configurar o config.js (ver README)."); return; }
    const email = $("#auth-email").value.trim();
    const password = $("#auth-password").value;
    const btn = $("#auth-submit");
    btn.disabled = true;
    btn.textContent = "A processar…";
    try {
      if (modoCriarConta) {
        const { error } = await sb.auth.signUp({ email, password });
        if (error) throw error;
        toast("Conta criada! Já podes entrar.");
        // se a confirmação de email estiver desligada, já há sessão
      } else {
        const { error } = await sb.auth.signInWithPassword({ email, password });
        if (error) throw error;
      }
    } catch (err) {
      showAuthError(traduzErro(err.message));
    } finally {
      btn.disabled = false;
      btn.textContent = modoCriarConta ? "Criar conta" : "Entrar";
    }
  });

  $("#logout-btn").addEventListener("click", async () => {
    await sb.auth.signOut();
  });
}

function showAuthError(msg) {
  const el = $("#auth-error");
  el.textContent = msg;
  el.classList.remove("hidden");
}

function traduzErro(msg) {
  if (/invalid login/i.test(msg)) return "Email ou senha errados.";
  if (/already registered/i.test(msg)) return "Esse email já tem conta. Tenta entrar.";
  if (/confirm/i.test(msg)) return "Confirma o email antes de entrar (vê a tua caixa de correio).";
  if (/password/i.test(msg)) return "A senha tem de ter pelo menos 6 caracteres.";
  return msg;
}

/* ============================================================
   CARREGAR DADOS
   ============================================================ */
async function carregarTudo() {
  const [q, s, p] = await Promise.all([
    sb.from("quintas").select("*").order("nome"),
    sb.from("servicos").select("*").order("data", { ascending: false }),
    sb.from("poupancas").select("*").order("data", { ascending: false }),
  ]);
  state.quintas = q.data || [];
  state.servicos = s.data || [];
  state.poupancas = p.data || [];
  renderTudo();
}

function renderTudo() {
  renderResumo();
  renderServicos();
  renderQuintas();
  renderPoupancas();
}

/* ============================================================
   RENDER — RESUMO
   ============================================================ */
function renderResumo() {
  $("#month-label").textContent = nomeMes(state.mes);

  const doMes = state.servicos.filter((s) => mesmoMes(s.data, state.mes));
  let ganho = 0, pendente = 0, horas = 0;
  const porQuinta = {};

  for (const s of doMes) {
    const t = totalServico(s);
    ganho += t;
    horas += calcHoras(s.hora_inicio, s.hora_fim);
    if (s.estado === "pendente") pendente += t;
    const nome = s.quinta_nome || "—";
    porQuinta[nome] = (porQuinta[nome] || 0) + t;
  }

  $("#stat-ganho").textContent = fmtEUR(ganho);
  $("#stat-pendente").textContent = fmtEUR(pendente);
  $("#stat-horas").textContent = fmtHoras(horas);
  $("#stat-poupancas").textContent = fmtEUR(saldoPoupancas());

  // por quinta
  const wrap = $("#resumo-por-quinta");
  const entradas = Object.entries(porQuinta).sort((a, b) => b[1] - a[1]);
  if (!entradas.length) {
    wrap.innerHTML = `<p class="empty">Sem serviços neste mês.</p>`;
  } else {
    const max = entradas[0][1] || 1;
    wrap.innerHTML = entradas.map(([nome, val]) => `
      <div class="card">
        <div class="item" style="padding:0;cursor:default;background:none">
          <div class="left"><div class="title">${escapeHtml(nome)}</div></div>
          <div class="right"><span class="amount money">${fmtEUR(val)}</span></div>
        </div>
        <div class="bar"><i style="width:${(val / max * 100).toFixed(0)}%"></i></div>
      </div>`).join("");
  }

  // recentes
  const recentes = state.servicos.slice(0, 5);
  $("#resumo-recentes").innerHTML = recentes.length
    ? recentes.map(servicoItemHTML).join("")
    : `<p class="empty">Sem serviços.</p>`;
  ligarCliquesServico("#resumo-recentes");
}

/* ============================================================
   RENDER — SERVIÇOS
   ============================================================ */
function servicoItemHTML(s) {
  const t = totalServico(s);
  const h = fmtHoras(calcHoras(s.hora_inicio, s.hora_fim));
  return `
    <div class="item" data-servico="${s.id}">
      <div class="left">
        <div class="title">${escapeHtml(s.quinta_nome || "—")}</div>
        <div class="sub">${fmtData(s.data)} · ${s.hora_inicio.slice(0,5)}–${s.hora_fim.slice(0,5)} · ${h}${Number(s.gorjeta) ? " · +gorjeta" : ""}</div>
      </div>
      <div class="right">
        <div class="amount money">${fmtEUR(t)}</div>
        <span class="badge ${s.estado}">${s.estado === "pago" ? "Pago" : "Por receber"}</span>
      </div>
    </div>`;
}

function renderServicos() {
  let lista = state.servicos;
  if (state.filtroServico !== "todos")
    lista = lista.filter((s) => s.estado === state.filtroServico);

  const wrap = $("#servicos-lista");
  $("#servicos-vazio").classList.toggle("hidden", state.servicos.length > 0);
  wrap.innerHTML = lista.map(servicoItemHTML).join("");
  ligarCliquesServico("#servicos-lista");
}

function ligarCliquesServico(sel) {
  $$(`${sel} [data-servico]`).forEach((el) => {
    el.addEventListener("click", () => abrirModalServico(el.dataset.servico));
  });
}

/* ============================================================
   RENDER — QUINTAS
   ============================================================ */
function renderQuintas() {
  const wrap = $("#quintas-lista");
  $("#quintas-vazio").classList.toggle("hidden", state.quintas.length > 0);
  wrap.innerHTML = state.quintas.map((q) => `
    <div class="item" data-quinta="${q.id}">
      <div class="left">
        <div class="title">${escapeHtml(q.nome)}</div>
        <div class="sub">${q.morada ? escapeHtml(q.morada) + " · " : ""}${fmtEUR(q.valor_hora)}/hora</div>
      </div>
      <div class="right"><span class="amount">${fmtEUR(q.valor_hora)}</span><div class="muted">por hora</div></div>
    </div>`).join("");
  $$("#quintas-lista [data-quinta]").forEach((el) => {
    el.addEventListener("click", () => abrirModalQuinta(el.dataset.quinta));
  });
}

/* ============================================================
   RENDER — POUPANÇAS
   ============================================================ */
function saldoPoupancas() {
  return state.poupancas.reduce(
    (acc, m) => acc + (m.tipo === "entrada" ? 1 : -1) * Number(m.valor), 0);
}

function renderPoupancas() {
  $("#poupancas-saldo").textContent = fmtEUR(saldoPoupancas());
  const wrap = $("#poupancas-lista");
  $("#poupancas-vazio").classList.toggle("hidden", state.poupancas.length > 0);
  wrap.innerHTML = state.poupancas.map((m) => {
    const entrada = m.tipo === "entrada";
    return `
      <div class="item" data-poupanca="${m.id}">
        <div class="left">
          <div class="title">${escapeHtml(m.descricao || (entrada ? "Entrada" : "Saída"))}</div>
          <div class="sub">${fmtData(m.data)}</div>
        </div>
        <div class="right">
          <div class="amount" style="color:${entrada ? "var(--accent-2)" : "var(--danger)"}">
            ${entrada ? "+" : "−"}${fmtEUR(m.valor)}
          </div>
        </div>
      </div>`;
  }).join("");
  $$("#poupancas-lista [data-poupanca]").forEach((el) => {
    el.addEventListener("click", () => apagarPoupanca(el.dataset.poupanca));
  });
}

/* ============================================================
   MODAL SERVIÇO
   ============================================================ */
function preencherSelectQuintas(selId) {
  const sel = $("#servico-quinta");
  if (!state.quintas.length) {
    sel.innerHTML = `<option value="">(cria uma quinta primeiro)</option>`;
    return;
  }
  sel.innerHTML = state.quintas
    .map((q) => `<option value="${q.id}">${escapeHtml(q.nome)}</option>`)
    .join("");
  if (selId) sel.value = selId;
}

function abrirModalServico(id) {
  const novo = !id;
  $("#modal-servico-titulo").textContent = novo ? "Novo serviço" : "Editar serviço";
  $("#servico-apagar").classList.toggle("hidden", novo);
  $("#form-servico").reset();
  $("#servico-id").value = id || "";
  state.editandoServico = novo ? null : (state.servicos.find((x) => x.id === id) || null);

  if (novo) {
    preencherSelectQuintas();
    $("#servico-data").value = hojeISO();
  } else {
    const s = state.editandoServico;
    if (!s) return;
    preencherSelectQuintas(s.quinta_id);
    $("#servico-data").value = s.data;
    $("#servico-inicio").value = s.hora_inicio?.slice(0, 5);
    $("#servico-fim").value = s.hora_fim?.slice(0, 5);
    $("#servico-gorjeta").value = Number(s.gorjeta) || "";
    $("#servico-notas").value = s.notas || "";
    $("#servico-pago").checked = s.estado === "pago";
  }
  atualizarPreviewServico();
  abrirModal("#modal-servico");
}

// valor/hora a aplicar: se estamos a editar e a quinta não mudou, mantém o valor
// guardado nesse dia; caso contrário usa o valor atual da quinta escolhida.
function valorHoraAtual() {
  const qid = $("#servico-quinta").value;
  const q = state.quintas.find((x) => x.id === qid);
  const edit = state.editandoServico;
  if (edit && edit.quinta_id === qid) return Number(edit.valor_hora);
  return q ? Number(q.valor_hora) : 0;
}

function atualizarPreviewServico() {
  const valorHora = valorHoraAtual();
  const horas = calcHoras($("#servico-inicio").value, $("#servico-fim").value);
  const gorjeta = Number($("#servico-gorjeta").value) || 0;
  const total = horas * valorHora + gorjeta;
  $("#servico-preview").textContent = horas
    ? `${fmtHoras(horas)} × ${fmtEUR(valorHora)}${gorjeta ? " + " + fmtEUR(gorjeta) : ""} = ${fmtEUR(total)}`
    : "Preenche as horas para ver o total";
}

async function guardarServico(e) {
  e.preventDefault();
  const id = $("#servico-id").value;
  const qid = $("#servico-quinta").value;
  const q = state.quintas.find((x) => x.id === qid);
  if (!q) { toast("Escolhe uma quinta."); return; }

  const dados = {
    quinta_id: qid,
    quinta_nome: q.nome,
    valor_hora: valorHoraAtual(),    // "fotografia" do valor (mantém histórico ao editar)
    data: $("#servico-data").value,
    hora_inicio: $("#servico-inicio").value,
    hora_fim: $("#servico-fim").value,
    gorjeta: Number($("#servico-gorjeta").value) || 0,
    estado: $("#servico-pago").checked ? "pago" : "pendente",
    notas: $("#servico-notas").value.trim() || null,
  };

  let error;
  if (id) ({ error } = await sb.from("servicos").update(dados).eq("id", id));
  else    ({ error } = await sb.from("servicos").insert(dados));

  if (error) { toast("Erro: " + error.message); return; }
  fecharModais();
  toast(id ? "Serviço atualizado." : "Serviço guardado.");
  await carregarTudo();
}

async function apagarServico() {
  const id = $("#servico-id").value;
  if (!id) return;
  if (!confirm("Apagar este serviço?")) return;
  const { error } = await sb.from("servicos").delete().eq("id", id);
  if (error) { toast("Erro: " + error.message); return; }
  fecharModais();
  toast("Serviço apagado.");
  await carregarTudo();
}

/* ============================================================
   MODAL QUINTA
   ============================================================ */
function abrirModalQuinta(id) {
  const novo = !id;
  $("#modal-quinta-titulo").textContent = novo ? "Nova quinta" : "Editar quinta";
  $("#quinta-apagar").classList.toggle("hidden", novo);
  $("#form-quinta").reset();
  $("#quinta-id").value = id || "";
  if (!novo) {
    const q = state.quintas.find((x) => x.id === id);
    if (!q) return;
    $("#quinta-nome").value = q.nome;
    $("#quinta-valor").value = q.valor_hora;
    $("#quinta-morada").value = q.morada || "";
    $("#quinta-notas").value = q.notas || "";
  }
  abrirModal("#modal-quinta");
}

async function guardarQuinta(e) {
  e.preventDefault();
  const id = $("#quinta-id").value;
  const dados = {
    nome: $("#quinta-nome").value.trim(),
    valor_hora: Number($("#quinta-valor").value) || 0,
    morada: $("#quinta-morada").value.trim() || null,
    notas: $("#quinta-notas").value.trim() || null,
  };
  if (!dados.nome) { toast("Escreve o nome da quinta."); return; }

  let error;
  if (id) ({ error } = await sb.from("quintas").update(dados).eq("id", id));
  else    ({ error } = await sb.from("quintas").insert(dados));

  if (error) { toast("Erro: " + error.message); return; }
  fecharModais();
  toast(id ? "Quinta atualizada." : "Quinta guardada.");
  await carregarTudo();
}

async function apagarQuinta() {
  const id = $("#quinta-id").value;
  if (!id) return;
  if (!confirm("Apagar esta quinta? Os serviços antigos mantêm-se com o nome guardado.")) return;
  const { error } = await sb.from("quintas").delete().eq("id", id);
  if (error) { toast("Erro: " + error.message); return; }
  fecharModais();
  toast("Quinta apagada.");
  await carregarTudo();
}

/* ============================================================
   MODAL POUPANÇA
   ============================================================ */
function abrirModalPoupanca() {
  $("#form-poupanca").reset();
  $("#poupanca-tipo").value = "entrada";
  $$("#modal-poupanca .seg-btn").forEach((b) =>
    b.classList.toggle("active", b.dataset.tipo === "entrada"));
  $("#poupanca-data").value = hojeISO();
  abrirModal("#modal-poupanca");
}

async function guardarPoupanca(e) {
  e.preventDefault();
  const dados = {
    tipo: $("#poupanca-tipo").value,
    valor: Number($("#poupanca-valor").value) || 0,
    data: $("#poupanca-data").value,
    descricao: $("#poupanca-descricao").value.trim() || null,
  };
  if (dados.valor <= 0) { toast("Escreve um valor."); return; }
  const { error } = await sb.from("poupancas").insert(dados);
  if (error) { toast("Erro: " + error.message); return; }
  fecharModais();
  toast("Movimento guardado.");
  await carregarTudo();
}

async function apagarPoupanca(id) {
  if (!confirm("Apagar este movimento?")) return;
  const { error } = await sb.from("poupancas").delete().eq("id", id);
  if (error) { toast("Erro: " + error.message); return; }
  toast("Movimento apagado.");
  await carregarTudo();
}

/* ============================================================
   MODAIS — utilitários
   ============================================================ */
function abrirModal(sel) { $(sel).classList.remove("hidden"); }
function fecharModais() { $$(".modal").forEach((m) => m.classList.add("hidden")); }

/* ============================================================
   NAVEGAÇÃO
   ============================================================ */
const TITULOS = { resumo: "Resumo", servicos: "Serviços", quintas: "Quintas", poupancas: "Poupanças" };

function mudarView(v) {
  state.view = v;
  $$(".view").forEach((el) => el.classList.add("hidden"));
  $(`#view-${v}`).classList.remove("hidden");
  $$(".nav-btn").forEach((b) => b.classList.toggle("active", b.dataset.view === v));
  $("#view-title").textContent = TITULOS[v];
}

function aoCarregarFab() {
  // o FAB cria conforme a secção
  switch (state.view) {
    case "quintas": abrirModalQuinta(); break;
    case "poupancas": abrirModalPoupanca(); break;
    default: // resumo ou serviços
      if (!state.quintas.length) { mudarView("quintas"); abrirModalQuinta(); toast("Cria primeiro a tua quinta."); }
      else abrirModalServico();
  }
}

/* ============================================================
   HELPERS
   ============================================================ */
function hojeISO() {
  const d = new Date();
  const off = d.getTimezoneOffset();
  return new Date(d.getTime() - off * 60000).toISOString().slice(0, 10);
}
function escapeHtml(str) {
  return String(str).replace(/[&<>"']/g, (c) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}

/* ============================================================
   ARRANQUE
   ============================================================ */
function ligarEventos() {
  // navegação
  $$(".nav-btn").forEach((b) => b.addEventListener("click", () => mudarView(b.dataset.view)));
  $("#fab").addEventListener("click", aoCarregarFab);

  // meses
  $("#month-prev").addEventListener("click", () => {
    state.mes = new Date(state.mes.getFullYear(), state.mes.getMonth() - 1, 1);
    renderResumo();
  });
  $("#month-next").addEventListener("click", () => {
    state.mes = new Date(state.mes.getFullYear(), state.mes.getMonth() + 1, 1);
    renderResumo();
  });

  // filtros serviços
  $$("#servicos-filtros .chip").forEach((c) => c.addEventListener("click", () => {
    $$("#servicos-filtros .chip").forEach((x) => x.classList.remove("active"));
    c.classList.add("active");
    state.filtroServico = c.dataset.f;
    renderServicos();
  }));

  // fechar modais
  $$("[data-close]").forEach((b) => b.addEventListener("click", fecharModais));
  $$(".modal").forEach((m) => m.addEventListener("click", (e) => {
    if (e.target === m) fecharModais();
  }));

  // formulários
  $("#form-servico").addEventListener("submit", guardarServico);
  $("#servico-apagar").addEventListener("click", apagarServico);
  ["#servico-quinta", "#servico-inicio", "#servico-fim", "#servico-gorjeta"].forEach((s) =>
    $(s).addEventListener("input", atualizarPreviewServico));

  $("#form-quinta").addEventListener("submit", guardarQuinta);
  $("#quinta-apagar").addEventListener("click", apagarQuinta);

  $("#form-poupanca").addEventListener("submit", guardarPoupanca);
  $$("#modal-poupanca .seg-btn").forEach((b) => b.addEventListener("click", () => {
    $$("#modal-poupanca .seg-btn").forEach((x) => x.classList.remove("active"));
    b.classList.add("active");
    $("#poupanca-tipo").value = b.dataset.tipo;
  }));
}

function mostrarApp(logado) {
  $("#login-view").classList.toggle("hidden", logado);
  $("#app").classList.toggle("hidden", !logado);
}

async function init() {
  setupAuthUI();
  ligarEventos();

  if (!configOK) {
    mostrarApp(false);
    return;
  }

  // reagir a login/logout
  sb.auth.onAuthStateChange((_evt, session) => {
    if (session) {
      mostrarApp(true);
      carregarTudo();
    } else {
      mostrarApp(false);
    }
  });

  // sessão já existente?
  const { data } = await sb.auth.getSession();
  if (data.session) {
    mostrarApp(true);
    carregarTudo();
  } else {
    mostrarApp(false);
  }
}

document.addEventListener("DOMContentLoaded", init);
