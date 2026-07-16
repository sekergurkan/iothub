import assert from "node:assert/strict";
import { mkdtemp, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { createBridgeService } from "../src/server.js";

test("HTTP API protects local state and persists rule CRUD", async (t) => {
  const directory = await mkdtemp(join(tmpdir(), "dirigera-bridge-server-"));
  const service = await createBridgeService({ dataDirectory: directory });
  t.after(async () => {
    await service.close();
    await rm(directory, { recursive: true, force: true });
  });

  await new Promise((resolve, reject) => {
    service.server.once("error", reject);
    service.server.listen(0, "127.0.0.1", resolve);
  });
  const { port } = service.server.address();
  const base = `http://127.0.0.1:${port}`;

  const health = await fetch(`${base}/api/health`, {
    headers: { Origin: "https://ui.example" },
  });
  assert.equal(health.status, 200);
  assert.equal(health.headers.get("access-control-allow-private-network"), "true");
  assert.equal((await health.json()).ok, true);

  const unauthorized = await fetch(`${base}/api/status`);
  assert.equal(unauthorized.status, 401);
  assert.equal((await unauthorized.json()).error.code, "UNAUTHORIZED");

  const headers = {
    "Content-Type": "application/json",
    "X-Bridge-Key": service.bridgeKey,
  };
  const status = await fetch(`${base}/api/status`, { headers });
  const statusBody = await status.json();
  assert.equal(status.status, 200);
  assert.equal(statusBody.paired, false);
  assert.equal(statusBody.connected, false);

  const createdResponse = await fetch(`${base}/api/rules`, {
    method: "POST",
    headers,
    body: JSON.stringify({
      id: "rule-ui-generated",
      name: "Test rule",
      trigger: { type: "motion", deviceId: "motion-1" },
      actions: [{ deviceId: "light-1", isOn: true, brightness: 50 }],
      offAfterSeconds: 30,
    }),
  });
  assert.equal(createdResponse.status, 201);
  const createdRule = await createdResponse.json();
  assert.equal(createdRule.id, "rule-ui-generated");

  const rulesResponse = await fetch(`${base}/api/rules`, { headers });
  const rules = await rulesResponse.json();
  assert.equal(rules.length, 1);
  assert.equal(rules[0].actions[0].brightness, 50);

  const updateResponse = await fetch(`${base}/api/rules/${createdRule.id}`, {
    method: "PUT",
    headers,
    body: JSON.stringify({ ...createdRule, name: "Disabled rule", enabled: false }),
  });
  assert.equal(updateResponse.status, 200);
  assert.equal((await updateResponse.json()).enabled, false);

  const eventsResponse = await fetch(`${base}/api/events`, { headers });
  assert.deepEqual(await eventsResponse.json(), { events: [] });
  assert.equal((await stat(service.paths.configPath)).mode & 0o777, 0o600);
  assert.equal((await stat(service.paths.rulesPath)).mode & 0o777, 0o600);
});
