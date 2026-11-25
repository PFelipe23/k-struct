import { expect, test, type Page } from "@playwright/test";
import { readFile } from "node:fs/promises";
import { beamExample, parseProject } from "../../src/domain/model";
import { exportOofem, parseOofemOutput } from "../../src/solver/oofem";
import { projectV8 } from "../fixtures/project-v8";
import { runDeck } from "../fixtures/solve-oofem";

async function save(page: Page) {
  const downloading = page.waitForEvent("download");
  await page
    .getByRole("button", { name: "Salvar projeto", exact: true })
    .click();
  const path = (await (await downloading).path())!;
  return { path, project: parseProject(await readFile(path, "utf8")) };
}

test("dois materiais, uso compartilhado, cópia independente, histórico e entrada OOFEM", async ({
  page,
}) => {
  test.setTimeout(60_000);
  const legacy = projectV8(beamExample());
  await page.addInitScript(
    (source) => localStorage.setItem("kstruct.draft.v8", source),
    JSON.stringify(legacy),
  );
  await page.goto("/");
  const button = (name: string) =>
    page.getByRole("button", { name, exact: true });
  const library = page.getByRole("dialog", { name: "Biblioteca de materiais" });
  const action = (name: string) =>
    library.getByRole("button", { name, exact: true });
  const material = library.getByRole("combobox", {
    name: "Material do projeto",
  });
  const target = library.getByRole("combobox", {
    name: "Seção ou laje de destino",
  });
  const usage = library.getByRole("region", { name: "Uso do material" });

  await button("Materiais").click();
  await action("Novo material").click();
  await library.getByLabel("Nome do material").fill("Aço 210");
  await library.getByLabel("Módulo E (GPa)", { exact: true }).fill("210");
  await library.getByLabel("Poisson ν", { exact: true }).fill("0,30");
  await library
    .getByLabel("Massa específica ρ (kg/m³)", { exact: true })
    .fill("7850");
  await library
    .getByLabel("Dilatação linear α (1/K)", { exact: true })
    .fill("0,000012");
  await action("Salvar material").click();
  const steel = await material.inputValue();
  expect(steel).not.toBe("steel");
  await action("Atribuir material").click();
  await action("Duplicar seção").click();
  const key = await target.inputValue(),
    sectionId = key.slice("section:".length);
  await action("Editar material").click();
  await expect(usage).toContainText("2 seções");
  await expect(usage).toContainText("Retangular R1, Retangular R2");
  await library.getByLabel("Módulo E (GPa)", { exact: true }).fill("100");
  await action("Cancelar edição").click();
  await action("Excluir material").click();
  await expect(library.getByRole("alert")).toContainText(
    "Retangular R1, Retangular R2",
  );
  await action("Duplicar material").click();
  await library.getByLabel("Nome do material").fill("Aço de ensaio");
  await expect(
    library.getByLabel("Módulo E (GPa)", { exact: true }),
  ).toHaveValue("210");
  await library.getByLabel("Módulo E (GPa)", { exact: true }).fill("420");
  await action("Salvar material").click();
  const copy = await material.inputValue();
  expect(copy).not.toBe(steel);
  await action("Atribuir material").click();
  await expect(usage).toContainText("1 seção · Retangular R2");
  await action("Fechar").click();

  await button("Desfazer").click();
  const undone = (await save(page)).project;
  expect(undone.sections.map((s) => s.materialId)).toEqual([steel, steel]);
  expect(undone.materials.map((m) => m.id)).toContain(copy);
  await button("Refazer").click();
  const { path, project } = await save(page);
  expect(project.sections.map((s) => s.materialId)).toEqual([steel, copy]);
  expect(project.materials.find((m) => m.id === steel)).toMatchObject({
    E: 210e9,
    nu: 0.3,
    density: 7850,
    alpha: 12e-6,
  });
  expect(project.materials.find((m) => m.id === copy)).toMatchObject({
    E: 420e9,
    nu: 0.3,
    density: 7850,
    alpha: 12e-6,
  });
  await page.locator("input[type=file]").setInputFiles(path);
  await page
    .locator(".explorer")
    .getByRole("button", { name: "B1", exact: true })
    .click();
  await expect(page.getByLabel("Propriedades do material")).toContainText(
    "210 GPa",
  );
  await page.getByLabel("Seção da barra").selectOption(sectionId);
  await expect(page.getByLabel("Propriedades do material")).toContainText(
    "420 GPa",
  );
  await button("Abrir material na biblioteca").click();
  await expect(material).toHaveValue(copy);
  await expect(target).toHaveValue(key);
  await action("Fechar").click();

  const latest = (await save(page)).project;
  expect(latest.loadPatterns).toEqual(legacy.loadPatterns);
  await button("Análise").click();
  const download = page.waitForEvent("download");
  await button("Entrada OOFEM").click();
  const deck = await readFile((await (await download).path())!, "utf8");
  const input = exportOofem(latest, "EL");
  expect(deck).toBe(input.deck);
  expect(deck).toMatch(/^SimpleCS 2 .* material 3 set /m);
  expect(deck).toContain("IsoLE 3 d 7850 E 420000000000 n 0.3 tAlpha 0.000012");
  if (process.env.OOFEM_BIN) {
    const r = parseOofemOutput(runDeck(deck, process.env.OOFEM_BIN), input);
    const mid = r.members.V1.find((s) => s.t === 0.5)!;
    expect(mid.uz).toBeCloseTo((-0.0084375 * 200) / 420, 8);
    for (const support of r.reactions) expect(support.fz).toBeCloseTo(30000, 1);
  }
});
