import { test, expect } from "@playwright/test";
import { readFile } from "node:fs/promises";

test("viga de referência: propriedades, undo, salvar e reabrir", async ({
  page,
}) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto("/");
  await page.getByRole("button", { name: /Viga de referência/ }).click();
  await page
    .locator(".explorer")
    .getByRole("button", { name: "B1", exact: true })
    .click();
  const load = page.getByLabel("qZ global");
  await load.fill("-20");
  await load.press("Tab");
  await expect(load).toHaveValue("-20");
  await page.getByRole("button", { name: "Desfazer", exact: true }).click();
  await page
    .locator(".explorer")
    .getByRole("button", { name: "B1", exact: true })
    .click();
  await expect(load).toHaveValue("-10");
  const wait = page.waitForEvent("download");
  await page
    .getByRole("button", { name: "Salvar projeto", exact: true })
    .click();
  const download = await wait,
    path = await download.path();
  const saved = JSON.parse(await readFile(path!, "utf8"));
  expect(saved.members).toHaveLength(1);
  expect(saved.loadPatterns[0].uniform[0].qz).toBe(-10000);
  await page.getByRole("button", { name: "Novo projeto", exact: true }).click();
  await page.locator("input[type=file]").setInputFiles(path!);
  await expect(page.getByLabel("Nome do projeto")).toHaveValue(
    "Viga biapoiada · 6 m",
  );
  await page.getByRole("button", { name: "Analisar", exact: true }).click();
  await expect(page.getByRole("status")).toContainText(
    "Execute o KStruct desktop",
  );
  await page.getByRole("button", { name: "Análise", exact: true }).click();
  const exported = page.waitForEvent("download");
  await page
    .getByRole("button", { name: "Entrada OOFEM", exact: true })
    .click();
  const deck = await exported;
  expect(await readFile((await deck.path())!, "utf8")).toContain(
    "domain 2dBeam",
  );
  expect(errors).toEqual([]);
});

test("lançamento a partir do vazio e seleção sincronizada", async ({
  page,
}) => {
  await page.goto("/");
  await page.getByRole("button", { name: /^Barra/ }).click();
  const canvas = page.getByRole("application", {
    name: "Área de lançamento XZ",
  });
  const box = await canvas.boundingBox();
  await canvas.click({
    position: { x: box!.width * 0.25, y: box!.height * 0.5 },
  });
  await canvas.click({
    position: { x: box!.width * 0.75, y: box!.height * 0.5 },
  });
  await expect(
    page.locator(".explorer").getByRole("button", { name: "B1", exact: true }),
  ).toBeVisible();
  await page.getByRole("button", { name: /^Selecionar/ }).click();
  await page
    .locator(".explorer")
    .getByRole("button", { name: "N1", exact: true })
    .click();
  await page.getByLabel("Restringir ux").check();
  await page.getByLabel("Restringir uz").check();
  await page.getByRole("button", { name: "Analisar", exact: true }).click();
  await expect(page.getByRole("status")).toContainText("apoios insuficientes");
  await page.getByRole("button", { name: "Excluir", exact: true }).click();
  await expect(
    page.locator(".explorer").getByRole("button", { name: "B1", exact: true }),
  ).toHaveCount(0);
  await page.getByRole("button", { name: "Desfazer", exact: true }).click();
  await expect(
    page.locator(".explorer").getByRole("button", { name: "B1", exact: true }),
  ).toBeVisible();
});

test("layout desktop, arte local e vista espacial", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("button", { name: /Viga de referência/ }).click();
  await page
    .locator(".explorer")
    .getByRole("button", { name: "B1", exact: true })
    .click();
  await expect(
    page.getByRole("heading", { name: "B1", exact: true }),
  ).toBeVisible();
  await expect(page.locator(".three-container canvas")).toBeVisible();
  expect(
    await page
      .locator(".identity-card img")
      .evaluate(
        (img: HTMLImageElement) => img.complete && img.naturalWidth > 0,
      ),
  ).toBe(true);
  await page.screenshot({
    path: "test-results/kstruct-workspace.png",
    fullPage: true,
  });
  await page.setViewportSize({ width: 1100, height: 720 });
  await expect(
    page.getByRole("button", { name: "Analisar", exact: true }),
  ).toBeInViewport();
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBe(true);
});
