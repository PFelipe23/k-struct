import { expect, test } from "@playwright/test";
import { readFileSync } from "node:fs";
import { serializeProject } from "../../src/domain/model";
import { exportOofem } from "../../src/solver/oofem";
import { runDeck } from "../fixtures/solve-oofem";
import { twoSpanBeam } from "../fixtures/two-span-beam";

test("valores i/j dos diagramas acompanham forças e momentos sem mover o desenho", async ({
  page,
}) => {
  test.setTimeout(60_000);
  const project = twoSpanBeam();
  const { deck } = exportOofem(project, project.analysisCases[0].id);
  // Replace only native IPC with real OOFEM output, generated here or captured
  // from this same benchmark. The application still parses and validates it.
  const output = process.env.OOFEM_BIN
    ? runDeck(deck, process.env.OOFEM_BIN)
    : readFileSync(
        new URL("../fixtures/two-span-beam-oofem.txt", import.meta.url),
        "utf8",
      );
  await page.addInitScript(
    ({ deck, output }) => {
      let callback = 0;
      Object.assign(window, {
        isTauri: true,
        __TAURI_INTERNALS__: {
          transformCallback: () => ++callback,
          invoke: async (
            command: string,
            args: {
              deck: string;
              runContext: Record<string, string>;
              response: { onmessage: (payload: unknown) => void };
            },
          ) => {
            if (command !== "start_oofem" || args.deck !== deck)
              throw new Error("Entrada OOFEM divergente.");
            args.response.onmessage({
              output,
              historyError: null,
              log: {
                summary: {
                  ...args.runContext,
                  status: "completed",
                  message: "OOFEM concluído.",
                },
              },
            });
          },
        },
      });
    },
    { deck, output },
  );
  await page.goto("/");
  await page.locator("input[type=file]").setInputFiles({
    name: "viga-dois-vaos.kstruct.json",
    mimeType: "application/json",
    buffer: Buffer.from(serializeProject(project)),
  });
  await expect(page.locator(".model-count")).toHaveText("3 nós · 2 barras");
  await page.getByRole("button", { name: "Analisar", exact: true }).click();
  await expect(page.getByRole("status")).toContainText("Análise concluída");
  await page
    .locator(".explorer")
    .getByRole("button", { name: "B1", exact: true })
    .click();
  await page.getByRole("button", { name: "Exibição", exact: true }).click();
  await page.getByRole("button", { name: "Eixos locais", exact: true }).click();
  const display = page.getByRole("combobox", {
    name: "Visualização dos resultados",
    exact: true,
  });
  await display.selectOption("v");
  const elevation = page.getByRole("region", {
    name: "Elevação XZ",
    exact: true,
  });
  await expect(
    elevation.getByRole("img", { name: "B1, i, V 24,375 kN", exact: true }),
  ).toBeVisible();
  await expect(
    elevation.getByRole("img", { name: "B1, j, V -35,625 kN", exact: true }),
  ).toBeVisible();
  const diagram = elevation
    .locator('line[data-member-id="V1"]')
    .locator("..")
    .locator("polygon")
    .first();
  const points = (await diagram.getAttribute("points"))!;
  await page.getByRole("button", { name: "Unidades", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "Unidades", exact: true });
  await dialog
    .getByRole("combobox", { name: "Forças", exact: true })
    .selectOption("N");
  await dialog
    .getByRole("combobox", { name: "Momentos", exact: true })
    .selectOption("N·m");
  await dialog
    .getByRole("button", { name: "Aplicar unidades", exact: true })
    .click();
  for (const [end, value] of [
    ["i", "24.375"],
    ["j", "-35.625"],
  ]) {
    const label = elevation.getByRole("img", {
      name: `B1, ${end}, V ${value} N`,
      exact: true,
    });
    await expect(label).toBeVisible();
    await expect(label).toContainText(`${end} · ${value} N`);
  }
  await expect(diagram).toHaveAttribute("points", points);
  await display.selectOption("m");
  const moment = elevation.getByRole("img", {
    name: "B1, j, M -33.750 N·m",
    exact: true,
  });
  await expect(moment).toBeVisible();
  await expect(moment).toContainText("j · -33.750 N·m");
  await expect(page.getByRole("status")).toContainText("Análise concluída");
  await expect(
    page.getByRole("button", { name: "Desfazer", exact: true }),
  ).toBeDisabled();
});
