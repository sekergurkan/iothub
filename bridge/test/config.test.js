import assert from "node:assert/strict";
import { mkdtemp, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import {
  loadOrCreateConfig,
  loadRuleDocument,
  resolveDataPaths,
  saveConfig,
} from "../src/config.js";

test("local configuration and rules are created with private permissions", async (t) => {
  const directory = await mkdtemp(join(tmpdir(), "dirigera-bridge-config-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const paths = resolveDataPaths(directory);

  const first = await loadOrCreateConfig(paths);
  assert.equal(first.created, true);
  assert.match(first.config.bridgeKey, /^[A-Za-z0-9_-]{40,}$/);
  assert.equal((await stat(paths.dataDir)).mode & 0o777, 0o700);
  assert.equal((await stat(paths.configPath)).mode & 0o777, 0o600);

  const updated = await saveConfig(paths, {
    ...first.config,
    gatewayIP: "192.168.1.50",
    accessToken: "local-secret-token",
    homeAssistant: {
      baseUrl: "http://127.0.0.1:8124",
      accessToken: "home-assistant-local-secret",
    },
  });
  const second = await loadOrCreateConfig(paths);
  assert.equal(second.created, false);
  assert.equal(second.config.bridgeKey, first.config.bridgeKey);
  assert.equal(second.config.accessToken, "local-secret-token");
  assert.deepEqual(second.config.homeAssistant, {
    baseUrl: "http://127.0.0.1:8124",
    accessToken: "home-assistant-local-secret",
  });
  assert.equal(updated.gatewayIP, "192.168.1.50");
  assert.equal((await stat(paths.configPath)).mode & 0o777, 0o600);

  const rules = await loadRuleDocument(paths);
  assert.deepEqual(rules, { version: 1, rules: [] });
  assert.equal((await stat(paths.rulesPath)).mode & 0o777, 0o600);
});
