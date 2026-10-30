#!/usr/bin/env node
// Mutação das regras críticas: quebra uma regra de cada vez no código, compila, roda os testes que deviam pegar e
// confere que eles FALHAM. Mutante que sobrevive = teste cego para aquela regra.
//   node scripts/mutacao.mjs            (todas)
//   node scripts/mutacao.mjs cofre      (só as que têm "cofre" no nome)
// O arquivo original volta sempre, mesmo se o processo for interrompido no meio de um teste.

import { readFileSync, writeFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const raiz = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const tsc = path.join(raiz, "node_modules", "typescript", "bin", "tsc");

const MUTANTES = [
  ["troca: só o login muda (mcpOAuth fica)", "src/credenciais/blob.ts", 'export const CHAVES_DO_LOGIN = ["claudeAiOauth", "organizationUuid"] as const;', 'export const CHAVES_DO_LOGIN = ["claudeAiOauth", "organizationUuid", "mcpOAuth"] as const;', ["troca", "credenciais"]],
  ["troca: nunca renovar pela cópia da ativa", "src/troca.ts", "if (!c || id === this.estado.ativa) return false;", "if (!c) return false;", ["troca"]],
  ["troca: trava por conta entre renovar e trocar", "src/troca.ts", "const r = await this.travaConta(destino).com(async () => {", "const r = await (async <T>(f: () => Promise<T>) => f())(async () => {", ["troca"]],
  ["troca: destino perto de vencer é renovado antes", "src/troca.ts", "if (blobAlvo && expiraEm(blobAlvo) < this.agora() + RENOVAR_ANTES_S", "if (blobAlvo && expiraEm(blobAlvo) < this.agora() - RENOVAR_ANTES_S", ["troca"]],
  ["troca: conferência agendada 5 s depois", "src/troca.ts", "    this.relogio.agendar(() => void this.conferirTroca(destino, de, 1), CONFERIR_TROCA_MS);", "", ["troca"]],
  ["troca: refaz se a sessão regravou a conta antiga", "src/troca.ts", "if (id && id === de && tentativa <= 3) {", "if (id && id === de && tentativa <= 0) {", ["troca"]],
  ["troca: guarda o último token visto antes de aceitar mudança por fora", "src/troca.ts", "if (anterior && this.ultimaPrincipal && this.ultimaPrincipal[0] === anterior", "if (anterior && this.ultimaPrincipal && this.ultimaPrincipal[0] === anterior + \"x\"", ["troca"]],
  ["troca: oauthAccount do ~/.claude.json acompanha", "src/troca.ts", "    await this.copiarConta(this.claudeJsonDa(alvo), this.c.claudeJson);", "", ["troca"]],
  ["troca: sem identificar a principal, não troca", "src/troca.ts", "if (atual && !(await this.identidade(atual))) {", "if (atual && !(await this.identidade(atual)) && Date.now() < 0) {", ["troca"]],
  ["troca: destino sem token de renovação é recusado", "src/troca.ts", "if (!temRenovacao(blobAlvo)) {", "if (!blobAlvo) {", ["troca"]],
  ["troca: modo sombra não troca", "src/troca.ts", "    if (this.sombra) {\n      const chave = `${destino}|${motivo}`;", "    if (this.sombra && destino === \"nunca\") {\n      const chave = `${destino}|${motivo}`;", ["troca"]],
  ["troca: medida logo depois da troca é ignorada", "src/troca.ts", "t - (this.estado.trocadaEm || 0) < IGNORAR_MEDIDA_APOS_TROCA_S) return false;", "false) return false;", ["troca"]],
  ["troca: limite de versão velha não esgota a nova", "src/troca.ts", "if (typeof v === \"number\" && Number.isInteger(v) && v < this.estado.versao) {", "if (false) {", ["troca"]],
  ["login: só vale a conta pedida", "src/logins.ts", "if (pedido && entrou !== pedido) {", "if (pedido && entrou !== pedido && pedido === \"nunca\") {", ["troca"]],
  ["decisão: espera entre trocas", "src/decisao.ts", "if (limite || t - (estado.trocadaEm || 0) >= espera) return [\"trocar\", cand];", "return [\"trocar\", cand];", ["decisao"]],
  ["decisão: reset que passou conta como zero", "src/decisao.ts", "valores.push(j.resetEm && j.resetEm <= t ? 0 : Number(j.pct));", "valores.push(Number(j.pct));", ["decisao"]],
  ["chaveiro: linha grande vai pelo argv", "src/credenciais/macos.ts", "if (linha.length <= LIMITE_LINHA) return", "if (true) return", ["credenciais"]],
  ["cofre: dado associado com a versão", "src/cofre/cifra.ts", "return `${contaId}|${versao}`;", "return `${contaId}`;", ["cofre", "nuvem"]],
  ["cofre: frase normalizada antes do scrypt", "src/cofre/frase.ts", "return scryptSync(normalizar(frase), sal, TAMANHO_CHAVE, SCRYPT);", "return scryptSync(frase, sal, TAMANHO_CHAVE, SCRYPT);", ["cofre"]],
  ["posse: devolve ao cofre antes de soltar", "src/posse.ts", "      if (await this.devolver(id).catch(() => false)) {\n        await this.soltar(id).catch(() => undefined);\n        this.soltarDepois.delete(id);", "      if (true) {\n        await this.soltar(id).catch(() => undefined);\n        this.soltarDepois.delete(id);", ["nuvem"]],
  ["posse: cofre nunca por cima da conta em uso", "src/posse.ts", "    if (id === this.estado().ativa && !principalSemConta) return;\n    const local", "    const local", ["nuvem"]],
  ["posse: com o assistente sem login, o cofre mais novo vale para a conta em uso", "src/posse.ts", "if (id === this.estado().ativa && !principalSemConta) return;", "if (id === this.estado().ativa) return;", ["conserto"]],
  ["posse: cofre mais novo entra no lugar da cópia local", "src/posse.ts", "if (c.versaoCofre !== null && cofre.versao <= c.versaoCofre && local) return;", "if (local) return;", ["nuvem"]],
  ["posse: dado associado da versão NOVA (anterior + 1)", "src/posse.ts", "const nova = anterior + 1;", "const nova = anterior;", ["nuvem"]],
  ["posse: registro regravado com conta_id|versão", "src/posse.ts", "const ok = await this.com(id, \"login\", async () => true, { sincronizar: false, devolverSempre: true });", "const ok = true;", ["nuvem-real"]],
  ["agente: parada só lida com posse", "src/agente.ts", "if (!this.posse || this.d.sombra || id === this.estado.ativa || !c.contaId) return this.trocador.lerUso(id, forcar);", "if (!this.posse || this.d.sombra || id === this.estado.ativa || !c.contaId || c.contaId !== \"nunca\") return this.trocador.lerUso(id, forcar);", ["nuvem"]],
  ["agente: sombra não responde comando", "src/agente.ts", "    if (this.d.sombra) {\n      this.d.log.faria(`reservar", "    if (false) {\n      this.d.log.faria(`reservar", ["nuvem"]],
  ["agente: sombra não pega posse nem troca pela nuvem", "src/agente.ts", "    if (this.d.sombra) {\n      const chave = `${a.conta_id}#${a.versao}`;", "    if (this.d.sombra && a.conta_id === \"nunca\") {\n      const chave = `${a.conta_id}#${a.versao}`;", ["nuvem"]],
  ["agente: sombra roda a decisão local e registra o que faria", "src/agente.ts", "if (this.comNuvem && !this.d.sombra) return;", "if (this.comNuvem) return;", ["nuvem"]],
  ["agente: sombra não aplica a configuração da nuvem", "src/agente.ts", "if (!this.d.sombra) this.aplicarConfig(r.config);", "this.aplicarConfig(r.config);", ["nuvem"]],
  ["agente: posse antiga solta na primeira busca", "src/agente.ts", "if (!this.possesLimpas) await this.limparPossesAntigas();", "this.possesLimpas = true;", ["nuvem"]],
  ["agente: registro tentado de novo quando a nuvem volta", "src/agente.ts", "        await this.registrarPendentes();\n", "", ["nuvem"]],
  ["agente: relê a chave do cofre que chegou depois", "src/agente.ts", "      await this.recarregarChave();\n", "", ["nuvem"]],
  ["registro: cede a vez ao resto do agente", "src/registro/contador.ts", "        await this.ceder();\n", "", ["registro"]],
  ["agente: desligar sobe a conta em uso ao cofre", "src/agente.ts", "        await this.posse.devolver(id).catch(() => false);\n        if (id !== this.estado.ativa)", "        if (id !== this.estado.ativa)", ["nuvem"]],
  ["agente: lista de contas permitidas", "src/agente.ts", "if (lista && !lista.has(email))", "if (false)", ["nuvem"]],
  ["agente: comando não roda duas vezes", "src/agente.ts", "    if (this.comandosVistos.has(id)) return;\n", "", ["nuvem"]],
  ["registro: resposta repetida conta uma vez", "src/registro/contador.ts", "    if (this.vistos.has(mid)) return;\n", "", ["registro"]],
  ["registro: linha zerada não marca o id", "src/registro/contador.ts", "if (!mid || t.ent + t.sai + t.c5 + t.c1h + t.cl === 0) return;", "if (!mid) return;", ["registro"]],
  ["registro: projeto só com a pasta final", "src/registro/contador.ts", "return path.basename(cwd.replace(/[\\\\/]+$/, \"\").replace(/\\\\/g, \"/\"));", "return cwd;", ["registro"]],
  ["registro: linha pela metade fica para depois", "src/registro/contador.ts", "      this.e.arquivos[caminho] = lidoAte;", "      this.e.arquivos[caminho] = pos;", ["registro"]],
  ["ponte: cabeçalho X-Reveza obrigatório", "src/ponte.ts", "if (req.headers[\"x-reveza\"] !== \"1\")", "if (false)", ["ponte"]],
  ["ponte: Host conferido", "src/ponte.ts", "if (!hosts.has(host))", "if (false)", ["ponte"]],
  ["importar: só copia, nunca move", "src/importar.ts", "copiados = copiarPasta(ca.pasta, conta.pasta);", "fs.renameSync(ca.pasta, conta.pasta);", ["importar"]],
  ["troca: principal sem conta não vai para a pasta da conta em uso", "src/troca.ts", "const de = semConta ? null : await this.conferirPrincipalDentro();", "const de = await this.conferirPrincipalDentro();", ["troca"]],
  ["troca: o último login visto da conta em uso não se perde quando o assistente sai dela", "src/troca.ts", "    if (semConta) await this.guardarUltimaPrincipal(anterior);\n", "", ["troca"]],
  ["conserto: só com o sim exato do painel (corrigir === true)", "src/agente.ts", "if (corpo.corrigir === true) {", "if (corpo.corrigir) {", ["conserto"]],
  ["conserto: a conta atribuída entra mesmo constando em uso", "src/agente.ts", "if (destino && destino === ativa && !principalSemConta) {", "if (destino && destino === ativa) {", ["conserto"]],
  ["conserto: outro programa na porta não se conserta reiniciando o serviço", "src/doctor.ts", "    resposta\n      ? { fazer:", "    false\n      ? { fazer:", ["conserto"]],
  ["conserto: a nuvem fora do ar não se conserta reiniciando o serviço", "src/doctor.ts", "      horaServidor === null\n        ? { fazer:", "      false\n        ? { fazer:", ["conserto"]],
  ["conserto: reinstalar o serviço não tira o modo sombra", "src/cli.ts", "sombra: instalado ? instalado.sombra : sombra,", "sombra: false,", ["conserto"]],
  ["conserto: sem serviço (--sem-servico) não instala o serviço", "src/doctor.ts", "    d.semServico\n      ? {", "    false\n      ? {", ["conserto"]],
  ["conserto: o --so-ver só lê", "src/cli.ts", "  if (a.flags[\"so-ver\"]) {", "  if (a.flags[\"so-ver\"] === \"nunca\") {", ["conserto"]],
  ["conserto: a conta que já consta em uso não está 'a caminho' (a busca não a põe de volta)", "src/agente.ts", "return !destino || destino !== this.estado.ativa;", "return true;", ["conserto"]],
  ["conserto: a espera pela conta da nuvem tem prazo", "src/agente.ts", "(tr.principalSemLoginDesde ?? this.iniciadoEm) > ESPERA_CONTA_S) return false;", "(tr.principalSemLoginDesde ?? this.iniciadoEm) > ESPERA_CONTA_S * 1000) return false;", ["conserto"]],
  ["conserto: sem login com a conta a caminho é aviso, não falha", "src/doctor.ts", "if (!o.accessToken && esperando) {", "if (!o.accessToken && esperando && false) {", ["conserto"]],
  ["atualizar: o pedido da nuvem só leva a versão", "src/atualizar.ts", "if (Object.keys(corpo).some((k) => k !== \"versao\"))", "if (false)", ["atualizar"]],
  ["atualizar: só versão maior que a atual", "src/atualizar.ts", "if (compararVersao(alvo, atual) <= 0) {", "if (compararVersao(alvo, atual) < 0) {", ["atualizar"]],
  ["atualizar: só versão publicada", "src/atualizar.ts", "if (pedida !== MAIS_NOVA && !publicadas.includes(pedida))", "if (false)", ["atualizar"]],
  ["atualizar: o download não sai do GitHub", "src/atualizar.ts", "!HOSTS_DO_PACOTE.has(proximo.hostname)", "false", ["atualizar"]],
  ["atualizar: nada de '..' no pacote", "src/atualizar.ts", "rel.split(\"/\").includes(\"..\")", "false", ["atualizar"]],
  ["atualizar: link no pacote é recusado", "src/atualizar.ts", "if (tipo === \"1\" || tipo === \"2\") throw", "if (false) throw", ["atualizar"]],
  ["atualizar: a versão de dentro do pacote é conferida", "src/atualizar.ts", "pacote.version !== versao", "false", ["atualizar"]],
  ["atualizar: no Linux com systemd, escopo próprio", "src/atualizar.ts", "final = [\"systemd-run\", \"--user\", \"--scope\", \"--quiet\", ...argv];", "final = argv;", ["atualizar"]],
  ["atualizar: uma atualização por vez", "src/agente.ts", "if (pendente) return { ok: false, status: 409, erro: `já há uma atualização em andamento", "if (pendente && Date.now() < 0) return { ok: false, status: 409, erro: `já há uma atualização em andamento", ["atualizar"]],
  ["sozinho: só das 3h às 5h", "src/atualizar.ts", "return hora >= 3 && hora < 5;", "return hora >= 3;", ["atualizar"]],
  ["sozinho: no fuso da instalação", "src/atualizar.ts", "hora = formatar(typeof fuso === \"string\" && fuso ? fuso : FUSO_PADRAO);", "hora = formatar(FUSO_PADRAO);", ["atualizar"]],
  ["sozinho: só com a opção ligada", "src/agente.ts", "if (cfg.atualizar_sozinho !== true || !nuvem", "if (!nuvem", ["atualizar"]],
  ["sozinho: só num momento calmo", "src/agente.ts", "if (!naMadrugada(t, cfg.fuso) || this.atualizacaoPendente() || !this.momentoCalmo()) return;", "if (!naMadrugada(t, cfg.fuso) || this.atualizacaoPendente()) return;", ["atualizar"]],
  ["sozinho: sessão no limite não é momento calmo", "src/agente.ts", "if (this.estado.fila.some((f) => f.estado === \"aguardando\" && t - f.em < FILA_VALIDA_S)) return false;", "", ["atualizar"]],
  ["sozinho: o fim vai à nuvem (falha para os outros)", "src/agente.ts", "if (atual.sozinho && !atual.nuvemAvisada && atual.fim && this.d.nuvem) {", "if (atual.sozinho && !atual.nuvemAvisada && atual.fim && this.d.nuvem && Date.now() < 0) {", ["atualizar"]],
  ["sozinho: o que nem começou só tenta na noite seguinte", "src/agente.ts", "t - this.sozinhoNaoComecouEm < 12 * 3600", "false", ["atualizar"]],
  ["~/.claude.json: não regravar arquivo ilegível", "src/claudejson.ts", "        const v = JSON.parse(bruto);", "        let v; try { v = JSON.parse(bruto); } catch { v = {}; }", ["doctor-cli"]],
  ["memória: com a conta em 99%, a troca não espera", "src/memoria.ts", "  if (p.pctConta !== null && p.pctConta >= TETO_ESPERA_PCT) return { esperar: false };\n", "", ["memoria"]],
  ["memória: nenhuma troca espera mais que o máximo", "src/memoria.ts", "  if (p.desde !== null && p.t - p.desde >= ESPERA_MAXIMA_S) return { esperar: false };\n", "", ["memoria"]],
  ["memória: limite, painel e API não esperam", "src/memoria.ts", "  return /^rodízio/i.test(motivo.trim());", "  return true;", ["memoria"]],
  ["memória: a atribuição da nuvem também espera", "src/agente.ts", "if (!principalSemConta && (await this.esperarMemoriaParaTrocar(`${ativa}>${a.conta_id}`, a.motivo || \"\"))) {", "if (false) {", ["memoria"]],
  ["memória: o aviso sai uma vez por espera", "src/agente.ts", "      } else this.esperaMemoria.esperando = true;", "      } else this.trocador.evento(\"aviso\", \"Segurei a troca de novo\");", ["memoria"]],
];

function rodar(argv) {
  return spawnSync(process.execPath, argv, { cwd: raiz, encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });
}

const filtro = process.argv[2];
const lista = MUTANTES.filter(([nome]) => !filtro || nome.includes(filtro));
const resultados = [];
for (const [nome, arquivo, de, para, testes] of lista) {
  const caminho = path.join(raiz, arquivo);
  const original = readFileSync(caminho, "utf8");
  const vezes = original.split(de).length - 1;
  if (vezes !== 1) {
    resultados.push([nome, `TRECHO NÃO ACHADO (${vezes}x)`]);
    continue;
  }
  const restaurar = () => writeFileSync(caminho, original);
  process.once("SIGINT", () => (restaurar(), process.exit(130)));
  try {
    writeFileSync(caminho, original.replace(de, para));
    const c = rodar([tsc, "-p", "tsconfig.json"]);
    if (c.status !== 0) {
      resultados.push([nome, "não compilou (conta como morto, mas reveja o mutante)"]);
      continue;
    }
    let morto = false;
    for (const f of testes) {
      if (rodar(["scripts/testar.mjs", f]).status !== 0) {
        morto = true;
        break;
      }
    }
    resultados.push([nome, morto ? "morto (o teste pegou)" : "SOBREVIVEU"]);
  } finally {
    restaurar();
  }
}
rodar([tsc, "-p", "tsconfig.json"]);
let sobreviventes = 0;
for (const [nome, r] of resultados) {
  if (!r.startsWith("morto")) sobreviventes += 1;
  console.log(`${r.startsWith("morto") ? "ok  " : "!!  "} ${nome}: ${r}`);
}
console.log(`\n${resultados.length - sobreviventes} de ${resultados.length} mutantes mortos.`);
process.exit(sobreviventes ? 1 : 0);
