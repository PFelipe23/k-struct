import { expect, type Page } from "@playwright/test";

export async function openProjectInBrowser(
  page: Page,
  name: string,
  source: string,
) {
  const picker = page.locator('input[type="file"][accept=".json"]');
  await picker.setInputFiles({
    name,
    mimeType: "application/json",
    buffer: Buffer.from(source),
  });
  // The handler clears the picker after File.text() and project replacement.
  // The rendered undo button confirms the editor has reset its history.
  await expect(picker).toHaveValue("");
  await expect(
    page.getByRole("button", { name: "Desfazer", exact: true }),
  ).toBeDisabled();
}
