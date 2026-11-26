import { offsetError } from "./memberOffsets";
import { reverseMember } from "./editing";
import { distance, memberLengthError } from "./geometry";
import { DEFAULT_UNITS, parseUnitInput, type UnitPreferences } from "../units";
import { connectionStations } from "./beamMesh";
import { free, type Project } from "./model";

export type CoordinateUnit = UnitPreferences["length"];

export type TabularCellError = {
  table: "nodes" | "members";
  line: number;
  column: string;
  value: string;
  reason: string;
};

export type TabularNodeAction = {
  action: "create" | "update" | "unchanged";
  id: string;
  name: string;
  x: number;
  y: number;
  z: number;
};

export type TabularMemberAction = {
  action: "create" | "update" | "unchanged";
  id: string;
  name: string;
  start: string;
  end: string;
  sectionId: string;
  sectionName: string;
  length: number;
};

export type TabularImportPlan = {
  unit: CoordinateUnit;
  nodes: TabularNodeAction[];
  members: TabularMemberAction[];
  counts: {
    nodesCreated: number;
    nodesUpdated: number;
    nodesUnchanged: number;
    membersCreated: number;
    membersUpdated: number;
    membersUnchanged: number;
  };
  hasChanges: boolean;
};

export type TabularImportResult =
  | { ok: true; plan: TabularImportPlan }
  | { ok: false; errors: TabularCellError[] };

const ID_PATTERN = /^[\w-]+$/;
const RESERVED_IDS = new Set(["__proto__", "constructor", "prototype"]);

function validateId(raw: string): string | null {
  const value = raw.trim();
  if (!value || value.length > 80) {
    return "Informe um ID com 1 a 80 caracteres.";
  }
  if (!ID_PATTERN.test(value) || RESERVED_IDS.has(value)) {
    return "Use apenas letras, números, sublinhado ou hífen no ID.";
  }
  return null;
}

function validateName(raw: string): string | null {
  const value = raw.trim();
  if (!value || value.length > 120) {
    return "Informe um nome com 1 a 120 caracteres.";
  }
  return null;
}

function normalizeHeaderToken(cell: string): string {
  return cell
    .trim()
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/\s*\([^)]*\)\s*$/g, "")
    .replace(/\s+/g, " ");
}

function splitTsvRows(
  tsv: string,
): { line: number; cells: string[]; raw: string }[] {
  const lines = tsv.replace(/\r\n/g, "\n").replace(/\r/g, "\n").split("\n");
  const rows: { line: number; cells: string[]; raw: string }[] = [];
  for (let i = 0; i < lines.length; i++) {
    const raw = lines[i];
    if (!raw.trim()) continue;
    rows.push({ line: i + 1, cells: raw.split("\t"), raw });
  }
  return rows;
}

const NODE_HEADER_ALIASES: Record<string, "id" | "name" | "x" | "y" | "z"> = {
  id: "id",
  nome: "name",
  name: "name",
  x: "x",
  y: "y",
  z: "z",
};

const MEMBER_HEADER_ALIASES: Record<
  string,
  "id" | "name" | "start" | "end" | "section"
> = {
  id: "id",
  nome: "name",
  name: "name",
  "id inicial": "start",
  inicio: "start",
  start: "start",
  "no inicial": "start",
  "no i": "start",
  i: "start",
  "id final": "end",
  fim: "end",
  end: "end",
  "no final": "end",
  "no j": "end",
  j: "end",
  secao: "section",
  section: "section",
  sectionid: "section",
  "id secao": "section",
};

export function inspectTabularImport(
  project: Project,
  {
    nodesTsv,
    membersTsv,
    unit,
  }: {
    nodesTsv: string;
    membersTsv: string;
    unit: CoordinateUnit;
  },
): TabularImportResult {
  const errors: TabularCellError[] = [];
  const units = { ...DEFAULT_UNITS, length: unit };
  const spatial = project.mode === "spatial";

  const existingNodes = new Map(project.nodes.map((n) => [n.id, n]));
  const existingMembers = new Map(project.members.map((m) => [m.id, m]));
  const sectionById = new Map(project.sections.map((s) => [s.id, s]));

  const resolveSection = (raw: string) => {
    const token = raw.trim();
    const byId = sectionById.get(token);
    if (byId) return byId;
    const byName = project.sections.filter((s) => s.name === token);
    return byName.length === 1 ? byName[0] : undefined;
  };

  // 1. Parse nodes TSV
  const nodeRows = splitTsvRows(nodesTsv);
  let nodeColumns: ("id" | "name" | "x" | "y" | "z")[] = spatial
    ? ["id", "name", "x", "y", "z"]
    : ["id", "name", "x", "z"];
  let nodeStartIndex = 0;

  if (nodeRows.length > 0) {
    const mapped = nodeRows[0].cells.map(
      (cell) => NODE_HEADER_ALIASES[normalizeHeaderToken(cell)] ?? null,
    );
    const hasHeaderTokens =
      mapped.every((col) => col !== null) &&
      mapped.includes("id") &&
      mapped.includes("x") &&
      mapped.includes("z");
    if (hasHeaderTokens) {
      nodeStartIndex = 1;
      const cols = mapped as ("id" | "name" | "x" | "y" | "z")[];
      const expected = spatial ? 5 : 4;
      const required: ("id" | "name" | "x" | "y" | "z")[] = spatial
        ? ["id", "name", "x", "y", "z"]
        : ["id", "name", "x", "z"];
      if (
        cols.length !== expected ||
        new Set(cols).size !== expected ||
        required.some((r) => !cols.includes(r))
      ) {
        errors.push({
          table: "nodes",
          line: nodeRows[0].line,
          column: "Cabeçalho",
          value: nodeRows[0].raw,
          reason: spatial
            ? "Cabeçalho incompatível com projeto espacial XYZ (esperado: ID, Nome, X, Y, Z)."
            : "Cabeçalho incompatível com projeto plano XZ (esperado: ID, Nome, X, Z).",
        });
      } else {
        nodeColumns = cols;
      }
    }
  }

  const seenNodeIds = new Set<string>();
  const validBatchNodes = new Map<
    string,
    { id: string; name: string; x: number; y: number; z: number }
  >();
  const nodeActions: TabularNodeAction[] = [];

  for (let i = nodeStartIndex; i < nodeRows.length; i++) {
    const row = nodeRows[i];
    const expectedCols = nodeColumns.length;
    if (row.cells.length !== expectedCols) {
      errors.push({
        table: "nodes",
        line: row.line,
        column: "Linha",
        value: row.raw,
        reason: `Esperadas ${expectedCols} colunas separadas por Tab; encontradas ${row.cells.length}.`,
      });
      continue;
    }

    const byCol = new Map<string, string>();
    nodeColumns.forEach((col, idx) => byCol.set(col, row.cells[idx] ?? ""));

    const rawId = byCol.get("id") ?? "";
    const rawName = byCol.get("name") ?? "";
    const idValue = rawId.trim();
    const nameValue = rawName.trim();

    let rowValid = true;
    const idError = validateId(rawId);
    if (idError) {
      errors.push({
        table: "nodes",
        line: row.line,
        column: "ID",
        value: rawId,
        reason: idError,
      });
      rowValid = false;
    } else if (seenNodeIds.has(idValue)) {
      errors.push({
        table: "nodes",
        line: row.line,
        column: "ID",
        value: rawId,
        reason: `ID de nó duplicado no lote: ${idValue}.`,
      });
      rowValid = false;
    }
    if (idValue) seenNodeIds.add(idValue);

    const nameError = validateName(rawName);
    if (nameError) {
      errors.push({
        table: "nodes",
        line: row.line,
        column: "Nome",
        value: rawName,
        reason: nameError,
      });
      rowValid = false;
    }

    const coordValues: Record<"x" | "y" | "z", number> = { x: 0, y: 0, z: 0 };
    const coordCols: ("x" | "y" | "z")[] = spatial
      ? ["x", "y", "z"]
      : ["x", "z"];
    for (const axis of coordCols) {
      const rawCoord = byCol.get(axis) ?? "";
      const parsed = parseUnitInput(
        rawCoord.replace(/−/g, "-"),
        "length",
        units,
        existingNodes.get(idValue)?.[axis],
      );
      if (parsed === null) {
        errors.push({
          table: "nodes",
          line: row.line,
          column: `${axis.toUpperCase()} (${unit})`,
          value: rawCoord,
          reason: "Informe um valor numérico finito.",
        });
        rowValid = false;
      } else {
        coordValues[axis] = parsed;
      }
    }

    if (rowValid) {
      validBatchNodes.set(idValue, {
        id: idValue,
        name: nameValue,
        ...coordValues,
      });
      const existing = existingNodes.get(idValue);
      const unchanged =
        existing !== undefined &&
        existing.name === nameValue &&
        existing.x === coordValues.x &&
        existing.y === coordValues.y &&
        existing.z === coordValues.z;
      nodeActions.push({
        action: existing ? (unchanged ? "unchanged" : "update") : "create",
        id: idValue,
        name: nameValue,
        ...coordValues,
      });
    }
  }

  // Build effective node map (existing nodes updated with valid batch nodes)
  const resolvedNodes = new Map<
    string,
    { id: string; name: string; x: number; y: number; z: number }
  >(
    project.nodes.map((n) => [
      n.id,
      { id: n.id, name: n.name, x: n.x, y: n.y, z: n.z },
    ]),
  );
  for (const [id, node] of validBatchNodes) {
    resolvedNodes.set(id, node);
  }

  if (resolvedNodes.size > 1000) {
    errors.push({
      table: "nodes",
      line: 1,
      column: "Lote",
      value: String(resolvedNodes.size),
      reason: `O total de nós (${resolvedNodes.size}) excede o limite de 1.000 nós do projeto.`,
    });
  }

  // 2. Parse members TSV
  const memberRows = splitTsvRows(membersTsv);
  let memberColumns: ("id" | "name" | "start" | "end" | "section")[] = [
    "id",
    "name",
    "start",
    "end",
    "section",
  ];
  let memberStartIndex = 0;

  if (memberRows.length > 0) {
    const mapped = memberRows[0].cells.map(
      (cell) => MEMBER_HEADER_ALIASES[normalizeHeaderToken(cell)] ?? null,
    );
    const hasHeaderTokens =
      mapped.every((col) => col !== null) &&
      mapped.includes("id") &&
      mapped.includes("start") &&
      mapped.includes("end");
    if (hasHeaderTokens) {
      memberStartIndex = 1;
      const cols = mapped as ("id" | "name" | "start" | "end" | "section")[];
      const required: ("id" | "name" | "start" | "end" | "section")[] = [
        "id",
        "name",
        "start",
        "end",
        "section",
      ];
      if (
        cols.length !== 5 ||
        new Set(cols).size !== 5 ||
        required.some((r) => !cols.includes(r))
      ) {
        errors.push({
          table: "members",
          line: memberRows[0].line,
          column: "Cabeçalho",
          value: memberRows[0].raw,
          reason:
            "Cabeçalho de barras inválido (esperado: ID, Nome, ID inicial, ID final, Seção).",
        });
      } else {
        memberColumns = cols;
      }
    }
  }

  const seenMemberIds = new Set<string>();
  const memberLines = new Map<string, number>();
  const finalMembers = new Map<
    string,
    { id: string; start: string; end: string }
  >(existingMembers);
  const memberActions: TabularMemberAction[] = [];

  for (let i = memberStartIndex; i < memberRows.length; i++) {
    const row = memberRows[i];
    if (row.cells.length !== 5) {
      errors.push({
        table: "members",
        line: row.line,
        column: "Linha",
        value: row.raw,
        reason: `Esperadas 5 colunas separadas por Tab; encontradas ${row.cells.length}.`,
      });
      continue;
    }

    const byCol = new Map<string, string>();
    memberColumns.forEach((col, idx) => byCol.set(col, row.cells[idx] ?? ""));

    const rawId = byCol.get("id") ?? "";
    const rawName = byCol.get("name") ?? "";
    const rawStart = byCol.get("start") ?? "";
    const rawEnd = byCol.get("end") ?? "";
    const rawSection = byCol.get("section") ?? "";

    const idValue = rawId.trim();
    const nameValue = rawName.trim();
    const startValue = rawStart.trim();
    const endValue = rawEnd.trim();

    let rowValid = true;
    const idError = validateId(rawId);
    if (idError) {
      errors.push({
        table: "members",
        line: row.line,
        column: "ID",
        value: rawId,
        reason: idError,
      });
      rowValid = false;
    } else if (seenMemberIds.has(idValue)) {
      errors.push({
        table: "members",
        line: row.line,
        column: "ID",
        value: rawId,
        reason: `ID de barra duplicado no lote: ${idValue}.`,
      });
      rowValid = false;
    }
    if (idValue) seenMemberIds.add(idValue);

    const nameError = validateName(rawName);
    if (nameError) {
      errors.push({
        table: "members",
        line: row.line,
        column: "Nome",
        value: rawName,
        reason: nameError,
      });
      rowValid = false;
    }

    const startNode = resolvedNodes.get(startValue);
    if (!startNode) {
      errors.push({
        table: "members",
        line: row.line,
        column: "ID inicial",
        value: rawStart,
        reason: `Nó inicial "${startValue || "(vazio)"}" inexistente no projeto ou no lote.`,
      });
      rowValid = false;
    }

    const endNode = resolvedNodes.get(endValue);
    if (!endNode) {
      errors.push({
        table: "members",
        line: row.line,
        column: "ID final",
        value: rawEnd,
        reason: `Nó final "${endValue || "(vazio)"}" inexistente no projeto ou no lote.`,
      });
      rowValid = false;
    }

    if (startNode && endNode) {
      const lengthError = memberLengthError(
        { id: idValue, name: nameValue },
        startNode,
        endNode,
      );
      if (startNode.id === endNode.id) {
        errors.push({
          table: "members",
          line: row.line,
          column: "ID final",
          value: rawEnd,
          reason: "Os nós inicial e final devem ser diferentes.",
        });
        rowValid = false;
      } else if (lengthError) {
        errors.push({
          table: "members",
          line: row.line,
          column: "ID final",
          value: rawEnd,
          reason: lengthError,
        });
        rowValid = false;
      }
    }

    const section = resolveSection(rawSection);
    if (!section) {
      errors.push({
        table: "members",
        line: row.line,
        column: "Seção",
        value: rawSection,
        reason: `Seção "${rawSection.trim() || "(vazio)"}" inexistente no projeto.`,
      });
      rowValid = false;
    }

    if (rowValid && startNode && endNode && section) {
      memberLines.set(idValue, row.line);
      finalMembers.set(idValue, {
        id: idValue,
        start: startNode.id,
        end: endNode.id,
      });
      const existing = existingMembers.get(idValue);
      const unchanged =
        existing !== undefined &&
        existing.name === nameValue &&
        existing.start === startNode.id &&
        existing.end === endNode.id &&
        existing.sectionId === section.id;
      memberActions.push({
        action: existing ? (unchanged ? "unchanged" : "update") : "create",
        id: idValue,
        name: nameValue,
        start: startNode.id,
        end: endNode.id,
        sectionId: section.id,
        sectionName: section.name,
        length: distance(startNode, endNode),
      });
    }
  }

  // Avalie a configuração final: a ordem da planilha não define a conectividade.
  const pairKey = (start: string, end: string) => [start, end].sort().join("|");
  const countsByPair = new Map<string, number>();
  for (const member of finalMembers.values()) {
    const key = pairKey(member.start, member.end);
    countsByPair.set(key, (countsByPair.get(key) ?? 0) + 1);
  }
  for (const member of memberActions) {
    const key = pairKey(member.start, member.end);
    const original = existingMembers.get(member.id);
    if (
      countsByPair.get(key)! > 1 &&
      (!original || pairKey(original.start, original.end) !== key)
    ) {
      errors.push({
        table: "members",
        line: memberLines.get(member.id)!,
        column: "ID final",
        value: member.end,
        reason: `Já existe uma barra ligando ${member.start} a ${member.end}.`,
      });
    }
  }
  // Mover um nó também altera as barras incidentes que não aparecem no TSV.
  for (const member of project.members) {
    if (memberLines.has(member.id)) continue;
    const nodeId = [member.start, member.end].find((id) =>
      validBatchNodes.has(id),
    );
    if (!nodeId) continue;
    const lengthError = memberLengthError(
      member,
      resolvedNodes.get(member.start)!,
      resolvedNodes.get(member.end)!,
    );
    if (lengthError) {
      const row = nodeRows.find(
        (row) => row.cells[nodeColumns.indexOf("id")]?.trim() === nodeId,
      )!;
      errors.push({
        table: "nodes",
        line: row.line,
        column: "Coordenadas",
        value: nodeId,
        reason: lengthError,
      });
    }
  }
  if (finalMembers.size > 1000) {
    errors.push({
      table: "members",
      line: 1,
      column: "Lote",
      value: String(finalMembers.size),
      reason: `O total de barras (${finalMembers.size}) excede o limite de 1.000 barras do projeto.`,
    });
  }

  if (errors.length > 0) {
    return { ok: false, errors };
  }

  const counts = {
    nodesCreated: nodeActions.filter((n) => n.action === "create").length,
    nodesUpdated: nodeActions.filter((n) => n.action === "update").length,
    nodesUnchanged: nodeActions.filter((n) => n.action === "unchanged").length,
    membersCreated: memberActions.filter((m) => m.action === "create").length,
    membersUpdated: memberActions.filter((m) => m.action === "update").length,
    membersUnchanged: memberActions.filter((m) => m.action === "unchanged")
      .length,
  };
  const hasChanges =
    counts.nodesCreated +
      counts.nodesUpdated +
      counts.membersCreated +
      counts.membersUpdated >
    0;

  const plan = {
    unit,
    nodes: nodeActions,
    members: memberActions,
    counts,
    hasChanges,
  };
  if (
    hasChanges &&
    (project.meshConnections.length || project.members.some((m) => m.offsets))
  ) {
    const candidate = structuredClone(project);
    applyTabularImport(candidate, plan);
    try {
      connectionStations(candidate);
      const nodes = new Map(candidate.nodes.map((n) => [n.id, n]));
      for (const m of candidate.members) {
        const problem = offsetError(
          m,
          nodes.get(m.start)!,
          nodes.get(m.end)!,
          candidate.mode,
        );
        if (problem) throw new Error(problem);
      }
    } catch (error) {
      return {
        ok: false,
        errors: [
          {
            table: nodesTsv.trim() ? "nodes" : "members",
            line: 1,
            column: "Lote",
            value: "Geometria das barras e conexões da malha",
            reason: (error as Error).message,
          },
        ],
      };
    }
  }
  return { ok: true, plan };
}

export function applyTabularImport(
  project: Project,
  plan: TabularImportPlan,
): void {
  const nodeMap = new Map(project.nodes.map((n) => [n.id, n]));
  for (const item of plan.nodes) {
    if (item.action === "unchanged") continue;
    const existing = nodeMap.get(item.id);
    if (existing) {
      existing.name = item.name;
      existing.x = item.x;
      existing.y = item.y;
      existing.z = item.z;
    } else {
      const created = {
        id: item.id,
        name: item.name,
        x: item.x,
        y: item.y,
        z: item.z,
        restraints: free(),
      };
      project.nodes.push(created);
      nodeMap.set(created.id, created);
    }
  }

  const memberMap = new Map(project.members.map((m) => [m.id, m]));
  for (const item of plan.members) {
    if (item.action === "unchanged") continue;
    const existing = memberMap.get(item.id);
    if (existing) {
      if (
        existing.offsets &&
        existing.start === item.end &&
        existing.end === item.start
      )
        reverseMember(project, existing.id);
      existing.name = item.name;
      existing.start = item.start;
      existing.end = item.end;
      existing.sectionId = item.sectionId;
    } else {
      const created = {
        id: item.id,
        name: item.name,
        start: item.start,
        end: item.end,
        sectionId: item.sectionId,
        roll: 0,
      };
      project.members.push(created);
      memberMap.set(created.id, created);
    }
  }
}