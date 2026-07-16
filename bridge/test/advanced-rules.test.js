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
