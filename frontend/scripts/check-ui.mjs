import fs from "node:fs";
import { createRequire } from "node:module";

const require = createRequire("D:/tmp-brands-check/package.json");
const puppeteer = require("puppeteer-core");

const env = fs.readFileSync(new URL("../../backend/.env", import.meta.url), "utf8");
const password = env.match(/^ADMIN_PASSWORD=(.*)$/m)[1].trim();
const edge = "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe";
const browser = await puppeteer.launch({
  executablePath: edge,
  headless: true,
  args: ["--disable-gpu"],
});
const page = await browser.newPage();
page.setDefaultTimeout(40000);
const report = [];

try {
  await page.setViewport({ width: 1400, height: 900 });
  await page.goto("http://127.0.0.1:5173/", { waitUntil: "domcontentloaded" });
  await page.type("input[autocomplete=username]", "admin");
  await page.type("input[type=password]", password);
  await page.click("button[type=submit]");
  await page.waitForSelector("h2");
  report.push(["heading", await page.$eval("h2", (node) => node.textContent)]);
  await page.waitForFunction(() => document.querySelectorAll("tbody tr").length > 1);
  report.push(["rows", await page.$$eval("tbody tr", (items) => items.length)]);
  report.push(["status", await page.$eval(".status", (node) => node.textContent)]);
  report.push(["stats", (await page.$$eval(".cards strong", (items) => items.map((node) => node.textContent))).join(" | ")]);

  await page.select("aside select", "KABOOM77");
  await page.waitForFunction(() => {
    const line = document.querySelector(".stats p")?.textContent || "";
    return line.startsWith("KABOOM77:");
  });
  const brands = await page.$$eval("tbody tr td:nth-child(13)", (cells) => [...new Set(cells.map((cell) => cell.textContent))]);
  report.push(["filteredBrands", brands.join(",")]);
  report.push(["filteredRows", await page.$$eval("tbody tr", (items) => items.length)]);
  report.push(["date", await page.$eval("input[type=date]", (node) => node.value)]);
  report.push(["clock", await page.evaluate(() => new Date().toString())]);

  await page.click("button.live");
  report.push(["live", (await page.$eval("button.live", (node) => node.textContent)).trim()]);

  await page.click("header button.ghost");
  await page.waitForFunction(() => document.body.innerText.includes("New user"));
  report.push(["users", await page.$eval("h2", (node) => node.textContent)]);

  await page.setViewport({ width: 390, height: 844 });
  await page.reload({ waitUntil: "domcontentloaded" });
  await page.waitForSelector(".workspace");
  report.push(["innerWidth", await page.evaluate(() => window.innerWidth)]);
  report.push(["mobileColumns", await page.$eval(".workspace", (node) => getComputedStyle(node).gridTemplateColumns)]);
} catch (error) {
  report.push(["error", error.message]);
} finally {
  console.log(report.map((item) => item.join(" | ")).join("\n"));
  await browser.close();
}
