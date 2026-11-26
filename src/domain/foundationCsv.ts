import { origin } from "./geometry";
import { foundationModes, type Foundation } from "./foundation";
import { supportDofs } from "./supports";

function records(text: string, separator: string) {
  const rows: string[][] = [];
  let row: string[] = [],
    value = "",
    quoted = false,
    closed = false;
  function endField() {
    row.push(value.trim());
    value = "";
    closed = false;
  }
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (quoted) {
      if (ch !== '"') value += ch;
      else if (text[i + 1] === '"') {
        value += '"';
        i++;
      } else {
        quoted = false;
        closed = true;
      }
    } else if (ch === separator) endField();
    else if (ch === "\n" || ch === "\r") {
      if (ch === "\r" && text[i + 1] === "\n") i++;
      endField();
      if (row.some(Boolean)) rows.push(row);
      row = [];
    } else if (ch === '"' && !value.trim() && !closed) {
      value = "";
      quoted = true;
    } else {
      if (ch === '"' || (closed && ch.trim()))
        throw new Error("Aspas inválidas no CSV.");
      value += ch;
    }
  }
  if (quoted) throw new Error("Campo entre aspas incompleto no CSV.");
  endField();
  if (row.some(Boolean)) rows.push(row);
  return rows;
}

function axisIndex(label: string, force: boolean) {
  const parts = /^([^\s(]+)\s*\(([^)]+)\)$/i.exec(label);
  const name = parts?.[1].toLowerCase().replace(/^(theta_?|θ_?)/, "r");
  const index = (
    force
      ? ["fx", "fy", "fz", "mx", "my", "mz"]
      : ([...supportDofs] as string[])
  ).indexOf(name ?? "");
  const unit = parts?.[2].trim().replace(/[·⋅*]/g, ".");
  const expected = force
    ? index < 3
      ? "kN"
      : "kN.m"
    : index < 3
      ? "m"
      : "rad";
  if (index < 0 || unit !== expected)
    throw new Error(`Grau de liberdade ou unidade incompatível: ${label}.`);
  return index;
}

export function parseFoundationCsv(
  source: string,
  fileName: string,
): Foundation {
  if (source.length > 256 * 1024)
    throw new Error("O CSV de matriz excede 256 KiB.");
  const text = source.replace(/^\uFEFF/, "").trim();
  const separator = /^"?Molas?Struct"?[ ]*([;,\t])/i.exec(text)?.[1];
  if (!separator) throw new Error("Cabeçalho de matriz do MolaStruct ausente.");
  const [sourceRow, header, ...rest] = records(text, separator);
  if (
    sourceRow.length !== 3 ||
    !sourceRow[1] ||
    sourceRow[1].length > 255 ||
    sourceRow[2] !== "kN;m;rad"
  )
    throw new Error(
      "Informe uma matriz do MolaStruct com unidades kN, m e rad.",
    );
  if (
    !header ||
    header.length !== 7 ||
    header[0].toUpperCase() !== "GDL" ||
    rest.length < 6
  )
    throw new Error(
      "Matriz incompleta. São necessárias seis linhas e seis colunas de rigidez.",
    );
  const columns = header.slice(1).map((label) => axisIndex(label, false));
  if (new Set(columns).size !== 6)
    throw new Error("Grau de liberdade repetido nas colunas.");
  const matrix: number[][] = Array.from({ length: 6 }, () => []);
  for (const [label, ...entries] of rest.slice(0, 6)) {
    const i = axisIndex(label, true);
    if (matrix[i].length || entries.length !== 6)
      throw new Error(`Linha de matriz duplicada ou incompleta: ${label}.`);
    entries.forEach((entry, j) => {
      if (!/^[+-]?(?:\d+(?:[.,]\d*)?|[.,]\d+)(?:[eE][+-]?\d+)?$/.test(entry))
        throw new Error(`Coeficiente inválido em ${label} × ${header[j + 1]}.`);
      // kN/m, kN/rad, kN·m/m and kN·m/rad all gain the same 1000
      // because both conjugate displacements are already in metres/radians.
      const value = Number(entry.replace(",", ".")) * 1000;
      if (!Number.isFinite(value))
        throw new Error(`Coeficiente fora de escala em ${label}.`);
      matrix[i][columns[j]] = value;
    });
  }
  const metadata = rest.slice(6);
  if (
    metadata.length > 512 ||
    metadata.some(
      (row) =>
        row.length < 2 ||
        row.length > 12 ||
        row.some((v) => v.length > 8192) ||
        /^[fm][xyz]\s*\(/i.test(row[0]),
    )
  )
    throw new Error("Linhas extras de matriz ou metadados inválidos no CSV.");
  const declarations = metadata.filter(
    ([label]) => label.toLowerCase() === "gdl livres",
  );
  if (declarations.length !== 1 || declarations[0].length !== 2)
    throw new Error("Declaração de GDL livres ausente ou repetida.");
  const declared = declarations[0][1];
  const freeDofs = /^nenhum$/i.test(declared)
    ? []
    : declared
        .split(/\s*,\s*/)
        .map((label) => supportDofs[axisIndex(label, false)]);
  const foundation: Foundation = {
    name: sourceRow[1],
    fileName,
    matrix,
    freeDofs,
    metadata,
    offset: { ...origin },
    reference: "node",
  };
  foundationModes(foundation);
  return foundation;
}
