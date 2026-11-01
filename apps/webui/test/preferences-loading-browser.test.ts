import { test } from "node:test";
import assert from "node:assert/strict";
import { join, resolve } from "node:path";
import { runtimeFixture } from "../../../packages/agent/test/runtime-fixture.ts";
import { startPocket } from "../src/bootstrap.ts";
import { ownedBrowser } from "./browser.ts";

// Gate the actual status RPC response in the browser. Native settings writes
// remain real; no fixed delay substitutes for the request/readiness boundary.
test("preferences initialization never overwrites edited or confirmed local state", { timeout: 60000 }, async (t) => {
  const m = await runtimeFixture();
  await m.runtime.close();
  let app: Awaited<ReturnType<typeof startPocket>> | undefined;
  let browser: Awaited<ReturnType<typeof ownedBrowser>> | undefined;
  try {
    app = await startPocket({ runtime: { ...m.config, dataDir: join(m.f.root, "preferences-loading") }, owner: "Owner", extensions: [{ root: resolve("apps/webui/examples/preferences") }] });
    assert.ok(app.initialOwner);
    browser = await ownedBrowser(join(m.f.root, "chrome"));
    const page = await browser.page(app.http.origin + "/#signin=" + app.initialOwner.token);
    await page.wait('document.querySelector("[data-action=signin]")');
    await page.click("[data-action=signin]");
    await page.wait('document.querySelector("[data-interface=preferences-settings]")');
    await page.evaluate(`(() => {
      const actualFetch = window.fetch.bind(window);
      window.preferenceGate = null;
      window.fetch = async (input, init) => {
        const command = typeof init?.body === 'string' ? JSON.parse(init.body).command?.call : null;
        const gate = window.preferenceGate;
        const response = await actualFetch(input, init);
        if (gate?.armed && command?.extension === 'preferences' && command?.action === 'status') {
          gate.armed = false;
          gate.entered = true;
          await new Promise(resolve => { gate.release = resolve; });
          gate.delivered = true;
        }
        return response;
      };
    })()`);
    const open = async () => {
      await page.evaluate('window.preferenceGate={armed:true,entered:false,delivered:false}');
      await page.click("[data-interface=preferences-settings]");
      await page.wait('window.preferenceGate.entered && document.querySelector("input[name=exampleLabel]")');
    };
    const release = async () => {
      await page.evaluate('window.preferenceGate.release()');
      await page.wait('window.preferenceGate.delivered');
      await page.evaluate('new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))');
    };
    await t.test("late initial read preserves the draft before save", async () => {
      await open();
      await page.type("input[name=exampleLabel]", "EDITED-BEFORE-INITIALIZATION");
      assert.equal(await page.evaluate('document.querySelector("input[name=exampleLabel]").value'), "EDITED-BEFORE-INITIALIZATION");
      await release();
      assert.equal(await page.evaluate('document.querySelector("input[name=exampleLabel]").value'), "EDITED-BEFORE-INITIALIZATION");
      await page.click("[data-save-label]");
      await page.wait('document.querySelector("[data-current-label]").textContent === "EDITED-BEFORE-INITIALIZATION"');
    });
    await page.click('[aria-label="Close Example preferences"]');
    await t.test("late initial read preserves a confirmed save", async () => {
      await open();
      await page.type("input[name=exampleLabel]", "SAVED-BEFORE-INITIALIZATION");
      await page.click("[data-save-label]");
      await page.wait('document.querySelector("[data-current-label]").textContent === "SAVED-BEFORE-INITIALIZATION"');
      await release();
      assert.deepEqual(await page.evaluate('({draft:document.querySelector("input[name=exampleLabel]").value,saved:document.querySelector("[data-current-label]").textContent})'), { draft: "SAVED-BEFORE-INITIALIZATION", saved: "SAVED-BEFORE-INITIALIZATION" });
    });
    await page.click('[aria-label="Close Example preferences"]');
    await t.test("an untouched reopened form loads the persisted setting", async () => {
      await page.evaluate('window.preferenceGate=null');
      await page.click("[data-interface=preferences-settings]");
      await page.wait('document.querySelector("[data-current-label]")?.textContent === "SAVED-BEFORE-INITIALIZATION"');
      assert.equal(await page.evaluate('document.querySelector("input[name=exampleLabel]").value'), "SAVED-BEFORE-INITIALIZATION");
    });
    assert.equal(m.f.requests.length, 0);
    assert.equal(m.f.errors.length, 0);
  } finally {
    await browser?.close();
    await app?.close();
    await m.f.close();
  }
});
