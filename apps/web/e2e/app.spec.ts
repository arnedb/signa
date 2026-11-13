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

test("practise a lesson with the keyboard and repeat the missed words", async ({ page, isMobile }) => {
  test.skip(isMobile, "keyboard flow");
  await login(page, "student", "demo-student");
  await expect(page.getByRole("heading", { name: "Oefenen" })).toBeVisible();
  await page.getByLabel("Les", { exact: true }).selectOption("1");
  // A fixed direction: the default ("mixed") picks one at random for each word.
  await page.getByText("Gebaar → woord").click();
  await page.getByText("Lesvolgorde").click();
  await page.getByRole("button", { name: "Start (13 woorden)" }).click();

  await expect(page.getByText("1 van 13")).toBeVisible();
  // The answers are saved when the round is done; wait for that before opening the difficult words.
  const saved = page.waitForResponse((r) => r.url().endsWith("/api/v1/me/results") && r.request().method() === "POST");
  for (let i = 0; i < 13; i++) {
    await page.keyboard.press("Space");
    await expect(page.getByRole("button", { name: "Kende ik", exact: true })).toBeVisible();
    await page.keyboard.press(i < 2 ? "ArrowLeft" : "ArrowRight");
  }
  await expect(page.getByRole("heading", { name: "Klaar!" })).toBeVisible();
  await expect(page.getByText("Je kende 11 van de 13 woorden.")).toBeVisible();
  expect((await saved).ok()).toBe(true);
  await page.getByRole("button", { name: "Herhaal de 2 gemiste" }).click();
  await expect(page.getByText("Ronde 2 · 1 van 2")).toBeVisible();

  await page.goto("/difficult");
  await expect(page.getByRole("link", { name: /hallo/ })).toBeVisible();
  await expect(page.getByRole("link", { name: /goedemorgen/ })).toBeVisible();
  // Only the direction that was practised is difficult.
  await expect(page.getByRole("link", { name: /hallo/ })).toContainText("Gebaar → woord");
  await expect(page.getByRole("link", { name: /hallo/ })).not.toContainText("Woord → gebaar");
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

test("a student joins a second school with the same account and switches between them", async ({ page }, info) => {
  const name = `jan-${info.project.name}-${Date.now() % 100000}`;
  await page.goto("/join/demo");
  await page.getByLabel("Gebruikersnaam").fill(name);
  await page.getByLabel("Wachtwoord", { exact: true }).fill("geheim-wachtwoord");
  await page.getByLabel("Herhaal wachtwoord").fill("geheim-wachtwoord");
  await page.getByRole("button", { name: "Account maken" }).click();
  await page.getByRole("button", { name: "Ik heb de code bewaard" }).click();
  // With one school and one group there is nothing to switch.
  await expect(page.getByRole("link", { name: /Wissel van school/ })).toHaveCount(0);

  await page.goto("/join/demo-2");
  await expect(page.getByText(`Je bent aangemeld als ${name}.`)).toBeVisible();
  await expect(page.getByText("Tweede school · Vlaamse Gebarentaal")).toBeVisible();
  await page.getByRole("button", { name: "Lid worden met deze account" }).click();
  await expect(page.getByRole("heading", { name: "Oefenen" })).toBeVisible();
  const switcher = page.getByRole("link", { name: "Wissel van school: Tweede school" });
  await expect(switcher).toBeVisible();

  // Each school has its own words.
  await page.goto("/dictionary");
  await page.getByLabel("Zoek een woord").fill("welkom");
  await expect(page.getByText("1 woord")).toBeVisible();
  await page.getByLabel("Zoek een woord").fill("huis");
  await expect(page.getByText("Geen woorden gevonden.")).toBeVisible();

  await switcher.click();
  await expect(page.getByRole("heading", { name: "Kies je school" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Tweede school · Jaar 1 · zaterdag" })).toHaveAttribute(
    "aria-current",
    "true",
  );
  await page.getByRole("button", { name: "Demoschool · Jaar 1 · dinsdag" }).click();
  await expect(page.getByRole("heading", { name: "Oefenen" })).toBeVisible();
  await expect(page.getByRole("link", { name: "Wissel van school: Demoschool" })).toBeVisible();
  await page.goto("/dictionary");
  await page.getByLabel("Zoek een woord").fill("huis");
  await expect(page.getByText("1 woord")).toBeVisible();

  // The last school chosen is chosen again after logging in.
  await page.getByRole("button", { name: "Afmelden" }).click();
  await login(page, name, "geheim-wachtwoord");
  await expect(page.getByRole("link", { name: "Wissel van school: Demoschool" })).toBeVisible();
});

test("a superadmin creates a school with its first admin", async ({ page }, info) => {
  const school = `School ${info.project.name} ${Date.now() % 100000}`;
  await login(page, "admin", "demo-admin");
  await page.goto("/admin/schools");
  await page.getByRole("button", { name: "Nieuwe school" }).click();
  const dialog = page.getByRole("dialog");
  await dialog.getByLabel("Naam", { exact: true }).fill(school);
  await dialog.getByLabel("Gebarentaal").selectOption("lsfb");
  await dialog.getByLabel(/Eerste beheerder/).fill(`dir-${Date.now() % 100000}`);
  await dialog.getByRole("button", { name: "Nieuwe school" }).click();
  await expect(page.getByText(`${school} is aangemaakt.`)).toBeVisible();
  await expect(page.getByRole("row", { name: new RegExp(school) })).toContainText("Langue des signes");
});

test("a student switches the interface to French and back", async ({ page }, info) => {
  const name = `zoe-${info.project.name}-${Date.now() % 100000}`;
  await page.goto("/join/demo");
  await page.getByLabel("Gebruikersnaam").fill(name);
  await page.getByLabel("Wachtwoord", { exact: true }).fill("geheim-wachtwoord");
  await page.getByLabel("Herhaal wachtwoord").fill("geheim-wachtwoord");
  await page.getByRole("button", { name: "Account maken" }).click();
  await page.getByRole("button", { name: "Ik heb de code bewaard" }).click();

  await page.goto("/profile");
  await page.getByLabel("Taal").selectOption("fr");
  await expect(page.getByRole("heading", { name: "Profil" })).toBeVisible();
  await expect(page.locator("html")).toHaveAttribute("lang", "fr");
  await page.goto("/");
  await expect(page.getByRole("heading", { name: "S’exercer" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Commencer (13 mots)" })).toBeVisible();

  // The account remembers it, and so does the login page on this device.
  await page.goto("/profile");
  await page.getByRole("button", { name: "Se déconnecter" }).click();
  await expect(page.getByRole("heading", { name: "Se connecter" })).toBeVisible();
  await page.getByLabel("Langue").selectOption("nl");
  await expect(page.getByRole("heading", { name: "Aanmelden" })).toBeVisible();
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
  // The lesson follows the list number.
  await page.getByLabel("Lijst", { exact: true }).fill("9.1");
  await expect(page.getByLabel("Les", { exact: true })).toHaveValue("9");
  // One word per part: Enter moves on to the next part.
  const word = page.getByLabel("Woord", { exact: true });
  await word.fill("boot");
  await word.press("Enter");
  await expect(page.getByRole("region", { name: "Fragment 2" })).toBeVisible();
  await page.getByLabel("Woord", { exact: true }).fill("huis");
  await expect(page.getByText(/Bestaat al in Lijst 2\.1/)).toBeVisible();
  await page.getByLabel("Woord", { exact: true }).press("Enter");
  await page.getByLabel("Woord", { exact: true }).fill("trein");
  const labelled = page.getByRole("list", { name: "Fragmenten" });
  await expect(labelled).toContainText("boot");
  await expect(labelled).toContainText("huis");
  await expect(labelled).toContainText("trein");
  await page.getByRole("button", { name: "3 video's maken" }).click();
  await expect(page.getByText(/De video's worden gemaakt/)).toBeVisible();

  await page.goto("/admin?year=1&list=9.1");
  for (const gloss of ["boot", "huis", "trein"]) {
    await expect(page.getByRole("link", { name: gloss, exact: true })).toBeVisible();
  }
});
