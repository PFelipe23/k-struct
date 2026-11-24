import { expect, test, type Page } from "@playwright/test";
import { readFile } from "node:fs/promises";
import {
  beamExample,
  free,
  parseProject,
  serializeProject,
  type Project,
} from "../../src/domain/model";
const button = (page: Page, name: string) =>
  page.getByRole("button", { name, exact: true });
async function open(page: Page, p: Project) {
  await page.goto("/");
  await page
    .locator("input[type=file]")
    .setInputFiles({
      name: "edicao.kstruct.json",
      mimeType: "application/json",
      buffer: Buffer.from(serializeProject(p)),
    });
  await expect(page.locator(".model-count")).toHaveText(
    `${p.nodes.length} nós · ${p.members.length} barras`,
  );
}
async function save(page: Page) {
  const file = page.waitForEvent("download");
  await button(page, "Salvar projeto").click();
  return parseProject(await readFile((await (await file).path())!, "utf8"));
}
async function selectBar(page: Page) {
  await page
    .locator(".explorer")
    .getByRole("button", { name: "B1", exact: true })
    .click();
}
test("dividir e unir no editor conserva cargas, cancela e restaura a divisão no histórico", async ({
  page,
}) => {
  const p = beamExample();
  await open(page, p);
  await selectBar(page);
  await button(page, "Editar barras").click();
  const dialog = page.getByRole("dialog", { name: "Editar barras físicas" });
  const dist = dialog.getByLabel("Distância desde i (m)");
  await dist.fill("6");
  await expect(dialog.getByRole("alert")).toContainText("interior da barra");
  await expect(button(page, "Aplicar edição")).toBeDisabled();
  await dist.fill("2");
  await expect(
    dialog.getByRole("img", { name: "Prévia geométrica em XZ" }),
  ).toBeVisible();
  await expect(
    dialog.getByRole("table", { name: "Geometria final" }).getByRole("row"),
  ).toHaveCount(3);
  await button(page, "Cancelar").click();
  expect((await save(page)).members).toEqual(p.members);
  await button(page, "Editar barras").click();
  await dist.fill("2");
  await button(page, "Aplicar edição").click();
  const split = await save(page);
  expect(split.members).toHaveLength(2);
  expect(split.loadPatterns[0].uniform.map((l) => l.qz)).toEqual([
    -10000, -10000,
  ]);
  await button(page, "Editar barras").click();
  await expect(dialog.getByLabel("Operação")).toHaveValue("join");
  await button(page, "Aplicar edição").click();
  expect(await save(page)).toEqual(p);
  await button(page, "Desfazer").click();
  expect(await save(page)).toEqual(split);
  await button(page, "Refazer").click();
  expect(await save(page)).toEqual(p);
});
test("aparar e prolongar mostram a resultante e conservam a ponta após salvar e reabrir", async ({
  page,
}) => {
  const p = beamExample();
  p.nodes[1].restraints = free();
  await open(page, p);
  await selectBar(page);
  const dialog = page.getByRole("dialog", { name: "Editar barras físicas" });
  await button(page, "Editar barras").click();
  await dialog.getByLabel("Operação").selectOption("trim");
  await dialog.getByLabel("Coordenada X (m)").fill("4");
  await expect(dialog.getByText(/0 \/ 0 \/ -60 → 0 \/ 0 \/ -40/)).toBeVisible();
  await button(page, "Aplicar edição").click();
  const trimmed = await save(page);
  expect(trimmed.nodes[1]).toMatchObject({ id: "B", x: 4 });
  expect(trimmed.loadPatterns).toEqual(p.loadPatterns);
  await open(page, trimmed);
  await selectBar(page);
  await button(page, "Editar barras").click();
  await dialog.getByLabel("Operação").selectOption("extend");
  await dialog.getByLabel("Coordenada X (m)").fill("6");
  await expect(dialog.getByText(/0 \/ 0 \/ -40 → 0 \/ 0 \/ -60/)).toBeVisible();
  await button(page, "Aplicar edição").click();
  expect(await save(page)).toEqual(p);
});
