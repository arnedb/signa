import { expect, type Page, test } from "@playwright/test";

async function login(page: Page, username: string, password: string) {
  await page.goto("/login");
  await page.getByLabel("Gebruikersnaam").fill(username);
  await page.getByLabel("Wachtwoord").fill(password);
  await page.getByRole("button", { name: "Aanmelden" }).click();
  await expect(page.getByRole("heading", { name: "Oefenen" })).toBeVisible();
}

test("a new student joins with the invite link and gets a recovery code", async ({ page }, info) => {
  const name = `lies-${info.project.name}-${Date.now() % 100000}`;
  await page.goto("/join/demo");
  await expect(page.getByRole("heading", { name: "Word lid van Jaar 1 · dinsdag" })).toBeVisible();
  await page.getByLabel("Gebruikersnaam").fill(name);
  await page.getByLabel("Wachtwoord", { exact: true }).fill("geheim-wachtwoord");
  await page.getByLabel("Herhaal wachtwoord").fill("geheim-wachtwoord");
  await page.getByRole("button", { name: "Account maken" }).click();
  await expect(page.getByRole("heading", { name: "Je herstelcode" })).toBeVisible();
  await expect(page.locator("code")).toHaveText(/^[A-Z0-9]{4}(-[A-Z0-9]{4}){3}$/);
  await page.getByRole("button", { name: "Ik heb de code bewaard" }).click();
  await expect(page.getByRole("heading", { name: "Oefenen" })).toBeVisible();
});

test("practise a list with the keyboard and repeat the missed words", async ({ page, isMobile }) => {
  test.skip(isMobile, "keyboard flow");
  await login(page, "student", "demo-student");
  await expect(page.getByRole("heading", { name: "Oefenen" })).toBeVisible();
  await page.getByLabel("Lijst", { exact: true }).selectOption("1.1");
  await page.getByText("Lesvolgorde").click();
  await page.getByRole("button", { name: "Start (6)" }).click();

  await expect(page.getByText("1 van 6")).toBeVisible();
  for (let i = 0; i < 6; i++) {
    await page.keyboard.press("Space");
    await expect(page.getByRole("button", { name: "Kende ik", exact: true })).toBeVisible();
    await page.keyboard.press(i < 2 ? "ArrowLeft" : "ArrowRight");
  }
  await expect(page.getByRole("heading", { name: "Klaar!" })).toBeVisible();
  await expect(page.getByText("Je kende 4 van de 6 woorden.")).toBeVisible();
  await page.getByRole("button", { name: "Herhaal de 2 gemiste" }).click();
  await expect(page.getByText("Ronde 2 · 1 van 2")).toBeVisible();

  await page.goto("/difficult");
  await expect(page.getByRole("link", { name: /hallo/ })).toBeVisible();
  await expect(page.getByRole("link", { name: /goedemorgen/ })).toBeVisible();
});

test("search the dictionary", async ({ page }) => {
  await login(page, "student", "demo-student");
  await page.goto("/dictionary");
  await page.getByLabel("Zoek een woord").fill("huis");
  await expect(page.getByText("1 woord")).toBeVisible();
  await page.getByRole("link", { name: /huis/ }).click();
  await expect(page.getByRole("heading", { name: "huis" })).toBeVisible();
  const video = page.locator("video").first();
  await expect(video).toHaveJSProperty("muted", true);
  await expect.poll(() => video.evaluate((v: HTMLVideoElement) => v.readyState)).toBeGreaterThan(1);
});

test("students cannot open the admin", async ({ page }) => {
  await login(page, "student", "demo-student");
  await expect(page.getByRole("heading", { name: "Oefenen" })).toBeVisible();
  await page.goto("/admin");
  await expect(page).toHaveURL(/\/$/);
});

test("a teacher adds a word, publishes it and undoes a change", async ({ page }, info) => {
  const gloss = `fiets-${info.project.name}`;
  await login(page, "docent", "demo-docent");
  await page.goto("/admin");
  await page.getByRole("button", { name: "Nieuw woord" }).click();
  const dialog = page.getByRole("dialog");
  await dialog.getByLabel("Woord", { exact: true }).fill(gloss);
  await dialog.getByLabel("Lijst", { exact: true }).fill("3.1");
  await dialog.getByRole("button", { name: "Nieuw woord" }).click();
  await expect(page.getByRole("heading", { name: gloss })).toBeVisible();

  await page.getByLabel("Notities").fill("twee wielen");
  await page.getByRole("button", { name: "Opslaan" }).click();
  await expect(page.getByText(/notities: — → twee wielen/)).toBeVisible();
  await page.getByRole("button", { name: "Publiceren" }).click();
  await expect(page.getByText("Gepubliceerd").first()).toBeVisible();

  await page.getByRole("button", { name: "Ongedaan maken" }).first().click();
  await expect(page.getByText("Concept").first()).toBeVisible();
});

test("a teacher sees groups and the invite link", async ({ page }) => {
  await login(page, "docent", "demo-docent");
  await page.goto("/admin/groups");
  await expect(page.getByRole("link", { name: "Jaar 1 · dinsdag" })).toBeVisible();
  await expect(page.getByText(/\/join\/demo$/)).toBeVisible();
  await page.getByRole("link", { name: "Jaar 1 · dinsdag" }).click();
  await expect(page.getByRole("checkbox", { name: "student", exact: true })).toBeVisible();
});
