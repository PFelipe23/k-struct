import { useEffect, useRef, useState } from "react";
import { uid, type ResultCombination } from "../domain/model";
import {
  acceptFamilies,
  formulaFields,
  generationKey,
  parseCoefficient,
  proposeFamilies,
  reviewFamilies,
  sameFormula,
  userFamily,
  type Family,
  type FamilyModel,
  type FamilyProfile,
  type FamilyRow,
} from "../domain/combinationFamilies";

type Coefficient = "permanent" | "leading" | "accompanying";
type FamilyDraft = Omit<Family, Coefficient> & Record<Coefficient, string>;
const coefficientLabels: Record<Coefficient, string> = {
  permanent: "Permanente",
  leading: "Principal",
  accompanying: "Acompanhante",
};
const toDraft = (f: Family): FamilyDraft => ({
  ...f,
  permanent: String(f.permanent),
  leading: String(f.leading),
  accompanying: String(f.accompanying),
});
const toFamily = (f: FamilyDraft): Family => ({
  ...f,
  name: f.name.trim(),
  source: f.source.trim(),
  permanent: parseCoefficient(f.permanent),
  leading: parseCoefficient(f.leading),
  accompanying: parseCoefficient(f.accompanying),
});
function expression(terms: { name: string; factor: number }[]) {
  const active = terms.filter((t) => t.factor !== 0);
  return (
    active
      .map(({ name, factor }, i) => {
        const sign = factor < 0 ? "−" : i > 0 ? "+" : "";
        const value = Number.isFinite(factor)
          ? String(Math.abs(factor)).replace(".", ",")
          : "?";
        return `${sign} ${value} × ${name}`.trim();
      })
      .join(" ") || "0"
  );
}

export default function CombinationFamilyEditor({
  model,
  initialProfile,
  onCancel,
  onAccept,
}: {
  model: FamilyModel;
  initialProfile?: FamilyProfile;
  onCancel: () => void;
  onAccept: (
    profile: FamilyProfile,
    combinations: ResultCombination[],
    firstId?: string,
  ) => void;
}) {
  const [actions, setActions] = useState<FamilyProfile["actions"]>(
    initialProfile?.actions ?? [],
  );
  const [families, setFamilies] = useState<FamilyDraft[]>(() =>
    (
      initialProfile?.families ?? [
        userFamily("ELU", "ELU"),
        { ...userFamily("ELS", "ELS"), enabled: false },
      ]
    ).map(toDraft),
  );
  const [preview, setPreview] = useState<{
    profile: FamilyProfile;
    rows: FamilyRow[];
  } | null>(null);
  const [reviewing, setReviewing] = useState(false);
  const heading = useRef<HTMLHeadingElement>(null);
  useEffect(() => {
    heading.current?.focus({ preventScroll: true });
    heading.current?.closest("dialog")?.scrollTo(0, 0);
  }, [reviewing]);
  const [editingKey, setEditingKey] = useState<string | null>(null);
  const [error, setError] = useState("");
  const caseNames = new Map(model.analysisCases.map((c) => [c.id, c.name]));
  const patterns = new Map(model.loadPatterns.map((p) => [p.id, p.name]));
  const caseExpression = (f: ResultCombination["factors"]) =>
    expression(
      f.map((t) => ({
        name: caseNames.get(t.caseId) ?? t.caseId,
        factor: t.factor,
      })),
    );
  const updateFamily = (id: string, patch: Partial<FamilyDraft>) =>
    setFamilies((all) =>
      all.map((f) => (f.id === id ? { ...f, ...patch } : f)),
    );
  function generate() {
    const profile = {
      actions: actions.map((a) => ({ ...a, group: a.group.trim() })),
      families: families.map(toFamily),
    };
    try {
      if (
        !preview ||
        JSON.stringify(profile) !== JSON.stringify(preview.profile)
      )
        setPreview({ profile, rows: proposeFamilies(model, profile) });
      setReviewing(true);
      setError("");
    } catch (e) {
      setError((e as Error).message);
    }
  }
  function updateRow(index: number, patch: Partial<FamilyRow>) {
    setPreview(
      (current) =>
        current && {
          ...current,
          rows: current.rows.map((r, i) =>
            i === index ? { ...r, ...patch } : r,
          ),
        },
    );
  }
  if (reviewing && preview) {
    const { rows, profile } = preview;
    const {
      checks,
      error: limit,
      outside,
      retainedWarnings,
    } = reviewFamilies(model, profile, rows);
    const blocked = Boolean(limit) || checks.some((c) => c.errors.length > 0);
    return (
      <div className="family-editor">
        <h3 ref={heading} tabIndex={-1}>
          Prévia das combinações
        </h3>
        <p>
          Confira os fatores efetivos por caso. Desmarcar uma linha mantém a
          combinação existente. As alterações entram no projeto ao aplicar as
          definições.
        </p>
        {rows.map((row, i) => {
          const { generation: g, previous } = row,
            check = checks[i];
          const key = generationKey(g);
          const before = previous?.generation;
          const protectedEdit =
            previous && before && !sameFormula(previous, before.suggested);
          const selectedCases =
            editingKey === key &&
            model.analysisCases.filter(
              (c) =>
                row.factors[c.id] !== undefined ||
                profile.actions.some((a) => a.caseId === c.id),
            );
          return (
            <section
              key={key}
              className="family-proposal"
              aria-label={`Prévia ${g.suggested.name}`}
            >
              <div className="family-row-title">
                <label>
                  <input
                    type="checkbox"
                    checked={row.include}
                    onChange={(e) =>
                      updateRow(i, { include: e.target.checked })
                    }
                  />{" "}
                  {g.suggested.name}
                </label>
                <b>{check.status}</b>
              </div>
              <div className="family-expression">
                {check.formula.name} = {caseExpression(check.formula.factors)}
              </div>
              <p>
                {g.leadingId
                  ? `Principal proposta: ${caseNames.get(g.leadingId)}. `
                  : "Somente ações permanentes. "}
                {g.kind} · Origem da proposta: {g.source}.{" "}
                {!sameFormula(
                  { ...check.formula, name: g.suggested.name },
                  g.suggested,
                ) && "Fatores editados pelo usuário."}
              </p>
              {protectedEdit && (
                <p>
                  A combinação existente foi editada. Proposta recalculada:{" "}
                  {g.suggested.name} = {caseExpression(g.suggested.factors)}.
                </p>
              )}
              {check.errors.map((message, j) => (
                <p role="alert" className="launch-error" key={j}>
                  {message}
                </p>
              ))}
              <button
                type="button"
                aria-expanded={editingKey === key}
                onClick={() => setEditingKey(editingKey === key ? null : key)}
              >
                Editar linha
              </button>
              {selectedCases && (
                <div className="family-edit-line">
                  <label>
                    Nome da linha
                    <input
                      value={row.name}
                      maxLength={120}
                      onChange={(e) => updateRow(i, { name: e.target.value })}
                    />
                  </label>
                  <div className="family-terms">
                    {selectedCases.map((c) => (
                      <label key={c.id}>
                        {c.name}
                        <input
                          aria-label={`Fator de ${c.name}`}
                          inputMode="decimal"
                          value={row.factors[c.id] ?? "0"}
                          onChange={(e) =>
                            updateRow(i, {
                              factors: {
                                ...row.factors,
                                [c.id]: e.target.value,
                              },
                            })
                          }
                        />
                      </label>
                    ))}
                  </div>
                  <button
                    type="button"
                    onClick={() => updateRow(i, formulaFields(g.suggested))}
                  >
                    Usar proposta recalculada
                  </button>
                </div>
              )}
            </section>
          );
        })}
        {outside.length > 0 && (
          <p>
            Geradas anteriormente e mantidas fora desta prévia:{" "}
            {outside.map((c) => c.name).join(", ")}.
          </p>
        )}
        {retainedWarnings.map((warning, i) => (
          <p key={i}>Combinação anterior mantida. {warning}</p>
        ))}
        {limit && (
          <p role="alert" className="launch-error">
            {limit}
          </p>
        )}
        {error && (
          <p role="alert" className="launch-error">
            {error}
          </p>
        )}
        <div className="modal-actions">
          <button
            type="button"
            onClick={() => {
              setReviewing(false);
              setError("");
            }}
          >
            Voltar aos critérios
          </button>
          <button type="button" onClick={onCancel}>
            Cancelar geração
          </button>
          <button
            type="button"
            disabled={blocked}
            onClick={() => {
              try {
                const result = acceptFamilies(model, profile, rows, uid);
                const first = rows.find((r) => r.include);
                const id =
                  first &&
                  result.find(
                    (c) =>
                      c.generation &&
                      generationKey(c.generation) ===
                        generationKey(first.generation),
                  )?.id;
                onAccept(profile, result, id);
              } catch (e) {
                setError((e as Error).message);
              }
            }}
          >
            Usar linhas selecionadas
          </button>
        </div>
      </div>
    );
  }
  return (
    <div className="family-editor">
      <h3 ref={heading} tabIndex={-1}>
        Ações e casos estáticos
      </h3>
      <p>
        Classifique cada caso. Casos com o mesmo grupo de exclusão representam
        alternativas. A expressão ao lado do caso mostra a ponderação dos
        padrões na análise.
      </p>
      <div className="family-table-wrap">
        <table>
          <thead>
            <tr>
              <th>Caso e padrões</th>
              <th>Classificação</th>
              <th>Grupo de exclusão</th>
            </tr>
          </thead>
          <tbody>
            {model.analysisCases.map((c) => {
              const action = actions.find((a) => a.caseId === c.id);
              return (
                <tr key={c.id}>
                  <td>
                    <b>{c.name}</b> <small>[{c.id}]</small>
                    <div>
                      {expression(
                        c.factors.map((t) => ({
                          name: patterns.get(t.patternId) ?? t.patternId,
                          factor: t.factor,
                        })),
                      )}
                    </div>
                  </td>
                  <td>
                    <select
                      aria-label={`Classificação de ${c.name}`}
                      value={action?.role ?? ""}
                      onChange={(e) => {
                        const role = e.target.value;
                        setActions((all) => {
                          const others = all.filter((a) => a.caseId !== c.id);
                          return role === "permanent" || role === "variable"
                            ? [
                                ...others,
                                {
                                  caseId: c.id,
                                  role,
                                  group: action?.group ?? "",
                                },
                              ]
                            : others;
                        });
                      }}
                    >
                      <option value="">Não incluir</option>
                      <option value="permanent">Permanente</option>
                      <option value="variable">Variável</option>
                    </select>
                  </td>
                  <td>
                    <input
                      aria-label={`Grupo de exclusão de ${c.name}`}
                      maxLength={120}
                      disabled={!action}
                      value={action?.group ?? ""}
                      onChange={(e) =>
                        setActions((all) =>
                          all.map((a) =>
                            a.caseId === c.id
                              ? { ...a, group: e.target.value }
                              : a,
                          ),
                        )
                      }
                    />
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <h3>Famílias e coeficientes</h3>
      <p>
        Os valores iniciais são unitários. Informe os fatores de projeto e a
        respectiva origem.
      </p>
      {families.map((f, i) => (
        <fieldset key={f.id} className="family-settings">
          <legend>
            <label>
              <input
                type="checkbox"
                checked={f.enabled}
                aria-label={`Incluir família ${f.name}`}
                onChange={(e) =>
                  updateFamily(f.id, { enabled: e.target.checked })
                }
              />{" "}
              {f.name || `Família ${i + 1}`}
            </label>
          </legend>
          <div className="family-identity">
            <label>
              Tipo
              <select
                value={f.kind}
                onChange={(e) =>
                  updateFamily(f.id, { kind: e.target.value as Family["kind"] })
                }
              >
                <option>ELU</option>
                <option>ELS</option>
              </select>
            </label>
            <label>
              Nome da família
              <input
                value={f.name}
                maxLength={120}
                onChange={(e) => updateFamily(f.id, { name: e.target.value })}
              />
            </label>
            <label>
              Origem dos coeficientes
              <input
                value={f.source}
                maxLength={120}
                onChange={(e) => updateFamily(f.id, { source: e.target.value })}
              />
            </label>
          </div>
          <div className="family-terms">
            {(Object.keys(coefficientLabels) as Coefficient[]).map((k) => (
              <label key={k}>
                {coefficientLabels[k]}
                <input
                  aria-label={`${coefficientLabels[k]} em ${f.name}`}
                  inputMode="decimal"
                  value={f[k]}
                  onChange={(e) => updateFamily(f.id, { [k]: e.target.value })}
                />
              </label>
            ))}
          </div>
          {families.length > 1 && (
            <button
              type="button"
              onClick={() =>
                setFamilies((all) => all.filter((a) => a.id !== f.id))
              }
            >
              Remover família
            </button>
          )}
        </fieldset>
      ))}
      <button
        type="button"
        disabled={families.length >= 100}
        onClick={() =>
          setFamilies((all) => [
            ...all,
            toDraft({
              ...userFamily(uid(), "ELS"),
              name: `Família ${all.length + 1}`,
            }),
          ])
        }
      >
        Adicionar família
      </button>
      {error && (
        <p role="alert" className="launch-error">
          {error}
        </p>
      )}
      <div className="modal-actions">
        <button type="button" onClick={onCancel}>
          Cancelar geração
        </button>
        <button type="button" onClick={generate}>
          Gerar prévia
        </button>
      </div>
    </div>
  );
}
