import assert from "node:assert/strict";
import { access, readFile } from "node:fs/promises";
import test from "node:test";

async function render() {
  const workerUrl = new URL("../dist/server/index.js", import.meta.url);
  workerUrl.searchParams.set("test", `${process.pid}-${Date.now()}`);
  const { default: worker } = await import(workerUrl.href);

  return worker.fetch(
    new Request("http://localhost/", {
      headers: { accept: "text/html", host: "localhost" },
    }),
    {
      ASSETS: {
        fetch: async () => new Response("Not found", { status: 404 }),
      },
    },
    {
      waitUntil() {},
      passThroughOnException() {},
    },
  );
}

test("server-renders the Yuva DIRIGERA control center", async () => {
  const response = await render();
  assert.equal(response.status, 200);
  assert.match(response.headers.get("content-type") ?? "", /^text\/html\b/i);

  const html = await response.text();
  assert.match(html, /<title>Yuva — DIRIGERA kontrol merkezi<\/title>/i);
  assert.match(html, /Genel Bakış/);
  assert.match(html, /Koridor Işığı/);
  assert.match(html, /Akşam Butonu/);
  assert.match(html, /Yeni otomasyon/);
  assert.doesNotMatch(html, /codex-preview|react-loading-skeleton|Your site is taking shape/i);
});

test("ships product metadata and removes starter preview artifacts", async () => {
  const [page, layout, client, css, packageJson] = await Promise.all([
    readFile(new URL("../app/page.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/layout.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/home-control.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/globals.css", import.meta.url), "utf8"),
    readFile(new URL("../package.json", import.meta.url), "utf8"),
  ]);

  assert.match(page, /<HomeControl \/>/);
  assert.match(layout, /DIRIGERA kontrol merkezi/);
  assert.match(layout, /\/og\.png/);
  assert.match(layout, /lang="tr"/);
  assert.match(client, /function RuleBuilder/);
  assert.match(client, /DETAYLI OTOMASYON/);
  assert.match(client, /deviceStates/);
  assert.match(client, /cooldownSeconds/);
  assert.match(client, /Tüm ışıkları seç/);
  assert.match(client, /Odaya göre:/);
  assert.match(client, /Üst tuş/);
  assert.match(client, /Yalnızca açtığın koşullar/);
  assert.match(client, /passthroughAttributes/);
  assert.match(client, /scheduleTestAutoOff/);
  assert.match(client, /pendingRuleWritesRef/);
  assert.match(client, /eventType: "babyCry"/);
  assert.match(client, /Yanıp sönerek uyar/);
  assert.match(client, /restoreState: true/);
  assert.match(client, /\/api\/rules\/\$\{encodeURIComponent\(rule\.id\)\}\/run/);
  assert.match(client, /X-Bridge-Key/);
  assert.match(client, /yuva-connection-mode/);
  assert.match(client, /syncBridge\(\)\.catch/);
  assert.match(css, /prefers-reduced-motion:\s*reduce/);
  assert.match(css, /\.device-action-card/);
  assert.match(css, /\.device-condition-row/);
  assert.match(packageJson, /"name": "yuva-dirigera-control"/);
  assert.doesNotMatch(packageJson, /react-loading-skeleton/);

  await access(new URL("../public/og.png", import.meta.url));
  await assert.rejects(access(new URL("../app/_sites-preview/SkeletonPreview.tsx", import.meta.url)));
});
