import { secao } from "../secao"

export default secao({
  pt: {
    troca: {
      descricao:
        "Quando e para qual conta cada computador passa. Quem decide é a nuvem, a cada minuto e na hora em que chega uso novo ou uma sessão bate no limite.",
      auto: {
        titulo: "Troca automática",
        ligada: "Ligada: a nuvem escolhe a conta de cada computador pelas regras abaixo.",
        desligada: "Desligada: cada computador fica na conta que está. Só computador sem conta recebe uma.",
        rotulo: "Ligar a troca automática",
      },
      modo: {
        titulo: "Modo",
        descricao: "Quando passar para a próxima conta.",
        valendo: "Valendo",
        limite:
          "Fica na conta até ela chegar a 100% (ou uma sessão ser barrada pelo limite) e só então passa para a próxima livre.",
        limiar:
          "Avisa quando a conta passa de {aviso} e troca ao chegar a {troca}, antes de alguma sessão ser barrada.",
        rodizio:
          "Troca de tempos em tempos (a cada {intervalo}, variando um pouco) para espalhar o uso. A troca aos {troca} continua valendo como rede de segurança.",
      },
      limiares: {
        titulo: "Limiares",
        descricao: "Valem para a maior janela da conta (5 horas, semana ou semana do modelo).",
        aviso: "Aviso",
        avisoDica: "Acima disso a conta em uso gera um aviso, e as outras deixam de ser escolhidas.",
        troca: "Troca",
        trocaDica: "Ao chegar aqui, a nuvem passa o computador para a próxima conta livre.",
        trocaNoLimite: "No modo só no limite, a troca é aos 100%.",
      },
      rodizio: {
        titulo: "Rodízio",
        intervalo: "Trocar a cada",
        faixa: "O horário varia um pouco, de {min} a {max}. Cerca de {n} trocas por dia.",
        proxima: "Próxima troca do rodízio {quando}",
        ordem: "Para qual conta",
        aleatoria: "Sorteada",
        aleatoriaDica: "Uma conta livre qualquer, abaixo do aviso.",
        menor_uso: "A menos usada",
        menor_usoDica: "A conta livre com a menor janela cheia.",
      },
      ordem: {
        titulo: "Ordem de preferência",
        descricao:
          "A nuvem escolhe de cima para baixo entre as contas livres: abaixo do aviso, fora de outro computador, dentro da agenda e do teto. A conta de reserva só entra quando nenhuma outra estiver livre.",
        subir: "Subir {conta}",
        descer: "Descer {conta}",
        reserva: "Reserva",
        pausada: "pausada",
      },
      agenda: {
        titulo: "Agenda e teto por conta",
        descricao: "Horários em que cada conta pode ser escolhida e o máximo da semana que ela pode gastar.",
        editar: "Editar",
        semTeto: "sem teto",
        fuso: "Fuso da agenda",
      },
      criticas: {
        titulo: "Sessões críticas",
        descricao:
          "Para o que não pode parar (monitoramento, correção, atendimento). Quando todas as contas passam do gatilho, as sessões comuns esperam e só as críticas seguem, gastando o que sobra. Nenhuma conta fica parada esperando.",
        ligar: "Segurar as sessões comuns quando faltar folga",
        ligarDica: "Desligado, todas as sessões seguem até as contas acabarem.",
        gatilho: "Gatilho",
        gatilhoDica: "Quando nenhuma conta estiver abaixo disto, só as críticas seguem. Quando uma conta voltar a ter folga, as comuns voltam sozinhas.",
        agora: "Agora só as críticas seguem",
        comoMarcar: "Como marcar uma sessão",
        naSessao: "Dentro da sessão, digite:",
        naRotina: "Em rotinas abertas por script, ponha isto antes do comando:",
        noTerminal: "Ou, no terminal do computador, com o id da sessão:",
      },
      ajustes: {
        titulo: "Mais ajustes",
        espera: "Espera mínima entre trocas",
        esperaDica: "Do mesmo computador, para não trocar à toa. Não vale quando uma sessão bate no limite.",
        intervalo: "Tempo de atualização",
        intervaloDica:
          "De quanto em quanto tempo cada computador conversa com a nuvem: manda o uso, recebe a troca e os pedidos do painel. Menor responde mais rápido; maior faz menos pedidos.",
        retomar: "Retomar sozinho sessões de terminal",
        retomarDica:
          "Quando uma sessão sem tela parar no limite, o computador a roda de novo na conta nova, em até 2 horas. Ela continua com a configuração padrão do assistente neste computador, não com as opções com que foi aberta.",
        segundos: "{n} s",
      },
      custo:
        "Trocar muito custa: cada troca faz a sessão aberta reler a conversa inteira na conta nova, porque o cache de uma conta não passa para outra. Limiares altos e rodízio espaçado gastam menos.",
      salvar: {
        pendente: "Alterações não salvas",
        salvo: "Troca automática salva",
      },
    },
  },
  en: {
    troca: {
      descricao:
        "When and to which account each computer switches. The cloud decides, every minute and whenever new usage arrives or a session hits the limit.",
      auto: {
        titulo: "Auto switch",
        ligada: "On: the cloud picks each computer's account using the rules below.",
        desligada: "Off: each computer stays on its current account. Only a computer without one gets an account.",
        rotulo: "Turn auto switch on",
      },
      modo: {
        titulo: "Mode",
        descricao: "When to move to the next account.",
        valendo: "Active",
        limite:
          "Stays on the account until it reaches 100% (or a session is blocked by the limit) and only then moves to the next free one.",
        limiar: "Warns when the account passes {aviso} and switches at {troca}, before any session gets blocked.",
        rodizio:
          "Switches from time to time (every {intervalo}, varying a bit) to spread usage. The switch at {troca} still works as a safety net.",
      },
      limiares: {
        titulo: "Thresholds",
        descricao: "They apply to the account's fullest window (5 hours, week or model week).",
        aviso: "Warning",
        avisoDica: "Above this, the account in use raises a warning and the others stop being chosen.",
        troca: "Switch",
        trocaDica: "When it gets here, the cloud moves the computer to the next free account.",
        trocaNoLimite: "In only-at-the-limit mode, the switch happens at 100%.",
      },
      rodizio: {
        titulo: "Rotation",
        intervalo: "Switch every",
        faixa: "The time varies a bit, from {min} to {max}. About {n} switches per day.",
        proxima: "Next rotation switch {quando}",
        ordem: "To which account",
        aleatoria: "Random",
        aleatoriaDica: "Any free account below the warning.",
        menor_uso: "Least used",
        menor_usoDica: "The free account with the emptiest window.",
      },
      ordem: {
        titulo: "Preference order",
        descricao:
          "The cloud chooses top to bottom among free accounts: below the warning, not on another computer, within schedule and cap. The backup account only comes in when no other is free.",
        subir: "Move {conta} up",
        descer: "Move {conta} down",
        reserva: "Backup",
        pausada: "paused",
      },
      agenda: {
        titulo: "Schedule and cap per account",
        descricao: "Hours when each account can be chosen and the most of the week it can spend.",
        editar: "Edit",
        semTeto: "no cap",
        fuso: "Schedule time zone",
      },
      criticas: {
        titulo: "Critical sessions",
        descricao:
          "For what can't stop (monitoring, fixes, support). When every account passes the trigger, regular sessions wait and only critical ones keep going, using what is left. No account sits idle waiting.",
        ligar: "Hold regular sessions when room runs out",
        ligarDica: "Off, every session keeps going until the accounts run out.",
        gatilho: "Trigger",
        gatilhoDica: "When no account is below this, only critical sessions run. When an account has room again, regular ones come back on their own.",
        agora: "Only critical sessions are running now",
        comoMarcar: "How to mark a session",
        naSessao: "Inside the session, type:",
        naRotina: "In routines started by a script, put this before the command:",
        noTerminal: "Or, in the computer's terminal, with the session id:",
      },
      ajustes: {
        titulo: "More settings",
        espera: "Minimum wait between switches",
        esperaDica: "For the same computer, to avoid pointless switching. Doesn't apply when a session hits the limit.",
        intervalo: "Update interval",
        intervaloDica:
          "How often each computer talks to the cloud: sends usage, receives the switch and the panel's requests. Shorter answers faster; longer makes fewer requests.",
        retomar: "Resume terminal sessions on their own",
        retomarDica:
          "When a headless session stops at the limit, the computer runs it again on the new account, within 2 hours. It continues with the assistant's default settings on this computer, not with the options it was started with.",
        segundos: "{n} s",
      },
      custo:
        "Switching a lot costs: each switch makes the open session reread the whole conversation on the new account, because one account's cache doesn't carry over. High thresholds and spaced rotation spend less.",
      salvar: {
        pendente: "Unsaved changes",
        salvo: "Auto switch saved",
      },
    },
  },
})
