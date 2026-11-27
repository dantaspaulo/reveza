// As pastas da barra lateral do OpenBot (0.22.0): o agente lê, só para leitura, em que pasta (e subpastas) cada agente
// está, para o projeto poder pegar uma pasta inteira. Leitura ruim lança erro (quem chama mantém a última boa); arquivo
// ausente é barra vazia.

import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { barraDoLayout, agentesDaSaida, CONSULTA_AGENTES } from "../src/openbot.js";

const A = "aaaaaaaa-0000-4000-8000-000000000001";
const B = "bbbbbbbb-0000-4000-8000-000000000002";
const C = "cccccccc-0000-4000-8000-000000000003";

function layout(o: Record<string, unknown>): string {
  return JSON.stringify({ version: 2, revision: 7, order: [], agentOrder: [], ...o });
}

describe("barra lateral do OpenBot", () => {
  test("sem arquivo: barra vazia, sem erro", () => {
    const b = barraDoLayout(null);
    assert.deepEqual(b.pastas, []);
    assert.equal(b.deAgente.size, 0);
  });

  test("pasta e subpasta: a cadeia vai da raiz até a pasta do agente", () => {
    const b = barraDoLayout(
      layout({
        sections: [
          { id: A, name: "Empresa" },
          { id: B, name: "Time", parentId: A },
          { id: C, name: "Outra", parentId: null },
        ],
        agentAssignments: { "agent-1": B, "agent-2": A, "agent-3": C },
      }),
    );
    assert.deepEqual(b.pastas, [
      { id: A, nome: "Empresa", pai: null },
      { id: B, nome: "Time", pai: A },
      { id: C, nome: "Outra", pai: null },
    ]);
    assert.deepEqual(b.deAgente.get("agent-1"), [A, B]);
    assert.deepEqual(b.deAgente.get("agent-2"), [A]);
    assert.deepEqual(b.deAgente.get("agent-3"), [C]);
    assert.equal(b.deAgente.has("agent-4"), false, "agente fora de pasta não tem cadeia");
  });

  test("ciclo de pais ou mais de 10 níveis: os agentes dali ficam sem pasta (não se adivinha)", () => {
    const ciclo = barraDoLayout(
      layout({
        sections: [
          { id: A, name: "a", parentId: B },
          { id: B, name: "b", parentId: A },
          { id: C, name: "c" },
          { id: "d", name: "d", parentId: "d" },
        ],
        agentAssignments: { "agent-1": A, "agent-2": C, "agent-3": "d" },
      }),
    );
    assert.equal(ciclo.deAgente.has("agent-1"), false);
    // revisão da 0.22.0: a pasta que é pai de si mesma é raiz, como na nuvem e no painel (que a oferecem para escolher)
    assert.deepEqual(ciclo.deAgente.get("agent-3"), ["d"], "pasta que é pai de si mesma é raiz");
    assert.deepEqual(ciclo.deAgente.get("agent-2"), [C]);

    const secoes = Array.from({ length: 12 }, (_, i) => ({ id: `s${i}`, name: `n${i}`, ...(i ? { parentId: `s${i - 1}` } : {}) }));
    const funda = barraDoLayout(layout({ sections: secoes, agentAssignments: { "agent-1": "s11", "agent-2": "s9", "agent-3": "s10" } }));
    assert.equal(funda.deAgente.has("agent-1"), false, "12 níveis: sem pasta");
    assert.equal(funda.deAgente.has("agent-3"), false, "11 níveis: sem pasta");
    assert.equal(funda.deAgente.get("agent-2")!.length, 10, "10 níveis: vale");
  });

  test("pai que não existe vira raiz; pasta que não existe deixa o agente sem pasta", () => {
    const b = barraDoLayout(
      layout({ sections: [{ id: B, name: "órfã", parentId: A }], agentAssignments: { "agent-1": B, "agent-2": C } }),
    );
    assert.deepEqual(b.pastas, [{ id: B, nome: "órfã", pai: null }]);
    assert.deepEqual(b.deAgente.get("agent-1"), [B]);
    assert.equal(b.deAgente.has("agent-2"), false);
  });

  test("id estranho fica de fora; nome sem controle, curto e pode ser vazio", () => {
    const b = barraDoLayout(
      layout({
        sections: [
          { id: "com espaço", name: "x" },
          { id: "x".repeat(101), name: "x" },
          { id: 5, name: "x" },
          "texto",
          null,
          { id: A, name: "Linha\nnova" + "N".repeat(200) },
          { id: B },
        ],
        agentAssignments: { "agent-1": A, "agent 2": A, "agent-3": "com espaço", "agent-4": 5, "agent-5": B },
      }),
    );
    assert.deepEqual(
      b.pastas.map((p) => p.id),
      [A, B],
    );
    assert.equal(b.pastas[0]!.nome, ("Linha nova" + "N".repeat(200)).slice(0, 120));
    assert.equal(b.pastas[1]!.nome, "");
    assert.deepEqual([...b.deAgente.keys()], ["agent-1", "agent-5"]);
  });

  test("JSON estragado, versão desconhecida ou formato errado: lança (quem chama mantém a última leitura boa)", () => {
    assert.throws(() => barraDoLayout("{quebrado"), /barra/);
    assert.throws(() => barraDoLayout(""), /barra/);
    assert.throws(() => barraDoLayout("[]"), /barra/);
    assert.throws(() => barraDoLayout(layout({ version: 3, sections: [], agentAssignments: {} })), /versão 3/);
    assert.throws(() => barraDoLayout(JSON.stringify({ sections: [], agentAssignments: {} })), /versão/);
    assert.throws(() => barraDoLayout(layout({ sections: {}, agentAssignments: {} })), /barra/);
    assert.throws(() => barraDoLayout(layout({ sections: [], agentAssignments: [] })), /barra/);
  });

  test("no máximo 500 pastas", () => {
    const secoes = Array.from({ length: 600 }, (_, i) => ({ id: `s${i}`, name: `n${i}` }));
    const b = barraDoLayout(layout({ sections: secoes, agentAssignments: { "agent-1": "s550", "agent-2": "s10" } }));
    assert.equal(b.pastas.length, 500);
    assert.equal(b.deAgente.has("agent-1"), false);
    assert.deepEqual(b.deAgente.get("agent-2"), ["s10"]);
  });
});

describe("o id do agente na consulta ao banco do OpenBot (0.22.0)", () => {
  test("a consulta traz o id e a saída guarda só id válido", () => {
    assert.match(CONSULTA_AGENTES, /agent_id AS id/);
    const r = agentesDaSaida(
      JSON.stringify([
        { id: "agent-1", pasta: "/a", nome: "", titulo: "" },
        { id: "agent 2", pasta: "/b", nome: "", titulo: "" },
        { pasta: "/c", nome: "", titulo: "" },
      ]),
    );
    assert.deepEqual(r, [
      { id: "agent-1", pasta: "/a", nome: "", titulo: "" },
      { pasta: "/b", nome: "", titulo: "" },
      { pasta: "/c", nome: "", titulo: "" },
    ]);
  });

  test("revisão: pasta que é pai dela mesma é raiz (como na nuvem e no painel); nome cortado não deixa meio emoji", () => {
    const longo = "x".repeat(119) + "\u{1F600}";
    const b = barraDoLayout(layout({ sections: [{ id: A, name: longo, parentId: A }], agentAssignments: { "agent-1": A } }));
    assert.deepEqual(b.deAgente.get("agent-1"), [A]);
    assert.equal(b.pastas[0]!.pai, null);
    const nome = b.pastas[0]!.nome;
    assert.ok(!/[\uD800-\uDBFF]$/.test(nome), "sem metade de emoji no fim");
    assert.doesNotThrow(() => encodeURIComponent(nome));
  });
});
