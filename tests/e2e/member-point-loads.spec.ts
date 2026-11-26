import { expect, test } from "@playwright/test";
import { readFile } from "node:fs/promises";
import { parseProject, serializeProject } from "../../src/domain/model";
import { pointLoadBeam } from "../fixtures/member-point-loads";
import { openProjectInBrowser } from "../fixtures/open-project";
import { analyzeInBrowser } from "../fixtures/analyze-in-browser";

test("lança na barra por clique, edita, reabre e consulta os saltos no CSV", async ({
  page,
}) => {
  const project = pointLoadBeam();
  delete project.loadPatterns[0].points;
  await page.goto("/");
  await openProjectInBrowser(
    page,
    "viga.kstruct.json",
    serializeProject(project),
  );
  const button = (name: string) =>
    page.getByRole("button", { name, exact: true });
  const view = page.getByRole("application", { name: "Área de lançamento XZ" });
  const position = await view
    .locator('[data-member-id="V1"]')
    .evaluate((el) => {
      const line = el as SVGLineElement;
      const x = (2 * line.x1.baseVal.value + line.x2.baseVal.value) / 3;
      const y = (2 * line.y1.baseVal.value + line.y2.baseVal.value) / 3;
      const at = new DOMPoint(x, y).matrixTransform(line.getScreenCTM()!);
      return { x: at.x, y: at.y };
    });
  await button("Modelo").click();
  await button("Carga concentrada").click();
  await page.mouse.click(position.x, position.y);
  const dialog = page.getByRole("dialog", { name: /Carga concentrada/ });
  const dist = dialog.getByLabel("Distância x (m)");
  expect(Number((await dist.inputValue()).replace(",", "."))).toBeCloseTo(2, 1);
  await dialog.getByLabel("Posição a partir de i").selectOption("relative");
  await dialog.getByLabel("Fração x/L").fill("1,1");
  await expect(dialog.getByRole("alert")).toContainText("entre 0 e 1");
  await expect(button("Aplicar carga")).toBeDisabled();
  await dialog.getByLabel("Fração x/L").fill("1/3");
  await dialog.getByLabel("FZ global (kN)").fill("-12");
  await button("Aplicar carga").click();
  const glyph = view.getByRole("img", { name: /FZ -12 kN global · x = 2 m/ });
  await expect(glyph).toBeVisible();
  await expect(page.locator(".model-count")).toHaveText("2 nós · 1 barras");
  await button("Desfazer").click();
  await expect(glyph).toHaveCount(0);
  await button("Refazer").click();
  await expect(glyph).toBeVisible();
  const pending = page.waitForEvent("download");
  await button("Salvar projeto").click();
  const source = await readFile((await (await pending).path())!, "utf8");
  const saved = parseProject(source);
  expect(saved.loadPatterns[0].points).toEqual([
    {
      ...pointLoadBeam().loadPatterns[0].points![0],
      id: expect.any(String),
      position: { kind: "relative", value: 1 / 3 },
    },
  ]);
  expect(saved.nodes).toEqual(project.nodes);
  expect(saved.members).toEqual(project.members);
  await openProjectInBrowser(page, "reaberta.kstruct.json", source);
  await expect(glyph).toBeVisible();
  await page
    .locator(".explorer")
    .getByRole("button", { name: "B1", exact: true })
    .click();
  await button("FZ -12 kN global · x = 2 m").click();
  await dialog.getByLabel("Tipo de ação").selectOption("moment");
  await dialog.getByLabel("Referencial da carga").selectOption("local");
  await dialog.getByLabel(/MY local/).fill("6");
  await button("Aplicar carga").click();
  await expect(view.getByRole("img", { name: /MY 6 .* local/ })).toBeVisible();
  await page.getByRole("button", { name: /MY 6 .* local/ }).click();
  await button("Excluir carga").click();
  await expect(view.locator(".member-point-glyph")).toHaveCount(0);
  await button("Desfazer").click();
  await button("Desfazer").click();
  await expect(glyph).toBeVisible();
  if (process.env.OOFEM_BIN) {
    await analyzeInBrowser(page, saved, process.env.OOFEM_BIN);
    await button("Esforços").click();
    const rows = page.locator(".results-body tbody tr");
    for (const [side, force] of [
      ["Lado i", "8"],
      ["Lado j", "-4"],
    ]) {
      const row = rows.filter({ hasText: side });
      await expect(
        row.getByRole("cell", { name: force, exact: true }),
      ).toBeVisible();
      await expect(
        row.getByRole("cell", { name: "16", exact: true }),
      ).toBeVisible();
    }
    const download = page.waitForEvent("download");
    await button("CSV").click();
    const csv = await readFile((await (await download).path())!, "utf8");
    expect(csv).toContain(';8;16;"Lado i";"V1"');
    expect(csv).toContain(';-4;16;"Lado j";"V1"');
  }
});

test("lança um momento na perspectiva e respeita a camada de cargas", async ({
  page,
}) => {
  const project = pointLoadBeam();
  project.mode = "spatial";
  project.nodes[1].z = 2;
  delete project.loadPatterns[0].points;
  await page.goto("/");
  await openProjectInBrowser(
    page,
    "espacial.kstruct.json",
    serializeProject(project),
  );
  const view = page.getByRole("region", {
    name: "Perspectiva 3D",
    exact: true,
  });
  await view.getByRole("button", { name: "Nomes dos objetos" }).click();
  await view.getByRole("button", { name: "Cargas", exact: true }).click();
  await page
    .getByRole("button", { name: "Carga concentrada", exact: true })
    .click();
  const anchor = view.locator(".scene-label").filter({ hasText: /^B1$/ });
  const { x, y } = await anchor.evaluate((e) => {
    const rect = e.getBoundingClientRect();
    return { x: rect.left, y: rect.bottom };
  });
  await page.mouse.click(x, y);
  const dialog = page.getByRole("dialog", { name: /Carga concentrada/ });
  const distance = await dialog.getByLabel("Distância x (m)").inputValue();
  expect(Number(distance.replace(",", "."))).toBeCloseTo(Math.sqrt(40) / 2, 1);
  await dialog.getByLabel("Tipo de ação").selectOption("moment");
  await dialog.getByLabel("Referencial da carga").selectOption("local");
  await dialog.getByLabel(/MX local/).fill("4");
  await dialog.getByRole("button", { name: "Aplicar carga" }).click();
  const label = view.locator(".scene-point-load");
  await expect(label).toHaveText(/MX 4 .* local/);
  await view.getByRole("button", { name: "Cargas", exact: true }).click();
  await expect(label).toHaveCount(0);
});
