import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import test from "node:test";
import { HubUpdateListener } from "../src/hub-websocket.js";

test("hub event listener pins TLS, limits frames, and rejects malformed events", async () => {
  const instances = [];
  class FakeWebSocket extends EventEmitter {
    static OPEN = 1;

    constructor(url, options) {
      super();
      this.url = url;
      this.options = options;
      this.readyState = FakeWebSocket.OPEN;
      instances.push(this);
    }

    send() {}
    terminate() {
      this.terminated = true;
    }
  }

  const events = [];
  const errors = [];
  const listener = new HubUpdateListener({
    gatewayIP: "192.168.1.50",
    accessToken: "test-token-never-logged",
    rejectUnauthorized: true,
    onEvent: (event) => events.push(event),
    onError: (error) => errors.push(error),
    WebSocketClass: FakeWebSocket,
  });
  listener.start();
  const [instance] = instances;

  assert.equal(instance.url, "wss://192.168.1.50:8443/v1");
  assert.equal(instance.options.rejectUnauthorized, true);
  assert.equal(instance.options.followRedirects, false);
  assert.equal(instance.options.maxPayload, 256 * 1024);
  assert.match(instance.options.ca[0], /BEGIN CERTIFICATE/);
  assert.equal(instance.options.headers.authorization, "Bearer test-token-never-logged");

  instance.emit("message", Buffer.from("not-json"), false);
  instance.emit(
    "message",
    Buffer.from(JSON.stringify({ id: "event-1", type: "deviceStateChanged", data: {} })),
    false,
  );
  await new Promise((resolve) => setImmediate(resolve));

  assert.equal(errors.length, 1);
  assert.equal(errors[0].code, "INVALID_HUB_EVENT");
  assert.equal(events.length, 1);
  assert.equal(events[0].id, "event-1");
  listener.stop();
  assert.equal(instance.terminated, true);
});
