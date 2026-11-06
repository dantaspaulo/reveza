// Os componentes GRÁTIS do React Bits (reactbits.dev) que o painel usa, e onde. A licença deles (MIT + Commons
// Clause) não deixa redistribuir: nenhum entra no repositório. `npm run react-bits` baixa cada um na máquina de quem
// instala, para src/components/react-bits/ (pasta ignorada pelo git). Nada do React Bits Pro.
// As dependências que eles pedem (motion, ogl) já estão no package.json do painel.

export const COMPONENTES = [
  {
    nome: "CountUp",
    onde: "números da Visão geral e do Uso",
    sha256: "abf8eef48056b0d2284d493421c4f2fb4f14edaf437696b956a30b5543759eaf",
  },
  {
    nome: "ShinyText",
    onde: 'o selo "ao vivo" do cabeçalho',
    sha256: "0d9c96b1b2c231a50ce3f66378590d2c366e0331ccdce4b92a0c3240220e301d",
  },
  {
    nome: "GradientText",
    onde: "o nome do produto no menu e nas telas de entrada",
    sha256: "dd46f0e515ee2f0812fd2c4de0cb8347fe415ead1e45d08b5e51beef50b5ca48",
  },
  {
    nome: "BlurText",
    onde: "o subtítulo das telas de entrada e da página Como funciona",
    sha256: "c824a558bb484521abe6adac25ba8af839de81434018a4fe044fc9969fe353e3",
  },
  {
    nome: "DecryptedText",
    onde: "o texto cifrado no diagrama da página Como funciona",
    sha256: "1ae5d6da17d76182b45aa4fc8d6a97387a8f07bda7d69c3b27ec1de308d88f38",
  },
  {
    nome: "SpotlightCard",
    onde: "as etapas do diagrama e os exemplos de Integrações",
    sha256: "f7b64189ce3c018e5f54103bdf16b3e5f0c97f4a0dba9f6cd62d8793580b8c72",
  },
  {
    nome: "SloshGauge",
    onde: "os níveis de uso que se arrastam no simulador da regra",
    sha256: "898f83f34c3266aa8a7dfeaa0e70497a08cc4b7b78aef41fbc3c0cd01ec24643",
  },
  {
    nome: "HoldButton",
    onde: "confirmar segurando: revogar computador, membro e chave, sair de todas as sessões",
    sha256: "7365e059b3d3d18bfc6626bd5dd5f588b0a299f6bed732d2d0ec190dba1857e3",
  },
  {
    nome: "StatusMark",
    onde: "os itens do diagnóstico na página Saúde",
    sha256: "6e14849c0719d472104dad43ad21199afab382c9c649e24e71ccc2b278c4bb7d",
  },
  {
    nome: "Aurora",
    onde: "o fundo das telas de entrada",
    sha256: "d4ecc600762aed884a4c2c3724a7601567c9120fa4cc1ae5c8bdd7c0997828f0",
  },
]

// sha256 do .tsx que o registro entrega, conferido antes de gravar: o código entra no mesmo pacote do painel (que
// guarda a sessão do administrador), então muda só quando alguém revisar e trocar o resumo aqui. Se o registro mudar,
// o componente não é gravado e o painel segue com a versão simples (auditoria de segurança de 11/10/2026).
export const NOMES = COMPONENTES.map((c) => c.nome)

export const URL_REGISTRO = (nome) => `https://reactbits.dev/r/${nome}-TS-TW.json`
