import { expect, test } from "@playwright/test";

const ONE_PIXEL_GIF = "R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7";

test.beforeEach(async ({ page }) => {
  await page.goto("/gifselector/");
  await page.getByLabel("Username").fill("admin");
  await page.getByLabel("Password").fill("e2e-password");
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page.getByRole("button", { name: "Log out" })).toBeVisible();
});

test("creates a category", async ({ page }) => {
  const name = `E2E-${Date.now()}`;
  await page.getByRole("button", { name: "Categories" }).click();
  await page.getByLabel("Category name").fill(name);
  await page.getByRole("button", { name: "Add" }).click();
  await expect(page.locator(".category-row-name", { hasText: name })).toBeVisible();
});

test("uploads a gif via drag-and-drop and shows it in the gallery", async ({ page }) => {
  const dataTransfer = await page.evaluateHandle((b64) => {
    const dt = new DataTransfer();
    const binary = atob(b64);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i += 1) {
      bytes[i] = binary.charCodeAt(i);
    }
    dt.items.add(new File([bytes], "e2e.gif", { type: "image/gif" }));
    return dt;
  }, ONE_PIXEL_GIF);

  await page.locator(".app").dispatchEvent("drop", { dataTransfer });

  await expect(page.getByAltText("e2e.gif")).toBeVisible();
});
