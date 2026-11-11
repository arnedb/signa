import { expect, type Page, test } from "@playwright/test";
import { execFileSync } from "node:child_process";

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

test("a teacher trims a clip and can undo it", async ({ page }, info) => {
  const gloss = info.project.name === "mobile" ? "nee" : "ja";
  await login(page, "docent", "demo-docent");
  await page.goto("/admin");
  await page.getByRole("link", { name: gloss, exact: true }).click();
  await expect(page.getByRole("heading", { name: gloss })).toBeVisible();
  await page.getByRole("button", { name: "Inkorten" }).first().click();
  const dialog = page.getByRole("dialog");
  await expect(dialog.getByText(/nog niets ingekort/)).toBeVisible();
  await dialog.getByRole("textbox", { name: "Begin" }).fill("0,4");
  await dialog.getByRole("textbox", { name: "Einde" }).fill("1.5");
  await dialog.getByRole("textbox", { name: "Einde" }).press("Enter");
  await expect(dialog.getByText(/→ 0:01\.1/)).toBeVisible();
  await dialog.getByRole("button", { name: "Inkorten" }).click();
  await expect(dialog).toBeHidden({ timeout: 20_000 });
  await expect(page.getByText(/video ingekort \(0:00\.4 – 0:01\.5\)/)).toBeVisible();
  await expect(page.getByText("Gearchiveerd", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Ongedaan maken" }).first().click();
  await expect(page.getByText("ongedaan gemaakt: video ingekort")).toBeVisible();
  await expect(page.getByText(/^video ingekort \(/)).toHaveClass(/line-through/);
});

test("a teacher splits a recording and labels the parts as new words", async ({ page, isMobile }, info) => {
  test.skip(isMobile, "one run is enough: it converts a video");
  // Three moving parts with the signer resting in between, and some camera noise.
  const video = info.outputPath("les.mp4");
  const parts = ["[1]trim=duration=1.5,setpts=PTS-STARTPTS,split=4[r0][r1][r2][r3]"];
  for (let i = 0; i < 3; i++) parts.push(`[0]trim=start=${i}:duration=1,setpts=PTS-STARTPTS[m${i}]`);
  parts.push("[r0][m0][r1][m1][r2][m2][r3]concat=n=7:v=1:a=0,noise=alls=20:allf=t[out]");
  execFileSync("ffmpeg", [
    "-hide_banner", "-loglevel", "error", "-y",
    "-f", "lavfi", "-i", "testsrc2=s=320x240:r=30:d=4",
    "-f", "lavfi", "-i", "color=c=gray:s=320x240:r=30:d=2",
    "-filter_complex", parts.join(";"), "-map", "[out]", "-c:v", "libx264", "-pix_fmt", "yuv420p", video,
  ]);

  await login(page, "docent", "demo-docent");
  await page.goto("/admin/recordings");
  await page.getByLabel("Videobestand").setInputFiles(video);
  await page.getByRole("button", { name: "Opname uploaden" }).click();
  const item = page.getByRole("link", { name: /les\.mp4/ }).first();
  await expect(item.getByText(/3 fragmenten/)).toBeVisible({ timeout: 30_000 });
  await item.click();

  await expect(page.getByRole("group", { name: /Tijdlijn/ }).getByRole("button")).toHaveCount(3);
  await page.getByLabel("Lijst", { exact: true }).fill("9.1");
  await page.getByRole("button", { name: "Alle lege fragmenten als nieuw woord" }).click();
  const names = page.getByLabel("Nieuw woord", { exact: true });
  await expect(names).toHaveCount(3);
  await names.nth(0).fill("boot");
  await names.nth(1).fill("huis");
  await names.nth(2).fill("trein");
  await expect(page.getByText("Bestaat al in Lijst 2.1: wordt een extra woord")).toBeVisible();
  await page.getByRole("button", { name: "3 video's maken" }).click();
  await expect(page.getByText(/De video's worden gemaakt/)).toBeVisible();

  await page.goto("/admin?year=1&list=9.1");
  for (const gloss of ["boot", "huis", "trein"]) {
    await expect(page.getByRole("link", { name: gloss, exact: true })).toBeVisible();
  }
});
