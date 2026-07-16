import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import test from "node:test";
import {
  HomeAssistantManager,
  validateHomeAssistantBaseUrl,
} from "../src/home-assistant-manager.js";

class FakeWebSocket extends EventEmitter {
  static OPEN = 1;
  static instances = [];

  constructor() {
    super();
    this.readyState = FakeWebSocket.OPEN;
    this.sent = [];
    FakeWebSocket.instances.push(this);
    queueMicrotask(() => this.emit("message", Buffer.from(JSON.stringify({ type: "auth_required" }))));
  }

  send(raw, callback = () => {}) {
    const message = JSON.parse(raw);
    this.sent.push(message);
    callback(null);
    if (message.type === "auth") {
      queueMicrotask(() => this.emit("message", Buffer.from(JSON.stringify({ type: "auth_ok" }))));
      return;
    }
    const results = {
      "config/entity_registry/list": FIXTURE_ENTITIES,
      "config/device_registry/list": FIXTURE_DEVICES,
      "config/area_registry/list": [{ area_id: "office", name: "Çalışma Odası" }],
      subscribe_events: null,
    };
    queueMicrotask(() =>
      this.emit(
        "message",
        Buffer.from(
          JSON.stringify({ id: message.id, type: "result", success: true, result: results[message.type] }),
        ),
      ),
    );
  }

  close() {
    if (this.readyState !== FakeWebSocket.OPEN) return;
    this.readyState = 3;
    queueMicrotask(() => this.emit("close"));
  }
}

const FIXTURE_DEVICES = [
  { id: "purifier", name: "Xiaomi Smart Air Purifier 4 Pro", model: "AC-M15-SC", manufacturer: "Xiaomi", area_id: "office" },
  { id: "dryer", name: "Xiaomi Smart Dehumidifier", model: "CSJ0114DM", manufacturer: "Xiaomi", area_id: "office" },
  { id: "bulb", name: "Mi Smart LED Bulb White", model: "XMBGDP01YLK", manufacturer: "Xiaomi", area_id: "office" },
  { id: "camera", name: "Xiaomi Smart Camera C701", model: "MJSXJ27CM", manufacturer: "Xiaomi", area_id: "office" },
];

const FIXTURE_ENTITIES = [
  { entity_id: "fan.air_purifier_4_pro", device_id: "purifier", platform: "xiaomi_home" },
  { entity_id: "sensor.air_purifier_pm2_5", device_id: "purifier", platform: "xiaomi_home" },
  { entity_id: "sensor.air_purifier_filter_life", device_id: "purifier", platform: "xiaomi_home" },
  { entity_id: "humidifier.smart_dehumidifier", device_id: "dryer", platform: "xiaomi_home" },
  { entity_id: "light.smart_dehumidifier_indicator", device_id: "dryer", platform: "xiaomi_home" },
  { entity_id: "binary_sensor.smart_dehumidifier_tank_full", device_id: "dryer", platform: "xiaomi_home" },
  { entity_id: "light.mi_bulb_white", device_id: "bulb", platform: "xiaomi_home" },
  { entity_id: "light.camera_c701_indicator", device_id: "camera", platform: "xiaomi_home" },
  { entity_id: "switch.camera_c701_power", device_id: "camera", platform: "xiaomi_home" },
  { entity_id: "switch.camera_c701_privacy", device_id: "camera", platform: "xiaomi_home" },
  { entity_id: "event.camera_c701_someone_appeared", device_id: "camera", platform: "xiaomi_home", original_name: "Ai Detection Someone Appeared" },
  { entity_id: "event.camera_c701_no_human_appear", device_id: "camera", platform: "xiaomi_home", original_name: "Ai Detection No Human Appear" },
];

const FIXTURE_STATES = [
  {
    entity_id: "fan.air_purifier_4_pro",
    state: "on",
    attributes: { friendly_name: "Air Purifier 4 Pro", percentage: 40, preset_mode: "Auto", preset_modes: ["Auto", "Silent", "Favorite"] },
  },
  { entity_id: "sensor.air_purifier_pm2_5", state: "8", attributes: { friendly_name: "PM2.5" } },
  { entity_id: "sensor.air_purifier_filter_life", state: "91", attributes: { friendly_name: "Filter life" } },
  {
    entity_id: "humidifier.smart_dehumidifier",
    state: "on",
    attributes: { friendly_name: "Smart Dehumidifier", current_humidity: 57, humidity: 50, available_modes: ["Auto", "Dry clothes"] },
  },
  { entity_id: "light.smart_dehumidifier_indicator", state: "on", attributes: { friendly_name: "Smart Dehumidifier Indicator Light", brightness: 128 } },
  { entity_id: "binary_sensor.smart_dehumidifier_tank_full", state: "off", attributes: { friendly_name: "Water tank full" } },
  {
    entity_id: "light.mi_bulb_white",
    state: "on",
    attributes: { friendly_name: "Mi Bulb White", brightness: 217, color_temp_kelvin: 2700, supported_color_modes: ["color_temp"] },
  },
  { entity_id: "light.camera_c701_indicator", state: "on", attributes: { friendly_name: "Camera C701 Indicator Light" } },
  { entity_id: "switch.camera_c701_power", state: "on", attributes: { friendly_name: "Camera C701 Switch Status" } },
  { entity_id: "switch.camera_c701_privacy", state: "off", attributes: { friendly_name: "Camera C701 Privacy" } },
  { entity_id: "event.camera_c701_someone_appeared", state: "2026-07-16T10:00:00+00:00", last_changed: "2026-07-16T10:00:00+00:00", attributes: { friendly_name: "Camera C701 Someone Appeared" } },
  { entity_id: "event.camera_c701_no_human_appear", state: "2026-07-16T09:55:00+00:00", last_changed: "2026-07-16T09:55:00+00:00", attributes: { friendly_name: "Camera C701 No Human Appear" } },
];

function jsonResponse(value, status = 200) {
  return new Response(JSON.stringify(value), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

test("Home Assistant manager exposes Xiaomi devices and maps controls to services", async (t) => {
  FakeWebSocket.instances.length = 0;
  const serviceCalls = [];
  const fetchImpl = async (input, init = {}) => {
    const url = new URL(input);
    if (url.pathname === "/api/") return jsonResponse({ message: "API running." });
    if (url.pathname === "/api/states") return jsonResponse(FIXTURE_STATES);
    if (url.pathname.startsWith("/api/services/")) {
      serviceCalls.push({ pathname: url.pathname, body: JSON.parse(init.body) });
      return jsonResponse([]);
    }
    return jsonResponse({}, 404);
  };
  let config = {
    homeAssistant: {
      baseUrl: "http://127.0.0.1:8124",
      accessToken: "a-valid-long-lived-access-token",
    },
  };
  const events = [];
  const manager = new HomeAssistantManager({
    config,
    persistConfig: async (next) => {
      config = next;
      return config;
    },
    onEvent: async (event) => events.push(event),
    fetchImpl,
    WebSocketImpl: FakeWebSocket,
  });
  t.after(() => manager.stop());

  await manager.initialize();
  assert.equal(manager.status().connected, true);
  assert.equal(manager.status().listening, true);
  assert.equal(manager.status().deviceCount, 4);
  assert.doesNotMatch(JSON.stringify(manager.status()), /long-lived-access-token/);

  const devices = manager.listDevices();
  const purifier = devices.find((device) => device.type === "airPurifier");
  const dryer = devices.find((device) => device.type === "dehumidifier");
  const bulb = devices.find((device) => device.type === "light");
  const camera = devices.find((device) => device.type === "camera");
  assert.equal(purifier.attributes.pm25, 8);
  assert.equal(purifier.attributes.filterLife, 91);
  assert.equal(dryer.attributes.targetHumidity, 50);
  assert.equal(dryer.attributes.waterTankFull, false);
  assert.equal(bulb.attributes.lightLevel, 85);
  assert.equal(camera.capabilities.privacy, true);
  assert.ok(devices.every((device) => /^ha_[A-Za-z0-9_-]+$/.test(device.id)));

  await manager.setDeviceAttributes({
    id: purifier.id,
    attributes: { percentage: 65, presetMode: "Silent" },
  });
  await manager.setDeviceAttributes({
    id: dryer.id,
    attributes: { isOn: false, targetHumidity: 45 },
  });
  await manager.setDeviceAttributes({
    id: bulb.id,
    attributes: { lightLevel: 60, colorTemperature: 2700 },
    transitionTime: 2_000,
  });
  await manager.setDeviceAttributes({ id: camera.id, attributes: { privacy: true } });
  await manager.setDeviceAttributes({ id: camera.id, attributes: { isOn: false } });
  assert.deepEqual(
    serviceCalls.map((call) => [call.pathname, call.body]),
    [
      ["/api/services/fan/set_percentage", { entity_id: "fan.air_purifier_4_pro", percentage: 65 }],
      ["/api/services/fan/set_preset_mode", { entity_id: "fan.air_purifier_4_pro", preset_mode: "Silent" }],
      ["/api/services/humidifier/set_humidity", { entity_id: "humidifier.smart_dehumidifier", humidity: 45 }],
      ["/api/services/humidifier/turn_off", { entity_id: "humidifier.smart_dehumidifier" }],
      ["/api/services/light/turn_on", { entity_id: "light.mi_bulb_white", brightness_pct: 60, transition: 2 }],
      ["/api/services/light/turn_on", { entity_id: "light.mi_bulb_white", color_temp_kelvin: 2700, transition: 2 }],
      ["/api/services/switch/turn_on", { entity_id: "switch.camera_c701_privacy" }],
      ["/api/services/switch/turn_off", { entity_id: "switch.camera_c701_power" }],
    ],
  );

  const socket = FakeWebSocket.instances[0];
  socket.emit(
    "message",
    Buffer.from(
      JSON.stringify({
        id: 999,
        type: "event",
        event: {
          event_type: "state_changed",
          time_fired: "2026-07-16T10:05:00.000Z",
          data: {
            entity_id: "event.camera_c701_someone_appeared",
            old_state: FIXTURE_STATES.at(-2),
            new_state: { ...FIXTURE_STATES.at(-2), state: "2026-07-16T10:05:00+00:00", last_changed: "2026-07-16T10:05:00+00:00" },
          },
        },
      }),
    ),
  );
  await new Promise((resolve) => setImmediate(resolve));
  assert.ok(events.some((event) => event.type === "deviceEvent" && event.data.eventType === "personDetected"));

  socket.emit(
    "message",
    Buffer.from(
      JSON.stringify({
        id: 1_000,
        type: "event",
        event: {
          event_type: "state_changed",
          time_fired: "2026-07-16T10:06:00.000Z",
          data: {
            entity_id: "event.camera_c701_no_human_appear",
            old_state: FIXTURE_STATES.at(-1),
            new_state: { ...FIXTURE_STATES.at(-1), state: "2026-07-16T10:06:00+00:00", last_changed: "2026-07-16T10:06:00+00:00" },
          },
        },
      }),
    ),
  );
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(
    events.filter((event) => event.type === "deviceEvent" && event.data.eventType === "personDetected").length,
    1,
  );
});

test("Home Assistant URL validation permits local addresses and rejects public or credentialed URLs", () => {
  assert.equal(validateHomeAssistantBaseUrl("http://127.0.0.1:8124/"), "http://127.0.0.1:8124");
  assert.equal(validateHomeAssistantBaseUrl("http://homeassistant.local:8123"), "http://homeassistant.local:8123");
  assert.throws(() => validateHomeAssistantBaseUrl("https://example.com"), /private-network/);
  assert.throws(() => validateHomeAssistantBaseUrl("http://user:secret@127.0.0.1:8124"), /private-network/);
});
