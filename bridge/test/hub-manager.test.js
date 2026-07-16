import assert from "node:assert/strict";
import test from "node:test";
import { validateGatewayIP } from "../src/hub-manager.js";

test("gateway validation supports local DIRIGERA IPv4 and unicast IPv6 addresses", () => {
  assert.equal(validateGatewayIP("192.168.1.50"), "192.168.1.50");
  assert.equal(
    validateGatewayIP("[2a00:1d34:2cf8:9500:6aec:8aff:fe0e:2d21]"),
    "2a00:1d34:2cf8:9500:6aec:8aff:fe0e:2d21",
  );
  assert.throws(() => validateGatewayIP("8.8.8.8"), /private IPv4/);
  assert.throws(() => validateGatewayIP("ff02::1"), /unicast IPv6/);
  assert.throws(() => validateGatewayIP("::"), /unicast IPv6/);
});
