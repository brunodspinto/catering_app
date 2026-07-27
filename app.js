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
  user: null,
  profile: null,
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
    $("#forgot-row").classList.toggle("hidden", modoCriarConta);
    $(".signup-only").classList.toggle("hidden", !modoCriarConta);
    $("#auth-email-label").textContent = modoCriarConta ? "Email" : "Email ou username";
    // ajuda o iPhone/iCloud a guardar a password (Face ID) ao criar conta
    $("#auth-password").setAttribute("autocomplete", modoCriarConta ? "new-password" : "current-password");
    $("#auth-error").classList.add("hidden");
  });

  $("#forgot-link").addEventListener("click", async (e) => {
    e.preventDefault();
    if (!configOK) { showAuthError("Falta configurar o config.js."); return; }
    const email = $("#auth-email").value.trim();
    if (!email) { showAuthError("Escreve primeiro o teu email aqui em cima."); return; }
    const { error } = await sb.auth.resetPasswordForEmail(email, { redirectTo: location.origin + location.pathname });
    if (error) { showAuthError(traduzErro(error.message)); return; }
    toast("Email enviado! Vê a tua caixa de correio para repor a palavra-passe.");
  });

  $("#form-recovery").addEventListener("submit", guardarRecovery);

  $("#auth-form").addEventListener("submit", async (e) => {
    e.preventDefault();
    if (!configOK) { showAuthError("Falta configurar o config.js (ver README)."); return; }
    const password = $("#auth-password").value;
    const btn = $("#auth-submit");
    btn.disabled = true;
    btn.textContent = "A processar…";
    try {
      if (modoCriarConta) {
        // ----- criar conta -----
        const nome = $("#auth-nome").value.trim();
        const apelido = $("#auth-apelido").value.trim();
        const numero = $("#auth-numero").value.trim();
        const username = $("#auth-username").value.trim();
        const email = $("#auth-email").value.trim();
        if (!nome) throw new Error("Escreve o teu nome.");
        if (!email.includes("@")) throw new Error("Escreve um email válido.");
        if (!/^[a-zA-Z0-9_.]{3,}$/.test(username))
          throw new Error("Username inválido: mínimo 3 caracteres, só letras, números, _ ou .");
        const { error } = await sb.auth.signUp({
          email, password,
          options: { data: { nome, apelido, numero: numero || null, username } },
        });
        if (error) throw error;
        toast("Conta criada! Já podes entrar.");
      } else {
        // ----- entrar (email OU username) -----
        const id = $("#auth-email").value.trim();
        let email = id;
        if (!id.includes("@")) {
          const { data: resolvido, error: rpcErr } = await sb.rpc("email_do_username", { uname: id });
          if (rpcErr) throw rpcErr;
          if (!resolvido) throw new Error("Não há nenhuma conta com esse username.");
          email = resolvido;
        }
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
}

function showAuthError(msg) {
  const el = $("#auth-error");
  el.textContent = msg;
  el.classList.remove("hidden");
}

function traduzErro(msg) {
  if (/invalid login/i.test(msg)) return "Email/username ou senha errados.";
  if (/already registered/i.test(msg)) return "Esse email já tem conta. Tenta entrar.";
  if (/duplicate key|already exists|unique/i.test(msg)) return "Esse username já está a ser usado. Escolhe outro.";
  if (/confirm/i.test(msg)) return "Confirma o email antes de entrar (vê a tua caixa de correio).";
  if (/password/i.test(msg)) return "A senha tem de ter pelo menos 6 caracteres.";
  return msg;
}

/* ============================================================
   CARREGAR DADOS
   ============================================================ */
async function carregarTudo() {
  try {
    const [q, s, p] = await Promise.all([
      sb.from("quintas").select("*").order("nome"),
      sb.from("servicos").select("*").order("data", { ascending: false }),
      sb.from("profiles").select("*").eq("id", state.user.id).maybeSingle(),
    ]);
    if (q.error || s.error) throw (q.error || s.error);
    state.quintas = q.data || [];
    state.servicos = s.data || [];
    state.profile = p.data || null;
    // guardar para uso offline
    try {
      localStorage.setItem("bandeja_cache",
        JSON.stringify({ quintas: state.quintas, servicos: state.servicos, profile: state.profile }));
    } catch (e) {}
  } catch (err) {
    // sem internet (ou erro de rede): mostrar a última cópia guardada
    const cache = lerCache();
    if (cache) {
      state.quintas = cache.quintas || [];
      state.servicos = cache.servicos || [];
      state.profile = cache.profile || null;
      toast("Sem internet — a mostrar os últimos dados guardados.");
    }
  }
  renderTudo();
}

function lerCache() {
  try { return JSON.parse(localStorage.getItem("bandeja_cache")); }
  catch (e) { return null; }
}

function renderTudo() {
  renderResumo();
  renderServicos();
  renderQuintas();
  renderConta();
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
  $("#stat-num-mes").textContent = doMes.length;
  $("#stat-pendente").textContent = fmtEUR(pendente);
  $("#stat-horas").textContent = fmtHoras(horas);

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
        <button class="badge ${s.estado}" data-pago="${s.id}" title="Tocar para alternar pago/por receber">${s.estado === "pago" ? "Pago" : "Por receber"}</button>
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
  // selo "Pago/Por receber" alterna com um toque (sem abrir o serviço)
  $$(`${sel} [data-pago]`).forEach((el) => {
    el.addEventListener("click", (e) => {
      e.stopPropagation();
      togglePagoServico(el.dataset.pago);
    });
  });
}

async function togglePagoServico(id) {
  const s = state.servicos.find((x) => x.id === id);
  if (!s) return;
  const novo = s.estado === "pago" ? "pendente" : "pago";
  const { error } = await sb.from("servicos").update({ estado: novo }).eq("id", id);
  if (error) { toast("Erro: " + error.message); return; }
  toast(novo === "pago" ? "Marcado como pago ✅" : "Marcado como por receber");
  await carregarTudo();
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
    setData("servico-data", hojeISO());
    setHora("servico-inicio", "");
    setHora("servico-fim", "");
  } else {
    const s = state.editandoServico;
    if (!s) return;
    preencherSelectQuintas(s.quinta_id);
    setData("servico-data", s.data);
    setHora("servico-inicio", s.hora_inicio ? s.hora_inicio.slice(0, 5) : "");
    setHora("servico-fim", s.hora_fim ? s.hora_fim.slice(0, 5) : "");
    $("#servico-gorjeta").value = comVirgula(Number(s.gorjeta) || 0);
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
  const gorjeta = parseNum($("#servico-gorjeta").value);
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
  if (!$("#servico-inicio").value || !$("#servico-fim").value) {
    toast("Escolhe a hora de entrada e de saída."); return;
  }

  const dados = {
    quinta_id: qid,
    quinta_nome: q.nome,
    valor_hora: valorHoraAtual(),    // "fotografia" do valor (mantém histórico ao editar)
    data: $("#servico-data").value,
    hora_inicio: $("#servico-inicio").value,
    hora_fim: $("#servico-fim").value,
    gorjeta: parseNum($("#servico-gorjeta").value),
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
   SELETOR DE HORAS (estilo iPhone)
   ============================================================ */
const TP = { input: null, trigger: null, h: 18, m: 0 };
const pad2 = (n) => String(n).padStart(2, "0");

// escreve a hora no campo escondido e no botão visível
function setHora(inputId, val) {
  $("#" + inputId).value = val || "";
  const trg = document.querySelector(`.time-trigger[data-target="${inputId}"]`);
  if (trg) trg.textContent = val || "--:--";
}

function tpConstruirColuna(col, max, sel, onPick) {
  col.innerHTML = "";
  for (let i = 0; i < max; i++) {
    const it = document.createElement("div");
    it.className = "tp-item" + (i === sel ? " sel" : "");
    it.textContent = pad2(i);
    it.addEventListener("click", () => onPick(i));
    col.appendChild(it);
  }
}
function tpCentrar(col, idx, smooth) {
  col.scrollTo({ top: idx * 44, behavior: smooth ? "smooth" : "auto" });
}
function tpMarcar(col, idx) {
  col.querySelectorAll(".tp-item").forEach((el, i) => el.classList.toggle("sel", i === idx));
}
function tpAplicar() {
  const val = `${pad2(TP.h)}:${pad2(TP.m)}`;
  TP.input.value = val;
  TP.trigger.textContent = val;
  atualizarPreviewServico();
}

function abrirTimePicker(trigger) {
  TP.trigger = trigger;
  TP.input = $("#" + trigger.dataset.target);
  $("#tp-title").textContent = trigger.dataset.titulo || "Hora";

  const atual = TP.input.value;
  if (atual && atual.includes(":")) {
    const [h, m] = atual.split(":").map(Number);
    TP.h = h; TP.m = m;
  } else { TP.h = 18; TP.m = 0; }

  const colH = $("#tp-hours"), colM = $("#tp-mins");
  tpConstruirColuna(colH, 24, TP.h, (i) => { TP.h = i; tpMarcar(colH, i); tpCentrar(colH, i, true); tpAplicar(); });
  tpConstruirColuna(colM, 60, TP.m, (i) => { TP.m = i; tpMarcar(colM, i); tpCentrar(colM, i, true); tpAplicar(); });

  $("#time-picker").classList.remove("hidden");
  requestAnimationFrame(() => { tpCentrar(colH, TP.h, false); tpCentrar(colM, TP.m, false); });
}
function fecharTimePicker() { $("#time-picker").classList.add("hidden"); }

/* ============================================================
   SELETOR DE DATA (calendário)
   ============================================================ */
const DP = { input: null, trigger: null, view: new Date(), selected: null };
const DIAS_SEMANA = ["Seg", "Ter", "Qua", "Qui", "Sex", "Sáb", "Dom"];

function fmtDataBotao(iso) {
  if (!iso) return "Escolher data";
  const [y, m, d] = iso.split("-").map(Number);
  const dt = new Date(y, m - 1, d);
  const s = dt.toLocaleDateString("pt-PT", { weekday: "short", day: "numeric", month: "short", year: "numeric" });
  return s.charAt(0).toUpperCase() + s.slice(1);
}

function setData(inputId, iso) {
  $("#" + inputId).value = iso || "";
  const trg = document.querySelector(`.date-trigger[data-target="${inputId}"]`);
  if (trg) trg.textContent = fmtDataBotao(iso);
}

function dpRender() {
  const y = DP.view.getFullYear(), m = DP.view.getMonth();
  const titulo = DP.view.toLocaleDateString("pt-PT", { month: "long", year: "numeric" });
  $("#dp-month").textContent = titulo.charAt(0).toUpperCase() + titulo.slice(1);
  $("#dp-week").innerHTML = DIAS_SEMANA.map((d) => `<span>${d}</span>`).join("");
  const offset = (new Date(y, m, 1).getDay() + 6) % 7;   // semana começa à segunda
  const dias = new Date(y, m + 1, 0).getDate();
  const hoje = hojeISO();
  let html = "";
  for (let i = 0; i < offset; i++) html += `<div class="dp-cell empty"></div>`;
  for (let d = 1; d <= dias; d++) {
    const iso = `${y}-${pad2(m + 1)}-${pad2(d)}`;
    const cls = ["dp-cell"];
    if (iso === hoje) cls.push("today");
    if (iso === DP.selected) cls.push("sel");
    html += `<div class="${cls.join(" ")}" data-iso="${iso}">${d}</div>`;
  }
  $("#dp-grid").innerHTML = html;
  $$("#dp-grid .dp-cell[data-iso]").forEach((c) =>
    c.addEventListener("click", () => dpEscolher(c.dataset.iso)));
}

function dpEscolher(iso) {
  DP.selected = iso;
  setData(DP.trigger.dataset.target, iso);
  fecharDatePicker();
}

function abrirDatePicker(trigger) {
  DP.trigger = trigger;
  DP.input = $("#" + trigger.dataset.target);
  const cur = DP.input.value;
  if (cur && cur.includes("-")) {
    DP.selected = cur;
    const [y, m] = cur.split("-").map(Number);
    DP.view = new Date(y, m - 1, 1);
  } else {
    DP.selected = null;
    DP.view = new Date();
  }
  dpRender();
  $("#date-picker").classList.remove("hidden");
}
function fecharDatePicker() { $("#date-picker").classList.add("hidden"); }

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
    $("#quinta-valor").value = comVirgula(q.valor_hora);
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
    valor_hora: parseNum($("#quinta-valor").value),
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
   MODAIS — utilitários
   ============================================================ */
function abrirModal(sel) { $(sel).classList.remove("hidden"); }
function fecharModais() { $$(".modal").forEach((m) => m.classList.add("hidden")); }

/* ============================================================
   NAVEGAÇÃO
   ============================================================ */
const TITULOS = { resumo: "Resumo", servicos: "Serviços", quintas: "Quintas", conta: "Conta" };

function mudarView(v) {
  state.view = v;
  $$(".view").forEach((el) => el.classList.add("hidden"));
  $(`#view-${v}`).classList.remove("hidden");
  $$(".nav-btn").forEach((b) => b.classList.toggle("active", b.dataset.view === v));
  $("#view-title").textContent = TITULOS[v];
  $("#fab").classList.toggle("hidden", v === "conta");   // não há "+" na Conta
}

function aoCarregarFab() {
  // o FAB cria conforme a secção
  switch (state.view) {
    case "quintas": abrirModalQuinta(); break;
    default: // resumo ou serviços
      if (!state.quintas.length) { mudarView("quintas"); abrirModalQuinta(); toast("Cria primeiro a tua quinta."); }
      else abrirModalServico();
  }
}

/* ============================================================
   CONTA — estatísticas e palavra-passe
   ============================================================ */
function renderConta() {
  // dados do perfil (com recurso aos metadados do registo, se ainda não houver perfil)
  const pf = state.profile || {};
  const meta = (state.user && state.user.user_metadata) || {};
  $("#perfil-nome").value = pf.nome || meta.nome || "";
  $("#perfil-apelido").value = pf.apelido || meta.apelido || "";
  $("#perfil-numero").value = pf.numero || meta.numero || "";
  $("#perfil-username").value = pf.username || meta.username || "";
  $("#perfil-email").value = state.user ? state.user.email : (pf.email || "");

  let ganho = 0, pendente = 0, horas = 0;
  const porQuinta = {};
  for (const s of state.servicos) {
    const t = totalServico(s);
    const h = calcHoras(s.hora_inicio, s.hora_fim);
    ganho += t; horas += h;
    if (s.estado === "pendente") pendente += t;
    const nome = s.quinta_nome || "—";
    if (!porQuinta[nome]) porQuinta[nome] = { count: 0, ganho: 0, horas: 0 };
    porQuinta[nome].count++;
    porQuinta[nome].ganho += t;
    porQuinta[nome].horas += h;
  }

  $("#conta-ganho").textContent = fmtEUR(ganho);
  $("#conta-horas").textContent = fmtHoras(horas);
  $("#conta-num").textContent = state.servicos.length;
  $("#conta-pendente").textContent = fmtEUR(pendente);

  const entradas = Object.entries(porQuinta).sort((a, b) => b[1].ganho - a[1].ganho);
  const wrap = $("#conta-por-quinta");
  wrap.innerHTML = entradas.length
    ? entradas.map(([nome, v]) => `
        <div class="item" style="cursor:default">
          <div class="left">
            <div class="title">${escapeHtml(nome)}</div>
            <div class="sub">${v.count} ${v.count === 1 ? "vez" : "vezes"} · ${fmtHoras(v.horas)}</div>
          </div>
          <div class="right"><span class="amount money">${fmtEUR(v.ganho)}</span></div>
        </div>`).join("")
    : `<p class="empty">Ainda sem serviços.</p>`;
}

async function guardarPerfil(e) {
  e.preventDefault();
  if (!state.user) { toast("Sessão não encontrada."); return; }
  const username = $("#perfil-username").value.trim();
  if (username && !/^[a-zA-Z0-9_.]{3,}$/.test(username)) {
    toast("Username inválido: mínimo 3, só letras, números, _ ou ."); return;
  }
  const dados = {
    id: state.user.id,
    nome: $("#perfil-nome").value.trim() || null,
    apelido: $("#perfil-apelido").value.trim() || null,
    numero: $("#perfil-numero").value.trim() || null,
    username: username || null,
    email: state.user.email,
  };
  const { error } = await sb.from("profiles").upsert(dados);
  if (error) { toast(traduzErro(error.message)); return; }
  state.profile = dados;
  toast("Dados guardados! ✅");
}

async function trocarPassword(e) {
  e.preventDefault();
  const atual = $("#pw-atual").value;
  const nova = $("#pw-nova").value;
  const nova2 = $("#pw-nova2").value;
  if (nova.length < 6) { toast("A nova palavra-passe tem de ter pelo menos 6 caracteres."); return; }
  if (nova !== nova2) { toast("A confirmação não coincide com a nova palavra-passe."); return; }
  if (!state.user) { toast("Sessão não encontrada. Entra de novo."); return; }

  const btn = $("#form-password button[type=submit]");
  btn.disabled = true; btn.textContent = "A alterar…";

  // 1) confirmar a palavra-passe ATUAL
  const { error: e1 } = await sb.auth.signInWithPassword({ email: state.user.email, password: atual });
  if (e1) {
    toast("A palavra-passe atual está errada.");
    btn.disabled = false; btn.textContent = "Alterar palavra-passe";
    return;
  }
  // 2) definir a NOVA
  const { error: e2 } = await sb.auth.updateUser({ password: nova });
  btn.disabled = false; btn.textContent = "Alterar palavra-passe";
  if (e2) { toast("Erro: " + e2.message); return; }

  $("#form-password").reset();
  toast("Palavra-passe alterada! ✅");
}

// vindo do link do email (recuperação): definir nova palavra-passe
async function guardarRecovery(e) {
  e.preventDefault();
  const nova = $("#rec-nova").value, nova2 = $("#rec-nova2").value;
  if (nova.length < 6) { toast("A palavra-passe tem de ter pelo menos 6 caracteres."); return; }
  if (nova !== nova2) { toast("A confirmação não coincide."); return; }
  const { error } = await sb.auth.updateUser({ password: nova });
  if (error) { toast("Erro: " + error.message); return; }
  fecharModais();
  toast("Palavra-passe definida! ✅ Já estás dentro.");
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
// aceita vírgula OU ponto como separador decimal (ex.: "8,50" -> 8.5)
function parseNum(v) { return Number(String(v).replace(",", ".").trim()) || 0; }
// mostra um número com vírgula para o utilizador (ex.: 8.5 -> "8,5")
function comVirgula(n) { return n ? String(n).replace(".", ",") : ""; }

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
  ["#servico-quinta", "#servico-gorjeta"].forEach((s) =>
    $(s).addEventListener("input", atualizarPreviewServico));

  // seletor de horas próprio
  $$(".time-trigger").forEach((b) => b.addEventListener("click", () => abrirTimePicker(b)));
  $("#tp-ok").addEventListener("click", fecharTimePicker);
  $("#tp-close").addEventListener("click", fecharTimePicker);
  $("#time-picker").addEventListener("click", (e) => { if (e.target.id === "time-picker") fecharTimePicker(); });

  // seletor de data (calendário)
  $$(".date-trigger").forEach((b) => b.addEventListener("click", () => abrirDatePicker(b)));
  $("#dp-prev").addEventListener("click", () => { DP.view = new Date(DP.view.getFullYear(), DP.view.getMonth() - 1, 1); dpRender(); });
  $("#dp-next").addEventListener("click", () => { DP.view = new Date(DP.view.getFullYear(), DP.view.getMonth() + 1, 1); dpRender(); });
  $("#dp-today").addEventListener("click", () => dpEscolher(hojeISO()));
  $("#dp-close-btn").addEventListener("click", fecharDatePicker);
  $("#date-picker").addEventListener("click", (e) => { if (e.target.id === "date-picker") fecharDatePicker(); });

  $("#form-quinta").addEventListener("submit", guardarQuinta);
  $("#quinta-apagar").addEventListener("click", apagarQuinta);

  // conta
  $("#form-perfil").addEventListener("submit", guardarPerfil);
  $("#form-password").addEventListener("submit", trocarPassword);
  $("#conta-logout").addEventListener("click", () => sb.auth.signOut());
}

function mostrarApp(logado) {
  $("#login-view").classList.toggle("hidden", logado);
  $("#app").classList.toggle("hidden", !logado);
}

function init() {
  setupAuthUI();
  ligarEventos();
  registarServiceWorker();

  if (!configOK) {
    mostrarApp(false);
    return;
  }

  // trata o login/logout E a sessão inicial (dispara "INITIAL_SESSION")
  sb.auth.onAuthStateChange((evt, session) => {
    if (evt === "PASSWORD_RECOVERY") {
      state.user = session ? session.user : null;
      mostrarApp(true);
      carregarTudo();
      abrirModal("#modal-recovery");   // pede a nova palavra-passe
      return;
    }
    if (session) {
      state.user = session.user;
      mostrarApp(true);
      carregarTudo();
    } else {
      state.user = null;
      localStorage.removeItem("bandeja_cache");  // limpa dados offline ao sair
      mostrarApp(false);
    }
  });
}

function registarServiceWorker() {
  if ("serviceWorker" in navigator) {
    navigator.serviceWorker.register("sw.js").catch(() => {});
  }
}

document.addEventListener("DOMContentLoaded", init);
