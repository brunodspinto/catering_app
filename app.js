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
  modoServico: "feito",       // "feito" (já realizado) ou "agendado"
  mes: new Date(),            // mês mostrado no resumo
  editandoServico: null,      // serviço a ser editado (para manter o valor/hora histórico)
  horaInicioTocada: false,    // o utilizador já escolheu a hora à mão neste serviço?
  novoServicoId: null,        // id do serviço novo no formulário aberto (ver novoId)
  novaQuintaId: null,         // id da quinta nova no formulário aberto
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

// "Sáb, 15 ago" — para serviços agendados (saber o dia da semana importa)
const fmtDataLonga = (iso) => {
  const [y, m, d] = iso.split("-").map(Number);
  const s = new Date(y, m - 1, d).toLocaleDateString("pt-PT",
    { weekday: "short", day: "numeric", month: "short" });
  return s.charAt(0).toUpperCase() + s.slice(1);
};

const nomeMes = (d) =>
  d.toLocaleDateString("pt-PT", { month: "long", year: "numeric" });

// horas entre "HH:MM" e "HH:MM" (lida com passar da meia-noite)
// entrada igual à saída é um horário inválido (não um turno de 24h): devolve 0
function calcHoras(inicio, fim) {
  if (!inicio || !fim) return 0;
  const [h1, m1] = inicio.split(":").map(Number);
  const [h2, m2] = fim.split(":").map(Number);
  let ini = h1 * 60 + m1;
  let f = h2 * 60 + m2;
  if (f === ini) return 0;
  if (f < ini) f += 24 * 60; // terminou no dia seguinte
  return (f - ini) / 60;
}

// a partir de quantas horas um turno é invulgar (avisa, mas deixa guardar)
const TURNO_LONGO_HORAS = 16;

// valida o horário de um serviço realizado
// devolve { erro } (impede guardar), { aviso } (só informa) ou {}
function validarHorario(inicio, fim) {
  if (!inicio || !fim) return { erro: "Escolhe a hora de entrada e de saída." };
  if (calcHoras(inicio, fim) === 0)
    return { erro: "A hora de saída tem de ser diferente da hora de entrada." };
  const horas = calcHoras(inicio, fim);
  if (horas > TURNO_LONGO_HORAS)
    return { aviso: `Turno de ${fmtHoras(horas)} — confirma se as horas estão certas.` };
  return {};
}

// o que a quinta te paga — as gorjetas NÃO entram (são registadas à parte, na Conta)
function totalServico(s) {
  return calcHoras(s.hora_inicio, s.hora_fim) * Number(s.valor_hora);
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
    // ajuda o iPhone/iCloud a guardar a password (Face ID) ao criar conta
    $("#auth-password").setAttribute("autocomplete", modoCriarConta ? "new-password" : "current-password");
    $("#auth-error").classList.add("hidden");
  });

  $("#forgot-link").addEventListener("click", async (e) => {
    e.preventDefault();
    if (!configOK) { showAuthError("Falta configurar o config.js."); return; }
    const email = $("#auth-email").value.trim();
    if (!emailValido(email)) { showAuthError("Escreve primeiro o teu email aqui em cima."); return; }
    const { error } = await sb.auth.resetPasswordForEmail(email, { redirectTo: location.origin + location.pathname });
    if (error) { showAuthError(traduzErro(error.message)); return; }
    // mensagem igual exista ou não a conta (não revela que emails estão registados)
    toast("Se existir uma conta com este email, vais receber um link para repor a palavra-passe.");
  });

  $("#form-recovery").addEventListener("submit", guardarRecovery);

  $("#auth-form").addEventListener("submit", async (e) => {
    e.preventDefault();
    if (!configOK) { showAuthError("Falta configurar o config.js (ver README)."); return; }
    const email = $("#auth-email").value.trim();
    const password = $("#auth-password").value;
    const btn = $("#auth-submit");
    btn.disabled = true;
    btn.textContent = "A processar…";
    try {
      if (!emailValido(email)) throw new Error("Escreve um email válido.");
      if (modoCriarConta) {
        // ----- criar conta -----
        const nome = $("#auth-nome").value.trim();
        const apelido = $("#auth-apelido").value.trim();
        const numero = $("#auth-numero").value.trim();
        const username = $("#auth-username").value.trim();
        if (!nome) throw new Error("Escreve o teu nome.");
        if (!/^[a-zA-Z0-9_.]{3,}$/.test(username))
          throw new Error("Username inválido: mínimo 3 caracteres, só letras, números, _ ou .");
        const { data, error } = await sb.auth.signUp({
          email, password,
          options: { data: { nome, apelido, numero: numero || null, username } },
        });
        if (error) throw error;
        // com a confirmação de email ligada não há sessão até confirmar
        toast(data.session ? "Conta criada! ✅" : "Conta criada! Confirma o teu email para entrar.");
      } else {
        // ----- entrar (só por email) -----
        const { error } = await sb.auth.signInWithPassword({ email, password });
        if (error) throw error;
      }
    } catch (err) {
      showAuthError(modoCriarConta ? traduzErro(err.message) : erroLogin(err.message));
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

const emailValido = (email) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);

// erros do login: mensagem genérica, sem dizer se o email existe
function erroLogin(msg) {
  if (/escreve um email/i.test(msg)) return msg;
  if (/not confirmed/i.test(msg)) return "Confirma o email antes de entrar (vê a tua caixa de correio).";
  if (/rate limit|too many/i.test(msg)) return "Demasiadas tentativas. Espera uns minutos e tenta de novo.";
  if (/fetch|network/i.test(msg)) return "Sem ligação à internet.";
  return "Email ou senha errados.";
}

function traduzErro(msg) {
  if (/invalid login/i.test(msg)) return "Email ou senha errados.";
  if (/already registered/i.test(msg)) return "Esse email já tem conta. Tenta entrar.";
  // o trigger que cria o perfil falha quando o username já existe (índice único)
  if (/database error saving new user/i.test(msg))
    return "Não foi possível criar a conta. Esse username já deve estar a ser usado — escolhe outro.";
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

  // os agendados não entram em nenhuma conta
  const doMes = state.servicos.filter((s) => s.estado !== "agendado" && mesmoMes(s.data, state.mes));
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

  // recentes (só os já realizados)
  const recentes = state.servicos.filter((s) => s.estado !== "agendado").slice(0, 5);
  $("#resumo-recentes").innerHTML = recentes.length
    ? recentes.map(servicoItemHTML).join("")
    : `<p class="empty">Sem serviços.</p>`;
  ligarCliquesServico("#resumo-recentes");
}

/* ============================================================
   RENDER — SERVIÇOS
   ============================================================ */
function servicoItemHTML(s) {
  // agendado: ainda não tem horas nem valor
  if (s.estado === "agendado") {
    return `
    <div class="item" data-servico="${s.id}">
      <div class="left">
        <div class="title">${escapeHtml(s.quinta_nome || "—")}</div>
        <div class="sub">${fmtDataLonga(s.data)}${s.notas ? " · " + escapeHtml(s.notas) : ""}</div>
      </div>
      <div class="right"><span class="badge agendado">Agendado</span></div>
    </div>`;
  }

  const t = totalServico(s);
  const h = fmtHoras(calcHoras(s.hora_inicio, s.hora_fim));
  const horario = (s.hora_inicio && s.hora_fim)
    ? `${s.hora_inicio.slice(0, 5)}–${s.hora_fim.slice(0, 5)} · ${h}` : "sem horas";
  return `
    <div class="item" data-servico="${s.id}">
      <div class="left">
        <div class="title">${escapeHtml(s.quinta_nome || "—")}</div>
        <div class="sub">${fmtData(s.data)} · ${horario}${Number(s.gorjeta) ? " · gorjeta " + fmtEUR(s.gorjeta) : ""}</div>
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
  // agendados: mostrar primeiro o que está mais próximo
  if (state.filtroServico === "agendado")
    lista = [...lista].sort((a, b) => a.data.localeCompare(b.data));

  const wrap = $("#servicos-lista");
  const vazio = $("#servicos-vazio");
  vazio.classList.toggle("hidden", lista.length > 0);
  if (!lista.length) {
    vazio.innerHTML =
      !state.servicos.length ? "Ainda não há serviços. Carrega no <b>+</b> para adicionar."
      : state.filtroServico === "agendado" ? "Não tens serviços marcados.<br />Carrega no <b>+</b> e escolhe <b>Agendar</b>."
      : state.filtroServico === "pendente" ? "Não tens nada por receber. 🎉"
      : state.filtroServico === "pago"     ? "Ainda não marcaste nenhum serviço como pago."
      : "Sem serviços.";
  }
  wrap.innerHTML = lista.map(servicoItemHTML).join("");
  ligarCliquesServico("#servicos-lista");
  renderPorReceberPorQuinta();
}

// quanto (e quantas horas) cada quinta ainda te deve
function renderPorReceberPorQuinta() {
  const box = $("#servicos-resumo");
  const pendentes = state.servicos.filter((s) => s.estado === "pendente");
  const mostrar = state.filtroServico === "pendente" && pendentes.length > 1;
  box.classList.toggle("hidden", !mostrar);
  if (!mostrar) return;

  const porQuinta = {};
  for (const s of pendentes) {
    const nome = s.quinta_nome || "—";
    if (!porQuinta[nome]) porQuinta[nome] = { n: 0, horas: 0, valor: 0 };
    porQuinta[nome].n++;
    porQuinta[nome].horas += calcHoras(s.hora_inicio, s.hora_fim);
    porQuinta[nome].valor += totalServico(s);
  }

  const entradas = Object.entries(porQuinta).sort((a, b) => b[1].valor - a[1].valor);
  const totalValor = entradas.reduce((acc, [, v]) => acc + v.valor, 0);
  const totalHoras = entradas.reduce((acc, [, v]) => acc + v.horas, 0);

  const linha = (titulo, sub, valor, classe = "") => `
    <div class="resumo-linha ${classe}">
      <div class="left">
        <div class="title">${titulo}</div>
        <div class="sub">${sub}</div>
      </div>
      <span class="amount warn">${fmtEUR(valor)}</span>
    </div>`;

  $("#servicos-resumo-lista").innerHTML =
    entradas.map(([nome, v]) =>
      linha(escapeHtml(nome), `${v.n} ${v.n === 1 ? "serviço" : "serviços"} · ${fmtHoras(v.horas)}`, v.valor)
    ).join("")
    + (entradas.length > 1 ? linha("Total", fmtHoras(totalHoras), totalValor, "total") : "");
}

function ligarCliquesServico(sel) {
  $$(`${sel} [data-servico]`).forEach((el) => {
    el.addEventListener("click", () => abrirModalServico(el.dataset.servico));
  });
  // selo "Pago/Por receber" alterna com um toque (sem abrir o serviço)
  $$(`${sel} [data-pago]`).forEach((el) => {
    el.addEventListener("click", (e) => {
      e.stopPropagation();
      togglePagoServico(el.dataset.pago, el);
    });
  });
}

async function togglePagoServico(id, botao) {
  await executarMutacao(botao, async () => {
    const s = state.servicos.find((x) => x.id === id);
    if (!s) return;
    const novo = s.estado === "pago" ? "pendente" : "pago";
    const { error } = await sb.from("servicos").update({ estado: novo }).eq("id", id);
    if (error) { toast("Erro: " + error.message); return; }
    toast(novo === "pago" ? "Marcado como pago ✅" : "Marcado como por receber");
    await carregarTudo();
  });
}

/* ============================================================
   RENDER — QUINTAS
   ============================================================ */
function renderQuintas() {
  const wrap = $("#quintas-lista");
  $("#quintas-vazio").classList.toggle("hidden", state.quintas.length > 0);
  wrap.innerHTML = state.quintas.map((q) => {
    const detalhes = [];
    if (q.hora_inicio_padrao) detalhes.push("Início " + q.hora_inicio_padrao.slice(0, 5));
    if (q.latitude != null && q.longitude != null) detalhes.push("📍 localização");
    return `
    <div class="item" data-quinta="${q.id}">
      <div class="left">
        <div class="title">${escapeHtml(q.nome)}</div>
        ${detalhes.length ? `<div class="sub">${detalhes.join(" · ")}</div>` : ""}
      </div>
      <div class="right"><span class="amount">${fmtEUR(q.valor_hora)}</span><div class="muted">por hora</div></div>
    </div>`;
  }).join("");
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
  limparErroForm("servico-erro");
  // id do registo novo, fixo enquanto o formulário estiver aberto (ver novoId)
  state.novoServicoId = novo ? novoId() : null;
  state.editandoServico = novo ? null : (state.servicos.find((x) => x.id === id) || null);

  state.horaInicioTocada = false;
  state.notasAuto = "";
  modoServico(state.editandoServico?.estado === "agendado" ? "agendado" : "feito");

  if (novo) {
    preencherSelectQuintas();
    setData("servico-data", dataSugeridaServico());
    setHora("servico-inicio", horaPadraoDaQuinta());     // hora habitual da quinta
    setHora("servico-fim", horaAgoraArredondada());      // hora a que estás agora
    detetarQuinta(true);                                 // e em que quinta estás
    $("#detetar-quinta-linha").classList.toggle("hidden",
      !state.quintas.some((q) => q.latitude != null));
  } else {
    const s = state.editandoServico;
    if (!s) return;
    preencherSelectQuintas(s.quinta_id);
    setData("servico-data", s.data);
    setHora("servico-inicio", s.hora_inicio ? s.hora_inicio.slice(0, 5) : "");
    setHora("servico-fim", s.hora_fim ? s.hora_fim.slice(0, 5) : "");
    $("#servico-gorjeta").value = Number(s.gorjeta) ? comVirgula(s.gorjeta) : "";
    $("#servico-notas").value = s.notas || "";
    $("#servico-pago").checked = s.estado === "pago";
  }
  atualizarPreviewServico();
  sincronizarComAgendado();
  abrirModal("#modal-servico");
}

// "feito" = serviço já realizado (com horas) | "agendado" = só marcado (quinta + dia)
function modoServico(modo) {
  state.modoServico = modo;
  $$("#servico-modo .seg-btn").forEach((b) => b.classList.toggle("active", b.dataset.modo === modo));
  $$("#form-servico .so-feito").forEach((el) => el.classList.toggle("hidden", modo === "agendado"));
  sincronizarComAgendado();
  atualizarPreviewServico();
}

// há um serviço agendado para esta quinta e este dia? (então é esse que estou a fazer)
function agendadoCorrespondente() {
  if ($("#servico-id").value) return null;          // estou a editar, não a criar
  if (state.modoServico !== "feito") return null;   // só ao registar um serviço realizado
  const qid = $("#servico-quinta").value, data = $("#servico-data").value;
  if (!qid || !data) return null;
  return state.servicos.find(
    (s) => s.estado === "agendado" && s.quinta_id === qid && s.data === data) || null;
}

// se este dia/quinta já estava agendado, traz as notas desse agendado
// (a conclusão em si acontece ao guardar, sem avisos no formulário)
function sincronizarComAgendado() {
  if ($("#servico-id").value) return;   // a editar: não mexer nas notas
  const ag = agendadoCorrespondente();
  const campo = $("#servico-notas");
  if (campo.value === "" || campo.value === state.notasAuto) {
    campo.value = ag ? (ag.notas || "") : "";
    state.notasAuto = campo.value;
  }
}

// hora habitual de início definida na quinta escolhida (vazio se não tiver)
function horaPadraoDaQuinta() {
  const q = state.quintas.find((x) => x.id === $("#servico-quinta").value);
  return q && q.hora_inicio_padrao ? q.hora_inicio_padrao.slice(0, 5) : "";
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
  const inicio = $("#servico-inicio").value, fim = $("#servico-fim").value;
  const horas = calcHoras(inicio, fim);
  const total = horas * valorHora;
  $("#preview-horas").textContent = horas ? fmtHoras(horas) : "—";
  $("#preview-total").textContent = horas ? fmtEUR(total) : "—";

  // o formulário mudou: o erro da última tentativa de guardar deixa de se aplicar
  limparErroForm("servico-erro");

  // aviso (não bloqueia) por baixo das contas quando o turno é invulgarmente longo;
  // horas iguais são um erro, mostrado ao guardar
  const msg = $("#servico-horario-msg");
  const { aviso } = (state.modoServico === "feito" && inicio && fim) ? validarHorario(inicio, fim) : {};
  msg.textContent = aviso || "";
  msg.classList.toggle("hidden", !aviso);
}

async function guardarServico(e) {
  e.preventDefault();
  const botao = e.submitter || $("#form-servico button[type=submit]");
  await executarMutacao(botao, async () => {
    limparErroForm("servico-erro");
    const id = $("#servico-id").value;
    const qid = $("#servico-quinta").value;
    const q = state.quintas.find((x) => x.id === qid);
    if (!q) return erroForm("servico-erro", "Escolhe uma quinta.", $("#servico-quinta"));
    const agendado = state.modoServico === "agendado";
    if (!$("#servico-data").value)
      return erroForm("servico-erro", "Escolhe a data.", $(".date-trigger[data-target=servico-data]"));

    let gorjeta = 0;
    if (!agendado) {
      const { erro } = validarHorario($("#servico-inicio").value, $("#servico-fim").value);
      if (erro) return erroForm("servico-erro", erro, $(".time-trigger[data-target=servico-fim]"));
      const lida = lerEuros($("#servico-gorjeta").value, "Gorjeta", false);
      if (lida.erro) return erroForm("servico-erro", lida.erro, $("#servico-gorjeta"));
      gorjeta = lida.valor;
    }
    await gravarServico(id, q, agendado, gorjeta);
  });
}

// grava o serviço já validado: atualiza o que está a ser editado, conclui o agendado
// correspondente ou cria um novo (upsert com o id fixo do formulário: repetir não duplica)
async function gravarServico(id, q, agendado, gorjeta) {
  const qid = q.id;
  const dados = agendado ? {
    quinta_id: qid,
    quinta_nome: q.nome,
    valor_hora: valorHoraAtual(),
    data: $("#servico-data").value,
    hora_inicio: null,
    hora_fim: null,
    gorjeta: 0,
    estado: "agendado",
    notas: $("#servico-notas").value.trim() || null,
  } : {
    quinta_id: qid,
    quinta_nome: q.nome,
    valor_hora: valorHoraAtual(),    // "fotografia" do valor (mantém histórico ao editar)
    data: $("#servico-data").value,
    hora_inicio: $("#servico-inicio").value,
    hora_fim: $("#servico-fim").value,
    gorjeta,
    estado: $("#servico-pago").checked ? "pago" : "pendente",
    notas: $("#servico-notas").value.trim() || null,
  };

  // se este dia/quinta já estava agendado, conclui esse em vez de criar outro
  const ag = agendadoCorrespondente();

  let error;
  if (id)      ({ error } = await sb.from("servicos").update(dados).eq("id", id));
  else if (ag) ({ error } = await sb.from("servicos").update(dados).eq("id", ag.id));
  else         ({ error } = await sb.from("servicos").upsert({ id: state.novoServicoId, ...dados }));

  if (error) { toast("Erro: " + error.message); return; }
  fecharModais();
  toast(id ? "Serviço atualizado." : ag ? "Serviço agendado concluído ✅" : "Serviço guardado.");
  await carregarTudo();
}

async function apagarServico(e) {
  const id = $("#servico-id").value;
  if (!id) return;
  if (!confirm("Apagar este serviço?")) return;
  await executarMutacao(e.currentTarget, async () => {
    const { error } = await sb.from("servicos").delete().eq("id", id);
    if (error) { toast("Erro: " + error.message); return; }
    fecharModais();
    toast("Serviço apagado.");
    await carregarTudo();
  });
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

// constrói uma coluna a partir de uma lista de valores (ex.: [0,15,30,45])
function tpConstruirColuna(col, valores, selVal, onPick) {
  col.innerHTML = "";
  for (const v of valores) {
    const it = document.createElement("div");
    it.className = "tp-item" + (v === selVal ? " sel" : "");
    it.textContent = pad2(v);
    it.dataset.val = v;
    it.addEventListener("click", () => onPick(v));
    col.appendChild(it);
  }
}
function tpCentrar(col, valores, val, smooth) {
  const i = Math.max(0, valores.indexOf(val));
  col.scrollTo({ top: i * 44, behavior: smooth ? "smooth" : "auto" });
}
function tpMarcar(col, val) {
  col.querySelectorAll(".tp-item").forEach((el) =>
    el.classList.toggle("sel", Number(el.dataset.val) === val));
}
function tpAplicar() {
  const val = `${pad2(TP.h)}:${pad2(TP.m)}`;
  TP.input.value = val;
  TP.trigger.textContent = val;
  // se foi a hora de entrada, deixa de ser a sugestão automática da quinta
  if (TP.input.id === "servico-inicio") state.horaInicioTocada = true;
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

  const horas = Array.from({ length: 24 }, (_, i) => i);
  // minutos de 15 em 15; se um serviço antigo tiver outro valor, mantém-no na lista
  const minutos = [0, 15, 30, 45];
  if (!minutos.includes(TP.m)) { minutos.push(TP.m); minutos.sort((a, b) => a - b); }

  TP.horas = horas; TP.minutos = minutos;   // guardados para o botão "Agora"

  const colH = $("#tp-hours"), colM = $("#tp-mins");
  tpConstruirColuna(colH, horas, TP.h, (v) => { TP.h = v; tpMarcar(colH, v); tpCentrar(colH, horas, v, true); tpAplicar(); });
  tpConstruirColuna(colM, minutos, TP.m, (v) => { TP.m = v; tpMarcar(colM, v); tpCentrar(colM, minutos, v, true); tpAplicar(); });

  $("#time-picker").classList.remove("hidden");
  requestAnimationFrame(() => { tpCentrar(colH, horas, TP.h, false); tpCentrar(colM, minutos, TP.m, false); });
}
function fecharTimePicker() { $("#time-picker").classList.add("hidden"); }

// coloca uma hora nas duas colunas de uma vez (usado pelo botão "Agora")
function tpDefinir(h, m) {
  const colH = $("#tp-hours"), colM = $("#tp-mins");
  TP.h = h; TP.m = m;
  tpMarcar(colH, h); tpCentrar(colH, TP.horas, h, true);
  tpMarcar(colM, m); tpCentrar(colM, TP.minutos, m, true);
  tpAplicar();
}

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
  if (DP.trigger.dataset.target === "servico-data") sincronizarComAgendado();
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
   LOCALIZAÇÃO (reconhecer em que quinta estás)
   ============================================================ */
const RAIO_QUINTA = 1000;  // metros — a que distância se considera "estou aqui"

// distância em metros entre duas coordenadas (fórmula de Haversine)
function distanciaMetros(lat1, lon1, lat2, lon2) {
  const R = 6371000, r = Math.PI / 180;
  const dLat = (lat2 - lat1) * r, dLon = (lon2 - lon1) * r;
  const x = Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1 * r) * Math.cos(lat2 * r) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(x));
}

function obterLocalizacao() {
  return new Promise((resolve, reject) => {
    if (!navigator.geolocation) return reject(new Error("sem GPS"));
    navigator.geolocation.getCurrentPosition(
      (p) => resolve(p.coords), reject,
      { enableHighAccuracy: true, timeout: 8000, maximumAge: 60000 });
  });
}

// qual das minhas quintas está mais perto (se estiver dentro do raio)
function quintaMaisProxima(coords) {
  let melhor = null, dist = Infinity;
  for (const q of state.quintas) {
    if (q.latitude == null || q.longitude == null) continue;
    const d = distanciaMetros(coords.latitude, coords.longitude,
                              Number(q.latitude), Number(q.longitude));
    if (d < dist) { dist = d; melhor = q; }
  }
  return (melhor && dist <= RAIO_QUINTA) ? { quinta: melhor, metros: Math.round(dist) } : null;
}

// ao criar um serviço, tenta descobrir em que quinta estás (não bloqueia nada)
// vê se já há autorização SEM fazer aparecer o pedido do telemóvel
async function estadoLocalizacao() {
  try {
    if (!navigator.permissions || !navigator.permissions.query) return "desconhecido";
    return (await navigator.permissions.query({ name: "geolocation" })).state;
  } catch (e) { return "desconhecido"; }
}

// auto = true  -> ao abrir o "+" (só age se não incomodar)
// auto = false -> o utilizador tocou no botão 📍 (aí pode pedir à vontade)
async function detetarQuinta(auto) {
  if (!state.quintas.some((q) => q.latitude != null)) return;  // nenhuma quinta tem localização

  if (auto) {
    const estado = await estadoLocalizacao();
    if (estado === "denied") return;                    // já recusou: nunca mais pedir
    if (estado !== "granted") {
      // ainda não deu autorização: pergunta UMA única vez e nunca mais
      if (localStorage.getItem("bandeja_gps_pedido")) return;
      localStorage.setItem("bandeja_gps_pedido", "1");
    }
  }

  try {
    const perto = quintaMaisProxima(await obterLocalizacao());
    if ($("#modal-servico").classList.contains("hidden")) return;
    if ($("#servico-id").value) return;
    if (!perto) { if (!auto) toast("Não estás perto de nenhuma quinta guardada."); return; }
    if ($("#servico-quinta").value !== perto.quinta.id) {
      $("#servico-quinta").value = perto.quinta.id;
      $("#servico-quinta").dispatchEvent(new Event("change"));
    }
    toast(`📍 Estás na ${perto.quinta.nome}`);
  } catch (e) {
    if (!auto) toast(e && e.code === 1 ? "Autorização de localização recusada."
                                       : "Não consegui obter a localização.");
  }
}

function mostrarInfoLocalizacao(precisao) {
  const tem = !!$("#quinta-lat").value;
  $("#quinta-gps-info").textContent = !tem ? "Sem localização guardada"
    : precisao ? `Localização apanhada (precisão ~${precisao} m)`
               : "Localização guardada ✓";
  $("#quinta-gps-remover").classList.toggle("hidden", !tem);
}

async function capturarLocalizacaoQuinta() {
  const btn = $("#quinta-gps"), texto = btn.textContent;
  btn.disabled = true; btn.textContent = "A obter localização…";
  try {
    const c = await obterLocalizacao();
    $("#quinta-lat").value = c.latitude;
    $("#quinta-lon").value = c.longitude;
    mostrarInfoLocalizacao(Math.round(c.accuracy));
    toast("Localização apanhada — falta Guardar.");
  } catch (e) {
    toast(e && e.code === 1 ? "Autorização de localização recusada."
                            : "Não consegui obter a localização.");
  } finally {
    btn.disabled = false; btn.textContent = texto;
  }
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
  limparErroForm("quinta-erro");
  // id do registo novo, fixo enquanto o formulário estiver aberto (ver novoId)
  state.novaQuintaId = novo ? novoId() : null;
  if (novo) {
    setHora("quinta-hora", "");
    $("#quinta-lat").value = ""; $("#quinta-lon").value = "";
  } else {
    const q = state.quintas.find((x) => x.id === id);
    if (!q) return;
    $("#quinta-nome").value = q.nome;
    $("#quinta-valor").value = comVirgula(q.valor_hora);
    setHora("quinta-hora", q.hora_inicio_padrao ? q.hora_inicio_padrao.slice(0, 5) : "");
    $("#quinta-lat").value = q.latitude ?? "";
    $("#quinta-lon").value = q.longitude ?? "";
    $("#quinta-notas").value = q.notas || "";
  }
  mostrarInfoLocalizacao();
  abrirModal("#modal-quinta");
}

async function guardarQuinta(e) {
  e.preventDefault();
  const botao = e.submitter || $("#form-quinta button[type=submit]");
  await executarMutacao(botao, async () => {
    limparErroForm("quinta-erro");
    const id = $("#quinta-id").value;
    const nome = $("#quinta-nome").value.trim();
    if (!nome) return erroForm("quinta-erro", "Escreve o nome da quinta.", $("#quinta-nome"));
    const valor = lerEuros($("#quinta-valor").value, "Valor à hora", true);
    if (valor.erro) return erroForm("quinta-erro", valor.erro, $("#quinta-valor"));

    const dados = {
      nome,
      valor_hora: valor.valor,
      hora_inicio_padrao: $("#quinta-hora").value || null,
      latitude: $("#quinta-lat").value ? Number($("#quinta-lat").value) : null,
      longitude: $("#quinta-lon").value ? Number($("#quinta-lon").value) : null,
      notas: $("#quinta-notas").value.trim() || null,
    };

    // quinta nova: upsert com o id fixo do formulário (repetir o pedido não duplica)
    let error;
    if (id) ({ error } = await sb.from("quintas").update(dados).eq("id", id));
    else    ({ error } = await sb.from("quintas").upsert({ id: state.novaQuintaId, ...dados }));

    if (error) { toast("Erro: " + error.message); return; }
    fecharModais();
    toast(id ? "Quinta atualizada." : "Quinta guardada.");
    await carregarTudo();
  });
}

async function apagarQuinta(e) {
  const id = $("#quinta-id").value;
  if (!id) return;
  if (!confirm("Apagar esta quinta? Os serviços antigos mantêm-se com o nome guardado.")) return;
  await executarMutacao(e.currentTarget, async () => {
    const { error } = await sb.from("quintas").delete().eq("id", id);
    if (error) { toast("Erro: " + error.message); return; }
    fecharModais();
    toast("Quinta apagada.");
    await carregarTudo();
  });
}

/* ============================================================
   MODAIS — utilitários
   ============================================================ */
function abrirModal(sel) { $(sel).classList.remove("hidden"); }
function fecharModais() { $$(".modal").forEach((m) => m.classList.add("hidden")); }

/* ============================================================
   NAVEGAÇÃO
   ============================================================ */
const TITULOS = { resumo: "Resumo", servicos: "Serviços", conta: "Conta" };

function mudarView(v) {
  state.view = v;
  $$(".view").forEach((el) => el.classList.add("hidden"));
  $(`#view-${v}`).classList.remove("hidden");
  $$(".nav-btn").forEach((b) => b.classList.toggle("active", b.dataset.view === v));
  $("#view-title").textContent = TITULOS[v];
  $("#fab").classList.toggle("hidden", v === "conta");   // não há "+" na Conta
}

// o "+" cria sempre um serviço (as quintas criam-se na Conta → Quintas)
function aoCarregarFab() {
  if (!state.quintas.length) {
    mudarView("conta");
    mudarAbaConta("quintas");
    abrirModalQuinta();
    toast("Cria primeiro a tua quinta.");
    return;
  }
  abrirModalServico();
}

/* ============================================================
   CONTA — estatísticas e palavra-passe
   ============================================================ */
function renderConta() {
  renderPerfil();

  let ganho = 0, pendente = 0, horas = 0;
  const porQuinta = {};
  const feitos = state.servicos.filter((s) => s.estado !== "agendado");
  for (const s of feitos) {
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
  $("#conta-num").textContent = feitos.length;
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

  renderGorjetas();
}

// lista de gorjetas: dia, quinta e valor de cada uma
function renderGorjetas() {
  const lista = state.servicos.filter((s) => Number(s.gorjeta) > 0);
  const total = lista.reduce((acc, s) => acc + Number(s.gorjeta), 0);
  const doMes = lista.filter((s) => mesmoMes(s.data, new Date()))
                     .reduce((acc, s) => acc + Number(s.gorjeta), 0);

  $("#gorjetas-mes").textContent = fmtEUR(doMes);
  $("#gorjetas-total").textContent = fmtEUR(total);
  $("#gorjetas-vazio").classList.toggle("hidden", lista.length > 0);
  $("#gorjetas-lista").innerHTML = lista.map((s) => `
    <div class="item" data-gorjeta="${s.id}">
      <div class="left">
        <div class="title">${escapeHtml(s.quinta_nome || "—")}</div>
        <div class="sub">${fmtData(s.data)}</div>
      </div>
      <div class="right"><span class="amount money">${fmtEUR(s.gorjeta)}</span></div>
    </div>`).join("");

  $$("#gorjetas-lista [data-gorjeta]").forEach((el) =>
    el.addEventListener("click", () => abrirModalServico(el.dataset.gorjeta)));
}

function mudarAbaConta(aba) {
  $$(".conta-aba").forEach((el) => el.classList.add("hidden"));
  $("#conta-aba-" + aba).classList.remove("hidden");
  $$("#conta-abas .chip").forEach((c) => c.classList.toggle("active", c.dataset.aba === aba));
}

// mostra os dados do perfil (leitura) e prepara o formulário de edição
function renderPerfil() {
  const pf = state.profile || {};
  const meta = (state.user && state.user.user_metadata) || {};
  const dados = {
    nome:     pf.nome     || meta.nome     || "",
    apelido:  pf.apelido  || meta.apelido  || "",
    numero:   pf.numero   || meta.numero   || "",
    username: pf.username || meta.username || "",
    email:    state.user ? state.user.email : (pf.email || ""),
  };

  // cartão de leitura
  for (const [campo, valor] of Object.entries(dados))
    $("#ver-" + campo).textContent = valor || "—";

  // formulário (só se não estiver a meio de uma edição)
  if ($("#form-perfil").classList.contains("hidden")) {
    for (const campo of ["nome", "apelido", "numero", "username", "email"])
      $("#perfil-" + campo).value = dados[campo];
  }
}

function modoPerfil(editar) {
  $("#perfil-ver").classList.toggle("hidden", editar);
  $("#perfil-editar").classList.toggle("hidden", editar);
  $("#form-perfil").classList.toggle("hidden", !editar);
}

async function guardarPerfil(e) {
  e.preventDefault();
  const botao = e.submitter || $("#form-perfil button[type=submit]");
  await executarMutacao(botao, async () => {
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
    modoPerfil(false);
    renderPerfil();
    toast("Dados guardados! ✅");
  });
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
// hora atual do aparelho, arredondada à opção de 15 min mais próxima
// (ex.: 00:56 -> 01:00). O 60 rola sozinho para a hora seguinte.
function horaAgoraArredondada(agora = new Date()) {
  const d = new Date(agora);
  d.setMinutes(Math.round(d.getMinutes() / 15) * 15, 0, 0);
  return pad2(d.getHours()) + ":" + pad2(d.getMinutes());
}
// data sugerida ao criar um serviço: se ainda for madrugada (antes das 8h),
// o turno começou no dia anterior — sugere esse dia
function dataSugeridaServico(agora = new Date()) {
  const d = new Date(agora);
  if (d.getHours() < 8) d.setDate(d.getDate() - 1);
  const off = d.getTimezoneOffset();
  return new Date(d.getTime() - off * 60000).toISOString().slice(0, 10);
}
function escapeHtml(str) {
  return String(str).replace(/[&<>"']/g, (c) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}
// lê um valor em euros escrito pelo utilizador: vírgula OU ponto decimal, até 2 casas,
// "€" opcional (ex.: "8,50" -> 8.5, "8.5 €" -> 8.5, "-3" -> -3).
// Devolve null se não o conseguir ler (vazio, "abc", "1.000,50", "8,505").
function parseNum(v) {
  const s = String(v ?? "").replace(/€/g, "").replace(/\s+/g, "");
  if (!/^-?\d+([.,]\d{1,2})?$/.test(s)) return null;
  return Number(s.replace(",", "."));
}
// valida um campo em euros: devolve { valor } ou { erro } com uma mensagem para o formulário
// (campo opcional vazio vale 0)
function lerEuros(texto, rotulo, obrigatorio) {
  if (String(texto ?? "").trim() === "")
    return obrigatorio ? { erro: `${rotulo}: escreve um valor (ex.: 8,50).` } : { valor: 0 };
  const n = parseNum(texto);
  if (n === null) return { erro: `${rotulo}: valor inválido. Escreve só o número, por exemplo 8,50.` };
  if (n < 0) return { erro: `${rotulo}: o valor não pode ser negativo.` };
  return { valor: n };
}
// mostra um número com vírgula para o utilizador (ex.: 8.5 -> "8,5"; 0 -> "0")
function comVirgula(n) { return n == null || n === "" ? "" : String(n).replace(".", ","); }

// id gerado no cliente para registos novos. O formulário usa sempre o mesmo id enquanto
// está aberto, por isso repetir o pedido (ex.: a resposta perdeu-se) atualiza o mesmo
// registo em vez de criar outro. crypto.randomUUID só existe em https/localhost; noutros
// casos (ex.: testar no telemóvel por http na rede local) gera um UUID v4 equivalente.
function novoId() {
  if (crypto.randomUUID) return crypto.randomUUID();
  const b = crypto.getRandomValues(new Uint8Array(16));
  b[6] = (b[6] & 0x0f) | 0x40;
  b[8] = (b[8] & 0x3f) | 0x80;
  const h = Array.from(b, (x) => x.toString(16).padStart(2, "0")).join("");
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
}

// erro de validação mostrado dentro do formulário (e foco no campo em causa)
function erroForm(elId, msg, campo) {
  const el = $("#" + elId);
  el.textContent = msg;
  el.classList.remove("hidden");
  if (campo) { campo.setAttribute("aria-invalid", "true"); campo.focus(); }
}
function limparErroForm(elId) {
  const el = $("#" + elId);
  el.textContent = "";
  el.classList.add("hidden");
  const form = el.closest("form");
  if (form) form.querySelectorAll("[aria-invalid]").forEach((c) => c.removeAttribute("aria-invalid"));
}

// escritas em curso, por formulário (ou pelo próprio botão, fora de formulários)
const mutacoesEmCurso = new WeakSet();

// corre uma escrita na base de dados sem deixar repetir: enquanto o pedido não termina,
// os botões do formulário ficam desativados e novos cliques/submits são ignorados
async function executarMutacao(botao, fn) {
  const chave = botao.form || botao;
  if (mutacoesEmCurso.has(chave)) return;
  mutacoesEmCurso.add(chave);
  const botoes = botao.form ? Array.from(botao.form.querySelectorAll("button")) : [botao];
  const desativados = botoes.filter((b) => !b.disabled);   // só reativa os que estavam ativos
  desativados.forEach((b) => { b.disabled = true; });
  botao.setAttribute("aria-busy", "true");
  try {
    await fn();
  } catch (err) {
    toast("Erro: " + (err && err.message ? err.message : err));
  } finally {
    desativados.forEach((b) => { b.disabled = false; });
    botao.removeAttribute("aria-busy");
    mutacoesEmCurso.delete(chave);
  }
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
  $("#servico-gorjeta").addEventListener("input", atualizarPreviewServico);
  $$("#servico-modo .seg-btn").forEach((b) =>
    b.addEventListener("click", () => modoServico(b.dataset.modo)));
  // trocar de quinta: num serviço novo, propõe a hora habitual dessa quinta
  $("#servico-quinta").addEventListener("change", () => {
    const novo = !$("#servico-id").value;
    if (novo && !state.horaInicioTocada) setHora("servico-inicio", horaPadraoDaQuinta());
    atualizarPreviewServico();
    sincronizarComAgendado();
  });

  // seletor de horas próprio
  $$(".time-trigger").forEach((b) => b.addEventListener("click", () => abrirTimePicker(b)));
  $("#tp-agora").addEventListener("click", () => {
    const [h, m] = horaAgoraArredondada().split(":").map(Number);
    tpDefinir(h, m);
  });
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
  $("#nova-quinta").addEventListener("click", () => abrirModalQuinta());
  $("#quinta-apagar").addEventListener("click", apagarQuinta);
  $("#quinta-gps").addEventListener("click", capturarLocalizacaoQuinta);
  $("#detetar-quinta").addEventListener("click", () => detetarQuinta(false));
  $("#quinta-gps-remover").addEventListener("click", () => {
    $("#quinta-lat").value = ""; $("#quinta-lon").value = "";
    mostrarInfoLocalizacao();
    toast("Localização removida — falta Guardar.");
  });

  // conta
  $$("#conta-abas .chip").forEach((c) =>
    c.addEventListener("click", () => mudarAbaConta(c.dataset.aba)));
  $("#form-perfil").addEventListener("submit", guardarPerfil);
  $("#perfil-editar").addEventListener("click", () => modoPerfil(true));
  $("#perfil-cancelar").addEventListener("click", () => {
    modoPerfil(false);
    renderPerfil();          // desfaz alterações não guardadas
  });
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
