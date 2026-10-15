// Os textos dos alertas que saem pelos canais, em português e em inglês. A nuvem grava o texto do evento em português
// (SQL); a língua do alerta é a da instalação (config `idioma`, que a 0026 devolve em alertas_pendentes). Os dados do
// evento trazem ids, não nomes: para o inglês, o nome do computador e o e-mail da conta saem do texto original.
export type Idioma = "pt-BR" | "en";

export interface EventoTexto { tipo: string; texto: string; dados?: Record<string, any> | null }

/** "en" e "en-US" viram inglês; qualquer outra coisa (ou nada) fica no português, o padrão. */
export function idiomaDe(valor: unknown): Idioma {
  return /^en\b/i.test(String(valor ?? "")) ? "en" : "pt-BR";
}

/** O motivo da troca (texto da nuvem, em português) em inglês; o que não se conhece segue como veio. */
export function motivoEmIngles(motivo: string): string {
  const m = motivo.trim();
  const chegou = /^chegou a (\d+(?:[.,]\d+)?)%$/.exec(m);
  if (chegou) return `reached ${chegou[1]}%`;
  const mapa: Record<string, string> = {
    "a sessão bateu o limite": "the session hit the limit",
    "rodízio do dia": "rotation",
    "pedido pelo painel": "requested from the panel",
    "pedido pela API": "requested through the API",
    "computador sem conta": "computer without an account",
    "conta que já estava no computador": "account already on the computer",
  };
  return Object.hasOwn(mapa, m) ? mapa[m]! : m;
}

// "05/10 14:30" (DD/MM, como a nuvem grava) vira "Oct 5, 14:30": em inglês DD/MM seria lido como MM/DD.
function dataEmIngles(data: string): string {
  const m = /^(\d{1,2})\/(\d{1,2}) (\d{1,2}:\d{2})$/.exec(data.trim());
  const meses = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  const mes = m ? meses[Number(m[2]) - 1] : undefined;
  return m && mes ? `${mes} ${Number(m[1])}, ${m[3]}` : data;
}

const nomeDoPc = (nome: string) => (nome === "um computador" ? "a computer" : `computer ${nome}`);

const MENSAGENS_ATUALIZACAO = {
  sozinha: (nome: string, para: string) =>
    `The automatic update of ${nome} to ${para} didn't finish. The other computers won't update on their own until someone checks and turns the option back on.`,
  voltou: (nome: string, para: string) =>
    `The automatic update of ${nome} to ${para} failed and rolled back to the previous version. The other computers won't update on their own until someone checks and turns the option back on.`,
};

// Um texto em inglês por tipo de evento e motivo; devolve null quando não dá para montar (o texto original vale).
function emIngles(e: EventoTexto): string | null {
  const d = e.dados ?? {};
  const texto = String(e.texto ?? "");
  if (e.tipo === "limite") return "A session hit the limit.";
  if (e.tipo === "troca") {
    const m = /^Troca: (.+) → (.+) \((.+)\)\.$/s.exec(texto);
    if (!m) return null;
    const conta = (c: string) => (c === "nenhuma" ? "none" : c);
    const motivo = typeof d.motivo === "string" && d.motivo ? d.motivo : m[3]!;
    return `Switch: ${conta(m[1]!)} → ${conta(m[2]!)} (${motivoEmIngles(motivo)}).`;
  }
  if (e.tipo !== "alerta") return null;
  switch (d.motivo) {
    case "sem_livre":
      return "No free account to switch to.";
    case "computador_parado": {
      const m = /^O computador (.+) não dá notícia desde (.+)\.$/s.exec(texto);
      if (!m) return "A computer has stopped checking in.";
      return `Computer ${m[1]} hasn't checked in since ${dataEmIngles(m[2]!)}.`;
    }
    case "precisa_login": {
      const m = /^(.+) precisa entrar de novo\.$/s.exec(texto);
      return m ? `${m[1]} needs to sign in again.` : "An account needs to sign in again.";
    }
    case "troca_falhou": {
      const completa = /^No computador (.+?), a troca para (.+?) não firmou: a conta em uso continua (.+)\. Confira no painel\.$/s.exec(texto);
      if (completa) {
        return `On computer ${completa[1]}, the switch to ${completa[2]} didn't take: the account in use is still ${completa[3]}. Check the panel.`;
      }
      const sem = /^No computador (.+?), a troca para (.+?) não firmou\. Confira no painel\.$/s.exec(texto);
      if (sem) return `On computer ${sem[1]}, the switch to ${sem[2]} didn't take. Check the panel.`;
      const generica = /^No computador (.+?), uma troca de conta não firmou\. Confira no painel\.$/s.exec(texto);
      return generica ? `On computer ${generica[1]}, an account switch didn't take. Check the panel.` : null;
    }
    case "atualizacao_falhou": {
      const para = typeof d.para === "string" && d.para ? d.para : "?";
      if (d.parte === "nuvem") {
        const erro = typeof d.erro === "string" && d.erro ? d.erro : "no reason given";
        return `The cloud update to ${para} stopped: ${erro}. Nothing was left half done (each migration applies fully or not at all); the cloud stays on the previous version, and the computers wait.`;
      }
      if (d.parte === "publicacao") {
        const m = /^A publicação das funções e do painel da \S+ em (.+?) não (?:terminou em 45 minutos|deu certo):/s.exec(texto);
        const nome = m ? nomeDoPc(m[1]!) : "a computer";
        const espera = "the computers won't update on their own until someone asks again (Update the cloud).";
        if (typeof d.erro === "string") {
          const erro = d.erro || "no reason given";
          return `Publishing the functions and the panel of ${para} on ${nome} didn't work: ${erro}. The previous panel stays online; ${espera}`;
        }
        return `Publishing the functions and the panel of ${para} on ${nome} didn't finish in 45 minutes: ${espera}`;
      }
      const m = /^A atualização sozinha de (.+?) para a (\S+) não (terminou|deu certo)/s.exec(texto);
      const nome = m ? (m[1] === "um computador" ? "a computer" : m[1]!) : "a computer";
      const versao = typeof d.para === "string" && d.para ? d.para : m ? m[2]! : "?";
      return (m && m[3] === "deu certo" ? MENSAGENS_ATUALIZACAO.voltou : MENSAGENS_ATUALIZACAO.sozinha)(nome, versao);
    }
  }
  return null;
}

/**
 * O texto do evento na língua da instalação. Em português devolve o texto que a nuvem gravou, sem recompor (o
 * comportamento de sempre, byte a byte). Em inglês monta a mensagem pelo tipo e pelos dados e, se não souber montar,
 * cai no texto original.
 */
export function textoDoEvento(e: EventoTexto, idioma: unknown): string {
  if (idiomaDe(idioma) !== "en") return e.texto;
  try {
    return emIngles(e) ?? e.texto;
  } catch {
    return e.texto;
  }
}

/** Os textos fixos que a função de alertas escreve (título do resumo, testes de canal, resumo do dia). */
export function textos(idioma: unknown) {
  const en = idiomaDe(idioma) === "en";
  return {
    tituloResumo: en ? "Reveza AI · Daily summary" : "Reveza AI · resumo do dia",
    tituloTeste: en ? "Reveza AI · test" : "Reveza AI · teste",
    testeCanal: en ? "If you got this, the channel is set up correctly." : "Se chegou, o canal está certo.",
    testePush: en ? "If you got this, the notification is set up correctly." : "Se chegou, a notificação está certa.",
    testeWebhook: en ? "If you got this, the webhook is set up correctly." : "Se chegou, o webhook está certo.",
    semLeitura: en ? "no reading" : "sem leitura",
    resumo: (usd: string, trocas: number, agentes: number, contas: string) => en
      ? `Today: US$ ${usd} equivalent cost, ${trocas} ${trocas === 1 ? "switch" : "switches"}, ${agentes} ${agentes === 1 ? "agent" : "agents"}.\n${contas}`
      : `Hoje: US$ ${usd} equivalentes, ${trocas} troca(s), ${agentes} agente(s).\n${contas}`,
    local: en ? "en-US" : "pt-BR",
  };
}
