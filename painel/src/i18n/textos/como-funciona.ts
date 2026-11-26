import { secao } from "../secao"

export default secao({
  pt: {
    comoFunciona: {
      descricao:
        "O caminho de um login, do computador até a troca de conta, e a regra que a nuvem usa para escolher. Nenhum login anda em claro fora do seu computador.",
      diagrama: {
        titulo: "O caminho de uma troca",
        seuComputador: "Seu computador",
        nuvem: "Nuvem da sua instalação",
        outroComputador: "Computador que vai usar",
        pausar: "Pausar",
        continuar: "Continuar",
        anterior: "Etapa anterior",
        proxima: "Próxima etapa",
        etapa: "Etapa {n} de 6",
        pacotes: {
          p1: "login",
          p2: "cifrado",
          p3: "uso",
          p4: "decisão",
          p5: "credencial",
        },
        etapas: {
          e1: {
            titulo: "Login oficial|no computador",
            texto:
              "Você entra em cada conta pelo login oficial, no navegador do próprio computador. O painel pede; quem abre o login é o computador. Nenhuma senha passa pelo painel.",
            dado: '{"conta": "trabalho@exemplo.com", "token": "…"}',
          },
          e2: {
            titulo: "Login cifrado|no computador",
            texto:
              "O agente cifra o login com AES-256-GCM usando a chave do cofre, que só existe no chaveiro dos seus computadores. O dado associado amarra o cifrado à conta e à versão.",
            dado: "AES-256-GCM(chave do cofre, login) →",
          },
          e3: {
            titulo: "Cofre na nuvem:|só texto cifrado",
            texto:
              "A nuvem guarda só o texto cifrado. Nem o banco nem a hospedagem conseguem abrir: a chave não sai dos seus computadores.",
            dado: "9f3ac1e07b52d4a8e6f01c93b7d2a5e4c8f6b1d03a7e9c25f4b8d6e1a3c7f902",
          },
          e4: {
            titulo: "A nuvem|decide",
            texto:
              "A cada minuto, e na hora em que chega uso novo ou uma sessão bate no limite, a função decidir() escolhe a conta de cada computador pela regra (modo, limiares, ordem, reserva, agenda, teto).",
            dado: "Notebook → pessoal@exemplo.com (chegou a 95%)",
          },
          e5: {
            titulo: "O computador baixa,|decifra e troca",
            texto:
              "Na próxima conversa com a nuvem (a cada 5 a 30 segundos, como você escolher), o computador vê a decisão, pega a posse da conta, baixa o cifrado, decifra com a chave local e troca a credencial ativa.",
            dado: "posse ✓ · cofre ✓ · decifrado ✓ · credencial trocada ✓",
          },
          e6: {
            titulo: "A sessão|continua",
            texto:
              "A sessão aberta segue na conta nova. Ela relê a conversa na conta nova (o cache não passa de uma conta para outra): por isso trocar muito custa.",
            dado: "sessão retomada em pessoal@exemplo.com",
          },
        },
      },
      simulador: {
        titulo: "Simulador da regra de alternar",
        descricao:
          "Mexa no uso das contas e na situação e veja qual conta a nuvem escolheria e por quê. É a mesma regra da função decidir() do banco.",
        situacao: "Situação",
        auto: "Troca automática ligada",
        atual: "Conta em uso agora",
        nenhuma: "Nenhuma (computador novo)",
        sessaoLimite: "Uma sessão acabou de bater no limite",
        rodizioVenceu: "Chegou a hora do rodízio",
        trocouAgora: "A última troca foi há menos de {espera}",
        ordemRodizio: "No rodízio, ir para",
        sortearDeNovo: "Sortear de novo",
        contas: "Contas, na ordem de preferência",
        cinco: "5 horas",
        semana: "Semana",
        pausada: "Pausada",
        reserva: "Reserva",
        precisaLogin: "Precisa de login",
        ocupada: "Em outro computador",
        foraDaAgenda: "Fora da agenda",
        nomes: "Conta A,Conta B,Conta C,Conta D",
        resultado: {
          titulo: "A nuvem escolhe",
          nenhuma: "Nenhuma conta",
          fica: "Fica em {conta}",
          troca: "Troca para {conta}",
          avisoGerado: "Gera um aviso de uso alto.",
          alertaSemLivre: 'Gera o alerta "nenhuma conta livre".',
          usouReserva: "Usou a conta de reserva: não havia outra livre.",
          fila: "Fila de candidatas",
          filaVazia: "Nenhuma candidata livre.",
        },
        motivos: {
          primeira_escolha:
            "O computador estava sem conta: recebe a primeira livre da fila (isso vale mesmo com a troca automática desligada).",
          sem_conta_sem_livre: "O computador está sem conta e nenhuma está livre.",
          auto_desligada: "Com a troca automática desligada, o computador fica na conta que está.",
          fica_ate_limite: "No modo só no limite, fica até a conta chegar a 100%.",
          fica_abaixo_aviso: "A conta em uso está abaixo do aviso ({aviso}): nada a fazer.",
          fica_aviso: "Passou do aviso ({aviso}), mas não da troca: fica e avisa.",
          fica_rodizio_cedo: "Ainda não é hora do rodízio e a conta está abaixo do aviso.",
          troca_limite: "A conta em uso chegou a 100%: passa para a primeira livre da fila.",
          troca_limiar: "A conta em uso chegou à troca ({troca}): passa para a primeira livre da fila.",
          troca_sessao_limite: "Uma sessão bateu o limite: troca na hora, sem esperar a espera mínima.",
          troca_rodizio: "Hora do rodízio: vai para uma conta livre ({ordem}).",
          espera_minima:
            "Precisava trocar, mas a última troca foi há pouco: espera a espera mínima para não ficar trocando à toa.",
          sem_livre:
            "Precisava trocar, mas nenhuma conta está livre: se outro computador está parado há 60 minutos e há uma conta sem dono para ele ir, recebe a conta dele assim que ele a solta; senão, fica na atual e a nuvem manda o alerta.",
          rodizio_sem_livre: "Hora do rodízio, mas nenhuma outra conta está livre: fica.",
          troca_preferida: "A conta preferida deste computador ficou livre: ele volta para ela.",
          devolve_preferida:
            "A conta em uso é a preferida de outro computador ligado: devolve e passa para a primeira livre da fila.",
          fica_preferida: "Hora do rodízio, mas o computador está na conta preferida dele: fica nela.",
        },
        porConta: {
          atual: "em uso",
          pausada: "pausada",
          precisa_login: "precisa de login",
          ocupada: "em outro computador",
          fora_agenda: "fora da agenda",
          esgotada: "esgotada",
          acima_aviso: "acima do aviso",
          teto_semana: "no teto da semana",
          reserva: "reserva (por último)",
          acima_ritmo: "acima do ritmo (depois das outras)",
          preferida: "preferida deste computador (primeiro)",
          preferida_de_outro: "preferida de outro computador (depois das outras)",
          livre: "livre",
        },
      },
    },
  },
  en: {
    comoFunciona: {
      descricao:
        "The path of a sign-in, from the computer to the account switch, and the rule the cloud uses to choose. No sign-in travels in plain text outside your computer.",
      diagrama: {
        titulo: "The path of a switch",
        seuComputador: "Your computer",
        nuvem: "Your installation's cloud",
        outroComputador: "Computer that will use it",
        pausar: "Pause",
        continuar: "Resume",
        anterior: "Previous step",
        proxima: "Next step",
        etapa: "Step {n} of 6",
        pacotes: {
          p1: "sign-in",
          p2: "encrypted",
          p3: "usage",
          p4: "decision",
          p5: "credential",
        },
        etapas: {
          e1: {
            titulo: "Official sign-in|on the computer",
            texto:
              "You sign in to each account through the official sign-in, in the computer's own browser. The panel asks; the computer opens the sign-in. No password goes through the panel.",
            dado: '{"account": "work@example.com", "token": "…"}',
          },
          e2: {
            titulo: "Sign-in encrypted|on the computer",
            texto:
              "The agent encrypts the sign-in with AES-256-GCM using the vault key, which only exists in your computers' keychain. Associated data ties the ciphertext to the account and version.",
            dado: "AES-256-GCM(vault key, sign-in) →",
          },
          e3: {
            titulo: "Vault in the cloud:|ciphertext only",
            texto:
              "The cloud keeps only the ciphertext. Neither the database nor the hosting can open it: the key never leaves your computers.",
            dado: "9f3ac1e07b52d4a8e6f01c93b7d2a5e4c8f6b1d03a7e9c25f4b8d6e1a3c7f902",
          },
          e4: {
            titulo: "The cloud|decides",
            texto:
              "Every minute, and whenever new usage arrives or a session hits the limit, the decidir() function picks each computer's account by the rule (mode, thresholds, order, backup, schedule, cap).",
            dado: "Notebook → personal@example.com (reached 95%)",
          },
          e5: {
            titulo: "The computer downloads,|decrypts and switches",
            texto:
              "On its next talk with the cloud (every 5 to 30 seconds, as you choose), the computer sees the decision, takes ownership of the account, downloads the ciphertext, decrypts it with the local key and swaps the active credential.",
            dado: "ownership ✓ · vault ✓ · decrypted ✓ · credential swapped ✓",
          },
          e6: {
            titulo: "The session|goes on",
            texto:
              "The open session carries on with the new account. It rereads the conversation on the new account (cache doesn't carry over between accounts): that's why switching a lot costs.",
            dado: "session resumed on personal@example.com",
          },
        },
      },
      simulador: {
        titulo: "Switching rule simulator",
        descricao:
          "Change the accounts' usage and the situation and see which account the cloud would pick and why. It's the same rule as the database's decidir() function.",
        situacao: "Situation",
        auto: "Auto switch on",
        atual: "Account in use now",
        nenhuma: "None (new computer)",
        sessaoLimite: "A session just hit the limit",
        rodizioVenceu: "Rotation time has come",
        trocouAgora: "The last switch was less than {espera} ago",
        ordemRodizio: "On rotation, go to",
        sortearDeNovo: "Draw again",
        contas: "Accounts, in preference order",
        cinco: "5 hours",
        semana: "Week",
        pausada: "Paused",
        reserva: "Backup",
        precisaLogin: "Needs sign-in",
        ocupada: "On another computer",
        foraDaAgenda: "Outside schedule",
        nomes: "Account A,Account B,Account C,Account D",
        resultado: {
          titulo: "The cloud picks",
          nenhuma: "No account",
          fica: "Stays on {conta}",
          troca: "Switches to {conta}",
          avisoGerado: "Raises a high-usage warning.",
          alertaSemLivre: 'Raises the "no free account" alert.',
          usouReserva: "Used the backup account: no other was free.",
          fila: "Candidate queue",
          filaVazia: "No free candidate.",
        },
        motivos: {
          primeira_escolha:
            "The computer had no account: it gets the first free one in the queue (even with auto switch off).",
          sem_conta_sem_livre: "The computer has no account and none is free.",
          auto_desligada: "With auto switch off, the computer stays on its account.",
          fica_ate_limite: "In only-at-the-limit mode, it stays until the account reaches 100%.",
          fica_abaixo_aviso: "The account in use is below the warning ({aviso}): nothing to do.",
          fica_aviso: "Past the warning ({aviso}) but not the switch: it stays and warns.",
          fica_rodizio_cedo: "It's not rotation time yet and the account is below the warning.",
          troca_limite: "The account in use reached 100%: it moves to the first free one in the queue.",
          troca_limiar: "The account in use reached the switch ({troca}): it moves to the first free one in the queue.",
          troca_sessao_limite: "A session hit the limit: it switches right away, without the minimum wait.",
          troca_rodizio: "Rotation time: it goes to a free account ({ordem}).",
          espera_minima:
            "It should switch, but the last switch was recent: it waits the minimum wait to avoid pointless switching.",
          sem_livre:
            "It should switch, but no account is free: if another computer has been idle for 60 minutes and there is an unowned account for it to move to, it gets that computer's account as soon as it lets go; otherwise it stays and the cloud sends the alert.",
          rodizio_sem_livre: "Rotation time, but no other account is free: it stays.",
          troca_preferida: "This computer's preferred account is free again: it goes back to it.",
          devolve_preferida:
            "The account in use is another powered-on computer's preferred one: it gives it back and takes the first free one in line.",
          fica_preferida: "Rotation time, but the computer is on its preferred account: it stays there.",
        },
        porConta: {
          atual: "in use",
          pausada: "paused",
          precisa_login: "needs sign-in",
          ocupada: "on another computer",
          fora_agenda: "outside schedule",
          esgotada: "exhausted",
          acima_aviso: "above the warning",
          teto_semana: "at the weekly cap",
          reserva: "backup (last)",
          acima_ritmo: "above pace (after the others)",
          preferida: "this computer's preferred (first)",
          preferida_de_outro: "another computer's preferred (after the others)",
          livre: "free",
        },
      },
    },
  },
})
