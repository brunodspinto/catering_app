// Testes das funções de cálculo do app.js (sem browser nem Supabase).
// Correr com:  node --test
const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

// carrega o app.js num contexto isolado, com o mínimo de "browser" para não rebentar
// ao arrancar (sem config, por isso não liga ao Supabase), e devolve as funções a testar
function carregarApp() {
  const codigo = fs.readFileSync(path.join(__dirname, "..", "app.js"), "utf8");
  const contexto = vm.createContext({
    window: { APP_CONFIG: {} },
    document: { addEventListener() {} },
    console,
  });
  return vm.runInContext(`${codigo}
    ;({ calcHoras, fmtHoras, validarHorario, totalServico, parseNum, lerEuros,
        horaAgoraArredondada, dataSugeridaServico, escapeHtml, erroDeRede, msgErro })`, contexto);
}
const app = carregarApp();

test("calcHoras: turno normal e a passar da meia-noite", () => {
  assert.equal(app.calcHoras("18:00", "23:30"), 5.5);
  assert.equal(app.calcHoras("20:00", "02:00"), 6);
  assert.equal(app.calcHoras("18:00", "18:00"), 0);   // horas iguais: inválido
  assert.equal(app.calcHoras("", "02:00"), 0);
});

test("fmtHoras: arredonda ao minuto (nunca '2h60')", () => {
  assert.equal(app.fmtHoras(0), "0h");
  assert.equal(app.fmtHoras(7.75), "7h45");
  assert.equal(app.fmtHoras(2.9999999), "3h");
  // soma de turnos com minutos "partidos" (10 min = 0,1666…)
  const soma = Array.from({ length: 18 }, () => app.calcHoras("18:00", "18:10")).reduce((a, b) => a + b, 0);
  assert.equal(app.fmtHoras(soma), "3h");
});

test("validarHorario: erro, aviso de turno longo e caso normal", () => {
  assert.ok(app.validarHorario("", "02:00").erro);
  assert.ok(app.validarHorario("18:00", "18:00").erro);
  assert.ok(app.validarHorario("06:00", "23:00").aviso);   // 17h
  assert.deepEqual({ ...app.validarHorario("18:00", "02:00") }, {});
});

test("totalServico: horas × valor/hora, sem a gorjeta", () => {
  assert.equal(app.totalServico({ hora_inicio: "18:00", hora_fim: "22:00", valor_hora: "8.5", gorjeta: 20 }), 34);
});

test("parseNum / lerEuros: vírgula, ponto, € e valores inválidos", () => {
  assert.equal(app.parseNum("8,50"), 8.5);
  assert.equal(app.parseNum("8.5 €"), 8.5);
  assert.equal(app.parseNum("1.000,50"), null);
  assert.equal(app.parseNum("8,505"), null);
  assert.equal(app.parseNum("abc"), null);
  assert.equal(app.lerEuros("", "Gorjeta", false).valor, 0);
  assert.ok(app.lerEuros("", "Valor", true).erro);
  assert.ok(app.lerEuros("-3", "Valor", true).erro);
});

test("horaAgoraArredondada: ao quarto de hora mais próximo", () => {
  assert.equal(app.horaAgoraArredondada(new Date(2026, 0, 1, 0, 56)), "01:00");
  assert.equal(app.horaAgoraArredondada(new Date(2026, 0, 1, 18, 7)), "18:00");
  assert.equal(app.horaAgoraArredondada(new Date(2026, 0, 1, 23, 53)), "00:00");
});

test("dataSugeridaServico: de madrugada sugere o dia anterior", () => {
  assert.equal(app.dataSugeridaServico(new Date(2026, 7, 16, 3, 0)), "2026-08-15");
  assert.equal(app.dataSugeridaServico(new Date(2026, 7, 16, 20, 0)), "2026-08-16");
  assert.equal(app.dataSugeridaServico(new Date(2026, 2, 1, 2, 0)), "2026-02-28");
});

test("escapeHtml: neutraliza HTML", () => {
  assert.equal(app.escapeHtml(`<b onclick="x">'&'</b>`), "&lt;b onclick=&quot;x&quot;&gt;&#39;&amp;&#39;&lt;/b&gt;");
});

test("erroDeRede / msgErro: reconhece a falha de rede de cada browser", () => {
  for (const m of ["TypeError: Load failed", "Failed to fetch", "NetworkError when attempting to fetch resource."])
    assert.ok(app.erroDeRede(m), m);
  assert.ok(!app.erroDeRede("new row violates check constraint"));
  assert.match(app.msgErro(new Error("TypeError: Load failed")), /Sem internet/);
  assert.equal(app.msgErro(new Error("outra coisa")), "Erro: outra coisa");
});
