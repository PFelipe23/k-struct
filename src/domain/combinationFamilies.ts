import type { AnalysisCase, Project, ResultCombination } from "./model";

export type FamilyProfile = NonNullable<Project["combinationProfile"]>;
export type Family = FamilyProfile["families"][number];
type Action = FamilyProfile["actions"][number];
type Generation = NonNullable<ResultCombination["generation"]>;
type Formula = Generation["suggested"];
export type FamilyModel = Pick<
  Project,
  "analysisCases" | "loadPatterns" | "resultCombinations"
>;
export type FamilyRow = {
  generation: Generation;
  previous?: ResultCombination;
  include: boolean;
  name: string;
  factors: Record<string, string>;
};

export const parseCoefficient = (value: string) =>
  value.trim() ? Number(value.replace(",", ".")) : NaN;

export function userFamily(id: string, kind: Family["kind"]): Family {
  return {
    id,
    kind,
    name: kind,
    enabled: true,
    source: "Definidos pelo usuário",
    permanent: 1,
    leading: 1,
    accompanying: 1,
  };
}

export function generationKey(
  g: Pick<Generation, "familyId" | "leadingId" | "alternatives">,
) {
  return JSON.stringify([g.familyId, g.leadingId, [...g.alternatives].sort()]);
}

export function formulaFields(f: Formula) {
  return {
    name: f.name,
    factors: Object.fromEntries(
      f.factors.map((t) => [t.caseId, String(t.factor)]),
    ),
  };
}

export function rowFormula(row: FamilyRow): Formula {
  return {
    name: row.name.trim(),
    factors: Object.entries(row.factors)
      .map(([caseId, value]) => ({ caseId, factor: parseCoefficient(value) }))
      .filter((t) => t.factor !== 0),
  };
}

function signature(terms: [string, number][]) {
  return JSON.stringify(
    terms
      .filter(([, v]) => v !== 0)
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)),
  );
}
export function sameFormula(a: Formula, b: Formula) {
  const key = (f: Formula) =>
    signature(f.factors.map((t) => [t.caseId, t.factor]));
  return a.name === b.name && key(a) === key(b);
}
const groupKey = (action: Action) =>
  action.group.trim().toLocaleLowerCase("pt-BR");

function profileError(profile: FamilyProfile, cases: AnalysisCase[]) {
  if (!profile.actions.length)
    return "Selecione ao menos uma ação permanente ou variável.";
  const caseIds = new Set(cases.map((c) => c.id));
  if (profile.actions.some((a) => !caseIds.has(a.caseId)))
    return "Há um caso inexistente entre as ações escolhidas.";
  if (
    new Set(profile.actions.map((a) => a.caseId)).size !==
    profile.actions.length
  )
    return "Classifique cada caso uma única vez.";
  if (!profile.families.some((f) => f.enabled))
    return "Selecione pelo menos uma família.";
  if (
    new Set(profile.families.map((f) => f.id)).size !== profile.families.length
  )
    return "Há famílias repetidas.";
  for (const f of profile.families) {
    if (!f.name.trim() || !f.source.trim())
      return "Informe o nome e a origem dos coeficientes de cada família.";
    if (![f.permanent, f.leading, f.accompanying].every(Number.isFinite))
      return `${f.name}: informe três coeficientes finitos.`;
  }
}

export function proposeFamilies(
  model: FamilyModel,
  profile: FamilyProfile,
): FamilyRow[] {
  const error = profileError(profile, model.analysisCases);
  if (error) throw new Error(error);
  const actions = new Map(profile.actions.map((a) => [a.caseId, a]));
  const ordered = model.analysisCases.flatMap((c) =>
    actions.has(c.id) ? [actions.get(c.id)!] : [],
  );
  const groups = new Map<string, Action[]>();
  for (const a of ordered) {
    const group = groupKey(a);
    if (group) {
      const list = groups.get(group) ?? [];
      list.push(a);
      groups.set(group, list);
    }
  }
  const choices = [...groups.values()].filter((list) => list.length > 1);
  const byId = new Map(model.analysisCases.map((c) => [c.id, c.name]));
  const existing = new Map(
    model.resultCombinations.flatMap((c) =>
      c.generation ? [[generationKey(c.generation), c] as const] : [],
    ),
  );
  const rows: FamilyRow[] = [];
  const families = profile.families.filter((f) => f.enabled);
  // Bound the Cartesian product before constructing or rendering it.
  const maxPreviewRows = 500;
  if (
    choices.reduce((n, list) => n * list.length, families.length) >
    maxPreviewRows
  )
    throw new Error(
      "A prévia excede 500 alternativas. Reduza os grupos ou as famílias selecionadas.",
    );
  function generate(index: number, selected: Action[]) {
    if (index < choices.length) {
      for (const a of choices[index]) generate(index + 1, [...selected, a]);
      return;
    }
    const chosen = new Set(selected.map((a) => a.caseId));
    const active = ordered.filter(
      (a) => (groups.get(groupKey(a))?.length ?? 0) < 2 || chosen.has(a.caseId),
    );
    const variables = active.filter((a) => a.role === "variable");
    for (const f of families)
      for (const lead of variables.length ? variables : [null]) {
        if (rows.length === maxPreviewRows)
          throw new Error(
            "A prévia excede 500 alternativas. Reduza os grupos ou as famílias selecionadas.",
          );
        const alternatives = selected
          .filter((a) => a !== lead)
          .map((a) => a.caseId)
          .sort();
        const labels = [
          lead ? byId.get(lead.caseId) : "permanentes",
          ...alternatives.map((id) => byId.get(id)),
        ];
        const suggested: Formula = {
          name: `${f.name.trim()} · ${labels.join(" / ")}`.slice(0, 120),
          factors: active
            .map((a) => ({
              caseId: a.caseId,
              factor:
                a.role === "permanent"
                  ? f.permanent
                  : a === lead
                    ? f.leading
                    : f.accompanying,
            }))
            .filter((t) => t.factor !== 0),
        };
        const generation = {
          familyId: f.id,
          kind: f.kind,
          leadingId: lead?.caseId ?? null,
          alternatives,
          source: f.source.trim(),
          suggested,
        };
        const previous = existing.get(generationKey(generation));
        const edited =
          previous?.generation &&
          !sameFormula(previous, previous.generation.suggested);
        rows.push({
          generation,
          previous,
          include: true,
          ...formulaFields(edited ? previous! : suggested),
        });
      }
  }
  generate(0, []);
  return rows;
}

function inspectFormula(
  formula: Formula,
  cases: Map<string, AnalysisCase>,
  patterns: Map<string, string>,
  actions?: Map<string, Action>,
) {
  const errors: string[] = [];
  const owners = new Map<string, string>(),
    activeGroups = new Map<string, string>(),
    totals = new Map<string, number>();
  if (!formula.name.trim() || formula.name.length > 120)
    errors.push("Informe um nome de até 120 caracteres.");
  if (!formula.factors.some((t) => Number.isFinite(t.factor) && t.factor !== 0))
    errors.push("A expressão precisa de uma parcela diferente de zero.");
  for (const { caseId, factor } of formula.factors) {
    if (factor === 0) continue;
    const c = cases.get(caseId);
    if (!c) {
      errors.push(`Caso inexistente: ${caseId}.`);
      continue;
    }
    if (!Number.isFinite(factor)) {
      errors.push(`${c.name}: fator inválido.`);
      continue;
    }
    const action = actions?.get(caseId),
      group = action && groupKey(action);
    if (group) {
      if (activeGroups.has(group))
        errors.push(
          `${activeGroups.get(group)} e ${c.name} são mutuamente exclusivos (${action!.group}).`,
        );
      activeGroups.set(group, c.name);
    }
    const effective = new Map<string, number>();
    for (const t of c.factors) {
      if (!patterns.has(t.patternId))
        errors.push(`${c.name}: padrão inexistente ${t.patternId}.`);
      effective.set(t.patternId, (effective.get(t.patternId) ?? 0) + t.factor);
    }
    if (![...effective.values()].some((v) => v !== 0))
      errors.push(
        `${c.name}: nenhum padrão com fator efetivo diferente de zero.`,
      );
    for (const [id, v] of effective) {
      if (v === 0) continue;
      if (!Number.isFinite(v * factor)) {
        errors.push(`${c.name}: ponderação não finita.`);
        continue;
      }
      const other = owners.get(id);
      if (actions && other && other !== c.id)
        errors.push(
          `Padrão ${patterns.get(id) ?? id} ponderado em dois casos: ${cases.get(other)!.name} e ${c.name}.`,
        );
      owners.set(id, c.id);
      const total = (totals.get(id) ?? 0) + v * factor;
      if (!Number.isFinite(total))
        errors.push(`${c.name}: soma dos fatores fora do intervalo numérico.`);
      totals.set(id, total);
    }
  }
  return {
    errors,
    signature: signature(
      [...totals].map(([id, value]) => [id, Number(value.toPrecision(15))]),
    ),
  };
}

export function reviewFamilies(
  model: FamilyModel,
  profile: FamilyProfile,
  rows: FamilyRow[],
) {
  const cases = new Map(model.analysisCases.map((c) => [c.id, c]));
  const patterns = new Map(model.loadPatterns.map((p) => [p.id, p.name]));
  const actions = new Map(profile.actions.map((a) => [a.caseId, a]));
  const replacing = new Set(
    rows.filter((r) => r.include && r.previous).map((r) => r.previous!.id),
  );
  const retained = model.resultCombinations.filter((c) => !replacing.has(c.id));
  const known = new Map<string, string>();
  for (const c of retained) {
    const v = inspectFormula(c, cases, patterns);
    if (!v.errors.length) known.set(v.signature, c.name);
  }
  const checks = rows.map((row) => {
    const formula = rowFormula(row);
    if (!row.include)
      return {
        formula,
        errors: [] as string[],
        status: row.previous ? "Manter existente" : "Dispensar",
      };
    const checked = inspectFormula(formula, cases, patterns, actions);
    if (!checked.errors.length) {
      if (known.has(checked.signature))
        checked.errors.push(
          `Expressão idêntica à combinação ${known.get(checked.signature)}.`,
        );
      else known.set(checked.signature, formula.name);
    }
    const previous = row.previous;
    const status = !previous
      ? "Criar"
      : !sameFormula(previous, formula)
        ? "Atualizar"
        : !sameFormula(formula, row.generation.suggested)
          ? "Preservar edição"
          : previous.generation?.source !== row.generation.source
            ? "Atualizar origem"
            : "Manter";
    return { formula, errors: checked.errors, status };
  });
  const total = retained.length + rows.filter((r) => r.include).length;
  const error =
    total > 100
      ? `A confirmação resultaria em ${total} combinações. O projeto comporta até 100.`
      : undefined;
  const displayed = new Set(rows.map((r) => r.previous?.id));
  const outside = model.resultCombinations.filter(
    (c) => c.generation && !displayed.has(c.id),
  );
  const retainedWarnings = retained
    .filter((c) => c.generation)
    .flatMap((c) =>
      inspectFormula(c, cases, patterns, actions).errors.map(
        (problem) => `${c.name}: ${problem}`,
      ),
    );
  return { checks, error, outside, retainedWarnings };
}

export function acceptFamilies(
  model: FamilyModel,
  profile: FamilyProfile,
  rows: FamilyRow[],
  newId: () => string,
) {
  const { checks, error } = reviewFamilies(model, profile, rows);
  const problem =
    profileError(profile, model.analysisCases) ??
    error ??
    checks.flatMap((c) => c.errors)[0];
  if (problem) throw new Error(problem);
  const accepted = new Map<string, ResultCombination>();
  for (const [i, row] of rows.entries())
    if (row.include) {
      const id = row.previous?.id ?? newId();
      accepted.set(id, {
        id,
        type: "linear",
        ...checks[i].formula,
        generation: row.generation,
      });
    }
  const combinations = model.resultCombinations.map((c) => {
    const next = accepted.get(c.id) ?? c;
    accepted.delete(c.id);
    return next;
  });
  return combinations.concat([...accepted.values()]);
}
