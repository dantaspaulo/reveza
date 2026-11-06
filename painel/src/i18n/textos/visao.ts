import { secao } from "../secao"

export default secao({
  pt: {
    visao: {
      descricao: "Que conta cada computador está usando, quanto já foi e o que pede atenção.",
      faixa: {
        precisa_login: {
          titulo: "{conta} precisa entrar de novo",
          texto: "O login venceu. Entre de novo para ela voltar ao revezamento.",
          botao: "Entrar de novo",
        },
        sem_livre: {
          titulo: "Nenhuma conta livre para {computador}",
          texto: "Todas estão no limite, pausadas ou em outro computador. A conta atual segue até bater no limite.",
          botao: "Ver contas",
        },
        folga_acabando: {
          titulo: "Folga acabando: só {conta} ainda tem folga",
          texto: "{proxima}",
          botao: "Ver contas",
        },
        sem_folga: {
          titulo: "Folga acabando: nenhuma conta com folga agora",
          texto: "{proxima} Até lá, o Reveza usa a conta com mais folga até 100%.",
          botao: "Ver contas",
        },
        proxima: "A próxima libera {quando}: {conta}.",
        semPrevisao: "Ainda sem a hora em que a próxima libera.",
        computador_parado: {
          titulo: "{computador} parou de responder",
          texto: "Visto {quando}. Sem conversar com a nuvem, ela não troca a conta dele.",
          botao: "Ver saúde",
        },
        login_vence: {
          titulo: "O login de {conta} vence {quando}",
          texto: "O computador que estiver com ela renova sozinho; se nenhum estiver ligado, ela vai pedir login.",
          botao: "Ver contas",
        },
        versao_antiga: {
          titulo: "{computador} está na versão {versao}",
          texto: "A mais nova entre os seus computadores é a {nova}.",
          botao: "Atualizar",
        },
        auto_desligada: {
          titulo: "A troca automática está desligada",
          texto: "Cada computador fica na conta que está até alguém trocar à mão.",
          botao: "Configurar",
        },
      },
      kpi: {
        livres: "Contas livres",
        emUso: { um: "{n} em uso", outros: "{n} em uso" },
        esgotadas: { um: "{n} esgotada", outros: "{n} esgotadas" },
        login: { um: "{n} pede login", outros: "{n} pedem login" },
        trocas: "Trocas em 24 h",
        trocasRodape: "Última {quando}",
        trocasNenhuma: "Nenhuma troca nas últimas 24 h",
        custo: "Custo equivalente hoje",
        custoRodape: "Ontem até esta hora: {valor}",
        custoDica: "Quanto o uso de hoje custaria pela tabela de preço da API. Não é cobrança.",
        proxima: "Próxima a esgotar",
        proximaRodape: "{janela}, no ritmo da última hora",
        proximaNenhuma: "Nenhuma esgota antes de renovar",
      },
      emUso: {
        titulo: "Em uso agora",
        descricao: "A conta de cada computador e a janela que está mais perto do fim.",
        semConta: "Sem conta atribuída",
        desde: "desde {quando}",
        renova: "renova {quando}",
        nenhum: "Nenhum computador ligado ainda.",
        ligar: "Ligar um computador",
      },
      contas: {
        titulo: "Contas",
        verTodas: "Ver todas",
      },
      grafico: {
        titulo: "Janela de 5 horas",
        descricao:
          "Uso de cada conta ao longo do tempo, um tom da cor do workspace para cada. As linhas tracejadas são o aviso e a troca.",
        h6: "6 horas",
        h24: "24 horas",
        aviso: "aviso",
        troca: "troca",
      },
      eventos: {
        titulo: "Linha do tempo",
        nenhum: "Nada aconteceu ainda.",
        mais: "Mostrar mais",
      },
    },
  },
  en: {
    visao: {
      descricao: "Which account each computer is using, how much is gone and what needs attention.",
      faixa: {
        precisa_login: {
          titulo: "{conta} needs to sign in again",
          texto: "The sign-in expired. Sign in again to bring it back into rotation.",
          botao: "Sign in again",
        },
        sem_livre: {
          titulo: "No free account for {computador}",
          texto:
            "All of them are at the limit, paused or on another computer. The current account stays until it hits the limit.",
          botao: "See accounts",
        },
        folga_acabando: {
          titulo: "Running low: only {conta} still has room",
          texto: "{proxima}",
          botao: "See accounts",
        },
        sem_folga: {
          titulo: "Running low: no account has room right now",
          texto: "{proxima} Until then, Reveza uses the account with the most room up to 100%.",
          botao: "See accounts",
        },
        proxima: "Next to free up {quando}: {conta}.",
        semPrevisao: "No time yet for when the next one frees up.",
        computador_parado: {
          titulo: "{computador} stopped responding",
          texto: "Seen {quando}. Without talking to the cloud, it can't switch its account.",
          botao: "See health",
        },
        login_vence: {
          titulo: "The sign-in for {conta} expires {quando}",
          texto: "Whichever computer holds it renews on its own; if none is on, it will ask to sign in.",
          botao: "See accounts",
        },
        versao_antiga: {
          titulo: "{computador} is on version {versao}",
          texto: "The newest among your computers is {nova}.",
          botao: "Update",
        },
        auto_desligada: {
          titulo: "Auto switch is off",
          texto: "Each computer stays on its current account until someone switches by hand.",
          botao: "Set up",
        },
      },
      kpi: {
        livres: "Free accounts",
        emUso: { um: "{n} in use", outros: "{n} in use" },
        esgotadas: { um: "{n} exhausted", outros: "{n} exhausted" },
        login: { um: "{n} needs sign-in", outros: "{n} need sign-in" },
        trocas: "Switches in 24 h",
        trocasRodape: "Last one {quando}",
        trocasNenhuma: "No switches in the last 24 h",
        custo: "Equivalent cost today",
        custoRodape: "Yesterday by this time: {valor}",
        custoDica: "What today's usage would cost at API prices. Not a charge.",
        proxima: "Next to run out",
        proximaRodape: "{janela}, at the last hour's pace",
        proximaNenhuma: "None runs out before resetting",
      },
      emUso: {
        titulo: "In use now",
        descricao: "Each computer's account and the window closest to running out.",
        semConta: "No account assigned",
        desde: "since {quando}",
        renova: "resets {quando}",
        nenhum: "No computer linked yet.",
        ligar: "Link a computer",
      },
      contas: {
        titulo: "Accounts",
        verTodas: "See all",
      },
      grafico: {
        titulo: "5-hour window",
        descricao:
          "Each account's usage over time, one shade of its workspace color each. Dashed lines are the warning and the switch.",
        h6: "6 hours",
        h24: "24 hours",
        aviso: "warning",
        troca: "switch",
      },
      eventos: {
        titulo: "Timeline",
        nenhum: "Nothing happened yet.",
        mais: "Show more",
      },
    },
  },
})
