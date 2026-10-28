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

// arredonda primeiro ao minuto: somas de horas decimais (ex.: 2,99999…) davam "2h60"
const fmtHoras = (h) => {
  const totalMin = Math.round(h * 60);
  const horas = Math.floor(totalMin / 60);
  const min = totalMin % 60;
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
let toastTimer, toastTextoTimer;
// o #toast é uma região live (role="status"): o texto só é escrito depois de a região
// estar visível e vazia, para os leitores de ecrã anunciarem mesmo mensagens repetidas
function toast(msg) {
  const t = $("#toast");
  clearTimeout(toastTimer);
  clearTimeout(toastTextoTimer);
  t.textContent = "";
  t.classList.remove("hidden");
  toastTextoTimer = setTimeout(() => { t.textContent = msg; }, 50);
  toastTimer = setTimeout(() => t.classList.add("hidden"), 2650);
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
    // contas novas: mínimo PW_MIN; ao entrar aceita as senhas antigas, mais curtas
    $("#auth-password").setAttribute("minlength", modoCriarConta ? PW_MIN : 6);
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
        if (password.length < PW_MIN) throw new Error(MSG_PW_CURTA);
        if (!/^[A-Za-z0-9_.]{3,30}$/.test(username))
          throw new Error("Username inválido: 3 a 30 caracteres, só letras, números, _ ou .");
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

// tamanho mínimo das palavras-passe novas (igual ao definido no Supabase → Auth)
const PW_MIN = 8;
const MSG_PW_CURTA = `A palavra-passe tem de ter pelo menos ${PW_MIN} caracteres.`;

const emailValido = (email) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);

// erros do login: mensagem genérica, sem dizer se o email existe
function erroLogin(msg) {
  if (/escreve um email/i.test(msg)) return msg;
  if (/not confirmed/i.test(msg)) return "Confirma o email antes de entrar (vê a tua caixa de correio).";
  if (/rate limit|too many/i.test(msg)) return "Demasiadas tentativas. Espera uns minutos e tenta de novo.";
  if (erroDeRede(msg)) return "Sem ligação à internet.";
  return "Email ou senha errados.";
}

// falha de rede, seja qual for o browser: "Failed to fetch" (Chrome),
// "Load failed" (Safari/iPhone), "NetworkError…" (Firefox)
const erroDeRede = (msg) => /fetch|network|load failed|internet connection|offline/i.test(msg || "");

// mensagem para o utilizador quando uma escrita falha
function msgErro(err) {
  const msg = err && err.message ? err.message : String(err);
  return erroDeRede(msg) ? MSG_SEM_REDE : "Erro: " + msg;
}
const MSG_SEM_REDE = "Sem internet — não foi guardado. Tenta de novo quando tiveres rede.";

function traduzErro(msg) {
  if (/invalid login/i.test(msg)) return "Email ou senha errados.";
  if (/already registered/i.test(msg)) return "Esse email já tem conta. Tenta entrar.";
  // o trigger que cria o perfil falha quando o username já existe (índice único)
  if (/database error saving new user/i.test(msg))
    return "Não foi possível criar a conta. Esse username já deve estar a ser usado — escolhe outro.";
  // regras de validação da base de dados (CHECK): limites de tamanho, formatos, valores negativos
  if (/check constraint/i.test(msg))
    return "Alguns dados são inválidos ou demasiado longos. Verifica os campos.";
  if (/duplicate key|already exists|unique/i.test(msg)) return "Esse username já está a ser usado. Escolhe outro.";
  if (/confirm/i.test(msg)) return "Confirma o email antes de entrar (vê a tua caixa de correio).";
  if (/password/i.test(msg)) return MSG_PW_CURTA;
  return msg;
}

/* ============================================================
   CARREGAR DADOS
   ============================================================ */
// o Supabase devolve no máximo 1000 linhas por pedido: pede os serviços aos bocados
// até vir tudo (senão, com muitos serviços, os mais antigos faltavam nos totais)
const TAMANHO_PAGINA = 1000;
async function carregarServicos() {
  const todos = [];
  for (let de = 0; ; de += TAMANHO_PAGINA) {
    const { data, error } = await sb.from("servicos").select("*")
      .order("data", { ascending: false })
      .order("id")                       // desempate fixo: as páginas não se sobrepõem
      .range(de, de + TAMANHO_PAGINA - 1);
    if (error) throw error;
    todos.push(...(data || []));
    if (!data || data.length < TAMANHO_PAGINA) return todos;
  }
}

// cada carregamento leva um número; se entretanto começou outro, a resposta deste
// (mais antiga) é ignorada e não pode tapar dados mais recentes
let carregamentoAtual = 0;

async function carregarTudo() {
  const meu = ++carregamentoAtual;
  const desatualizado = () => meu !== carregamentoAtual;
  // ao abrir a app: mostra já a cópia guardada enquanto os dados novos não chegam
  // (sem rede, o Supabase repete cada pedido 3 vezes — ~7 s — antes de desistir)
  const cacheInicial = !state.servicos.length && !state.quintas.length ? lerCache() : null;
  if (cacheInicial) {
    aplicarCache(cacheInicial);
    aplicarPendentes();
    renderTudo();
  }
  try {
    // o aparelho sabe que está sem rede: nem tenta (evita as repetições)
    if (!navigator.onLine) throw new Error("network: offline");
    const [q, servicos, p] = await Promise.all([
      sb.from("quintas").select("*").order("nome"),
      carregarServicos(),
      sb.from("profiles").select("*").eq("id", state.user.id).maybeSingle(),
    ]);
    if (desatualizado()) return;
    if (q.error) throw q.error;
    state.quintas = q.data || [];
    state.servicos = servicos;
    state.profile = p.data || null;
    guardarCache();
    aplicarPendentes();   // o que ainda não foi enviado continua a aparecer como está neste aparelho
  } catch (err) {
    if (desatualizado()) return;
    // não deu para carregar: mostrar a última cópia guardada (se houver) e dizer porquê
    const semRede = !navigator.onLine || erroDeRede(err && err.message);
    const cache = lerCache();
    if (cache) { aplicarCache(cache); aplicarPendentes(); }
    toast(semRede
      ? (cache ? "Sem internet — a mostrar os últimos dados guardados."
               : "Sem internet e sem dados guardados neste aparelho. Liga-te à internet para veres os teus dados.")
      : (cache ? "Não foi possível atualizar os dados — a mostrar os últimos guardados."
               : "Não foi possível carregar os teus dados. Fecha e volta a abrir a app."));
  }
  renderTudo();
  if (sync.fila.length) sincronizar();
}

// guarda a cópia offline do que está na app (já com as alterações por enviar:
// voltar a aplicá-las por cima não muda nada)
function guardarCache() {
  try {
    localStorage.setItem("bandeja_cache", JSON.stringify({
      userId: state.user.id, quintas: state.quintas, servicos: state.servicos, profile: state.profile }));
  } catch (e) {}
}

// a cópia offline só serve se for do utilizador com sessão (num aparelho partilhado,
// nunca mostrar os dados de outra pessoa)
function lerCache() {
  try {
    const cache = JSON.parse(localStorage.getItem("bandeja_cache"));
    return cache && state.user && cache.userId === state.user.id ? cache : null;
  } catch (e) { return null; }
}

function aplicarCache(cache) {
  state.quintas = cache.quintas || [];
  state.servicos = cache.servicos || [];
  state.profile = cache.profile || null;
}

// esquece os dados do utilizador anterior (ao sair, ou antes de carregar outro)
function limparDados() {
  state.quintas = [];
  state.servicos = [];
  state.profile = null;
  sync.fila = [];
  sync.conflitos = [];
}

// app reaberta depois de algum tempo em segundo plano: volta a buscar os dados
// (o telemóvel pode ter ficado dias com a app suspensa e outro aparelho ter mudado algo)
const RECARREGAR_APOS_MS = 5 * 60 * 1000;
let escondidaDesde = null;
function aoMudarVisibilidade() {
  if (document.hidden) { escondidaDesde = Date.now(); return; }
  const longe = escondidaDesde && Date.now() - escondidaDesde >= RECARREGAR_APOS_MS;
  escondidaDesde = null;
  if (longe && state.user && !janelas.length) carregarTudo();   // não mexe a meio de um formulário
}

function renderTudo() {
  renderAvisosSync();
  renderResumo();
  renderServicos();
  renderQuintas();
  renderConta();
  restaurarFocoPendente();
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
// parte clicável de um item de lista: um <button> (focável e acionável com Enter/Espaço)
// que ocupa a linha toda através de um ::after; outros controlos do item ficam por cima.
// (o item em si não pode ser um <button>: tem outro botão lá dentro, o selo pago/por receber)
function itemBotaoHTML(dataAttr, id, tituloHTML, subHTML) {
  return `
      <button type="button" class="left item-abrir" data-${dataAttr}="${id}">
        <span class="title">${tituloHTML}</span>${subHTML ? `
        <span class="sub">${subHTML}</span>` : ""}
      </button>`;
}

function servicoItemHTML(s) {
  // agendado: ainda não tem horas nem valor
  if (s.estado === "agendado") {
    // o dia já passou e ainda não foi registado: lembrar de lhe pôr as horas
    const passou = s.data < hojeISO();
    return `
    <div class="item item-clicavel">${itemBotaoHTML("servico", s.id, escapeHtml(s.quinta_nome || "—"),
        fmtDataLonga(s.data) + (s.notas ? " · " + escapeHtml(s.notas) : ""))}
      <div class="right"><span class="badge ${passou ? "atrasado" : "agendado"}"${passou
        ? ` title="Abre o serviço e regista as horas"` : ""}>${passou ? "Já passou" : "Agendado"}</span>${seloSync("servicos", s.id)}</div>
    </div>`;
  }

  const t = totalServico(s);
  const h = fmtHoras(calcHoras(s.hora_inicio, s.hora_fim));
  const horario = (s.hora_inicio && s.hora_fim)
    ? `${s.hora_inicio.slice(0, 5)}–${s.hora_fim.slice(0, 5)} · ${h}` : "sem horas";
  const pago = s.estado === "pago";
  return `
    <div class="item item-clicavel">${itemBotaoHTML("servico", s.id, escapeHtml(s.quinta_nome || "—"),
        `${fmtData(s.data)} · ${horario}${Number(s.gorjeta) ? " · gorjeta " + fmtEUR(s.gorjeta) : ""}`)}
      <div class="right">
        <div class="amount money">${fmtEUR(t)}</div>
        <button type="button" class="badge ${s.estado}" data-pago="${s.id}" title="Tocar para alternar pago/por receber"
          aria-label="${pago ? "Pago" : "Por receber"}: marcar como ${pago ? "por receber" : "pago"}">${pago ? "Pago" : "Por receber"}</button>${seloSync("servicos", s.id)}
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
    focoPendente = `[data-pago="${id}"]`;   // o selo é redesenhado: devolver-lhe o foco
    registarAlteracao("servicos", "editar", id, { estado: novo });
    toastGravado(novo === "pago" ? "Marcado como pago ✅" : "Marcado como por receber.");
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
    if (q.latitude != null && q.longitude != null) detalhes.push(`<span aria-hidden="true">📍</span> localização`);
    return `
    <div class="item item-clicavel">${itemBotaoHTML("quinta", q.id, escapeHtml(q.nome), detalhes.join(" · "))}
      <div class="right"><span class="amount">${fmtEUR(q.valor_hora)}</span><div class="muted">por hora</div>${seloSync("quintas", q.id)}</div>
    </div>`;
  }).join("");
  $$("#quintas-lista [data-quinta]").forEach((el) => {
    el.addEventListener("click", () => abrirModalQuinta(el.dataset.quinta));
  });
}

/* ============================================================
   MODAL SERVIÇO
   ============================================================ */
// valor do <select> para um serviço cuja quinta já foi apagada (mantém o nome e o valor guardados)
const QUINTA_APAGADA = "__apagada";

// servico: o serviço a editar (se for de uma quinta que já não existe, essa opção aparece
// e fica escolhida — senão o browser escolhia a primeira quinta sem avisar)
function preencherSelectQuintas(servico) {
  const sel = $("#servico-quinta");
  const apagada = servico && !state.quintas.some((q) => q.id === servico.quinta_id);
  const opcoes = state.quintas.map((q) => `<option value="${q.id}">${escapeHtml(q.nome)}</option>`);
  if (apagada) opcoes.unshift(`<option value="${QUINTA_APAGADA}">${escapeHtml(servico.quinta_nome || "—")} (apagada)</option>`);
  sel.innerHTML = opcoes.join("") || `<option value="">(cria uma quinta primeiro)</option>`;
  if (servico) sel.value = apagada ? QUINTA_APAGADA : servico.quinta_id;
}

// a quinta escolhida no formulário ({ id, nome, valor_hora }); a apagada fica sem id
function quintaEscolhida() {
  const qid = $("#servico-quinta").value;
  const edit = state.editandoServico;
  if (qid === QUINTA_APAGADA && edit) return { id: null, nome: edit.quinta_nome, valor_hora: edit.valor_hora };
  return state.quintas.find((x) => x.id === qid) || null;
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
    preencherSelectQuintas(s);
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
  $$("#servico-modo .seg-btn").forEach((b) => marcarAtivo(b, b.dataset.modo === modo));
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
// Um agendado ainda não foi trabalhado: o valor que guardou ao marcar pode estar
// desatualizado, por isso usa sempre o valor atual (igual a concluí-lo pelo "+").
function valorHoraAtual() {
  const qid = $("#servico-quinta").value;
  const q = quintaEscolhida();
  const edit = state.editandoServico;
  if (edit && (qid === QUINTA_APAGADA || (edit.estado !== "agendado" && edit.quinta_id === qid)))
    return Number(edit.valor_hora);
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
    const q = quintaEscolhida();
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

  fecharModais();
  if (id)      registarAlteracao("servicos", "editar", id, dados);
  else if (ag) registarAlteracao("servicos", "editar", ag.id, dados);
  else         registarAlteracao("servicos", "novo", state.novoServicoId, dados);
  toastGravado(id ? "Serviço atualizado." : ag ? "Serviço agendado concluído ✅" : "Serviço guardado.");
}

async function apagarServico(e) {
  const id = $("#servico-id").value;
  if (!id) return;
  if (!confirm("Apagar este serviço?")) return;
  await executarMutacao(e.currentTarget, async () => {
    fecharModais();
    registarAlteracao("servicos", "apagar", id);
    toastGravado("Serviço apagado.");
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
// cada valor é um <button>: Enter/Espaço escolhe; ↑↓ (e Home/End) mudam o foco na coluna.
// Só o valor escolhido está na ordem do Tab ("roving tabindex").
function tpConstruirColuna(col, valores, selVal, onPick, unidade) {
  col.innerHTML = "";
  for (const v of valores) {
    const it = document.createElement("button");
    it.type = "button";
    it.className = "tp-item";
    it.textContent = pad2(v);
    it.dataset.val = v;
    it.setAttribute("aria-label", `${v} ${unidade}`);
    it.addEventListener("click", () => onPick(v));
    col.appendChild(it);
  }
  tpMarcar(col, selVal);
}
function tpCentrar(col, valores, val, smooth) {
  const i = Math.max(0, valores.indexOf(val));
  col.scrollTo({ top: i * 44, behavior: smooth ? "smooth" : "auto" });
}
function tpMarcar(col, val) {
  col.querySelectorAll(".tp-item").forEach((el) => {
    const sel = Number(el.dataset.val) === val;
    el.classList.toggle("sel", sel);
    el.setAttribute("aria-pressed", String(sel));
    el.tabIndex = sel ? 0 : -1;
  });
}
// ↑↓ Home End dentro de uma coluna do seletor de horas (só move o foco; Enter/Espaço escolhe)
function tpTeclas(e) {
  const itens = Array.from(e.currentTarget.querySelectorAll(".tp-item"));
  const i = itens.indexOf(document.activeElement);
  if (i === -1) return;
  const destino = { ArrowUp: i - 1, ArrowDown: i + 1, Home: 0, End: itens.length - 1 }[e.key];
  if (destino === undefined) return;
  e.preventDefault();
  const alvo = itens[(destino + itens.length) % itens.length];   // dá a volta (23 → 00)
  itens.forEach((el) => { el.tabIndex = el === alvo ? 0 : -1; });
  alvo.focus();
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
  tpConstruirColuna(colH, horas, TP.h, (v) => { TP.h = v; tpMarcar(colH, v); tpCentrar(colH, horas, v, true); tpAplicar(); }, "horas");
  tpConstruirColuna(colM, minutos, TP.m, (v) => { TP.m = v; tpMarcar(colM, v); tpCentrar(colM, minutos, v, true); tpAplicar(); }, "minutos");

  abrirJanela($("#time-picker"), colH.querySelector(".tp-item.sel"));
  requestAnimationFrame(() => { tpCentrar(colH, horas, TP.h, false); tpCentrar(colM, minutos, TP.m, false); });
}
function fecharTimePicker() { fecharJanela($("#time-picker")); }

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

// data por extenso para leitores de ecrã (ex.: "sexta-feira, 18 de setembro de 2026")
function fmtDataExtenso(iso) {
  const [y, m, d] = iso.split("-").map(Number);
  return new Date(y, m - 1, d).toLocaleDateString("pt-PT",
    { weekday: "long", day: "numeric", month: "long", year: "numeric" });
}

// desenha o mês de DP.view. Cada dia é um <button>; só um está na ordem do Tab
// (focoIso, o escolhido, hoje ou o dia 1). Com focar = true, põe o foco nesse dia.
function dpRender(focoIso, focar) {
  const y = DP.view.getFullYear(), m = DP.view.getMonth();
  const titulo = DP.view.toLocaleDateString("pt-PT", { month: "long", year: "numeric" });
  $("#dp-month").textContent = titulo.charAt(0).toUpperCase() + titulo.slice(1);
  $("#dp-week").innerHTML = DIAS_SEMANA.map((d) => `<span>${d}</span>`).join("");
  const offset = (new Date(y, m, 1).getDay() + 6) % 7;   // semana começa à segunda
  const dias = new Date(y, m + 1, 0).getDate();
  const hoje = hojeISO();
  const doMes = (iso) => iso && iso.startsWith(`${y}-${pad2(m + 1)}-`);
  const alvo = [focoIso, DP.selected, hoje].find(doMes) || `${y}-${pad2(m + 1)}-01`;
  let html = "";
  for (let i = 0; i < offset; i++) html += `<div class="dp-cell empty" aria-hidden="true"></div>`;
  for (let d = 1; d <= dias; d++) {
    const iso = `${y}-${pad2(m + 1)}-${pad2(d)}`;
    const cls = ["dp-cell"];
    if (iso === hoje) cls.push("today");
    if (iso === DP.selected) cls.push("sel");
    html += `<button type="button" class="${cls.join(" ")}" data-iso="${iso}" tabindex="${iso === alvo ? 0 : -1}"
      aria-label="${fmtDataExtenso(iso)}"${iso === hoje ? ` aria-current="date"` : ""}
      aria-pressed="${iso === DP.selected}">${d}</button>`;
  }
  $("#dp-grid").innerHTML = html;
  $$("#dp-grid .dp-cell[data-iso]").forEach((c) =>
    c.addEventListener("click", () => dpEscolher(c.dataset.iso)));
  if (focar) $(`#dp-grid [data-iso="${alvo}"]`).focus();
}

// setas no calendário: ←→ dia anterior/seguinte, ↑↓ semana anterior/seguinte,
// Home/End início/fim da semana, PageUp/PageDown mês anterior/seguinte (muda de mês se preciso)
function dpTeclas(e) {
  const atual = document.activeElement && document.activeElement.dataset.iso;
  if (!atual) return;
  const [y, m, d] = atual.split("-").map(Number);
  const dt = new Date(y, m - 1, d);
  const diaSemana = (dt.getDay() + 6) % 7;   // 0 = segunda
  switch (e.key) {
    case "ArrowLeft":  dt.setDate(d - 1); break;
    case "ArrowRight": dt.setDate(d + 1); break;
    case "ArrowUp":    dt.setDate(d - 7); break;
    case "ArrowDown":  dt.setDate(d + 7); break;
    case "Home":       dt.setDate(d - diaSemana); break;
    case "End":        dt.setDate(d + (6 - diaSemana)); break;
    case "PageUp":     dt.setMonth(m - 2, Math.min(d, new Date(y, m - 1, 0).getDate())); break;
    case "PageDown":   dt.setMonth(m, Math.min(d, new Date(y, m + 1, 0).getDate())); break;
    default: return;
  }
  e.preventDefault();
  const iso = `${dt.getFullYear()}-${pad2(dt.getMonth() + 1)}-${pad2(dt.getDate())}`;
  DP.view = new Date(dt.getFullYear(), dt.getMonth(), 1);
  dpRender(iso, true);
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
  $("#dp-titulo").textContent = trigger.dataset.titulo || "Escolher data";
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
  abrirJanela($("#date-picker"), $('#dp-grid [tabindex="0"]'));
}
function fecharDatePicker() { fecharJanela($("#date-picker")); }

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

    // quinta nova: o id fixo do formulário (repetir o pedido não duplica)
    fecharModais();
    if (id) registarAlteracao("quintas", "editar", id, dados);
    else    registarAlteracao("quintas", "novo", state.novaQuintaId, dados);
    toastGravado(id ? "Quinta atualizada." : "Quinta guardada.");
  });
}

async function apagarQuinta(e) {
  const id = $("#quinta-id").value;
  if (!id) return;
  if (!confirm("Apagar esta quinta? Os serviços antigos mantêm-se com o nome guardado.")) return;
  await executarMutacao(e.currentTarget, async () => {
    fecharModais();
    registarAlteracao("quintas", "apagar", id);
    toastGravado("Quinta apagada.");
  });
}

/* ============================================================
   GRAVAR SEM INTERNET — fila de alterações e conflitos
   ============================================================ */
// Serviços e quintas gravam-se sempre por aqui: a alteração aparece logo na app, fica
// guardada no telemóvel e entra numa fila que é enviada quando houver rede.
// No servidor cada linha tem uma "versao" que sobe a cada alteração. Uma alteração da fila
// diz em que versão se baseou e só é aceite se a linha ainda estiver nessa versão; se não
// estiver, outro aparelho mexeu-lhe entretanto: a app junta as duas alterações sozinha e
// só pergunta quando o MESMO campo ficou diferente nos dois aparelhos.

// campos comparados em cada tabela; os do mesmo grupo andam juntos
// (escolher a quinta de um serviço traz também o nome e o valor/hora dessa quinta)
const GRUPOS = {
  servicos: {
    quinta: ["quinta_id", "quinta_nome", "valor_hora"], data: ["data"],
    hora_inicio: ["hora_inicio"], hora_fim: ["hora_fim"], gorjeta: ["gorjeta"],
    estado: ["estado"], notas: ["notas"],
  },
  quintas: {
    nome: ["nome"], valor_hora: ["valor_hora"], hora_inicio_padrao: ["hora_inicio_padrao"],
    localizacao: ["latitude", "longitude"], notas: ["notas"],
  },
};
const ROTULOS = {
  quinta: "Quinta", data: "Data", hora_inicio: "Hora de entrada", hora_fim: "Hora de saída",
  gorjeta: "Gorjeta", estado: "Estado", notas: "Notas", nome: "Nome", valor_hora: "Valor à hora",
  hora_inicio_padrao: "Hora habitual de início", localizacao: "Localização",
};

// fila: alterações por enviar, pela ordem em que foram feitas
//   { tabela, tipo: "novo" | "editar" | "apagar", id, base, dados, quando }
//   base = a linha como estava no servidor (com a versão) quando se começou a mudar
// conflitos: alterações que precisam de uma decisão (ver resolverConflito)
const sync = { fila: [], conflitos: [], aEnviar: false, tentarDeNovo: null };

const copia = (x) => (x == null ? null : JSON.parse(JSON.stringify(x)));
const listaDe = (tabela) => (tabela === "servicos" ? state.servicos : state.quintas);
const linhaAtual = (tabela, id) => listaDe(tabela).find((x) => x.id === id) || null;

// só os campos que a app grava (sem versao, user_id, created_at…)
function camposDe(tabela, linha) {
  const out = {};
  for (const campos of Object.values(GRUPOS[tabela]))
    for (const c of campos) out[c] = linha ? linha[c] ?? null : null;
  return out;
}

// valores comparáveis: o servidor devolve "18:00:00" e "8.50" onde a app tem "18:00" e 8.5
function normalizar(v) {
  if (v == null || v === "") return null;
  if (typeof v === "string") {
    if (/^\d{2}:\d{2}(:\d{2})?$/.test(v)) return v.slice(0, 5);
    if (/^-?\d+(\.\d+)?$/.test(v)) return Number(v);
  }
  return v;
}
const valorGrupo = (linha, campos) => JSON.stringify(campos.map((c) => normalizar(linha && linha[c])));

// junta a alteração deste aparelho (base → local) com a do servidor (base → remoto), grupo a grupo:
//   só um dos lados mudou (ou mudaram igual) → fica esse;  mudaram os dois, diferente → conflito
// devolve { final, auto: { grupo: "local" | "remoto" }, conflitos: [grupo] }
// (nos grupos em conflito, final fica com o valor deste aparelho)
function fundir(tabela, base, local, remoto) {
  const final = {}, auto = {}, conflitos = [];
  for (const [grupo, campos] of Object.entries(GRUPOS[tabela])) {
    const b = valorGrupo(base, campos), l = valorGrupo(local, campos), r = valorGrupo(remoto, campos);
    let origem;
    if (l === b || l === r) origem = "remoto";
    else if (r === b) origem = "local";
    else { origem = "local"; conflitos.push(grupo); }
    if (!conflitos.includes(grupo)) {
      if (l !== b && r === b) auto[grupo] = "local";
      else if (r !== b && l === b) auto[grupo] = "remoto";
    }
    for (const c of campos) final[c] = (origem === "local" ? local : remoto)[c] ?? null;
  }
  return { final, auto, conflitos };
}

// mostra a alteração na app (dados = null: apagar)
function aplicarLocal(tabela, id, dados) {
  const antiga = linhaAtual(tabela, id);
  // só alguns campos de uma linha que não está carregada (ex.: telemóvel sem cópia): nada a mostrar
  if (dados && !antiga && !(tabela === "servicos" ? dados.data : dados.nome)) return;
  const lista = listaDe(tabela).filter((x) => x.id !== id);
  if (dados) lista.push({ ...antiga, ...dados, id });
  if (tabela === "servicos") state.servicos = lista.sort((a, b) => b.data.localeCompare(a.data));
  else state.quintas = lista.sort((a, b) => a.nome.localeCompare(b.nome, "pt"));
}

// põe por cima dos dados carregados tudo o que ainda não chegou ao servidor
function aplicarPendentes() {
  for (const op of sync.fila) aplicarLocal(op.tabela, op.id, op.tipo === "apagar" ? null : op.dados);
  // em conflito: até decidires, a app mostra a versão deste telemóvel
  for (const c of sync.conflitos) aplicarLocal(c.tabela, c.id, c.tipo === "apagado-local" ? null : c.local);
}

// ---------- guardar a fila no telemóvel (por utilizador) ----------
const chaveSync = (userId) => "bandeja_sync_" + userId;
function guardarSync() {
  if (!state.user) return;
  try {
    localStorage.setItem(chaveSync(state.user.id),
      JSON.stringify({ fila: sync.fila, conflitos: sync.conflitos }));
  } catch (e) {}
}
function lerSync() {
  try {
    const s = JSON.parse(localStorage.getItem(chaveSync(state.user.id))) || {};
    sync.fila = s.fila || [];
    sync.conflitos = s.conflitos || [];
  } catch (e) { sync.fila = []; sync.conflitos = []; }
  sync.fila.forEach((op) => { delete op.aEnviar; });   // um envio interrompido volta à fila
}

// "Guardado." com rede; sem rede avisa que fica para enviar depois
function toastGravado(msg) {
  toast(navigator.onLine ? msg : `${msg} Fica neste telemóvel e envia quando houver rede.`);
}

// regista uma alteração: aparece já na app, fica guardada e tenta enviar
//   tipo "novo" (id gerado no formulário), "editar" (dados podem ser só alguns campos), "apagar"
function registarAlteracao(tabela, tipo, id, dados = null) {
  const conflito = sync.conflitos.find((c) => c.tabela === tabela && c.id === id);
  if (conflito) absorverEmConflito(conflito, tipo, dados);
  else juntarNaFila({ tabela, tipo, id, dados: dados && { ...dados }, quando: Date.now() });
  aplicarLocal(tabela, id, tipo === "apagar" ? null : dados);
  depoisDeMudar();
  sincronizar();
}

function depoisDeMudar() {
  guardarSync();
  if (state.user) guardarCache();
  renderTudo();
}

// junta a alteração à que já estava na fila para a mesma linha (enquanto essa não está a
// ser enviada); senão acrescenta-a, com a versão atual como base
function juntarNaFila(nova) {
  const i = sync.fila.findIndex((op) => op.tabela === nova.tabela && op.id === nova.id && !op.aEnviar);
  const op = i === -1 ? null : sync.fila[i];
  if (op && nova.tipo === "apagar") {
    if (op.tipo === "novo") sync.fila.splice(i, 1);   // nunca chegou ao servidor: basta esquecê-la
    else Object.assign(op, { tipo: "apagar", dados: null, quando: nova.quando });
    return;
  }
  if (op) { op.dados = { ...op.dados, ...nova.dados }; op.quando = nova.quando; return; }
  // uma alteração anterior desta linha ainda vai a caminho: a base é o que o servidor devolver
  const aCaminho = sync.fila.some((x) => x.tabela === nova.tabela && x.id === nova.id);
  if (aCaminho) nova.baseDoAnterior = true;
  else if (nova.tipo !== "novo") nova.base = copia(linhaAtual(nova.tabela, nova.id));
  sync.fila.push(nova);
}

// mexer numa linha que está em conflito: a mudança entra na versão deste telemóvel
function absorverEmConflito(c, tipo, dados) {
  if (tipo === "apagar") {
    sync.conflitos = sync.conflitos.filter((x) => x !== c);
    // apagada no outro aparelho e agora aqui também: não há nada a decidir
    if (c.remoto) sync.fila.push({ tabela: c.tabela, tipo: "apagar", id: c.id, base: c.remoto,
                                   dados: null, quando: Date.now() });
    return;
  }
  c.local = { ...c.local, ...dados };
  c.quando = Date.now();
}

// ---------- enviar ----------
// tenta enviar a fila toda, por ordem. Sem rede pára e fica para depois.
async function sincronizar() {
  if (sync.aEnviar || !state.user || !navigator.onLine || !sync.fila.length) return;
  sync.aEnviar = true;
  let mudou = false;
  try {
    while (sync.fila.length) {
      const op = sync.fila[0];
      op.aEnviar = true;
      let r;
      try {
        r = await enviarOp(op);
      } catch (err) {
        delete op.aEnviar;
        if (!navigator.onLine || erroDeRede(err && err.message)) break;   // fica para quando houver rede
        // recusada pela base de dados (não acontece com dados validados pela app): desiste dela
        // e das que dependiam dela; os dados certos voltam a ser carregados do servidor
        sync.fila = sync.fila.filter((x) => x !== op && !(x.baseDoAnterior && x.tabela === op.tabela && x.id === op.id));
        toast("Uma alteração não foi aceite e foi desfeita: " + traduzErro(err.message || String(err)));
        mudou = true;
        guardarSync();
        continue;
      }
      delete op.aEnviar;
      if (r.repetir) { guardarSync(); continue; }   // juntou com o outro aparelho: envia a versão junta
      sync.fila.shift();
      const seguintes = sync.fila.filter((x) => x.baseDoAnterior && x.tabela === op.tabela && x.id === op.id);
      if (r.conflito) {
        sync.conflitos.push(r.conflito);
        // o que se mudou depois (com esta já a caminho) entra na versão deste telemóvel
        for (const x of seguintes) absorverEmConflito(r.conflito, x.tipo, x.dados);
        sync.fila = sync.fila.filter((x) => !seguintes.includes(x));
      } else if (r.linha) {
        // as alterações feitas entretanto partem da versão que o servidor acabou de guardar
        for (const x of seguintes) { delete x.baseDoAnterior; x.base = r.linha; }
      } else {
        sync.fila = sync.fila.filter((x) => !seguintes.includes(x));   // a linha foi apagada
      }
      mudou = true;
      guardarSync();
    }
  } finally {
    sync.aEnviar = false;
  }
  // a rede falhou mas o telemóvel diz que está "online" (rede fraca na quinta): o evento
  // "online" não vai chegar, por isso volta a tentar daqui a pouco
  if (sync.fila.length && navigator.onLine && !sync.tentarDeNovo)
    sync.tentarDeNovo = setTimeout(() => { sync.tentarDeNovo = null; sincronizar(); }, 30000);
  if (mudou) await carregarTudo();
  else renderAvisosSync();
}

// envia uma alteração. Devolve { linha } (aceite: a linha como ficou no servidor),
// { repetir: true } (outro aparelho mexeu; a op foi juntada com essa mudança e vai outra vez)
// ou { conflito } (é preciso decidir)
async function enviarOp(op) {
  const tabela = sb.from(op.tabela);
  if (op.tipo === "novo") {
    const { data, error } = await tabela.upsert({ id: op.id, ...op.dados }).select().maybeSingle();
    if (error) throw error;
    return { linha: data };
  }
  const versao = op.base && op.base.versao;
  let pedido = (op.tipo === "apagar" ? tabela.delete() : tabela.update(op.dados)).eq("id", op.id);
  if (versao != null) pedido = pedido.eq("versao", versao);
  const { data, error } = await pedido.select();
  if (error) throw error;
  if (data && data.length) return { linha: op.tipo === "apagar" ? null : data[0] };

  // nada mudou no servidor: a linha já não está naquela versão (ou já não existe)
  const { data: remoto, error: e2 } = await sb.from(op.tabela).select("*").eq("id", op.id).maybeSingle();
  if (e2) throw e2;
  const base = { tabela: op.tabela, id: op.id, base: op.base, remoto, quando: op.quando };
  if (op.tipo === "apagar") {
    // apagada aqui; no outro aparelho também (nada a fazer) ou foi mudada (pergunta)
    return remoto ? { conflito: { ...base, tipo: "apagado-local", local: null } } : { linha: null };
  }
  const local = { ...op.base, ...op.dados };
  if (!remoto) return { conflito: { ...base, tipo: "apagado-remoto", local } };
  const { final, auto, conflitos } = fundir(op.tabela, op.base, local, remoto);
  if (!conflitos.length) {
    op.base = remoto;
    op.dados = final;
    return { repetir: true };
  }
  return { conflito: { ...base, tipo: "campos", local, auto, campos: conflitos } };
}

// ---------- avisos e selos ----------
function estadoSync(tabela, id) {
  if (sync.conflitos.some((c) => c.tabela === tabela && c.id === id)) return "conflito";
  if (sync.fila.some((op) => op.tabela === tabela && op.id === id)) return "pendente";
  return null;
}
function seloSync(tabela, id) {
  const e = estadoSync(tabela, id);
  if (e === "conflito") return `<span class="sync-selo conflito">Conflito</span>`;
  if (e === "pendente") return `<span class="sync-selo">Por enviar</span>`;
  return "";
}

function renderAvisosSync() {
  const box = $("#sync-avisos");
  const n = sync.fila.length, nc = sync.conflitos.length;
  let html = "";
  if (n) html += `
    <div class="sync-aviso pendente" role="status">
      <span aria-hidden="true">⟳</span>
      <span><b>${n} ${n === 1 ? "alteração" : "alterações"} por enviar</b> · ${navigator.onLine
        ? "a enviar…" : "guardadas neste telemóvel, enviam sozinhas quando houver rede"}</span>
    </div>`;
  if (nc) html += `
    <button type="button" class="sync-aviso conflito" id="sync-resolver">
      <span aria-hidden="true">⚠</span>
      <span><b>${nc} ${nc === 1 ? "alteração precisa" : "alterações precisam"} de ti</b> — foi mudado nos dois aparelhos. <u>Resolver</u></span>
    </button>`;
  box.innerHTML = html;
  box.classList.toggle("hidden", !html);
  const btn = $("#sync-resolver");
  if (btn) btn.addEventListener("click", () => abrirConflito());
}

// ---------- resolver um conflito ----------
let conflitoAberto = null;   // { c, escolhas: { grupo: "local" | "remoto" } }

function fmtGrupo(tabela, grupo, linha) {
  if (!linha) return "—";
  const v = linha[GRUPOS[tabela][grupo][0]];
  switch (grupo) {
    case "quinta": return linha.quinta_nome || "—";
    case "data": return v ? fmtDataLonga(v) : "—";
    case "hora_inicio": case "hora_fim": case "hora_inicio_padrao": return v ? String(v).slice(0, 5) : "—";
    case "gorjeta": case "valor_hora": return fmtEUR(v);
    case "estado": return { agendado: "Agendado", pendente: "Por receber", pago: "Pago" }[v] || "—";
    case "localizacao": return linha.latitude != null ? "Guardada" : "Sem localização";
    default: return v ? String(v) : "—";
  }
}

function tituloConflito(c) {
  const l = c.local || c.remoto || c.base || {};
  return c.tabela === "servicos"
    ? `${l.quinta_nome || "—"} · ${l.data ? fmtDataLonga(l.data) : ""}`
    : `Quinta · ${l.nome || "—"}`;
}

// lista "Campo: antes → depois" do que um lado mudou em relação à base
function mudancasHTML(tabela, de, para) {
  const linhas = Object.entries(GRUPOS[tabela])
    .filter(([, campos]) => valorGrupo(de, campos) !== valorGrupo(para, campos))
    .map(([g]) => `<div class="sub">${ROTULOS[g]}: ${escapeHtml(fmtGrupo(tabela, g, de))} → <b>${escapeHtml(fmtGrupo(tabela, g, para))}</b></div>`);
  return linhas.join("") || `<div class="sub">Sem mudanças nos campos.</div>`;
}

function abrirConflito() {
  const c = sync.conflitos[0];
  if (!c) { fecharModais(); return; }
  // sugestão: em cada campo, o valor do aparelho onde se mexeu por último
  const remotoEm = c.remoto && c.remoto.atualizado_em ? Date.parse(c.remoto.atualizado_em) : 0;
  const sugestao = c.quando >= remotoEm ? "local" : "remoto";
  conflitoAberto = { c, escolhas: Object.fromEntries((c.campos || []).map((g) => [g, sugestao])) };
  limparErroForm("conflito-erro");
  renderConflito();
  if ($("#modal-conflito").classList.contains("hidden")) abrirModal("#modal-conflito");
}

function renderConflito() {
  const { c, escolhas } = conflitoAberto;
  const n = sync.conflitos.length;
  $("#conflito-sub").textContent = tituloConflito(c) + (n > 1 ? ` · 1 de ${n}` : "");
  let html = "";
  if (c.tipo === "campos") {
    const auto = Object.entries(c.auto || {});
    if (auto.length) html += `<div class="conflito-lbl">Juntado sozinho</div>` + auto.map(([g, origem]) =>
      `<div class="conflito-auto">✓ ${ROTULOS[g]}: ${escapeHtml(fmtGrupo(c.tabela, g, origem === "local" ? c.local : c.remoto))}
        — ${origem === "local" ? "deste telemóvel" : "do outro aparelho"}</div>`).join("");
    for (const g of c.campos) {
      html += `<div class="conflito-lbl" id="conflito-lbl-${g}">${ROTULOS[g]} — escolhe uma</div>
        <div class="conflito-opts" role="group" aria-labelledby="conflito-lbl-${g}">` +
        [["local", "Este telemóvel", c.local], ["remoto", "Outro aparelho", c.remoto]].map(([lado, nome, linha]) => `
          <button type="button" class="conflito-opt${escolhas[g] === lado ? " sel" : ""}" data-grupo="${g}" data-lado="${lado}"
            aria-pressed="${escolhas[g] === lado}">
            <span class="q">${nome}</span><span class="v">${escapeHtml(fmtGrupo(c.tabela, g, linha))}</span>
          </button>`).join("") + `</div>`;
    }
    if (c.tabela === "servicos") {
      const f = versaoEscolhida();
      const horas = calcHoras(normalizar(f.hora_inicio), normalizar(f.hora_fim));
      html += `<div class="conflito-total"><span>${f.estado === "agendado" ? "Agendado"
        : `${normalizar(f.hora_inicio) || "--:--"}–${normalizar(f.hora_fim) || "--:--"} · ${fmtHoras(horas)}`}</span>
        <span class="money">${f.estado === "agendado" ? "" : fmtEUR(totalServico({ ...f,
          hora_inicio: normalizar(f.hora_inicio), hora_fim: normalizar(f.hora_fim) }))}</span></div>`;
    }
    $("#conflito-acoes").innerHTML = `
      <button type="button" class="btn btn-ghost" data-acao="depois">Decidir mais tarde</button>
      <button type="button" class="btn btn-primary" data-acao="guardar">Guardar esta versão</button>`;
  } else if (c.tipo === "apagado-remoto") {
    html += `<div class="conflito-caixa"><span class="badge atrasado">Apagado no outro aparelho</span>
      <p>Mas neste telemóvel mudaste-o enquanto estavas sem rede:</p>${mudancasHTML(c.tabela, c.base, c.local)}</div>`;
    $("#conflito-acoes").innerHTML = `
      <button type="button" class="btn btn-ghost danger" data-acao="apagar">Apagar mesmo</button>
      <button type="button" class="btn btn-primary" data-acao="manter">Manter (com as mudanças)</button>`;
  } else {
    html += `<div class="conflito-caixa"><span class="badge atrasado">Mudado no outro aparelho</span>
      <p>Apagaste-o neste telemóvel, mas no outro aparelho foi mudado:</p>${mudancasHTML(c.tabela, c.base, c.remoto)}</div>`;
    $("#conflito-acoes").innerHTML = `
      <button type="button" class="btn btn-ghost danger" data-acao="apagar">Apagar mesmo</button>
      <button type="button" class="btn btn-primary" data-acao="manter">Manter (com essas mudanças)</button>`;
  }
  $("#conflito-corpo").innerHTML = html;
}

// a versão final com as escolhas feitas (campos juntados sozinhos + escolhidos à mão)
function versaoEscolhida() {
  const { c, escolhas } = conflitoAberto;
  const { final } = fundir(c.tabela, c.base, c.local, c.remoto);
  for (const [g, lado] of Object.entries(escolhas))
    for (const campo of GRUPOS[c.tabela][g]) final[campo] = (lado === "local" ? c.local : c.remoto)[campo] ?? null;
  return final;
}

// a combinação escolhida tem de continuar a ser um serviço válido
function erroVersao(tabela, f) {
  if (tabela !== "servicos" || f.estado === "agendado") return null;
  if (!f.hora_inicio || !f.hora_fim) return "Com esta escolha o serviço fica sem horas. Escolhe as horas do outro lado ou o estado.";
  return validarHorario(normalizar(f.hora_inicio), normalizar(f.hora_fim)).erro || null;
}

function acaoConflito(acao) {
  const { c } = conflitoAberto;
  if (acao === "depois") { fecharModais(); return; }
  if (c.tipo === "campos" && acao === "guardar") {
    const final = versaoEscolhida();
    const erro = erroVersao(c.tabela, final);
    if (erro) return erroForm("conflito-erro", erro);
    // a decisão parte da versão atual do servidor: se mudar outra vez entretanto, volta a juntar
    sync.fila.push({ tabela: c.tabela, tipo: "editar", id: c.id, base: c.remoto, dados: final, quando: Date.now() });
    aplicarLocal(c.tabela, c.id, final);
  } else if (c.tipo === "apagado-remoto") {
    if (acao === "manter") {
      sync.fila.push({ tabela: c.tabela, tipo: "novo", id: c.id, dados: camposDe(c.tabela, c.local), quando: Date.now() });
    } else aplicarLocal(c.tabela, c.id, null);
  } else if (c.tipo === "apagado-local") {
    if (acao === "apagar") {
      sync.fila.push({ tabela: c.tabela, tipo: "apagar", id: c.id, base: c.remoto, dados: null, quando: Date.now() });
    } else aplicarLocal(c.tabela, c.id, c.remoto);
  }
  sync.conflitos = sync.conflitos.filter((x) => x !== c);
  toastGravado(acao === "apagar" ? "Apagado." : "Guardado ✅");
  if (sync.conflitos.length) abrirConflito(); else fecharModais();
  depoisDeMudar();
  sincronizar();
}

/* ============================================================
   MODAIS — utilitários
   ============================================================ */
function abrirModal(sel) { abrirJanela($(sel)); }
function fecharModais() { $$(".modal").forEach((m) => fecharJanela(m)); }

/* ============================================================
   JANELAS (modais e seletores): foco, Tab preso lá dentro, Escape
   ============================================================ */
// janelas abertas, a de cima por último (o seletor de data/hora abre por cima do modal)
const janelas = [];
// depois de redesenhar as listas, devolver o foco ao item equivalente (ver restaurarFocoPendente)
let focoPendente = null;

const CAMPOS = "input:not([type=hidden]), select, textarea";
const FOCAVEIS = "a[href], button, input:not([type=hidden]), select, textarea, [tabindex]";

const visivel = (el) => el.getClientRects().length > 0;
// elementos que o Tab alcança dentro de uma janela (sem os desativados nem os tabindex="-1")
function focaveis(janela) {
  return Array.from(janela.querySelectorAll(FOCAVEIS))
    .filter((el) => !el.disabled && el.tabIndex >= 0 && visivel(el));
}
// a caixa da janela (.modal-box, .dp-box, .tp-box): recebe o foco quando não há melhor alvo
function caixaDe(janela) {
  const caixa = janela.firstElementChild;
  caixa.tabIndex = -1;
  return caixa;
}
// ecrã tátil: não pôr o foco num campo de texto ao abrir (abria o teclado do telemóvel)
const ecraTatil = () => window.matchMedia("(pointer: coarse)").matches;

function focoInicialDe(janela) {
  const campo = Array.from(janela.querySelectorAll(CAMPOS)).find((el) => !el.disabled && visivel(el));
  if (campo && !(ecraTatil() && campo.matches("input"))) return campo;
  if (campo) return caixaDe(janela);
  return focaveis(janela)[0] || caixaDe(janela);
}

// só a janela de cima é utilizável: o resto da página (e janelas por baixo) fica inerte
function atualizarInert() {
  const topo = janelas.length ? janelas[janelas.length - 1].el : null;
  for (const el of [$("#login-view"), $("#app"), ...$$(".modal, .dp, .tp")])
    el.inert = !!topo && el !== topo;
}

// abre uma janela: guarda quem a abriu (para lhe devolver o foco) e move o foco para dentro
function abrirJanela(el, alvo) {
  if (!janelas.some((j) => j.el === el)) janelas.push({ el, abridor: document.activeElement });
  el.classList.remove("hidden");
  atualizarInert();
  (alvo || focoInicialDe(el)).focus();
}

function fecharJanela(el) {
  el.classList.add("hidden");
  const i = janelas.findIndex((j) => j.el === el);
  if (i === -1) return;
  const [{ abridor }] = janelas.splice(i, 1);
  atualizarInert();
  devolverFoco(abridor);
}

// devolve o foco a quem abriu a janela. Se esse elemento for um item de lista, guarda
// também como o reencontrar: ao guardar/apagar, as listas são redesenhadas logo a seguir
function devolverFoco(abridor) {
  const chave = abridor && ["servico", "quinta", "gorjeta", "pago"].find((k) => abridor.dataset && abridor.dataset[k]);
  focoPendente = chave ? `[data-${chave}="${abridor.dataset[chave]}"]` : null;
  if (abridor && abridor !== document.body && abridor.isConnected && visivel(abridor)) abridor.focus();
  else focoAlternativo();   // ex.: janela aberta por código (recuperação de palavra-passe)
}

// depois de redesenhar: se o foco se perdeu (o elemento focado foi substituído), volta ao
// item equivalente; se o item já não existe (ex.: foi apagado), vai para um sítio estável
function restaurarFocoPendente() {
  if (!focoPendente) return;
  const sel = focoPendente;
  focoPendente = null;
  if (janelas.length) return;
  const ativo = document.activeElement;
  if (ativo && ativo !== document.body && ativo.isConnected) return;
  const el = $$(sel).find(visivel);
  if (el) el.focus(); else focoAlternativo();
}

function focoAlternativo() {
  const el = [$("#fab"), $(".nav-btn.active")].find((x) => x && visivel(x));
  if (el) el.focus();
}

// Tab / Shift+Tab ficam dentro da janela de cima; Escape fecha-a
function teclasJanelas(e) {
  if (!janelas.length) return;
  const topo = janelas[janelas.length - 1].el;
  if (e.key === "Escape") {
    e.preventDefault();
    if (topo.classList.contains("modal")) fecharModais();   // a mesma ação que clicar fora
    else if (topo.id === "date-picker") fecharDatePicker();
    else if (topo.id === "time-picker") fecharTimePicker();
    return;
  }
  if (e.key !== "Tab") return;
  const lista = focaveis(topo);
  if (!lista.length) { e.preventDefault(); caixaDe(topo).focus(); return; }
  const primeiro = lista[0], ultimo = lista[lista.length - 1];
  const dentro = topo.contains(document.activeElement);
  if (e.shiftKey && (!dentro || document.activeElement === primeiro || document.activeElement === caixaDe(topo))) {
    e.preventDefault(); ultimo.focus();
  } else if (!e.shiftKey && (!dentro || document.activeElement === ultimo)) {
    e.preventDefault(); primeiro.focus();
  }
}

/* ============================================================
   NAVEGAÇÃO
   ============================================================ */
const TITULOS = { resumo: "Resumo", servicos: "Serviços", conta: "Conta" };

function mudarView(v) {
  state.view = v;
  $$(".view").forEach((el) => el.classList.add("hidden"));
  $(`#view-${v}`).classList.remove("hidden");
  $$(".nav-btn").forEach((b) => {
    b.classList.toggle("active", b.dataset.view === v);
    if (b.dataset.view === v) b.setAttribute("aria-current", "page"); else b.removeAttribute("aria-current");
  });
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
    <div class="item item-clicavel">${itemBotaoHTML("gorjeta", s.id, escapeHtml(s.quinta_nome || "—"), fmtData(s.data))}
      <div class="right"><span class="amount money">${fmtEUR(s.gorjeta)}</span></div>
    </div>`).join("");

  $$("#gorjetas-lista [data-gorjeta]").forEach((el) =>
    el.addEventListener("click", () => abrirModalServico(el.dataset.gorjeta)));
}

function mudarAbaConta(aba) {
  $$(".conta-aba").forEach((el) => el.classList.add("hidden"));
  $("#conta-aba-" + aba).classList.remove("hidden");
  $$("#conta-abas .chip").forEach((c) => marcarAtivo(c, c.dataset.aba === aba));
}

// botão de alternância (chips, Feito/Agendar): estado visual + aria-pressed
function marcarAtivo(botao, ativo) {
  botao.classList.toggle("active", ativo);
  botao.setAttribute("aria-pressed", String(ativo));
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
    if (username && !/^[A-Za-z0-9_.]{3,30}$/.test(username)) {
      toast("Username inválido: 3 a 30 caracteres, só letras, números, _ ou ."); return;
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
  }, { precisaRede: true });
}

async function trocarPassword(e) {
  e.preventDefault();
  const atual = $("#pw-atual").value;
  const nova = $("#pw-nova").value;
  const nova2 = $("#pw-nova2").value;
  if (nova.length < PW_MIN) { toast(MSG_PW_CURTA); return; }
  if (nova !== nova2) { toast("A confirmação não coincide com a nova palavra-passe."); return; }
  if (!state.user) { toast("Sessão não encontrada. Entra de novo."); return; }

  const btn = e.submitter || $("#form-password button[type=submit]");
  await executarMutacao(btn, async () => {
    btn.textContent = "A alterar…";
    try {
      // 1) confirmar a palavra-passe ATUAL
      const { error: e1 } = await sb.auth.signInWithPassword({ email: state.user.email, password: atual });
      if (e1) {
        toast(erroDeRede(e1.message) ? "Sem ligação à internet." : "A palavra-passe atual está errada.");
        return;
      }
      // 2) definir a NOVA
      const { error: e2 } = await sb.auth.updateUser({ password: nova });
      if (e2) { toast(msgErro(e2)); return; }

      $("#form-password").reset();
      toast("Palavra-passe alterada! ✅");
    } finally {
      btn.textContent = "Alterar palavra-passe";   // mesmo que a ligação falhe a meio
    }
  }, { precisaRede: true });
}

// vindo do link do email (recuperação): definir nova palavra-passe
async function guardarRecovery(e) {
  e.preventDefault();
  const nova = $("#rec-nova").value, nova2 = $("#rec-nova2").value;
  if (nova.length < PW_MIN) { toast(MSG_PW_CURTA); return; }
  if (nova !== nova2) { toast("A confirmação não coincide."); return; }
  const botao = e.submitter || $("#form-recovery button[type=submit]");
  await executarMutacao(botao, async () => {
    const { error } = await sb.auth.updateUser({ password: nova });
    if (error) { toast(msgErro(error)); return; }
    fecharModais();
    toast("Palavra-passe definida! ✅ Já estás dentro.");
  }, { precisaRede: true });
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
// precisaRede: escritas que não passam pela fila (perfil, palavra-passe) só com rede
async function executarMutacao(botao, fn, { precisaRede = false } = {}) {
  const chave = botao.form || botao;
  if (mutacoesEmCurso.has(chave)) return;
  // sem rede: avisa logo, sem esperar que o pedido falhe (o formulário fica aberto)
  if (precisaRede && !navigator.onLine) { toast(MSG_SEM_REDE); return; }
  mutacoesEmCurso.add(chave);
  const botoes = botao.form ? Array.from(botao.form.querySelectorAll("button")) : [botao];
  const desativados = botoes.filter((b) => !b.disabled);   // só reativa os que estavam ativos
  desativados.forEach((b) => { b.disabled = true; });
  botao.setAttribute("aria-busy", "true");
  try {
    await fn();
  } catch (err) {
    toast(msgErro(err));
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
    $$("#servicos-filtros .chip").forEach((x) => marcarAtivo(x, x === c));
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
  $("#tp-hours").addEventListener("keydown", tpTeclas);
  $("#tp-mins").addEventListener("keydown", tpTeclas);

  // janelas: Tab preso na janela de cima, Escape fecha-a
  document.addEventListener("keydown", teclasJanelas);
  document.addEventListener("visibilitychange", aoMudarVisibilidade);

  // gravar sem internet: a rede voltou → envia o que ficou guardado
  window.addEventListener("online", () => { renderAvisosSync(); sincronizar(); });
  window.addEventListener("offline", renderAvisosSync);
  $("#conflito-corpo").addEventListener("click", (e) => {
    const b = e.target.closest("[data-grupo]");
    if (!b) return;
    conflitoAberto.escolhas[b.dataset.grupo] = b.dataset.lado;
    limparErroForm("conflito-erro");
    renderConflito();
    $(`#conflito-corpo [data-grupo="${b.dataset.grupo}"][data-lado="${b.dataset.lado}"]`).focus();
  });
  $("#conflito-acoes").addEventListener("click", (e) => {
    const b = e.target.closest("[data-acao]");
    if (b) acaoConflito(b.dataset.acao);
  });

  // seletor de data (calendário)
  $$(".date-trigger").forEach((b) => b.addEventListener("click", () => abrirDatePicker(b)));
  $("#dp-prev").addEventListener("click", () => { DP.view = new Date(DP.view.getFullYear(), DP.view.getMonth() - 1, 1); dpRender(); });
  $("#dp-next").addEventListener("click", () => { DP.view = new Date(DP.view.getFullYear(), DP.view.getMonth() + 1, 1); dpRender(); });
  $("#dp-today").addEventListener("click", () => dpEscolher(hojeISO()));
  $("#dp-close-btn").addEventListener("click", fecharDatePicker);
  $("#date-picker").addEventListener("click", (e) => { if (e.target.id === "date-picker") fecharDatePicker(); });
  $("#dp-grid").addEventListener("keydown", dpTeclas);

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
  $("#conta-logout").addEventListener("click", () => {
    const n = sync.fila.length + sync.conflitos.length;
    if (n && !confirm(`Tens ${n} ${n === 1 ? "alteração que ainda não foi enviada" : "alterações que ainda não foram enviadas"}. `
      + "Se saíres agora, perdem-se. Sair mesmo assim?")) return;
    if (state.user) localStorage.removeItem(chaveSync(state.user.id));
    sb.auth.signOut();
  });
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
      if (state.user) lerSync();
      mostrarApp(true);
      carregarTudo();
      abrirModal("#modal-recovery");   // pede a nova palavra-passe
      return;
    }
    if (session) {
      // só carrega quando entra um utilizador novo; a renovação do token (TOKEN_REFRESHED),
      // USER_UPDATED e o SIGNED_IN da confirmação da palavra-passe não mudam os dados
      const mudouUtilizador = !state.user || state.user.id !== session.user.id;
      state.user = session.user;
      if (mudouUtilizador) {
        limparDados();
        lerSync();      // alterações deste utilizador que ficaram por enviar
        renderTudo();   // não deixar à vista os dados de outra conta enquanto carrega
        mostrarApp(true);
        carregarTudo();
      }
    } else {
      carregamentoAtual++;   // ao sair, uma resposta que ainda venha a caminho é ignorada
      state.user = null;
      fecharModais();   // ex.: a sessão expirou com um formulário aberto
      limparDados();
      renderTudo();
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
