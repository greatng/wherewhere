/* global navigator, localStorage, indexedDB */
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { resolve, extname, sep } from "node:path";
import { chromium } from "playwright";

// Exercise actual generated service workers, not the Vite development server.
const root = resolve("dist");
let release = 1;
const types = {
  ".js": "text/javascript",
  ".html": "text/html",
  ".css": "text/css",
  ".webmanifest": "application/manifest+json",
  ".svg": "image/svg+xml",
  ".png": "image/png",
};
const server = createServer(async (request, response) => {
  try {
    const path = new URL(request.url, "http://localhost").pathname;
    const file = resolve(root, `.${path === "/" ? "/index.html" : path}`);
    if (!file.startsWith(root + sep)) throw new Error("Invalid path");
    let data = await readFile(file);
    response.setHeader(
      "Content-Type",
      types[extname(file)] || "application/octet-stream",
    );
    response.setHeader("Cache-Control", "no-store");
    if (path === "/sw.js")
      data = Buffer.from(data.toString() + `\n// release ${release}\n`);
    response.end(data);
  } catch {
    response.statusCode = 404;
    response.end();
  }
});
await new Promise((done) => server.listen(0, "127.0.0.1", done));
const browser = await chromium.launch();
try {
  const page = await browser.newPage();
  // No live account or data is involved in this regression.
  await page.route("**/rest/v1/**", (route) => route.fulfill({ json: [] }));
  const origin = `http://127.0.0.1:${server.address().port}`;
  await page.goto(origin);
  await page.evaluate(async () => {
    await navigator.serviceWorker.ready;
  });
  await page.reload();
  await page.waitForFunction(() => !!navigator.serviceWorker.controller);
  await page.evaluate(async () => {
    localStorage.setItem("roam-pwa-session-marker", "retained");
    const database = await new Promise((done, reject) => {
      const request = indexedDB.open("travelmate", 10);
      request.onupgradeneeded = () => {
        const database = request.result;
        const outbox = database.createObjectStore("outbox", { keyPath: "id" });
        for (const name of ["ownerId", "tripId", "kind", "createdAt", "state"])
          outbox.createIndex(name, name);
        outbox.createIndex("[ownerId+tripId]", ["ownerId", "tripId"]);
        const cached = database.createObjectStore("cached", {
          keyPath: ["ownerId", "tripId", "kind"],
        });
        for (const name of ["ownerId", "tripId", "savedAt"])
          cached.createIndex(name, name);
      };
      request.onsuccess = () => done(request.result);
      request.onerror = () => reject(request.error);
    });
    await new Promise((done, reject) => {
      const transaction = database.transaction("outbox", "readwrite");
      transaction
        .objectStore("outbox")
        .put({
          id: "pwa-update-fixture",
          ownerId: "fixture-user",
          tripId: "fixture-trip",
          kind: "expense",
          payload: {},
          createdAt: 1,
          state: "pending",
        });
      transaction.oncomplete = done;
      transaction.onerror = () => reject(transaction.error);
    });
    database.close();
  });
  release = 2;
  await page.evaluate(async () => {
    const registration = await navigator.serviceWorker.getRegistration();
    await registration.update();
  });
  await page.waitForFunction(
    async () => !!(await navigator.serviceWorker.getRegistration())?.waiting,
  );
  const update = page.getByRole("button", { name: "Update app", exact: true });
  await update.waitFor({ state: "visible", timeout: 10000 });
  // A waiting update must also be discoverable when reopening the app.
  await page.reload();
  await update.waitFor({ state: "visible", timeout: 10000 });
  await page.screenshot({ path: "artifacts/pwa-update-fixture-preview.png" });
  await Promise.all([page.waitForEvent("load"), update.click()]);
  await page.waitForFunction(
    async () => !(await navigator.serviceWorker.getRegistration())?.waiting,
  );
  assert.equal(
    await page.evaluate(() => localStorage.getItem("roam-pwa-session-marker")),
    "retained",
  );
  const queued = await page.evaluate(async () => {
    const database = await new Promise((done) => {
      const request = indexedDB.open("travelmate");
      request.onsuccess = () => done(request.result);
    });
    const value = await new Promise((done) => {
      const request = database
        .transaction("outbox")
        .objectStore("outbox")
        .get("pwa-update-fixture");
      request.onsuccess = () => done(request.result);
    });
    database.close();
    return value;
  });
  assert.equal(queued.id, "pwa-update-fixture");
  assert.equal(queued.state, "pending");
  console.log(
    "PASS: waiting update, reopen detection, explicit activation/reload, storage and queued operation preservation.",
  );
} finally {
  await browser.close();
  await new Promise((done) => server.close(done));
}
