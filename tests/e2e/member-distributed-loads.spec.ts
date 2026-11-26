import { expect, test } from "@playwright/test";
import { readFile } from "node:fs/promises";
import { parseProject, serializeProject } from "../../src/domain/model";
import { distributedBeam } from "../fixtures/member-distributed-loads";
import { openProjectInBrowser } from "../fixtures/open-project";
import { analyzeInBrowser } from "../fixtures/analyze-in-browser";

test("lança o trecho na barra, valida, desenha, desfaz, reabre e consulta as seções", async ({
  page,
}) => {
  test.setTimeout(60_000);
  const p = distributedBeam();
  delete p.loadPatterns[0].distributed;
  await page.goto("/");
  await openProjectInBrowser(page, "viga.kstruct.json", serializeProject(p));
  const button = (name: string) =>
    page.getByRole("button", { name, exact: true });
  const view = page.getByRole("application", { name: "Área de lançamento XZ" });
  await button("Carga por trecho").click();
  const at = await view.locator('[data-member-id="V1"]').evaluate((el) => {
    const line = el as SVGLineElement;
    const pos = new DOMPoint(
      (2 * line.x1.baseVal.value + line.x2.baseVal.value) / 3,
      (2 * line.y1.baseVal.value + line.y2.baseVal.value) / 3,
    ).matrixTransform(line.getScreenCTM()!);
    return { x: pos.x, y: pos.y };
  });
  await page.mouse.click(at.x, at.y);
  const dialog = page.getByRole("dialog", { name: /Carga por trecho/ });
  expect(
    Number(
      (await dialog.getByLabel("Início (m)").inputValue()).replace(",", "."),
    ),
  ).toBeCloseTo(2, 1);
  await dialog.getByLabel("Posições a partir de i").selectOption("relative");
  const start = dialog.getByLabel("Início (x/L)"),
    end = dialog.getByLabel("Fim (x/L)");
  await start.fill("1/3");
  await end.fill("1/4");
  await expect(dialog.getByRole("alert")).toContainText("maior que o início");
  await end.fill("6/5");
  await expect(button("Aplicar carga")).toBeDisabled();
  await end.fill("5/6");
  await dialog.getByLabel("qZ final").fill("-6");
  await button("Aplicar carga").click();
  const glyph = view.getByRole("img", {
    name: "2–5 m · qZ 0 → -6 kN/m · global",
  });
  await expect(glyph).toBeVisible();
  const arrows = await glyph
    .locator("line")
    .evaluateAll((lines) =>
      lines.map((el) =>
        Math.abs(Number(el.getAttribute("y2")) - Number(el.getAttribute("y1"))),
      ),
    );
  expect(arrows[0]).toBeLessThan(arrows.at(-1)!);
  await expect(page.locator(".model-count")).toHaveText("2 nós · 1 barras");
  await button("Desfazer").click();
  await expect(glyph).toHaveCount(0);
  await button("Refazer").click();
  await expect(glyph).toBeVisible();
  const download = page.waitForEvent("download");
  await button("Salvar projeto").click();
  const source = await readFile((await (await download).path())!, "utf8"),
    saved = parseProject(source);
  expect(saved.loadPatterns[0].distributed).toMatchObject([
    { start: 1 / 3, end: 5 / 6, measure: "relative", qEnd: { z: -6000 } },
  ]);
  expect(saved.members).toEqual(p.members);
  await openProjectInBrowser(page, "reaberta.kstruct.json", source);
  await expect(glyph).toBeVisible();
  await page
    .locator(".explorer")
    .getByRole("button", { name: "B1", exact: true })
    .click();
  await button("2–5 m · qZ 0 → -6 kN/m · global").click();
  await dialog.getByLabel("qZ inicial").fill("6");
  await button("Aplicar carga").click();
  const signed = view.getByRole("img", {
    name: "2–5 m · qZ 6 → -6 kN/m · global",
  });
  const directions = await signed
    .locator("line")
    .evaluateAll((lines) =>
      lines.map((el) =>
        Math.sign(
          Number(el.getAttribute("y2")) - Number(el.getAttribute("y1")),
        ),
      ),
    );
  expect(new Set(directions)).toEqual(new Set([-1, 1]));
  await expect(signed.locator('[data-load-station="3.5"]')).toHaveCount(1);
  await button("2–5 m · qZ 6 → -6 kN/m · global").click();
  await button("Excluir carga").click();
  await expect(signed).toHaveCount(0);
  await button("Desfazer").click();
  await button("Desfazer").click();
  await expect(glyph).toBeVisible();
  if (process.env.OOFEM_BIN) {
    await analyzeInBrowser(page, saved, process.env.OOFEM_BIN);
    await page.getByLabel("Visualização dos resultados").selectOption("m");
    await expect(glyph.locator("text")).toHaveText(["x = 2 m", "x = 5 m"]);
    await button("Reações").click();
    const rows = page.locator(".results-body tbody tr");
    await expect(
      rows.nth(0).getByRole("cell", { name: "3", exact: true }),
    ).toBeVisible();
    await expect(
      rows.nth(1).getByRole("cell", { name: "6", exact: true }),
    ).toBeVisible();
    await button("Esforços").click();
    const csvEvent = page.waitForEvent("download");
    await button("CSV").click();
    const csv = await readFile((await (await csvEvent).path())!, "utf8");
    expect(
      csv
        .split("\n")
        .some((r) => r.includes(";0.33333") && r.includes(";3;6;")),
    ).toBe(true);
    expect(
      csv
        .split("\n")
        .some((r) => r.includes(";0.83333") && r.includes(";-6;6;")),
    ).toBe(true);
  }
});

test("o referencial local e as intensidades aparecem na perspectiva XYZ", async ({
  page,
}) => {
  const p = distributedBeam(-2000, -6000);
  p.mode = "spatial";
  p.nodes[1].z = 2;
  p.members[0].roll = 32;
  p.loadPatterns[0].distributed![0].system = "local";
  await page.goto("/");
  await openProjectInBrowser(
    page,
    "espacial.kstruct.json",
    serializeProject(p),
  );
  const view = page.getByRole("region", { name: "Perspectiva 3D" });
  await view.getByRole("button", { name: "Cargas", exact: true }).click();
  await expect(view.locator('[data-distributed-load="D1"]')).toHaveText(
    "2–5 m · qZ -2 → -6 kN/m · local",
  );
  await view.getByRole("button", { name: "Cargas", exact: true }).click();
  await expect(view.locator('[data-distributed-load="D1"]')).toHaveCount(0);
});
