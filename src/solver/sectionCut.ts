import { origin } from "../domain/geometry";
import {
  equilibrateShear,
  externalPanels,
  externalSlab,
  shearModes,
} from "./cutEquilibrium";
import { cutGeometry } from "../domain/sectionCut";
import type { Project, SectionCut, ResultCombination } from "../domain/model";
import { panelAssembly, type PanelAssembly } from "../domain/surfacePanel";
import { requireAvailableCases } from "./combinations";
import { cutMember } from "./cutMember";
import { integratePanel, integrateSlab } from "./cutSurface";
import {
  accumulate,
  reduced,
  zeroResultant,
  type Resultant,
} from "./cutResultant";
import type { AnalysisResult } from "./oofem";

export function evaluateCut(
  p: Project,
  cut: SectionCut,
  factors: ResultCombination["factors"],
  results: ReadonlyMap<string, AnalysisResult>,
  geometry = cutGeometry(p, cut),
) {
  if (!factors.some((f) => f.factor !== 0))
    throw new Error("Informe pelo menos um fator diferente de zero.");
  requireAvailableCases(p, factors, results);
  const { frame, objects } = geometry,
    rows: { id: string; name: string; note: string; value?: Resultant }[] = [];
  const reference = { ...cut, datum: cut.point },
    panelParts: Resultant[] = [],
    modes: Parameters<typeof equilibrateShear>[2] = [];
  let assembly: PanelAssembly | undefined;
  for (const o of objects) {
    if (!o.hits.length && !o.traces.length && !o.notice) continue;
    const key = { id: o.id, name: o.name };
    if (o.unavailable) {
      rows.push({ ...key, note: o.notice! });
      continue;
    }
    if (!o.hits.length && !o.traces.length) continue;
    const value = zeroResultant();
    let note = "";
    try {
      for (const { caseId, factor } of factors) {
        if (!factor) continue;
        const result = results.get(caseId)!;
        let part: Resultant;
        if (o.kind === "member") {
          part = cutMember(
            p,
            result,
            p.members.find((v) => v.id === o.id)!,
            o,
            reference,
            frame,
          );
          note =
            p.mode === "planar" ? "Barra XZ · N, Vz e My" : "Barra espacial";
        } else if (o.kind === "slab") {
          const slab =
            result.floor?.panels.find((s) => s.slabId === o.id) ?? result.slab;
          if (slab?.slabId !== o.id)
            throw new Error("Resultados da laje indisponíveis.");
          part = integrateSlab(slab, reference, frame);
          const ext = externalSlab(
            p,
            caseId,
            p.slabs.find((s) => s.id === o.id)!,
            slab,
            reference,
            frame,
          );
          equilibrateShear(
            ext,
            [part],
            [
              {
                ...shearModes(o.traces[0][0], { ...origin, z: 1 }, frame),
                value: part,
              },
            ],
            reference.datum,
          );
          note = "Placa · flexão e cortante recuperado";
        } else {
          if (!result.panels)
            throw new Error("Resultados do painel indisponíveis.");
          assembly ??= panelAssembly(p);
          part = integratePanel(
            assembly,
            o.id,
            result.panels,
            reference,
            frame,
          );
          const kind = p.surfacePanels!.find((v) => v.id === o.id)!.kind;
          note =
            kind === "membrane"
              ? "Membrana · forças no plano"
              : kind === "plate"
                ? "Placa · flexão e cortante recuperado"
                : "Casca · membrana, flexão e cortante recuperado";
        }
        accumulate(value, part, factor);
      }
      if (
        ![...Object.values(value.force), ...Object.values(value.moment)].every(
          Number.isFinite,
        )
      )
        throw new Error("Resultante fora do intervalo numérico.");
      if (o.kind === "panel" && assembly) {
        panelParts.push(value);
        const g = assembly.panels.find((g) => g.panel.id === o.id)!;
        if (g.panel.kind !== "membrane")
          modes.push({
            ...shearModes(o.traces[0][0], g.axes[2], frame),
            value,
          });
      }
      rows.push({ ...key, value, note });
    } catch (e) {
      rows.push({ ...key, note: (e as Error).message });
    }
  }
  if (assembly && modes.length) {
    try {
      if (rows.some((r) => !r.value))
        throw new Error(
          "Interface ou parcela incompleta para o equilíbrio de cortantes.",
        );
      const ext = zeroResultant();
      for (const { caseId, factor } of factors)
        if (factor)
          accumulate(
            ext,
            externalPanels(
              p,
              caseId,
              assembly,
              results.get(caseId)!.panels!,
              reference,
              frame,
            ),
            factor,
          );
      equilibrateShear(ext, panelParts, modes, reference.datum);
    } catch (e) {
      for (const row of rows)
        if (modes.some((m) => m.value === row.value)) {
          delete row.value;
          row.note = (e as Error).message;
        }
    }
  }
  for (const row of rows)
    if (row.value)
      row.value = reduced(
        reference.datum,
        cut.datum,
        row.value.force,
        row.value.moment,
      );
  const total =
    rows.length && rows.every((r) => r.value) ? zeroResultant() : undefined;
  if (total) for (const row of rows) accumulate(total, row.value!);
  if (
    total &&
    ![...Object.values(total.force), ...Object.values(total.moment)].every(
      Number.isFinite,
    )
  )
    throw new Error("Soma fora do intervalo numérico.");
  return { rows, total };
}
