import { describe, expect, it } from "vitest";
import { addMember, addSlab } from "../src/domain/editing";
import {
  beamExample,
  createProject,
  parseProject,
  removeSelection,
  serializeProject,
  type Project,
} from "../src/domain/model";
import { historyReducer } from "../src/domain/history";
import {
  allObjects,
  combineSelection,
  filterObjects,
  objectsInWindow,
} from "../src/domain/selection";

const at = (x: number, y: number, z = 3) => ({ x, y, z });
const plane = { kind: "XY", offset: 3 } as const;
const a = { u: 0, v: 0 },
  b = { u: 4, v: 4 };
function bars(p: Project, crossing = false) {
  return objectsInWindow(p, plane, crossing ? b : a, crossing ? a : b)
    .filter((o) => o.kind === "member")
    .map((o) => o.id);
}

describe("seleção de objetos", () => {
  it("inclui limites, cruza segmentos com duas pontas externas e descarta projeções e diagonais que só cruzam a caixa envolvente", () => {
    const p = createProject("spatial");
    const add = (x: number, y: number, X: number, Y: number, z = 3) =>
      addMember(p, at(x, y, z), at(X, Y, z)).id;
    const inside = add(0, 0, 4, 4),
      across = add(-2, 2, 6, 2),
      tangent = add(-1, 1, 1, -1);
    add(-3, 2, 2, -3);
    add(1, 1, 2, 2, 6);
    const vertical = add(2, -1, 2, 6);
    expect(bars(p)).toEqual([inside]);
    expect(bars(p, true)).toEqual([inside, across, tangent, vertical]);
    const elev = objectsInWindow(
      p,
      { kind: "XZ", offset: 0 },
      { u: -2, v: 1 },
      { u: 1, v: 4 },
    );
    expect(elev.map((o) => o.kind)).toEqual(["node"]);
  });
  it("inclui uma laje que envolve a janela apenas por cruzamento e somente no pavimento visível", () => {
    const p = createProject("spatial");
    const slab = addSlab(p, "level1", at(-1, -1), at(5, 5));
    expect(objectsInWindow(p, plane, a, b)).toEqual([]);
    expect(objectsInWindow(p, plane, b, a)).toEqual([
      { kind: "slab", id: slab.id },
    ]);
    expect(objectsInWindow(p, { ...plane, offset: 6 }, b, a)).toEqual([]);
    expect(objectsInWindow(p, plane, { u: -2, v: -2 }, { u: 6, v: 6 })).toEqual(
      [{ kind: "slab", id: slab.id }],
    );
  });
  it("cruza tipo, seção, material e piso sem incluir um pilar ou um nó por material", () => {
    const p = createProject("spatial");
    p.materials.push({ ...p.materials[0], id: "m2", name: "Outro material" });
    p.sections.push({ ...p.sections[0], id: "r2", materialId: "m2" });
    const beam = addMember(p, at(1, 0), at(3, 0));
    const column = addMember(p, at(1, 0), at(1, 0, 6));
    const other = addMember(p, at(1, 2), at(3, 2));
    other.sectionId = "r2";
    const slab = addSlab(p, "level1", at(0, 0), at(4, 4));
    slab.materialId = "steel";
    const filter = { ...allObjects, levelId: "level1", materialId: "steel" };
    expect(filterObjects(p, filter)).toEqual([
      { kind: "member", id: beam.id },
      { kind: "slab", id: slab.id },
    ]);
    expect(filterObjects(p, { ...filter, sectionId: "r2" })).toEqual([]);
    expect(filterObjects(p, { ...filter, kind: "node" })).toEqual([]);
    expect(filterObjects(p, { ...allObjects, levelId: "inexistente" })).toEqual(
      [],
    );
    expect(
      filterObjects(p, { ...allObjects, kind: "member" }).map((o) => o.id),
    ).toContain(column.id);
  });
  it("combina conjuntos preservando a identidade por tipo e ID", () => {
    const n = { kind: "node", id: "A" } as const,
      m = { kind: "member", id: "A" } as const;
    expect(combineSelection([n], [n, m], "add")).toEqual([n, m]);
    expect(combineSelection([n, m], [m], "intersect")).toEqual([m]);
    expect(combineSelection([n, m], [m], "subtract")).toEqual([n]);
    expect(combineSelection([n], [m], "replace")).toEqual([m]);
  });
  it("mantém IDs ao renomear e recupera a remoção em cascata ao desfazer", () => {
    const p = beamExample();
    p.selectionGroups = [
      {
        id: "g",
        name: "Apoio e viga",
        objects: [
          { kind: "node", id: "A" },
          { kind: "member", id: "V1" },
        ],
      },
    ];
    p.members[0].name = "Viga de borda";
    expect(parseProject(serializeProject(p)).selectionGroups).toEqual(
      p.selectionGroups,
    );
    const next = structuredClone(p);
    removeSelection(next, [{ kind: "node", id: "A" }]);
    const h = historyReducer(
      { past: [], current: p, future: [] },
      { type: "change", project: next },
    );
    expect(h.current.selectionGroups[0].objects).toEqual([]);
    const old = historyReducer(h, { type: "undo" });
    expect(old.current.selectionGroups).toEqual(p.selectionGroups);
    expect(
      historyReducer(old, { type: "redo" }).current.selectionGroups,
    ).toEqual(next.selectionGroups);
  });
  it("migra v6 original e mantém as referências válidas de grupos em arquivos legados", () => {
    const { selectionGroups, ...p } = beamExample();
    const { meshConnections, ...legacy } = p;
    const v6 = { ...legacy, schemaVersion: 6 };
    expect(parseProject(JSON.stringify(v6)).selectionGroups).toEqual([]);
    const objects = [
      { kind: "member", id: "V1" },
      { kind: "node", id: "ausente" },
    ];
    const groups = [{ id: "g", name: "Vigas", objects }];
    expect(
      parseProject(JSON.stringify({ ...v6, selectionGroups: groups }))
        .selectionGroups,
    ).toEqual([{ ...groups[0], objects: [objects[0]] }]);
    expect(() =>
      parseProject(JSON.stringify({ ...p, selectionGroups: groups })),
    ).toThrow(/inexistente/);
    const repeated = { ...groups[0], objects: [objects[0], objects[0]] };
    expect(() =>
      parseProject(JSON.stringify({ ...p, selectionGroups: [repeated] })),
    ).toThrow(/repetido/);
  });
});
