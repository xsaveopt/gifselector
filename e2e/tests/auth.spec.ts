import { expect, test } from "@playwright/test";

test.describe("authentication", () => {
  test("rejects invalid credentials", async ({ page }) => {
    await page.goto("/gifselector/");
    await expect(page.getByRole("button", { name: "Sign in" })).toBeVisible();

    await page.getByLabel("Username").fill("admin");
    await page.getByLabel("Password").fill("wrong-password");
    await page.getByRole("button", { name: "Sign in" }).click();

    await expect(page.getByText("Invalid credentials.")).toBeVisible();
  });

  test("logs in and back out", async ({ page }) => {
    await page.goto("/gifselector/");

    await page.getByLabel("Username").fill("admin");
    await page.getByLabel("Password").fill("e2e-password");
    await page.getByRole("button", { name: "Sign in" }).click();

    await expect(page.getByRole("button", { name: "Log out" })).toBeVisible();

    await page.getByRole("button", { name: "Log out" }).click();
    await expect(page.getByRole("button", { name: "Sign in" })).toBeVisible();
  });
});
