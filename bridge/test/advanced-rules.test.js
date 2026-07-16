import assert from "node:assert/strict";
import test from "node:test";
import { RuleEngine } from "../src/rule-engine.js";

function createEngine(overrides = {}) {
  const calls = [];
  const executions = [];
  const engine = new RuleEngine({
    rules: [],
    saveRules: async () => {},
    setDeviceAttributes: async (request) => calls.push(structuredClone(request)),
    onExecution: (execution) => executions.push(execution),
    ...overrides,
  });
  return { engine, calls, executions };
}

function blinkRule(overrides = {}) {
  return {
    id: "baby-cry-blink",
    name: "Baby cry light warning",
    trigger: { type: "deviceEvent", deviceId: "camera-1", eventType: "babyCry" },
    actions: [
      { deviceId: "light-on", isOn: true },
      { deviceId: "light-off", isOn: true },
    ],
    effect: {
      type: "blink",
      durationSeconds: 1,
      intervalMilliseconds: 100,
      restoreState: true,
    },
    ...overrides,
  };
}

test("blink effects normalize, persist, reload, and reject unsafe combinations", async () => {
  const saves = [];
  const { engine } = createEngine({
    saveRules: async (rules) => saves.push(structuredClone(rules)),
  });
  const created = await engine.create(blinkRule());

  assert.deepEqual(created.effect, {
    type: "blink",
    durationSeconds: 1,
    intervalMilliseconds: 100,
    restoreState: true,
  });
  assert.deepEqual(saves.at(-1)[0].effect, created.effect);

  const reloaded = new RuleEngine({
    rules: saves.at(-1),
    saveRules: async () => {},
    setDeviceAttributes: async () => {},
  });
  assert.deepEqual(reloaded.get(created.id).effect, created.effect);

  await assert.rejects(
    engine.create(
      blinkRule({
        id: "blink-no-restore",
        effect: {
          type: "blink",
          durationSeconds: 1,
          intervalMilliseconds: 100,
          restoreState: false,
        },
      }),
    ),
    /restoreState must be true/,
  );
  await assert.rejects(
    engine.create(
      blinkRule({
        id: "blink-too-short",
        effect: {
          type: "blink",
          durationSeconds: 1,
          intervalMilliseconds: 600,
          restoreState: true,
        },
      }),
    ),
    /at least one complete blink cycle/,
  );
  await assert.rejects(
    engine.create(
      blinkRule({
        id: "blink-with-brightness",
        actions: [{ deviceId: "light-on", isOn: true, brightness: 100 }],
      }),
    ),
    /may only select a device with isOn set to true/,
  );
  await assert.rejects(
    engine.create(
      blinkRule({
        id: "blink-duplicate-target",
        actions: [
          { deviceId: "light-on", isOn: true },
          { deviceId: "light-on", isOn: true },
        ],
      }),
    ),
    /targets must be unique/,
  );
  await assert.rejects(
    engine.create(blinkRule({ id: "blink-with-auto-off", offAfterSeconds: 5 })),
    /cannot be combined with a blink effect/,
  );

  assert.equal(saves.at(-1).length, 1, "rejected rules are never persisted");
  reloaded.stop();
  engine.stop();
});

test("blink phases start together and restore each light's exact prior power state", async () => {
  let clock = 0;
  let phaseInFlight = 0;
  let maximumPhaseInFlight = 0;
  const waits = [];
  const calls = [];
  const devices = new Map([
    [
      "light-on",
      {
        id: "light-on",
        type: "light",
        isReachable: true,
        attributes: { isOn: true, lightLevel: 42, colorTemperature: 2_700 },
      },
    ],
    [
      "light-off",
      {
        id: "light-off",
        type: "light",
        isReachable: true,
        attributes: { isOn: false, lightLevel: 85, colorTemperature: 4_000 },
      },
    ],
  ]);
  const executions = [];
  const engine = new RuleEngine({
    rules: [],
    saveRules: async () => {},
    getDevice: async (id) => structuredClone(devices.get(id)),
    setDeviceAttributes: async (request) => {
      const calledAt = clock;
      calls.push({ ...structuredClone(request), calledAt });
      if (calledAt < 1_000) {
        phaseInFlight += 1;
        maximumPhaseInFlight = Math.max(maximumPhaseInFlight, phaseInFlight);
      }
      await new Promise((resolve) => queueMicrotask(resolve));
      if (calledAt < 1_000) phaseInFlight -= 1;
    },
    wait: async (milliseconds) => {
      waits.push(milliseconds);
      clock += milliseconds;
    },
    now: () => clock,
    onExecution: (execution) => executions.push(execution),
  });
  const rule = await engine.create(blinkRule());

  const completed = await engine.run(rule.id);

  assert.equal(completed.runCount, 1);
  assert.deepEqual(waits, Array(10).fill(100));
  assert.equal(maximumPhaseInFlight, 2, "both lights start each blink phase concurrently");
  assert.deepEqual(
    calls.slice(0, 2).map(({ id, attributes, transitionTime, calledAt }) => ({
      id,
      attributes,
      transitionTime,
      calledAt,
    })),
    [
      { id: "light-on", attributes: { isOn: true }, transitionTime: 0, calledAt: 0 },
      { id: "light-off", attributes: { isOn: true }, transitionTime: 0, calledAt: 0 },
    ],
  );
  assert.equal(
    calls.filter((call) => call.calledAt < 1_000).length,
    20,
    "ten synchronized on/off phases run during the one-second effect",
  );
  assert.deepEqual(
    calls
      .filter((call) => call.calledAt === 1_000 && call.id === "light-on")
      .map(({ attributes, transitionTime }) => ({ attributes, transitionTime })),
    [
      { attributes: { isOn: true }, transitionTime: 0 },
      { attributes: { lightLevel: 42 }, transitionTime: 0 },
      { attributes: { colorTemperature: 2_700 }, transitionTime: 0 },
    ],
  );
  assert.deepEqual(
    calls
      .filter((call) => call.calledAt === 1_000 && call.id === "light-off")
      .map(({ attributes, transitionTime }) => ({ attributes, transitionTime })),
    [{ attributes: { isOn: false }, transitionTime: 0 }],
  );
  assert.equal(executions.at(-1).status, "success");
  engine.stop();
});

test("a failed blink phase is reported without preventing later phases or restoration", async () => {
  let clock = 0;
  let failedOnce = false;
  const calls = [];
  const executions = [];
  const devices = new Map([
    [
      "light-on",
      {
        id: "light-on",
        type: "light",
        isReachable: true,
        attributes: { isOn: true, lightLevel: 25, colorTemperature: 3_000 },
      },
    ],
    [
      "light-off",
      {
        id: "light-off",
        type: "light",
        isReachable: true,
        attributes: { isOn: false },
      },
    ],
  ]);
  const engine = new RuleEngine({
    rules: [],
    saveRules: async () => {},
    getDevice: async (id) => structuredClone(devices.get(id)),
    setDeviceAttributes: async (request) => {
      calls.push({ ...structuredClone(request), calledAt: clock });
      if (!failedOnce && request.id === "light-on" && clock === 0) {
        failedOnce = true;
        const error = new Error("temporary device failure");
        error.code = "DEVICE_UNREACHABLE";
        throw error;
      }
    },
    wait: async (milliseconds) => {
      clock += milliseconds;
    },
    now: () => clock,
    onExecution: (execution) => executions.push(execution),
  });
  const rule = await engine.create(
    blinkRule({
      effect: {
        type: "blink",
        durationSeconds: 1,
        intervalMilliseconds: 500,
        restoreState: true,
      },
    }),
  );

  await assert.rejects(engine.run(rule.id), (error) => {
    assert.equal(error.code, "RULE_ACTIONS_PARTIAL_FAILURE");
    assert.deepEqual(error.failures, [
      {
        deviceId: "light-on",
        actionIndex: 0,
        requestIndex: 0,
        stage: "phase",
        phaseIndex: 0,
        code: "DEVICE_UNREACHABLE",
      },
    ]);
    return true;
  });

  assert.deepEqual(
    calls
      .filter((call) => call.calledAt === 500)
      .map((call) => [call.id, call.attributes]),
    [
      ["light-on", { isOn: false }],
      ["light-off", { isOn: false }],
    ],
    "the next synchronized phase still reaches both targets",
  );
  assert.deepEqual(
    calls
      .filter((call) => call.calledAt === 1_000 && call.id === "light-on")
      .map((call) => call.attributes),
    [{ isOn: true }, { lightLevel: 25 }, { colorTemperature: 3_000 }],
  );
  assert.deepEqual(
    calls
      .filter((call) => call.calledAt === 1_000 && call.id === "light-off")
      .map((call) => call.attributes),
    [{ isOn: false }],
  );
  assert.equal(engine.get(rule.id).runCount, 1);
  assert.equal(executions.at(-1).status, "error");
  engine.stop();
});

test("Home Assistant blink restore watchdog repairs delayed power drift and verifies for five seconds", async () => {
  const deviceId = "ha_wc-light";
  let clock = 0;
  const calls = [];
  const reads = [];
  const waits = [];
  const executions = [];
  const engine = new RuleEngine({
    rules: [],
    saveRules: async () => {},
    getDevice: async (id, options) => {
      reads.push({ id, options: structuredClone(options), calledAt: clock });
      return {
        id,
        type: "light",
        provider: "home-assistant",
        isReachable: true,
        attributes: {
          isOn: clock === 4_000,
          lightLevel: 33,
          colorTemperature: 2_700,
        },
      };
    },
    setDeviceAttributes: async (request) => {
      calls.push({ ...structuredClone(request), calledAt: clock });
    },
    wait: async (milliseconds) => {
      waits.push(milliseconds);
      clock += milliseconds;
    },
    now: () => clock,
    onExecution: (execution) => executions.push(execution),
  });
  const rule = await engine.create(
    blinkRule({
      actions: [{ deviceId, isOn: true }],
      effect: {
        type: "blink",
        durationSeconds: 1,
        intervalMilliseconds: 500,
        restoreState: true,
      },
    }),
  );

  await engine.run(rule.id);

  assert.deepEqual(waits, [500, 500, 1_000, 1_000, 1_000, 1_000, 1_000]);
  assert.deepEqual(
    reads.map(({ calledAt }) => calledAt),
    [0, 2_000, 3_000, 4_000, 5_000, 6_000],
    "fresh state is checked throughout the full five-second watchdog window",
  );
  assert.ok(reads.every((read) => read.options?.fresh === true));
  assert.deepEqual(
    calls
      .filter((call) => call.calledAt === 4_000)
      .map((call) => call.attributes),
    [{ isOn: false }],
    "a late Home Assistant state reversal is corrected immediately",
  );
  assert.equal(executions.at(-1).status, "success");
  engine.stop();
});

test("a persistent Home Assistant restore mismatch is reported as restoreVerify failure", async () => {
  const deviceId = "ha_wc-light";
  let clock = 0;
  const calls = [];
  const reads = [];
  const executions = [];
  const engine = new RuleEngine({
    rules: [],
    saveRules: async () => {},
    getDevice: async (id, options) => {
      reads.push({ id, options: structuredClone(options), calledAt: clock });
      return {
        id,
        type: "light",
        provider: "home-assistant",
        isReachable: true,
        attributes: { isOn: clock === 0 ? false : true },
      };
    },
    setDeviceAttributes: async (request) => {
      calls.push({ ...structuredClone(request), calledAt: clock });
    },
    wait: async (milliseconds) => {
      clock += milliseconds;
    },
    now: () => clock,
    onExecution: (execution) => executions.push(execution),
  });
  const rule = await engine.create(
    blinkRule({
      actions: [{ deviceId, isOn: true }],
      effect: {
        type: "blink",
        durationSeconds: 1,
        intervalMilliseconds: 500,
        restoreState: true,
      },
    }),
  );

  await assert.rejects(engine.run(rule.id), (error) => {
    assert.equal(error.code, "RULE_ACTIONS_PARTIAL_FAILURE");
    assert.deepEqual(error.failures, [
      {
        deviceId,
        actionIndex: 0,
        requestIndex: 5,
        stage: "restoreVerify",
        code: "RULE_EFFECT_RESTORE_UNVERIFIED",
      },
    ]);
    return true;
  });

  assert.deepEqual(
    reads.map(({ calledAt }) => calledAt),
    [0, 2_000, 3_000, 4_000, 5_000, 6_000, 7_000],
  );
  assert.deepEqual(
    calls
      .filter((call) => call.calledAt >= 2_000)
      .map((call) => [call.calledAt, call.attributes]),
    [
      [2_000, { isOn: false }],
      [3_000, { isOn: false }],
      [4_000, { isOn: false }],
      [5_000, { isOn: false }],
      [6_000, { isOn: false }],
    ],
    "the expected power state is reasserted after every failed watchdog check",
  );
  assert.equal(executions.at(-1).status, "error");
  engine.stop();
});

test("superseding a Home Assistant light stops the restore watchdog from reasserting stale state", async () => {
  const deviceId = "ha_wc-light";
  let clock = 0;
  let engine;
  const calls = [];
  const reads = [];
  const executions = [];
  engine = new RuleEngine({
    rules: [],
    saveRules: async () => {},
    getDevice: async (id, options) => {
      reads.push({ id, options: structuredClone(options), calledAt: clock });
      return {
        id,
        type: "light",
        provider: "home-assistant",
        isReachable: true,
        attributes: { isOn: clock === 0 ? false : true },
      };
    },
    setDeviceAttributes: async (request) => {
      calls.push({ ...structuredClone(request), calledAt: clock });
    },
    wait: async (milliseconds) => {
      clock += milliseconds;
      if (clock === 3_000) engine.supersedeDevice(deviceId);
    },
    now: () => clock,
    onExecution: (execution) => executions.push(execution),
  });
  const rule = await engine.create(
    blinkRule({
      actions: [{ deviceId, isOn: true }],
      effect: {
        type: "blink",
        durationSeconds: 1,
        intervalMilliseconds: 500,
        restoreState: true,
      },
    }),
  );

  await engine.run(rule.id);

  assert.deepEqual(
    reads.map(({ calledAt }) => calledAt),
    [0, 2_000],
    "the superseded target is not read again",
  );
  assert.deepEqual(
    calls
      .filter((call) => call.calledAt >= 2_000)
      .map((call) => [call.calledAt, call.attributes]),
    [[2_000, { isOn: false }]],
    "no stale restore is issued after a manual action supersedes the effect",
  );
  assert.equal(executions.at(-1).status, "success");
  engine.stop();
});

test("disabled optional rule features are omitted and enabled empty features are rejected", async () => {
  const { engine } = createEngine();
  const rule = await engine.create({
    name: "Only required fields",
    trigger: { type: "button", deviceId: "button-1", clickPattern: "singlePress" },
    conditions: {},
    actions: [{ deviceId: "light-1", isOn: false }],
  });

  assert.deepEqual(rule.conditions, {});
  assert.equal(Object.hasOwn(rule, "cooldownSeconds"), false);
  assert.equal(Object.hasOwn(rule, "offAfterSeconds"), false);
  assert.equal(Object.hasOwn(rule.actions[0], "brightness"), false);
  assert.equal(Object.hasOwn(rule.actions[0], "temperature"), false);
  assert.equal(Object.hasOwn(rule.actions[0], "transitionTime"), false);
  assert.equal(Object.hasOwn(rule.actions[0], "offAfterSeconds"), false);

  await assert.rejects(
    engine.create({
      name: "Empty device state selection",
      trigger: { type: "time", time: "12:00" },
      conditions: { deviceStates: [] },
      actions: [{ deviceId: "light-1", isOn: true }],
    }),
    /between 1 and 32 device conditions/,
  );
  await assert.rejects(
    engine.create({
      name: "Invalid boolean operator",
      trigger: { type: "time", time: "12:00" },
      conditions: {
        deviceStates: [
          {
            deviceId: "light-1",
            attribute: "isOn",
            operator: "greaterThan",
            value: true,
          },
        ],
      },
      actions: [{ deviceId: "light-1", isOn: true }],
    }),
    /not supported for isOn/,
  );
  await assert.rejects(
    engine.create({
      name: "Invalid numeric value",
      trigger: { type: "time", time: "12:00" },
      conditions: {
        deviceStates: [
          {
            deviceId: "light-1",
            attribute: "lightLevel",
            operator: "equals",
            value: 101,
          },
        ],
      },
      actions: [{ deviceId: "light-1", isOn: true }],
    }),
    /between 0 and 100/,
  );
  await assert.rejects(
    engine.create({
      name: "Invalid auto off",
      trigger: { type: "time", time: "12:00" },
      actions: [{ deviceId: "light-1", isOn: false, offAfterSeconds: 30 }],
    }),
    /only be used when the action turns the device on/,
  );
  engine.stop();
});

test("device state conditions support boolean and numeric comparisons with one read per device", async () => {
  const reads = [];
  const devices = new Map([
    [
      "light-state",
      {
        id: "light-state",
        isReachable: true,
        attributes: { isOn: true, lightLevel: 30, colorTemperature: 2_700 },
      },
    ],
    [
      "sensor-state",
      {
        id: "sensor-state",
        isReachable: true,
        attributes: { batteryPercentage: 84, isDetected: false },
      },
    ],
    [
      "malformed-state",
      {
        id: "malformed-state",
        isReachable: true,
        attributes: { batteryPercentage: "84" },
      },
    ],
  ]);
  const { engine, calls } = createEngine({
    getDevice: async (id) => {
      reads.push(id);
      return structuredClone(devices.get(id));
    },
  });
  const trigger = { type: "button", deviceId: "button-1", clickPattern: "singlePress" };

  await engine.create({
    name: "All state checks pass",
    trigger,
    conditions: {
      deviceStates: [
        { deviceId: "light-state", attribute: "isReachable", operator: "equals", value: true },
        { deviceId: "light-state", attribute: "isOn", operator: "notEquals", value: false },
        {
          deviceId: "light-state",
          attribute: "lightLevel",
          operator: "greaterThanOrEqual",
          value: 30,
        },
        {
          deviceId: "light-state",
          attribute: "colorTemperature",
          operator: "lessThanOrEqual",
          value: 2_700,
        },
        {
          deviceId: "sensor-state",
          attribute: "batteryPercentage",
          operator: "greaterThan",
          value: 50,
        },
        {
          deviceId: "sensor-state",
          attribute: "isDetected",
          operator: "equals",
          value: false,
        },
      ],
    },
    actions: [{ deviceId: "target-pass", isOn: true }],
  });
  await engine.create({
    name: "One state check fails",
    trigger,
    conditions: {
      deviceStates: [
        {
          deviceId: "light-state",
          attribute: "lightLevel",
          operator: "lessThan",
          value: 10,
        },
      ],
    },
    actions: [{ deviceId: "target-fail", isOn: true }],
  });
  await engine.create({
    name: "Malformed state fails closed",
    trigger,
    conditions: {
      deviceStates: [
        {
          deviceId: "malformed-state",
          attribute: "batteryPercentage",
          operator: "notEquals",
          value: 50,
        },
      ],
    },
    actions: [{ deviceId: "target-malformed", isOn: true }],
  });

  await engine.handleEvent({
    id: "state-event",
    type: "remotePressEvent",
    time: new Date().toISOString(),
    data: { id: "button-1", clickPattern: "singlePress" },
  });

  assert.deepEqual(
    calls.map((call) => call.id),
    ["target-pass"],
  );
  assert.deepEqual(reads.sort(), ["light-state", "malformed-state", "sensor-state"]);
  engine.stop();
});

test("Xiaomi and Home Assistant device state conditions support extended value types", async () => {
  const device = {
    id: "xiaomi-climate",
    isReachable: true,
    attributes: {
      waterTankFull: false,
      privacy: true,
      pm25: 12,
      pm10: 24,
      humidity: 46,
      targetHumidity: 50,
      temperature: 22.5,
      filterLife: 84,
      percentage: 65,
      presetMode: "Silent",
    },
  };
  const { engine, calls } = createEngine({
    getDevice: async () => structuredClone(device),
  });
  const rule = await engine.create({
    name: "Healthy Xiaomi state",
    trigger: { type: "button", deviceId: "button-1", clickPattern: "singlePress" },
    conditions: {
      deviceStates: [
        { deviceId: device.id, attribute: "waterTankFull", operator: "equals", value: false },
        { deviceId: device.id, attribute: "privacy", operator: "notEquals", value: false },
        { deviceId: device.id, attribute: "pm25", operator: "lessThanOrEqual", value: 12 },
        { deviceId: device.id, attribute: "pm10", operator: "lessThan", value: 25 },
        { deviceId: device.id, attribute: "humidity", operator: "greaterThan", value: 45 },
        { deviceId: device.id, attribute: "targetHumidity", operator: "equals", value: 50 },
        { deviceId: device.id, attribute: "temperature", operator: "greaterThan", value: 20 },
        { deviceId: device.id, attribute: "filterLife", operator: "greaterThan", value: 50 },
        { deviceId: device.id, attribute: "percentage", operator: "notEquals", value: 0 },
        { deviceId: device.id, attribute: "presetMode", operator: "equals", value: " Silent " },
      ],
    },
    actions: [{ deviceId: "target-pass", isOn: true }],
  });

  assert.equal(rule.conditions.deviceStates.at(-1).value, "Silent");
  await engine.handleEvent({
    id: "xiaomi-condition-event",
    type: "remotePressEvent",
    time: new Date().toISOString(),
    data: { id: "button-1", clickPattern: "singlePress" },
  });
  assert.deepEqual(calls.map((call) => call.id), ["target-pass"]);

  await assert.rejects(
    engine.create({
      name: "Invalid preset comparison",
      trigger: { type: "time", time: "12:00" },
      conditions: {
        deviceStates: [
          {
            deviceId: device.id,
            attribute: "presetMode",
            operator: "greaterThan",
            value: "Silent",
          },
        ],
      },
      actions: [{ deviceId: "target-invalid", isOn: true }],
    }),
    /not supported for presetMode/,
  );
  await assert.rejects(
    engine.create({
      name: "Invalid tank value",
      trigger: { type: "time", time: "12:00" },
      conditions: {
        deviceStates: [
          {
            deviceId: device.id,
            attribute: "waterTankFull",
            operator: "equals",
            value: "false",
          },
        ],
      },
      actions: [{ deviceId: "target-invalid", isOn: true }],
    }),
    /must be a boolean/,
  );
  engine.stop();
});

test("state triggers fire only when a supported comparison crosses from false to true", async () => {
  const { engine, calls } = createEngine();
  const pmRule = await engine.create({
    name: "Air quality worsened",
    trigger: {
      type: "state",
      deviceId: "purifier-1",
      attribute: "pm25",
      operator: "greaterThanOrEqual",
      value: 35,
    },
    actions: [{ deviceId: "purifier-1", attributes: { presetMode: "Auto" } }],
  });
  await engine.create({
    name: "Camera entered privacy mode",
    trigger: {
      type: "state",
      deviceId: "camera-1",
      attribute: "privacy",
      operator: "equals",
      value: true,
    },
    actions: [{ deviceId: "hall-light", isOn: false }],
  });
  assert.deepEqual(pmRule.trigger, {
    type: "state",
    deviceId: "purifier-1",
    attribute: "pm25",
    operator: "greaterThanOrEqual",
    value: 35,
  });

  const stateEvent = (id, deviceId, attributes, oldAttributes) => ({
    id,
    type: "deviceStateChanged",
    time: new Date().toISOString(),
    data: { id: deviceId, attributes, oldAttributes },
  });
  await engine.handleEvent(stateEvent("state-initial", "purifier-1", { pm25: 40 }, {}));
  await engine.handleEvent(
    stateEvent("state-malformed", "purifier-1", { pm25: "40" }, { pm25: 20 }),
  );
  await engine.handleEvent(stateEvent("state-cross-1", "purifier-1", { pm25: 35 }, { pm25: 20 }));
  await engine.handleEvent(stateEvent("state-stays-true", "purifier-1", { pm25: 50 }, { pm25: 35 }));
  await engine.handleEvent(stateEvent("state-falls", "purifier-1", { pm25: 30 }, { pm25: 50 }));
  await engine.handleEvent(stateEvent("state-cross-2", "purifier-1", { pm25: 36 }, { pm25: 30 }));
  await engine.handleEvent(
    stateEvent("privacy-cross", "camera-1", { privacy: true }, { privacy: false }),
  );
  await engine.handleEvent(
    stateEvent("privacy-stays", "camera-1", { privacy: true }, { privacy: true }),
  );

  assert.deepEqual(
    calls.map((call) => [call.id, call.attributes]),
    [
      ["purifier-1", { presetMode: "Auto" }],
      ["purifier-1", { presetMode: "Auto" }],
      ["hall-light", { isOn: false }],
    ],
  );
  assert.equal(engine.get(pmRule.id).runCount, 2);
  await assert.rejects(
    engine.create({
      name: "Unsupported state trigger",
      trigger: {
        type: "state",
        deviceId: "purifier-1",
        attribute: "unknownMetric",
        operator: "equals",
        value: 1,
      },
      actions: [{ deviceId: "purifier-1", isOn: true }],
    }),
    /not a supported device state/,
  );
  engine.stop();
});

test("deviceEvent triggers match an exact safe event type and device", async () => {
  const { engine, calls } = createEngine();
  const rule = await engine.create({
    name: "Camera person detected",
    trigger: {
      type: "deviceEvent",
      deviceId: "camera-1",
      eventType: "personDetected",
    },
    actions: [{ deviceId: "hall-light", isOn: true }],
  });
  assert.equal(rule.trigger.eventType, "personDetected");

  const event = (id, type, deviceId, eventType) => ({
    id,
    type,
    time: new Date().toISOString(),
    data: { id: deviceId, eventType },
  });
  await engine.handleEvent(event("camera-wrong-envelope", "cameraEvent", "camera-1", "personDetected"));
  await engine.handleEvent(event("camera-wrong-device", "deviceEvent", "camera-2", "personDetected"));
  await engine.handleEvent(event("camera-wrong-type", "deviceEvent", "camera-1", "petDetected"));
  await engine.handleEvent(event("camera-match", "deviceEvent", "camera-1", "personDetected"));
  assert.deepEqual(calls.map((call) => call.id), ["hall-light"]);

  await assert.rejects(
    engine.create({
      name: "Unsafe camera event",
      trigger: {
        type: "deviceEvent",
        deviceId: "camera-1",
        eventType: "../personDetected",
      },
      actions: [{ deviceId: "hall-light", isOn: true }],
    }),
    /unsupported characters/,
  );
  engine.stop();
});

test("condition read errors fail closed and produce a safe rule failure", async () => {
  const { engine, calls, executions } = createEngine({
    getDevice: async () => {
      const error = new Error("private hub detail");
      error.code = "HUB_OFFLINE";
      throw error;
    },
  });
  await engine.create({
    name: "Offline condition",
    trigger: { type: "motion", deviceId: "motion-1" },
    conditions: {
      deviceStates: [
        { deviceId: "light-state", attribute: "isOn", operator: "equals", value: false },
      ],
    },
    actions: [{ deviceId: "target", isOn: true }],
  });

  await engine.handleEvent({
    id: "offline-condition",
    type: "deviceStateChanged",
    time: new Date().toISOString(),
    data: { id: "motion-1", attributes: { isDetected: true } },
  });

  assert.equal(calls.length, 0);
  assert.equal(executions.length, 1);
  assert.equal(executions[0].status, "error");
  assert.equal(executions[0].source, "condition");
  assert.equal(executions[0].error.code, "RULE_CONDITION_READ_FAILED");
  engine.stop();
});

test("a failed target does not stop later targets and the attempted run is recorded", async () => {
  const executions = [];
  const calls = [];
  const engine = new RuleEngine({
    rules: [],
    saveRules: async () => {},
    setDeviceAttributes: async (request) => {
      calls.push(structuredClone(request));
      if (request.id === "bad-light") {
        const error = new Error("unreachable");
        error.code = "DEVICE_UNREACHABLE";
        throw error;
      }
    },
    onExecution: (execution) => executions.push(execution),
  });
  const rule = await engine.create({
    name: "Continue after failure",
    trigger: { type: "button", deviceId: "button-1", clickPattern: "doublePress" },
    actions: [
      { deviceId: "bad-light", isOn: true, brightness: 40 },
      { deviceId: "good-light", isOn: true, brightness: 30, transitionTime: 750 },
    ],
    cooldownSeconds: 60,
  });

  await engine.handleEvent({
    id: "partial-1",
    type: "remotePressEvent",
    time: new Date().toISOString(),
    data: { id: "button-1", clickPattern: "doublePress" },
  });

  assert.deepEqual(
    calls.map((call) => [call.id, call.attributes, call.transitionTime]),
    [
      ["bad-light", { isOn: true }, undefined],
      ["bad-light", { lightLevel: 40 }, undefined],
      ["good-light", { isOn: true }, 750],
      ["good-light", { lightLevel: 30 }, 750],
    ],
  );
  assert.equal(engine.get(rule.id).runCount, 1);
  assert.equal(executions.length, 1);
  assert.equal(executions[0].status, "error");
  assert.equal(executions[0].error.code, "RULE_ACTIONS_PARTIAL_FAILURE");
  assert.equal(executions[0].error.failures.length, 2);

  await engine.handleEvent({
    id: "partial-2",
    type: "remotePressEvent",
    time: new Date().toISOString(),
    data: { id: "button-1", clickPattern: "doublePress" },
  });
  assert.equal(calls.length, 4, "cooldown prevents an immediate second attempt");
  engine.stop();
});

test("auto-off remains armed when turning on succeeds but a later attribute fails", async () => {
  const calls = [];
  const executions = [];
  const engine = new RuleEngine({
    rules: [],
    saveRules: async () => {},
    setDeviceAttributes: async (request) => {
      calls.push(structuredClone(request));
      if (request.attributes.lightLevel !== undefined) {
        const error = new Error("brightness rejected");
        error.code = "ATTRIBUTE_REJECTED";
        throw error;
      }
    },
    onExecution: (execution) => executions.push(execution),
  });
  await engine.create({
    name: "Safe partial auto-off",
    trigger: { type: "button", deviceId: "button-1", clickPattern: "singlePress" },
    actions: [{ deviceId: "light-1", isOn: true, brightness: 40, offAfterSeconds: 1 }],
  });

  await engine.handleEvent({
    id: "partial-auto-off",
    type: "remotePressEvent",
    time: new Date().toISOString(),
    data: { id: "button-1", clickPattern: "singlePress" },
  });
  await new Promise((resolve) => setTimeout(resolve, 1_050));

  assert.deepEqual(calls.map((call) => call.attributes), [
    { isOn: true },
    { lightLevel: 40 },
    { isOn: false },
  ]);
  assert.equal(executions[0].error.code, "RULE_ACTIONS_PARTIAL_FAILURE");
  assert.equal(executions.at(-1).source, "offTimer");
  engine.stop();
});

test("motion cleared is a distinct trigger and advanced action options are preserved", async () => {
  const { engine, calls } = createEngine();
  const rule = await engine.create({
    name: "After motion clears",
    trigger: { type: "motion", deviceId: "motion-1", isDetected: false },
    actions: [
      {
        deviceId: "light-1",
        isOn: true,
        brightness: 25,
        temperature: 2_200,
        transitionTime: 1_500,
        offAfterSeconds: 30,
      },
    ],
  });
  assert.equal(rule.trigger.isDetected, false);
  assert.equal(rule.actions[0].transitionTime, 1_500);
  assert.equal(rule.actions[0].offAfterSeconds, 30);

  await engine.handleEvent({
    id: "motion-on",
    type: "deviceStateChanged",
    time: new Date().toISOString(),
    data: { id: "motion-1", attributes: { isDetected: true } },
  });
  assert.equal(calls.length, 0);
  await engine.handleEvent({
    id: "motion-off",
    type: "deviceStateChanged",
    time: new Date().toISOString(),
    data: { id: "motion-1", attributes: { isDetected: false } },
  });
  assert.equal(calls.length, 3);
  assert.ok(calls.every((call) => call.transitionTime === 1_500));
  engine.stop();
});
