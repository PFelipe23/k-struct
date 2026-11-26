import { expect, test, type Page } from "@playwright/test";
import { readFile } from "node:fs/promises";
import { parseProject, serializeProject } from "../../src/domain/model";
import { exportOofem } from "../../src/solver/oofem";
import { internalJointBeam } from "../fixtures/internal-joint";
import { runDeck } from "../fixtures/solve-oofem";

const button = (page: Page, name: string) =>
  page.getByRole("button", { name, exact: true });
test("conecta, refina, reabre e consulta ambos os lados da mesma barra", async ({
  page,
}) => {
  test.setTimeout(60_000);
  const p = internalJointBeam();
  const expected = exportOofem(p, "EL");
  const raw = process.env.OOFEM_BIN
    ? runDeck(expected.deck, process.env.OOFEM_BIN)
    : await readFile("tests/fixtures/internal-joint-oofem.txt", "utf8");
  p.meshConnections = [];
  await page.goto("/");
  const file = page.locator("input[type=file]");
  await file.setInputFiles({
    name: "viga.kstruct.json",
    mimeType: "application/json",
    buffer: Buffer.from(serializeProject(p)),
  });
  await expect(page.locator(".model-count")).toHaveText("3 nós · 1 barras");
  const view = page.getByRole("region", { name: "Elevação XZ", exact: true });
  const marks = view.locator('[data-mesh-member="V1"]');
  await view.getByRole("button", { name: "Malha de análise" }).click();
  await expect(marks).toHaveCount(7);
  await page
    .locator(".explorer")
    .getByRole("button", { name: "B1", exact: true })
    .click();
  await button(page, "Conexões da malha").click();
  const dialog = page.getByRole("dialog", { name: "Conexões da malha" });
  await dialog.getByLabel("Nó interno", { exact: true }).selectOption("C");
  await dialog.getByRole("button", { name: "Conectar", exact: true }).click();
  await expect(dialog.getByRole("cell", { name: "0,33333" })).toBeVisible();
  await dialog.getByRole("button", { name: "Fechar" }).click();
  const joint = view.locator('[data-mesh-member="V1"][data-mesh-joint="C"]');
  await expect(joint).toHaveCount(1);
  await button(page, "Desfazer").click();
  await expect(joint).toHaveCount(0);
  await button(page, "Refazer").click();
  await expect(joint).toHaveCount(1);
  await page
    .locator(".explorer")
    .getByRole("button", { name: "B1", exact: true })
    .click();
  await button(page, "Conexões da malha").click();
  await dialog.getByLabel("Subdivisões regulares por barra").fill("6");
  await dialog.getByRole("button", { name: "Aplicar refinamento" }).click();
  await expect(
    dialog.getByRole("heading", { name: "B1 · 6 elementos de análise" }),
  ).toBeVisible();
  await dialog.getByRole("button", { name: "Fechar" }).click();
  await expect(marks).toHaveCount(5);
  await expect(button(page, "Editar barras")).toBeEnabled();
  await button(page, "Desfazer").click();
  await expect(marks).toHaveCount(8);
  const download = page.waitForEvent("download");
  await button(page, "Salvar projeto").click();
  const path = (await (await download).path())!;
  const saved = parseProject(await readFile(path, "utf8"));
  expect(saved.meshConnections).toEqual([{ memberId: "V1", nodeId: "C" }]);
  expect(saved.members).toEqual(p.members);
  await file.setInputFiles(path);
  await expect(page.locator(".model-count")).toHaveText("3 nós · 1 barras");

  // The browser uses the desktop message contract; the solver output is from the exact deck.
  await page.evaluate(
    ({ deck, raw }) => {
      let callback = 0;
      Object.assign(window, {
        isTauri: true,
        __TAURI_INTERNALS__: {
          transformCallback: () => ++callback,
          invoke: async (
            cmd: string,
            args: {
              deck: string;
              runContext: Record<string, string>;
              response: { onmessage: (payload: unknown) => void };
            },
          ) => {
            if (cmd !== "start_oofem" || args.deck !== deck)
              throw new Error("Entrada OOFEM divergente.");
            args.response.onmessage({
              output: raw,
              log: {
                summary: {
                  ...args.runContext,
                  status: "completed",
                  message: "OOFEM concluído.",
                },
              },
              historyError: null,
            });
          },
        },
      });
    },
    { deck: expected.deck, raw },
  );
  await button(page, "Análise").click();
  await button(page, "Analisar").click();
  await expect(page.getByRole("status")).toContainText("Análise concluída");
  await page.evaluate(() => Object.assign(window, { isTauri: false }));
  const picker = page.getByLabel("Caso, combinação ou envelope", {
    exact: true,
  });
  const diagram = page.getByLabel("Visualização dos resultados");
  await diagram.selectOption("v");
  await button(page, "Esforços").click();
  const rows = page.locator(".results-body tbody tr");
  await expect(
    rows
      .filter({ hasText: "Lado i" })
      .getByRole("cell", { name: "6", exact: true }),
  ).toBeVisible();
  await expect(
    rows
      .filter({ hasText: "Lado j" })
      .getByRole("cell", { name: "-3", exact: true }),
  ).toBeVisible();
  await picker.selectOption("combination:NEG");
  await expect(
    rows
      .filter({ hasText: "Lado j" })
      .getByRole("cell", { name: "3", exact: true }),
  ).toBeVisible();
  const comboDownload = page.waitForEvent("download");
  await button(page, "CSV").click();
  const comboCsv = await readFile(
    (await (await comboDownload).path())!,
    "utf8",
  );
  expect(comboCsv).toContain(';3;-12;"Lado j";"V1";"Invertida";"NEG";');

  await picker.selectOption("envelope:ENV");
  await diagram.selectOption("v");
  const env = page.getByRole("region", { name: "Resultados do envelope" });
  const station = env.getByLabel("Estação x/L");
  for (const [label, governing] of [
    ["Lado i", "Direta"],
    ["Lado j", "Invertida"],
  ]) {
    await station.selectOption({ label: `0,33333 · ${label}` });
    await expect(env.getByRole("row", { name: /Máximo/ })).toContainText(
      governing,
    );
  }
  const marker = view.locator(".envelope-max-line circle");
  for (const side of ["i", "j"]) {
    const label = `0,33333 · Lado ${side}`;
    await station.selectOption({ label });
    const bounds = await marker.boundingBox();
    await station.selectOption({
      label: `0,33333 · Lado ${side === "i" ? "j" : "i"}`,
    });
    await page.mouse.click(
      bounds!.x + bounds!.width / 2,
      bounds!.y + bounds!.height / 2,
    );
    await expect(station.locator("option:checked")).toHaveText(label);
  }
  const csvDownload = page.waitForEvent("download");
  await env.getByRole("button", { name: "CSV" }).click();
  const csv = await readFile((await (await csvDownload).path())!, "utf8");
  const extremes = csv
    .split("\n")
    .filter((row) => row.includes(`;"V1";${1 / 3};"V";"Máximo";`));
  expect(extremes).toHaveLength(2);
  expect(extremes[0]).toContain(';"Direta";"POS";');
  expect(extremes[0]).toMatch(/;"Lado i"$/);
  expect(extremes[1]).toContain(';"Invertida";"NEG";');
  expect(extremes[1]).toMatch(/;"Lado j"$/);
});
