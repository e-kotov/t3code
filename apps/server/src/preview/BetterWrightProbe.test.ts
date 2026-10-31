// @effect-diagnostics nodeBuiltinImport:off - Tests real DOM hit-testing through the public Playwright page API.
import * as NodeVM from "node:vm";
import { chromium, type Page } from "playwright-core";
import { expect, it } from "vite-plus/test";
import { betterWrightProbeCode } from "./BetterWrightProbe.ts";

it("opens the keyboard for editable fields, including framed and shadow fields, and not CAPTCHA controls", async () => {
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage();
    await page.setContent(`<style>input,textarea,button,iframe{display:block;margin:12px}</style>
      <button id="button">Submit</button><input id="captcha" type="checkbox">
      <input id="text"><textarea id="area"></textarea><input id="locked" readonly>
      <input id="disabled" disabled><div id="edit" contenteditable>editable</div>
      <div id="shadow"></div><iframe id="frame" srcdoc="<input id='inner'><input id='check' type='checkbox'>"></iframe>`);
    await page.locator("#shadow").evaluate((element) => {
      element.attachShadow({ mode: "open" }).innerHTML = "<input id='shadow-text'>";
    });
    for (const [selector, editable] of [
      ["#button", false],
      ["#captcha", false],
      ["#text", true],
      ["#area", true],
      ["#locked", false],
      ["#disabled", false],
      ["#edit", true],
      ["#shadow-text", true],
    ] as const) {
      const box = await page.locator(selector).boundingBox();
      expect(box).not.toBeNull();
      const run = NodeVM.runInNewContext(
        `(async function(usePage) { ${betterWrightProbeCode("page-1", box!.x + box!.width / 2, box!.y + box!.height / 2)} })`,
      ) as (usePage: (id: string) => Promise<Page>) => Promise<boolean>;
      expect(
        await run(async (id) => {
          expect(id).toBe("page-1");
          return page;
        }),
        selector,
      ).toBe(editable);
    }
    for (const [selector, editable] of [
      ["#inner", true],
      ["#check", false],
    ] as const) {
      const box = await page.frameLocator("#frame").locator(selector).boundingBox();
      expect(box).not.toBeNull();
      const run = NodeVM.runInNewContext(
        `(async function(usePage) { ${betterWrightProbeCode("page-1", box!.x + box!.width / 2, box!.y + box!.height / 2)} })`,
      ) as (usePage: (id: string) => Promise<Page>) => Promise<boolean>;
      expect(await run(async () => page), selector).toBe(editable);
    }
  } finally {
    await browser.close();
  }
});
