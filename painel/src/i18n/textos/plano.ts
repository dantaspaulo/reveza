import { secao } from "../secao"

export default secao({
  pt: {
    plano: {
      descricao:
        "A cota de cada conta é a semana inteira (100%, ou o teto que você deu), dividida pelos 7 dias. Aqui dá para ver quanto já foi e se o ritmo cabe até renovar.",
      ritmo: {
        abaixo: "Abaixo do ritmo",
        no_ritmo: "No ritmo",
        acima: "Acima do ritmo",
        esgotada: "Esgotada",
        sem_dado: "Sem leitura",
      },
      usado: "{usado} de {limite}",
      renova: "renova {quando}",
      esperado: "esperado agora: {pct}",
      cotaDia: "Cota por dia",
      porDia: "Cabe por dia até renovar",
      porDiaTexto: "{pct} por dia nos {dias} que faltam",
      esgotaAntes: "No ritmo da semana, esgota {quando}, antes de renovar.",
      folga: "Sobra {pct} da semana.",
      diasGrafico: "Uso de cada dia da semana",
      cotaLinha: "cota do dia",
      semLeitura: "Esta conta ainda não tem leitura da semana.",
      semSemana: "Esta conta não informa cota semanal agora: só a janela de 5 horas.",
      semSemanaSelo: "Sem semana",
      soFable:
        "Esta conta não informa a semana geral agora. Esta é a semana do Fable, que só conta para as sessões no Fable.",
      teto: "com teto de {pct}",
      dicaRitmo: "A nuvem já deixa por último, na escolha, a conta que está acima do ritmo.",
    },
  },
  en: {
    plano: {
      descricao:
        "Each account's quota is the whole week (100%, or the cap you set), split across 7 days. Here you can see how much is gone and whether the pace fits until it resets.",
      ritmo: {
        abaixo: "Below pace",
        no_ritmo: "On pace",
        acima: "Above pace",
        esgotada: "Exhausted",
        sem_dado: "No reading",
      },
      usado: "{usado} of {limite}",
      renova: "resets {quando}",
      esperado: "expected now: {pct}",
      cotaDia: "Quota per day",
      porDia: "Fits per day until reset",
      porDiaTexto: "{pct} per day over the {dias} left",
      esgotaAntes: "At this week's pace, it runs out {quando}, before resetting.",
      folga: "{pct} of the week is left.",
      diasGrafico: "Usage on each day of the week",
      cotaLinha: "daily quota",
      semLeitura: "This account has no weekly reading yet.",
      semSemana: "This account does not report a weekly quota right now: only the 5-hour window.",
      semSemanaSelo: "No week",
      soFable:
        "This account does not report its overall week right now. This is the Fable week, which only counts for sessions on Fable.",
      teto: "with a {pct} cap",
      dicaRitmo: "The cloud already puts an account that's above pace last when choosing.",
    },
  },
})
