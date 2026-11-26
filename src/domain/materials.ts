import {
  defaultElasticProperties,
  materialLimit,
  materialSchema,
  sectionLimit,
  nextName,
  uid,
  type Material,
  type Project,
} from "./model";

export type MaterialTarget = { kind: "section" | "slab"; id: string };

export function materialUsage(p: Project, id: string) {
  return {
    panels: (p.surfacePanels ?? []).filter((panel) => panel.materialId === id),
    sections: p.sections.filter((section) => section.materialId === id),
    slabs: p.slabs.filter((slab) => slab.materialId === id),
  };
}

export function newMaterial(p: Project, source?: Material): Material {
  const name = source
    ? nextName(
        `${source.name.slice(0, 120 - " · cópia ".length - String(materialLimit).length)} · cópia `,
        p.materials,
      )
    : nextName("Material M", p.materials);
  return { ...(source ?? defaultElasticProperties), id: uid(), name };
}

export function saveMaterial(
  p: Project,
  values: Material,
  mode: "create" | "edit",
) {
  const parsed = materialSchema.safeParse({
    ...values,
    name: values.name.trim(),
  });
  if (!parsed.success) {
    const messages: Record<string, string> = {
      name: "Informe um nome de 1 a 120 caracteres.",
      E: "O módulo E deve ser finito e maior que zero.",
      nu: "Informe um coeficiente de Poisson maior ou igual a zero e menor que 0,5.",
      density: "A massa específica deve ser finita e maior que zero.",
      alpha: "Informe um coeficiente de dilatação linear finito.",
    };
    throw new Error(
      messages[String(parsed.error.issues[0].path[0])] ?? "Material inválido.",
    );
  }
  const index = p.materials.findIndex((m) => m.id === values.id);
  if (mode === "edit") {
    if (index === -1)
      throw new Error("O material em edição não existe no projeto.");
    p.materials[index] = parsed.data;
    return;
  }
  if (p.materials.length >= materialLimit)
    throw new Error(`O projeto comporta até ${materialLimit} materiais.`);
  if (index !== -1) throw new Error("Já existe um material com esse ID.");
  p.materials.push(parsed.data);
}

export function removeMaterial(p: Project, id: string) {
  const index = p.materials.findIndex((m) => m.id === id);
  if (index === -1) throw new Error("Material inexistente.");
  const { sections, slabs, panels } = materialUsage(p, id);
  const users = [...sections, ...slabs, ...panels].map((item) => item.name);
  const reasons = [];
  if (users.length)
    reasons.push(
      `Reatribua o material de ${users.join(", ")} antes de excluir.`,
    );
  if (p.materials.length === 1)
    reasons.push("Mantenha pelo menos um material no projeto.");
  if (reasons.length) throw new Error(reasons.join(" "));
  p.materials.splice(index, 1);
}

export function assignMaterial(
  p: Project,
  target: MaterialTarget,
  materialId: string,
) {
  const objects = target.kind === "section" ? p.sections : p.slabs;
  const object = objects.find((item) => item.id === target.id);
  if (!object)
    throw new Error(
      target.kind === "section" ? "Seção inexistente." : "Laje inexistente.",
    );
  if (!p.materials.some((material) => material.id === materialId))
    throw new Error("Material inexistente.");
  object.materialId = materialId;
}

export function duplicateSection(p: Project, id: string) {
  const section = p.sections.find((s) => s.id === id);
  if (!section) throw new Error("Seção inexistente.");
  if (p.sections.length >= sectionLimit)
    throw new Error(`O projeto comporta até ${sectionLimit} seções.`);
  const copy = {
    ...section,
    id: uid(),
    name:
      section.shape === "rectangle"
        ? nextName("Retangular R", p.sections)
        : nextName(
            `${section.name.slice(0, 120 - " · cópia ".length - String(sectionLimit).length)} · cópia `,
            p.sections,
          ),
  };
  p.sections.push(copy);
  return copy.id;
}
