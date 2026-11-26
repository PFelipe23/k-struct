import { describe, expect, it } from "vitest";
import { beamExample, free, serializeProject } from "../src/domain/model";
import { exportOofem } from "../src/solver/oofem";
import {
  diagnoseModel,
  diagnoseSolverFailure,
} from "../src/domain/diagnostics";
import { diagnosticContextMatches } from "../src/solver/diagnosticHistory";

describe("diagnósticos de análise", () => {
  it("localiza o nó isolado e a barra física que o contém", () => {
    const project = beamExample();
    project.nodes.push({
      ...project.nodes[0],
      id: "isolated",
      name: "N-isolado",
    });

    const [diagnostic] = diagnoseModel(project);
    expect(diagnostic.message).toContain("Objetos identificados: N-isolado");
    expect(diagnostic.objects).toEqual([{ kind: "node", id: "isolated" }]);
    expect(diagnostic.confidence).toBe("confirmado");
  });

  it("aponta o componente conectado quando faltam restrições suficientes", () => {
    const project = beamExample();
    project.nodes.forEach((node) => (node.restraints = free()));

    const diagnostics = diagnoseModel(project);
    const support = diagnostics.find(({ message }) =>
      message.includes("apoios insuficientes"),
    );
    expect(support?.objects).toEqual([
      ...project.nodes.map(({ id }) => ({ kind: "node" as const, id })),
      ...project.members.map(({ id }) => ({ kind: "member" as const, id })),
    ]);
  });

  it("identifica a barra que referencia um nó inexistente", () => {
    const project = beamExample();
    project.members[0].end = "ausente";

    const [diagnostic] = diagnoseModel(project);
    expect(diagnostic.message).toContain("nó de extremidade inexistente");
    expect(diagnostic.objects).toEqual([
      { kind: "member", id: project.members[0].id },
    ]);
  });

  it("não atribui uma singularidade genérica a uma peça arbitrária", () => {
    const [diagnostic] = diagnoseSolverFailure(
      "Falha do solver",
      "stiffness matrix is singular",
      "",
    );
    expect(diagnostic.message).toMatch(/matriz singular/);
    expect(diagnostic.objects).toEqual([]);
    expect(diagnostic.confidence).toBe("possível");
  });

  it("traduz somente identificadores explícitos do log pela malha da execução", () => {
    const project = beamExample();
    const input = exportOofem(project, "EL");
    const node = input.nodes.find(
      ({ objectId }) => objectId === project.nodes[0].id,
    )!;
    const [diagnostic] = diagnoseSolverFailure(
      "Falha do solver",
      `Dof manager number ${node.number} has zero pivot; stiffness matrix is singular`,
      "",
      input,
    );
    expect(diagnostic.objects).toEqual([
      { kind: "node", id: project.nodes[0].id },
    ]);
    expect(diagnostic.confidence).toBe("confirmado");
  });

  it("impede saltos de um diagnóstico histórico para um modelo editado", () => {
    const project = beamExample();
    const snapshot = serializeProject(project);
    const context = {
      projectId: project.id,
      projectSnapshot: snapshot,
      diagnostics: diagnoseModel(project),
    };
    expect(diagnosticContextMatches(context, project)).toBe(true);
    project.name = "Projeto alterado";
    expect(diagnosticContextMatches(context, project)).toBe(false);
  });
});
