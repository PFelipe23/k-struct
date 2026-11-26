import { test, expect, type Page } from "@playwright/test";
import { readFileSync } from "node:fs";
import { readFile } from "node:fs/promises";
import {
  beamExample,
  parseProject,
  serializeProject,
} from "../../src/domain/model";
import { twoSpanBeam } from "../fixtures/two-span-beam";

// Only the IPC boundary is substituted. This is a captured result from the real
// OOFEM benchmark, not an alternative solver or a fallback in the application.
const output = readFileSync(
  new URL("../fixtures/beam-oofem.txt", import.meta.url),
  "utf8",
);
async function bridge(
  page: Page,
  { delayed = false, solverOutput = output } = {},
) {
  await page.addInitScript(
    ({ output, delayed }) => {
      type InvokeArgs = {
        runContext: { runId: string; projectName: string; caseName: string };
        runId: string;
        response: { onmessage: (outcome: unknown) => void };
      };
      const w = window as unknown as {
        isTauri: boolean;
        __TAURI_INTERNALS__: {
          invoke: (cmd: string, args: InvokeArgs) => Promise<unknown>;
          transformCallback: () => number;
        };
        finishAnalysis?: () => void;
      };
      const engine = {
        origin: "bundled",
        path: "/kstruct/oofem/oofem",
        version: "3.0",
        commit: "214b161",
        sha256: "checksum",
      };
      let callbackId = 0;
      let pending: {
        runId: string;
        finish: (cancelled: boolean) => void;
      } | null = null;
      const records = () =>
        JSON.parse(sessionStorage.getItem("e2e-native-runs") ?? "[]") as Array<{
          summary: { runId: string };
          stdout: string;
        }>;
      w.isTauri = true;
      w.__TAURI_INTERNALS__ = {
        transformCallback: () => ++callbackId,
        invoke: async (cmd, args) => {
          if (cmd === "start_oofem") {
            const finish = (cancelled: boolean) => {
              const log = {
                summary: {
                  ...args.runContext,
                  startedAt: Date.now(),
                  durationMs: 123,
                  engine,
                  status: cancelled ? "cancelled" : "completed",
                  message: cancelled
                    ? "Análise cancelada."
                    : "Execução do OOFEM concluída.",
                },
                stdout: "Saída do OOFEM para a viga de referência",
                stderr: "",
                logTruncated: false,
              };
              sessionStorage.setItem(
                "e2e-native-runs",
                JSON.stringify([log, ...records()]),
              );
              pending = null;
              args.response.onmessage({
                output: cancelled ? null : output,
                log,
                historyError: null,
              });
            };
            if (delayed) {
              pending = { runId: args.runContext.runId, finish };
              w.finishAnalysis = () => finish(false);
            } else finish(false);
            return;
          }
          if (cmd === "cancel_oofem" && pending?.runId === args.runId) {
            const { finish } = pending;
            setTimeout(() => finish(true), 80);
            return true;
          }
          if (cmd === "list_oofem_runs")
            return records().map((log) => log.summary);
          if (cmd === "read_oofem_log")
            return records().find((log) => log.summary.runId === args.runId);
          if (cmd === "diagnose_oofem")
            return {
              ok: true,
              message: "A viga de referência reproduziu os valores esperados.",
              engine,
              benchmark: {
                leftReactionN: 30000,
                rightReactionN: 30000,
                midspanUzM: -0.0084375,
              },
              stdout: "",
              stderr: "",
            };
          throw new Error(`Unexpected test IPC: ${cmd}`);
        },
      };
    },
    { output: solverOutput, delayed },
  );
}

test("cancelar ou repetir um lote preserva as reações e o histórico", async ({
  page,
}) => {
  await bridge(page);
  await page.goto("/");
  const button = (name: string) =>
    page.getByRole("button", { name, exact: true });
  await page.getByRole("button", { name: /Viga de referência/ }).click();
  await button("Analisar").click();
  await expect(page.getByRole("status")).toContainText("Análise concluída");
  await button("Reações").click();
  const cells = page.getByRole("cell", { name: "30", exact: true });
  const explorer = page.locator(".explorer");
  await explorer.getByRole("button", { name: /^N1/ }).click();
  await explorer
    .getByRole("button", { name: /^N2/ })
    .click({ modifiers: ["Control"] });
  const batch = page.getByRole("region", { name: "Atribuição em lote" });
  await batch.getByLabel("Lote Força Z").fill("inválido");
  await expect(button("Aplicar lote")).toBeDisabled();
  await batch.getByRole("button", { name: "Cancelar" }).click();
  await expect(cells).toHaveCount(2);
  await batch.getByLabel("Apoio em lote uz").selectOption("restrict");
  await button("Aplicar lote").click();
  await expect(batch).toContainText("Nenhuma alteração efetiva");
  await expect(button("Desfazer")).toBeDisabled();
  await expect(cells).toHaveCount(2);
  await batch.getByLabel("Apoio em lote ry").selectOption("restrict");
  await button("Aplicar lote").click();
  await expect(button("Desfazer")).toBeEnabled();
  await expect(cells).toHaveCount(0);
});

test("resultados calculados são apresentados e invalidados após edição", async ({
  page,
}) => {
  await bridge(page);
  await page.goto("/");
  await page.getByRole("button", { name: /Viga de referência/ }).click();
  await page.getByRole("button", { name: "Analisar", exact: true }).click();
  await expect(page.getByRole("status")).toContainText("Análise concluída");
  await expect(page.getByLabel("Visualização dos resultados")).toHaveValue("m");
  await page.getByRole("button", { name: "Reações", exact: true }).click();
  await expect(
    page.getByRole("columnheader", { name: "RZ global (kN)" }),
  ).toBeVisible();
  await expect(
    page.getByRole("columnheader", { name: "RZ local (kN)" }),
  ).toHaveCount(0);
  await expect(page.getByRole("cell", { name: "30", exact: true })).toHaveCount(
    2,
  );
  await page.getByRole("button", { name: "Esforços", exact: true }).click();
  await expect(page.getByRole("cell", { name: "45", exact: true })).toHaveCount(
    1,
  );
  await page
    .getByRole("button", { name: "Deslocamentos", exact: true })
    .click();
  await expect(
    page.getByRole("cell", { name: "-8,4375", exact: true }),
  ).toHaveCount(1);
  await page.screenshot({
    path: "test-results/kstruct-analysis.png",
    fullPage: true,
  });
  await page.getByLabel("Visualização dos resultados").selectOption("deformed");
  await expect(page.locator(".elevation polyline")).toHaveCount(1);
  await page
    .locator(".explorer")
    .getByRole("button", { name: "B1", exact: true })
    .click();
  await page.getByLabel("qZ global").fill("-20");
  await page.getByLabel("qZ global").press("Tab");
  await expect(page.getByLabel("Visualização dos resultados")).toHaveValue(
    "model",
  );
  await expect(page.getByRole("cell", { name: "45", exact: true })).toHaveCount(
    0,
  );
});

test("a tabela bloqueia o colapso da barra e aceita trocar os extremos em um lote", async ({
  page,
}) => {
  await bridge(page);
  await page.goto("/");
  const button = (name: string) =>
    page.getByRole("button", { name, exact: true });
  await page.getByRole("button", { name: /Viga de referência/ }).click();
  await button("Analisar").click();
  const display = page.getByLabel("Visualização dos resultados");
  await expect(display).toHaveValue("m");
  const dialog = page.getByRole("dialog", { name: "Tabela de nós" });
  const x1 = dialog.getByLabel("X de N1", { exact: true });
  const x2 = dialog.getByLabel("X de N2", { exact: true });
  const apply = dialog.getByRole("button", { name: "Aplicar", exact: true });
  const open = button("Tabela de nós");
  await open.click();
  await x2.fill("0");
  await expect(x2).toHaveAttribute("aria-invalid", "true");
  await expect(x2).toHaveAccessibleDescription(/B1.*V1.*comprimento nulo/);
  await expect(x1).toHaveAttribute("aria-invalid", "false");
  await expect(apply).toBeDisabled();
  await x2.press("Enter");
  await expect(dialog).toBeVisible();
  await dialog.getByRole("button", { name: "Cancelar" }).click();
  await expect(display).toHaveValue("m");
  await expect(button("Desfazer")).toBeDisabled();

  await open.click();
  await expect(x2).toHaveValue("6");
  await x2.fill("0");
  await expect(apply).toBeDisabled();
  await x1.fill("6");
  await expect(dialog.getByRole("alert")).toHaveCount(0);
  await expect(apply).toBeEnabled();
  await apply.click();
  await expect(display).toHaveValue("model");

  const positions = () =>
    page.evaluate(() =>
      JSON.parse(localStorage.getItem("kstruct.draft.v21")!).nodes.map(
        (n: { id: string; x: number }) => [n.id, n.x],
      ),
    );
  await expect.poll(positions).toEqual([
    ["A", 6],
    ["B", 0],
  ]);
  await button("Desfazer").click();
  await expect.poll(positions).toEqual([
    ["A", 0],
    ["B", 6],
  ]);
  await expect(button("Desfazer")).toBeDisabled();
  await button("Refazer").click();
  await expect.poll(positions).toEqual([
    ["A", 6],
    ["B", 0],
  ]);
});

test("tabela plana valida, cancela e aplica coordenadas em um único passo", async ({
  page,
}) => {
  test.setTimeout(60_000);
  await bridge(page);
  await page.goto("/");
  const button = (name: string) =>
    page.getByRole("button", { name, exact: true });
  await page.getByRole("button", { name: /Viga de referência/ }).click();
  await button("Analisar").click();
  const display = page.getByLabel("Visualização dos resultados");
  await expect(display).toHaveValue("m");

  const beam = page
    .getByRole("application", { name: "Área de lançamento XZ" })
    .locator("line[data-member-id]");
  const beamSpan = () =>
    beam.evaluate((line) => ({
      x: Number(line.getAttribute("x2")) - Number(line.getAttribute("x1")),
      z: Number(line.getAttribute("y1")) - Number(line.getAttribute("y2")),
    }));
  const originalSpan = await beamSpan();
  const dialog = page.getByRole("dialog", { name: "Tabela de nós" });
  const apply = dialog.getByRole("button", { name: "Aplicar", exact: true });
  const x1 = dialog.getByLabel("X de N1", { exact: true });
  const z2 = dialog.getByLabel("Z de N2", { exact: true });
  await button("Tabela de nós").click();
  await expect(dialog.getByRole("columnheader")).toHaveText([
    "Nó",
    "X (m)",
    "Z (m)",
  ]);
  await x1.fill("0,0");
  await apply.click();
  await expect(dialog).toHaveCount(0);
  await expect(display).toHaveValue("m");
  await expect(button("Desfazer")).toBeDisabled();

  await button("Tabela de nós").click();
  await x1.fill("-1,25");
  await z2.fill("");
  await apply.click();
  await expect(x1).toHaveValue("-1,25");
  await expect(x1).toHaveAttribute("aria-invalid", "false");
  await expect(z2).toBeFocused();
  await expect(z2).toHaveAttribute("aria-invalid", "true");
  await expect(z2).toHaveAccessibleDescription("Preencha a coordenada.");
  await z2.fill("1e999");
  await apply.click();
  await expect(z2).toHaveAccessibleDescription("Informe um número finito.");
  await dialog.getByRole("button", { name: "Cancelar", exact: true }).click();
  await expect.poll(beamSpan).toEqual(originalSpan);
  await expect(display).toHaveValue("m");
  await expect(button("Desfazer")).toBeDisabled();

  await button("Tabela de nós").click();
  await expect(x1).toHaveValue("0");
  await expect(z2).toHaveValue("0");
  await x1.fill("-1,25");
  await z2.fill("2.5");
  await apply.click();
  await expect(display).toHaveValue("model");
  await expect(page.getByRole("status")).toContainText("Clique em Analisar");
  const editedSpan = await beamSpan();
  expect(editedSpan.x).toBeGreaterThan(originalSpan.x);
  expect(editedSpan.z).toBeGreaterThan(originalSpan.z);
  await button("Desfazer").click();
  await expect.poll(beamSpan).toEqual(originalSpan);
  await expect(button("Desfazer")).toBeDisabled();
  await button("Refazer").click();
  await expect.poll(beamSpan).toEqual(editedSpan);

  await page.evaluate(() => Object.assign(window, { isTauri: false }));
  const download = page.waitForEvent("download");
  await button("Salvar projeto").click();
  const path = (await (await download).path())!;
  const saved = parseProject(await readFile(path, "utf8"));
  expect(saved.nodes).toMatchObject([
    { id: "A", x: -1.25, y: 0, z: 0 },
    { id: "B", x: 6, y: 0, z: 2.5 },
  ]);
  expect(saved.members).toEqual(beamExample().members);
  await button("Novo projeto").click();
  await page
    .getByRole("dialog", { name: "Novo projeto" })
    .getByRole("button", { name: "Criar projeto", exact: true })
    .click();
  await page.locator('input[type="file"]').setInputFiles(path);
  await button("Tabela de nós").click();
  await expect(x1).toHaveValue("-1.25");
  await expect(z2).toHaveValue("2.5");
});

test("tema alterna pelo teclado, preserva as vistas e retorna após recarregar", async ({
  page,
}) => {
  test.setTimeout(60_000);
  await page.setViewportSize({ width: 1100, height: 720 });
  await page.emulateMedia({ colorScheme: "light" });
  await bridge(page);
  await page.goto("/");
  const button = (name: string) =>
    page.getByRole("button", { name, exact: true });
  const root = page.locator("html");
  const meta = page.locator('meta[name="theme-color"]');
  await expect(root).toHaveAttribute("data-theme", "dark");
  await expect(root).toHaveCSS("color-scheme", "dark");
  await expect(meta).toHaveAttribute("content", "#101522");

  await page.getByRole("button", { name: /Viga de referência/ }).click();
  await button("Analisar").click();
  await expect(page.getByRole("status")).toContainText("Análise concluída");
  await page
    .locator(".explorer")
    .getByRole("button", { name: "B1", exact: true })
    .click();
  const display = page.getByLabel("Visualização dos resultados");
  await display.selectOption("deformed");
  await button("Aumentar zoom").click();
  const drawing = page.getByRole("application", {
    name: "Área de lançamento XZ",
  });
  const deformation = drawing.locator("polyline");
  const points = (await deformation.getAttribute("points"))!;
  await expect(deformation).toHaveCSS("stroke", "rgb(103, 214, 192)");

  const canvas = page.locator(".three-container canvas");
  const initialCamera = await canvas.screenshot();
  const bounds = (await canvas.boundingBox())!;
  await page.mouse.move(
    bounds.x + bounds.width / 2,
    bounds.y + bounds.height / 2,
  );
  await page.mouse.down();
  await page.mouse.move(
    bounds.x + bounds.width * 0.7,
    bounds.y + bounds.height * 0.4,
    { steps: 5 },
  );
  await page.mouse.up();
  const darkScene = await canvas.screenshot();
  expect(darkScene.equals(initialCamera)).toBe(false);

  const theme = page.getByRole("combobox", { name: "Tema", exact: true });
  await button("Exibição").press("Enter");
  await page.keyboard.press("Tab");
  await expect(
    page.getByRole("button", {
      name: "Explorador",
      exact: true,
      pressed: true,
    }),
  ).toBeFocused();
  await page.keyboard.press("Tab");
  const properties = button("Propriedades");
  await expect(properties).toBeFocused();
  const caption = page.getByText("ÁREA DE TRABALHO", { exact: true });
  const focusBottom = await properties.evaluate((element) => {
    const style = getComputedStyle(element);
    return (
      element.getBoundingClientRect().bottom +
      parseFloat(style.outlineOffset) +
      parseFloat(style.outlineWidth)
    );
  });
  expect(focusBottom).toBeLessThanOrEqual((await caption.boundingBox())!.y);
  await properties.press("Space");
  await expect(properties).toHaveAttribute("aria-pressed", "false");
  await properties.press("Space");
  await expect(properties).toHaveAttribute("aria-pressed", "true");
  await page.keyboard.press("Tab");
  await page.keyboard.press("Tab");
  await expect(theme).toBeFocused();
  await expect(theme).toHaveCSS("outline-style", "solid");
  await expect(theme).toHaveValue("dark");
  await page.keyboard.press("End");
  await expect(theme).toHaveValue("light");
  await expect(theme).toBeInViewport();
  await expect(theme).toHaveCSS("outline-color", "rgb(96, 51, 152)");
  await expect(button("Analisar")).toBeInViewport();
  await expect(root).toHaveCSS("color-scheme", "light");
  await expect(meta).toHaveAttribute("content", "#eff3f8");
  await expect(page.locator(".viewport.elevation")).toHaveCSS(
    "background-color",
    "rgb(245, 248, 252)",
  );
  await expect(deformation).toHaveCSS("stroke", "rgb(0, 105, 95)");
  await expect(deformation).toHaveAttribute("points", points);
  await expect(
    page.getByRole("heading", { name: "B1", exact: true }),
  ).toBeVisible();
  await expect(display).toHaveValue("deformed");

  const lightScene = await canvas.screenshot();
  const backgroundPixel = await page.evaluate(async (data) => {
    const response = await fetch(`data:image/png;base64,${data}`);
    const image = await createImageBitmap(await response.blob());
    const context = new OffscreenCanvas(image.width, image.height).getContext(
      "2d",
    )!;
    context.drawImage(image, 0, 0);
    image.close();
    return Array.from(context.getImageData(4, 4, 1, 1).data);
  }, lightScene.toString("base64"));
  expect(backgroundPixel).toEqual([237, 243, 250, 255]);
  await page.keyboard.press("Home");
  await expect(theme).toHaveValue("dark");
  await expect(root).toHaveCSS("color-scheme", "dark");
  expect((await canvas.screenshot()).equals(darkScene)).toBe(true);

  await page.keyboard.press("End");
  await expect(theme).toHaveValue("light");
  await page.reload();
  await expect(root).toHaveAttribute("data-theme", "light");
  await expect(root).toHaveCSS("color-scheme", "light");
  await button("Exibição").click();
  await expect(theme).toHaveValue("light");

  await page.evaluate(() => localStorage.setItem("kstruct.theme", "inválido"));
  await page.reload();
  await expect(root).toHaveAttribute("data-theme", "dark");
});

test("combinação linear lista casos pendentes, consulta resultados e preserva a composição", async ({
  page,
}) => {
  test.setTimeout(60_000);
  await bridge(page);
  await page.goto("/");
  const button = (name: string) =>
    page.getByRole("button", { name, exact: true });
  await page.getByRole("button", { name: /Viga de referência/ }).click();
  await button("Cargas e casos").click();
  const editor = page.getByRole("dialog", {
    name: "Padrões, casos, combinações e envelopes",
  });
  const editButton = (name: string) =>
    editor.getByRole("button", { name, exact: true });
  await editButton("Casos estáticos").click();
  await editor.getByLabel("Nome do caso").fill("Permanente");
  await editButton("Novo caso").click();
  await editor.getByLabel("Nome do caso").fill("Variável");
  const secondary = await editor.getByLabel("Caso para editar").inputValue();
  await editButton("Combinações lineares").click();
  await editButton("Nova combinação").click();
  await editor.getByLabel("Nome da combinação").fill("Composição 1");
  await editor.getByLabel("Caso da parcela 1").selectOption("EL");
  await editButton("Adicionar parcela").click();
  await editor.getByLabel("Fator da parcela 1").fill("1,8");
  await editor.getByLabel("Fator da parcela 2").fill("-0,3");
  const combinationId = await editor
    .getByLabel("Combinação para editar")
    .inputValue();
  await editButton("Aplicar definições").click();

  const picker = page.getByLabel("Caso, combinação ou envelope", {
    exact: true,
  });
  const combo = `combination:${combinationId}`;
  const status = page.getByRole("status");
  await expect(picker).toHaveValue(combo);
  await expect(status).toContainText("Permanente, Variável");
  await expect(button("Analisar")).toBeDisabled();
  await picker.selectOption("EL");
  await button("Analisar").click();
  await expect(status).toContainText("Análise concluída · Permanente");
  await picker.selectOption(combo);
  await expect(status).toContainText(
    /Analise os casos pendentes.*\s+Variável$/,
  );
  await picker.selectOption(secondary);
  await button("Analisar").click();
  await expect(status).toContainText("Análise concluída · Variável");
  await picker.selectOption(combo);
  await expect(status).toContainText("1,8 × Permanente − 0,3 × Variável");
  await expect(page.getByLabel("Visualização dos resultados")).toHaveValue("m");
  await expect(page.locator(".elevation polygon")).toHaveCount(1);
  await expect(button("Saída OOFEM")).toHaveCount(0);
  await button("Esforços").click();
  await expect(
    page.getByRole("cell", { name: "67,5", exact: true }),
  ).toHaveCount(1);

  await page.evaluate(() => Object.assign(window, { isTauri: false }));
  const csvDownload = page.waitForEvent("download");
  await button("CSV").click();
  const csv = await readFile((await (await csvDownload).path())!, "utf8");
  expect(csv).toContain(
    '"Combinação";"ID da combinação";"Parcelas (ID do caso e fator)"',
  );
  expect(csv).toContain(`67.5;"Composição 1";"${combinationId}"`);
  expect(csv).toContain('""caseId"":""EL"",""factor"":1.8');

  const projectDownload = page.waitForEvent("download");
  await button("Salvar projeto").click();
  const file = (await (await projectDownload).path())!;
  const model = parseProject(await readFile(file, "utf8"));
  expect(model.resultCombinations).toEqual([
    {
      id: combinationId,
      name: "Composição 1",
      type: "linear",
      factors: [
        { caseId: "EL", factor: 1.8 },
        { caseId: secondary, factor: -0.3 },
      ],
    },
  ]);

  await button("Cargas e casos").click();
  await editButton("Casos estáticos").click();
  await editor.getByLabel("Caso para editar").selectOption(secondary);
  await editButton("Excluir caso").click();
  await expect(editor.getByRole("alert")).toContainText(
    "O caso está em uso nas combinações Composição 1",
  );
  await editButton("Combinações lineares").click();
  await editor.getByLabel("Fator da parcela 1").fill("2");
  await editButton("Aplicar definições").click();
  await expect(page.getByRole("table")).toHaveCount(0);
  await expect(page.getByLabel("Visualização dos resultados")).toHaveValue(
    "model",
  );

  await page.locator('input[type="file"]').setInputFiles(file);
  await expect(picker).toHaveValue("EL");
  await picker.selectOption(combo);
  await button("Mensagens").click();
  await expect(status).toContainText("1,8 × Permanente − 0,3 × Variável");
  await expect(status).toContainText("Permanente, Variável");
});

test("filtro de esforços acompanha caso e combinação e limita as linhas do CSV", async ({
  page,
}) => {
  test.setTimeout(60_000);
  const solverOutput = readFileSync(
    new URL("../fixtures/two-span-beam-oofem.txt", import.meta.url),
    "utf8",
  );
  await bridge(page, { solverOutput });
  const project = twoSpanBeam();
  const combination = {
    id: "C1",
    name: "Combinação de teste",
    type: "linear" as const,
    factors: [{ caseId: "EL", factor: 2 }],
  };
  project.resultCombinations = [combination];

  await page.goto("/");
  await page.locator('input[type="file"]').setInputFiles({
    name: "dois-vaos.kstruct.json",
    mimeType: "application/json",
    buffer: Buffer.from(serializeProject(project)),
  });
  const button = (name: string) =>
    page.getByRole("button", { name, exact: true });
  await button("Esforços").click();
  const filter = page.getByRole("combobox", { name: "Barra em Esforços" });
  await expect(filter).toHaveValue("");
  await expect(filter.locator("option")).toHaveText([
    "Todas as barras",
    "B1",
    "B2",
  ]);
  await button("Analisar").click();
  const table = page.getByRole("table");
  const memberCells = table.locator("tbody td:first-child");
  const stationCells = table.locator("tbody td:nth-child(2)");
  await expect(table.getByRole("columnheader")).toHaveText([
    "Barra",
    "x/L",
    "N (kN)",
    "V (kN)",
    "M (kN·m)",
  ]);
  await expect(memberCells).toHaveText(["B1", "B1", "B1", "B2", "B2", "B2"]);

  await filter.selectOption({ label: "B2" });
  await expect(filter).toHaveValue("V2");
  await expect(memberCells).toHaveText(["B2", "B2", "B2"]);
  await expect(stationCells).toHaveText(["0", "0,5", "1"]);
  const middleMoment = table.locator("tbody td:last-child").nth(1);
  await expect(middleMoment).toHaveText("5,625");
  await page.evaluate(() => Object.assign(window, { isTauri: false }));
  const exportCsv = async () => {
    const waiting = page.waitForEvent("download");
    await button("CSV").click();
    const path = (await (await waiting).path())!;
    const [header, ...rows] = (await readFile(path, "utf8")).split("\n");
    expect(rows.map((row) => row.split(";").slice(0, 2))).toEqual([
      ['"B2"', "0"],
      ['"B2"', "0.5"],
      ['"B2"', "1"],
    ]);
    return { header, rows };
  };
  const caseCsv = await exportCsv();
  const columns = '\uFEFF"Barra";"x/L";"N (kN)";"V (kN)";"M (kN·m)"';
  expect(caseCsv.header).toBe(`${columns};"Caso";"ID do caso"`);
  for (const row of caseCsv.rows)
    expect(row).toMatch(/;"EL · Estática linear";"EL"$/);
  expect(caseCsv.rows[1]).toContain(";0.5;0;5.625;5.625;");

  const picker = page.getByLabel("Caso, combinação ou envelope", {
    exact: true,
  });
  await picker.selectOption(`combination:${combination.id}`);
  await expect(filter).toHaveValue("V2");
  await expect(memberCells).toHaveText(["B2", "B2", "B2"]);
  await expect(stationCells).toHaveText(["0", "0,5", "1"]);
  await expect(middleMoment).toHaveText("11,25");
  const combinationCsv = await exportCsv();
  expect(combinationCsv.header).toBe(
    `${columns};"Combinação";"ID da combinação";"Parcelas (ID do caso e fator)"`,
  );
  for (const row of combinationCsv.rows)
    expect(row).toMatch(
      /;"Combinação de teste";"C1";"\[\{""caseId"":""EL"",""factor"":2\}\]"$/,
    );
  expect(combinationCsv.rows[1]).toContain(";0.5;0;11.25;11.25;");

  await picker.selectOption("EL");
  await expect(filter).toHaveValue("V2");
  await expect(memberCells).toHaveText(["B2", "B2", "B2"]);
  await page
    .locator(".explorer")
    .getByRole("button", { name: "B2", exact: true })
    .click();
  await button("Excluir").click();
  await expect(filter).toHaveValue("");
  await expect(filter.locator("option")).toHaveText(["Todas as barras", "B1"]);
  await expect(table).toHaveCount(0);
  await expect(button("CSV")).toHaveCount(0);
  await expect(
    page.getByText("Execute uma análise para consultar os esforços do caso"),
  ).toBeVisible();
  await button("Desfazer").click();
  await expect(filter.locator("option")).toHaveCount(3);
  await expect(filter).toHaveValue("");
});

test("duas barras de mesmo nome continuam identificáveis no filtro, na tabela e no CSV", async ({
  page,
}) => {
  const project = twoSpanBeam();
  for (const member of project.members) member.name = "Viga";
  project.resultCombinations = [
    {
      id: "C1",
      name: "EL em dobro",
      type: "linear",
      factors: [{ caseId: "EL", factor: 2 }],
    },
  ];
  const output = readFileSync(
    new URL("../fixtures/two-span-beam-oofem.txt", import.meta.url),
    "utf8",
  );
  await bridge(page, { solverOutput: output });
  await page.goto("/");
  await page.locator('input[type="file"]').setInputFiles({
    name: "barras-homonimas.kstruct.json",
    mimeType: "application/json",
    buffer: Buffer.from(serializeProject(project)),
  });
  await page.getByRole("button", { name: "Analisar", exact: true }).click();
  await page.getByRole("button", { name: "Esforços", exact: true }).click();
  const filter = page.getByRole("combobox", { name: "Barra em Esforços" });
  await expect(filter.locator("option")).toHaveText([
    "Todas as barras",
    "[V1] Viga",
    "[V2] Viga",
  ]);
  const names = page.getByRole("table").locator("tbody td:first-child");
  await expect(names).toHaveText([
    "[V1] Viga",
    "[V1] Viga",
    "[V1] Viga",
    "[V2] Viga",
    "[V2] Viga",
    "[V2] Viga",
  ]);
  await filter.selectOption({ label: "[V2] Viga" });
  await page.evaluate(() => Object.assign(window, { isTauri: false }));
  for (const source of ["EL", "combination:C1"]) {
    await page
      .getByLabel("Caso, combinação ou envelope", { exact: true })
      .selectOption(source);
    await expect(filter).toHaveValue("V2");
    await expect(names).toHaveText(["[V2] Viga", "[V2] Viga", "[V2] Viga"]);
    const waiting = page.waitForEvent("download");
    await page.getByRole("button", { name: "CSV", exact: true }).click();
    const csv = await readFile((await (await waiting).path())!, "utf8");
    const [header, ...rows] = csv.split("\n");
    expect(header).toContain(
      source === "EL"
        ? '"Caso";"ID do caso"'
        : '"Combinação";"ID da combinação"',
    );
    expect(rows.map((row) => row.split(";").slice(0, 2))).toEqual([
      ['"[V2] Viga"', "0"],
      ['"[V2] Viga"', "0.5"],
      ['"[V2] Viga"', "1"],
    ]);
    expect(rows[1].split(";")[4]).toBe(source === "EL" ? "5.625" : "11.25");
  }
});

test("envelope consulta os dois extremos por estação e exporta as combinações governantes", async ({
  page,
}) => {
  test.setTimeout(60_000);
  await bridge(page);
  await page.goto("/");
  const button = (name: string) =>
    page.getByRole("button", { name, exact: true });
  const project = beamExample();
  project.resultCombinations = [
    {
      id: "POS",
      name: "Flexão positiva",
      type: "linear",
      factors: [{ caseId: "EL", factor: 1 }],
    },
    {
      id: "NEG",
      name: "Flexão negativa",
      type: "linear",
      factors: [{ caseId: "EL", factor: -2 }],
    },
    {
      id: "OUT",
      name: "Outra combinação",
      type: "linear",
      factors: [{ caseId: "EL", factor: 10 }],
    },
  ];
  const input = page.locator('input[type="file"]');
  await input.setInputFiles({
    name: "viga.kstruct.json",
    mimeType: "application/json",
    buffer: Buffer.from(serializeProject(project)),
  });
  await expect(page.locator(".model-count")).toHaveText("2 nós · 1 barras");
  await button("Cargas e casos").click();
  const editor = page.getByRole("dialog", {
    name: "Padrões, casos, combinações e envelopes",
  });
  const editButton = (name: string) =>
    editor.getByRole("button", { name, exact: true });
  await editButton("Envelopes").click();
  await editButton("Novo envelope").click();
  await editor.getByLabel("Nome do envelope").fill("Envelope de projeto");
  await editButton("Aplicar definições").click();
  await expect(editor.getByRole("alert")).toContainText(
    "Selecione pelo menos uma combinação",
  );
  await editor.getByRole("checkbox", { name: "Flexão positiva" }).check();
  await editor.getByRole("checkbox", { name: "Flexão negativa" }).check();
  const envelopeId = await editor
    .getByLabel("Envelope para editar")
    .inputValue();
  await editButton("Aplicar definições").click();

  const picker = page.getByLabel("Caso, combinação ou envelope", {
    exact: true,
  });
  const envelopeOption = `envelope:${envelopeId}`;
  const region = page.getByRole("region", { name: "Resultados do envelope" });
  const plot = page.locator(".envelope-plot");
  const table = region.getByRole("table");
  await expect(picker).toHaveValue(envelopeOption);
  await expect(region.getByRole("status")).toContainText(
    "Analise os casos pendentes nesta revisão.",
  );
  await expect(button("Analisar")).toBeDisabled();

  await button("Cargas e casos").click();
  await editButton("Combinações lineares").click();
  await editor.getByLabel("Combinação para editar").selectOption("POS");
  await editButton("Excluir combinação").click();
  await expect(editor.getByRole("alert")).toContainText(
    "A combinação está em uso nos envelopes Envelope de projeto",
  );
  await editButton("Cancelar").click();
  await picker.selectOption("EL");
  await button("Analisar").click();
  await expect(page.getByRole("status")).toContainText("Análise concluída");
  await picker.selectOption(envelopeOption);
  await expect(plot).toHaveCount(1);
  await expect(page.getByLabel("Visualização dos resultados")).toHaveValue("m");
  const middle = await plot
    .locator(".envelope-max-line polyline")
    .evaluate((element) => {
      const line = element as SVGPolylineElement;
      const { x, y } = line.points
        .getItem(4)
        .matrixTransform(line.getScreenCTM()!);
      return { x, y };
    });
  await page.mouse.click(middle.x, middle.y);
  await expect(region.getByLabel("Estação x/L")).toHaveValue("4");
  const maximum = plot.locator(".envelope-max-line polyline");
  const minimum = plot.locator(".envelope-min-line polyline");
  await expect(maximum).toHaveCSS("stroke", "rgb(130, 220, 230)");
  await expect(minimum).toHaveCSS("stroke", "rgb(242, 174, 122)");
  await button("Exibição").click();
  await page
    .getByRole("combobox", { name: "Tema", exact: true })
    .selectOption("light");
  await expect(maximum).toHaveCSS("stroke", "rgb(0, 101, 119)");
  await expect(minimum).toHaveCSS("stroke", "rgb(145, 63, 18)");
  await expect(region.getByLabel("Barra do envelope")).toHaveValue("V1");
  await expect(region.getByLabel("Estação x/L")).toHaveValue("4");
  await expect(picker).toHaveValue(envelopeOption);
  const max = table.getByRole("row", { name: /Máximo/ });
  const min = table.getByRole("row", { name: /Mínimo/ });
  await expect(max).toContainText("Flexão positiva");
  await expect(
    max.getByRole("cell", { name: "45", exact: true }),
  ).toBeVisible();
  await expect(min).toContainText("Flexão negativa");
  await expect(
    min.getByRole("cell", { name: "-90", exact: true }),
  ).toBeVisible();

  await page.evaluate(() => Object.assign(window, { isTauri: false }));
  const csvDownload = page.waitForEvent("download");
  await region.getByRole("button", { name: "CSV", exact: true }).click();
  const csv = await readFile((await (await csvDownload).path())!, "utf8");
  const csvRows = csv.split("\n");
  const maxRow = csvRows.find((row) =>
    row.includes(';0.5;"M";"Máximo";"Flexão positiva";"POS";'),
  );
  const minRow = csvRows.find((row) =>
    row.includes(';0.5;"M";"Mínimo";"Flexão negativa";"NEG";'),
  );
  expect(maxRow).toContain(";45;");
  expect(minRow).toContain(";-90;");
  expect(csv).not.toContain("Outra combinação");

  const projectDownload = page.waitForEvent("download");
  await button("Salvar projeto").click();
  const path = (await (await projectDownload).path())!;
  const saved = parseProject(await readFile(path, "utf8"));
  expect(saved.resultEnvelopes).toEqual([
    {
      id: envelopeId,
      name: "Envelope de projeto",
      combinationIds: ["POS", "NEG"],
    },
  ]);
  await page.getByLabel("qZ global", { exact: true }).fill("-20");
  await page.getByLabel("qZ global", { exact: true }).press("Enter");
  await expect(plot).toHaveCount(0);
  await expect(table).toHaveCount(0);
  await expect(region.getByRole("status")).toContainText(
    "Analise os casos pendentes",
  );

  await input.setInputFiles(path);
  await expect(picker).toHaveValue("EL");
  await picker.selectOption(envelopeOption);
  await expect(region.getByRole("status")).toContainText(
    "Analise os casos pendentes",
  );
});

test("resposta antiga é descartada quando o modelo muda durante a execução", async ({
  page,
}) => {
  await bridge(page, { delayed: true });
  await page.goto("/");
  await page.getByRole("button", { name: /Viga de referência/ }).click();
  await page.getByRole("button", { name: "Analisar", exact: true }).click();
  await expect(page.getByRole("status")).toContainText("em execução");
  await page
    .locator(".explorer")
    .getByRole("button", { name: "B1", exact: true })
    .click();
  await page.getByLabel("qZ global").fill("-20");
  await page.getByLabel("qZ global").press("Tab");
  await page.evaluate(() =>
    (window as unknown as { finishAnalysis: () => void }).finishAnalysis(),
  );
  await expect(page.getByRole("status")).toContainText(
    "mudou durante a análise",
  );
  await expect(page.getByLabel("Visualização dos resultados")).toHaveValue(
    "model",
  );
});

test("cancelamento não publica resultados e o log é recuperado ao reabrir", async ({
  page,
}) => {
  await bridge(page, { delayed: true });
  await page.goto("/");
  await page.getByRole("button", { name: /Viga de referência/ }).click();
  await page.getByRole("button", { name: "Analisar", exact: true }).click();
  await page.getByRole("button", { name: "Cancelar análise" }).click();
  await expect(page.getByRole("status")).toContainText("Análise cancelada.");
  await expect(page.getByLabel("Visualização dos resultados")).toHaveValue(
    "model",
  );
  await page.reload();
  await page.getByRole("button", { name: "Análise", exact: true }).click();
  await page.getByRole("button", { name: "Histórico de análises" }).click();
  const history = page.getByRole("dialog", { name: "Histórico de análises" });
  await expect(
    history.getByRole("heading", { name: "Cancelado" }),
  ).toBeVisible();
  await expect(
    history.getByText("Saída do OOFEM para a viga de referência"),
  ).toBeVisible();
});

test("configurações exibem origem, versão e resultado do diagnóstico", async ({
  page,
}) => {
  await bridge(page);
  await page.goto("/");
  await page
    .getByRole("button", { name: "Configurar OOFEM", exact: true })
    .click();
  const settings = page.getByRole("dialog", { name: "Motor OOFEM" });
  await settings.getByRole("button", { name: "Testar motor" }).click();
  await expect(settings.getByRole("status")).toContainText(
    "Integrado ao KStruct",
  );
  await expect(settings.getByRole("status")).toContainText("OOFEM 3.0");
  await expect(settings.getByRole("status")).toContainText("Flecha -8,4375 mm");
});
