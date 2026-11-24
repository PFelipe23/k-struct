import { expect, test, type Page } from "@playwright/test";
import { readFile } from "node:fs/promises";
import { addMember } from "../../src/domain/editing";
import {
  addPoint,
  createProject,
  nodalLoad,
  parseProject,
  serializeProject,
  type Project,
} from "../../src/domain/model";

async function open(page: Page, p: Project) {
  await page.goto("/");
  await page
    .locator("input[type=file]")
    .setInputFiles({
      name: "estrutura.kstruct.json",
      mimeType: "application/json",
      buffer: Buffer.from(serializeProject(p)),
    });
  await expect(page.locator(".model-count")).toHaveText(
    `${p.nodes.length} nós · ${p.members.length} barras`,
  );
}
const button = (page: Page, name: string) =>
  page.getByRole("button", { name, exact: true });
async function saved(page: Page) {
  const pending = page.waitForEvent("download");
  await button(page, "Salvar projeto").click();
  return parseProject(await readFile((await (await pending).path())!, "utf8"));
}
test("mover um nó comum mostra as barras incidentes; cancelar e desfazer preservam o original", async ({
  page,
}) => {
  const p = createProject("planar");
  addMember(p, { x: 0, y: 0, z: 0 }, { x: 2, y: 0, z: 0 });
  addMember(p, { x: 2, y: 0, z: 0 }, { x: 4, y: 0, z: 0 });
  await open(page, p);
  await page
    .locator(".explorer")
    .getByRole("button", { name: "N2", exact: true })
    .click();
  const dialog = page.getByRole("dialog");
  async function preview() {
    await button(page, "Transformar").click();
    await dialog.getByLabel("Operação").selectOption("move");
    await dialog.getByLabel("ΔX (m)").fill("0");
    await dialog.getByLabel("ΔZ (m)").fill("1,5");
    await expect(
      dialog.getByRole("img", { name: "Prévia geométrica em XZ" }),
    ).toBeVisible();
    await expect(
      dialog.getByText("1 nó movido · 2 barras incidentes"),
    ).toBeVisible();
    await dialog.getByText("Barras incidentes (2)", { exact: true }).click();
    await expect(dialog.getByText("B1 · 2 → 2,5 m")).toBeVisible();
    await expect(dialog.getByText("B2 · 2 → 2,5 m")).toBeVisible();
  }
  await preview();
  await button(page, "Cancelar").click();
  expect((await saved(page)).nodes).toEqual(p.nodes);
  await preview();
  await button(page, "Confirmar movimento").click();
  const moved = await saved(page);
  expect(moved.nodes[1]).toMatchObject({ id: p.nodes[1].id, z: 1.5 });
  expect(moved.members).toEqual(p.members);
  await button(page, "Desfazer").click();
  expect((await saved(page)).nodes).toEqual(p.nodes);
});
test("rotação mostra o conflito antes de copiar e soma cargas só após a escolha", async ({
  page,
}) => {
  const p = createProject("spatial"),
    bar = addMember(p, { x: 2, y: 0, z: 0 }, { x: 3, y: 0, z: 0 });
  const target = addPoint(p, { x: 0, y: 2, z: 0 });
  p.loadPatterns[0].nodal = [
    { ...nodalLoad(bar.start), fx: 20 },
    { ...nodalLoad(target.id), fy: 5 },
  ];
  await open(page, p);
  await page
    .locator(".explorer")
    .getByRole("button", { name: "B1", exact: true })
    .click();
  await button(page, "Replicar").click();
  const d = page.getByRole("dialog");
  await d.getByLabel("Operação").selectOption("rotate");
  await d.getByLabel(/Copiar cargas/).check();
  await expect(
    d.getByRole("img", { name: "Prévia geométrica em XY" }),
  ).toBeVisible();
  await expect(d.getByText(/carga nodal em/)).toBeVisible();
  await expect(button(page, "Criar cópias")).toBeDisabled();
  await d.getByLabel("Para os conflitos listados").selectOption("combine");
  await button(page, "Criar cópias").click();
  const copied = await saved(page);
  expect(copied.nodes).toHaveLength(4);
  expect(copied.members).toHaveLength(2);
  expect(copied.members[1].start).toBe(target.id);
  expect(copied.nodes[3].y).toBeCloseTo(3);
  expect(
    copied.loadPatterns[0].nodal.find((n) => n.nodeId === target.id)!.fy,
  ).toBeCloseTo(25);
  await button(page, "Desfazer").click();
  expect((await saved(page)).loadPatterns).toEqual(p.loadPatterns);
});
