import { expect, test, type Page } from "@playwright/test";
import { readFile } from "node:fs/promises";
import {
  createProject,
  parseProject,
  serializeProject,
} from "../../src/domain/model";

const drawing = (page: Page) =>
  page.getByRole("application", { name: "Área de lançamento XY" });
async function openModel(page: Page) {
  const model = createProject("spatial");
  model.guides.x[2].position = 10;
  model.sections.push({ ...model.sections[0], id: "r2", name: "R2" });
  await page.goto("/");
  await page
    .locator("input[type=file]")
    .setInputFiles({
      name: "teste.kstruct.json",
      mimeType: "application/json",
      buffer: Buffer.from(serializeProject(model)),
    });
  await expect(drawing(page)).toBeVisible();
  await page.getByRole("button", { name: /^Barra B$/ }).click();
  await page.getByLabel("Seção ativa").selectOption("r2");
  await page.getByLabel("Rotação local (°)").fill("12,5");
  await page
    .getByRole("button", { name: "Enquadrar modelo", exact: true })
    .first()
    .click();
}
async function position(page: Page, x: number, y: number) {
  return drawing(page).evaluate(
    (svg, { x, y }) => {
      const at = (axis: string, v: number) =>
        Number(
          svg
            .querySelector(`line[data-axis="${axis}"][data-position="${v}"]`)!
            .getAttribute(axis + "1"),
        );
      return {
        x: at("x", 0) + ((at("x", 4) - at("x", 0)) * x) / 4,
        y: at("y", 0) + ((at("y", 4) - at("y", 0)) * y) / 4,
      };
    },
    { x, y },
  );
}
async function click(page: Page, x: number, y: number) {
  await drawing(page).click({ position: await position(page, x, y) });
}
async function saved(page: Page) {
  const download = page.waitForEvent("download");
  await page
    .getByRole("button", { name: "Salvar projeto", exact: true })
    .click();
  return parseProject(await readFile((await (await download).path())!, "utf8"));
}
test("cadeia compartilha o nó, preserva as propriedades e desfaz um trecho por vez", async ({
  page,
}) => {
  await openModel(page);
  await page.getByLabel("Traçado").selectOption("chain");
  await click(page, 0, 0);
  await click(page, 4, 0);
  await click(page, 4, 0);
  await expect(page.getByRole("status")).toContainText("extremidade diferente");
  await click(page, 4.4, 4);
  await expect(page.locator(".model-count")).toHaveText("3 nós · 2 barras");
  await page.keyboard.press("Escape");
  const model = await saved(page);
  expect(model.members[0].end).toBe(model.members[1].start);
  expect(model.nodes.map((n) => [n.x, n.y, n.z])).toEqual([
    [0, 0, 0],
    [4, 0, 0],
    [4, 4, 0],
  ]);
  for (const bar of model.members)
    expect(bar).toMatchObject({ sectionId: "r2", roll: 12.5 });
  await page.getByRole("button", { name: "Desfazer", exact: true }).click();
  await expect(page.locator(".model-count")).toHaveText("2 nós · 1 barras");
  await page.getByRole("button", { name: "Refazer", exact: true }).click();
  await expect(page.locator(".model-count")).toHaveText("3 nós · 2 barras");
  await page.getByRole("button", { name: /^Barra B$/ }).click();
  await expect(page.getByLabel("Seção ativa")).toHaveValue("r2");
  await click(page, 0, 0);
  await page.getByLabel("Pavimento ativo").selectOption("level1");
  await click(page, 4, 0);
  await expect(page.locator(".model-count")).toHaveText("3 nós · 2 barras");
  await page.keyboard.press("Escape");
});
test("vão elevado destaca e cria o trecho 4–10 m uma única vez", async ({
  page,
}) => {
  await openModel(page);
  await page.getByLabel("Traçado").selectOption("span");
  await page.getByLabel("Pavimento ativo").selectOption("level1");
  const line = drawing(page).getByLabel("Vão a lançar");
  await click(page, 4, 0);
  await expect(line).toHaveCount(0);
  await expect(page.locator(".model-count")).toHaveText("0 nós · 0 barras");
  const mid = await position(page, 7, 0);
  await drawing(page).hover({ position: mid });
  await expect(line).toBeVisible();
  const a = await position(page, 4, 0),
    b = await position(page, 10, 0);
  expect(Number(await line.getAttribute("x1"))).toBeCloseTo(a.x, 4);
  expect(Number(await line.getAttribute("x2"))).toBeCloseTo(b.x, 4);
  await click(page, 7, 0);
  await click(page, 7, 0);
  await expect(page.getByRole("status")).toContainText("Já existe uma barra");
  const model = await saved(page);
  expect(model.nodes.map((n) => [n.x, n.y, n.z])).toEqual([
    [4, 0, 3],
    [10, 0, 3],
  ]);
  expect(model.members).toEqual([
    expect.objectContaining({ sectionId: "r2", roll: 12.5 }),
  ]);
  await page.getByRole("button", { name: "Desfazer", exact: true }).click();
  await expect(page.locator(".model-count")).toHaveText("0 nós · 0 barras");
});
