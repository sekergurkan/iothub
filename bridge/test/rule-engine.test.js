import assert from "node:assert/strict";
import test from "node:test";
import { RuleEngine } from "../src/rule-engine.js";

test("motion and button events execute mapped light attributes once", async () => {
  const calls = [];
  let persisted = [];
  const engine = new RuleEngine({
    rules: [],
    saveRules: async (rules) => {
      persisted = structuredClone(rules);
    },
    setDeviceAttributes: async (request) => calls.push(structuredClone(request)),
  });

  const motionRule = await engine.create({
    name: "Hall motion",
    enabled: true,
    trigger: { type: "motion", deviceId: "motion-1" },
    conditions: {},
    actions: [
      {
        deviceId: "light-1",
        isOn: true,
        brightness: 72,
        temperature: 2700,
      },
    ],
  });

  const event = {
    id: "event-1",
    type: "deviceStateChanged",
    time: new Date().toISOString(),
    data: { id: "motion-1", attributes: { isDetected: true } },
  };
  await engine.handleEvent(event);
  await engine.handleEvent(event);

  assert.deepEqual(calls, [
    {
      id: "light-1",
      attributes: {
        isOn: true,
        lightLevel: 72,
        colorTemperature: 2700,
      },
      transitionTime: undefined,
    },
  ]);
  const storedMotionRule = persisted.find((rule) => rule.id === motionRule.id);
  assert.equal(storedMotionRule.runCount, 1);
  assert.ok(storedMotionRule.lastRun);

  await engine.create({
    name: "Button",
    trigger: {
      type: "button",
      deviceId: "remote-1",
      clickPattern: "doublePress",
    },
    actions: [{ deviceId: "light-2", isOn: false }],
  });
  await engine.handleEvent({
    id: "event-2",
    type: "remotePressEvent",
    time: new Date().toISOString(),
    data: { id: "remote-1", clickPattern: "doublePress" },
  });
  assert.deepEqual(calls.at(-1).attributes, { isOn: false });
  engine.stop();
});

test("time rules honor local weekday and time conditions", async () => {
  const calls = [];
  const engine = new RuleEngine({
    rules: [],
    saveRules: async () => {},
    setDeviceAttributes: async (request) => calls.push(request),
  });

  const date = new Date(2032, 3, 5, 8, 30, 0, 0);
  const day = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"][date.getDay()];
  await engine.create({
    name: "Morning",
    trigger: { type: "time", time: "08:30", days: [day] },
    conditions: { days: [day], startTime: "08:00", endTime: "09:00" },
    actions: [{ deviceId: "light-1", isOn: true }],
  });

  await engine.handleTimeTick(date);
  await engine.handleTimeTick(date);
  assert.equal(calls.length, 1);
  assert.deepEqual(calls[0].attributes, { isOn: true });
  engine.stop();
});

test("events arriving during a run are coalesced and executed afterwards", async () => {
  const calls = [];
  let releaseFirst;
  let markFirstStarted;
  const firstStarted = new Promise((resolve) => {
    markFirstStarted = resolve;
  });
  const firstBlocked = new Promise((resolve) => {
    releaseFirst = resolve;
  });
  const engine = new RuleEngine({
    rules: [],
    saveRules: async () => {},
    setDeviceAttributes: async (request) => {
      calls.push(request);
      if (calls.length === 1) {
        markFirstStarted();
        await firstBlocked;
      }
    },
  });

  await engine.create({
    name: "Busy motion",
    trigger: { type: "motion", deviceId: "motion-1" },
    actions: [{ deviceId: "light-1", isOn: true }],
  });
  const firstRun = engine.handleEvent({
    id: "queued-1",
    type: "deviceStateChanged",
    time: new Date().toISOString(),
    data: { id: "motion-1", attributes: { isDetected: true } },
  });
  await firstStarted;
  await engine.handleEvent({
    id: "queued-2",
    type: "deviceStateChanged",
    time: new Date().toISOString(),
    data: { id: "motion-1", attributes: { isDetected: true } },
  });
  releaseFirst();
  await firstRun;

  assert.equal(calls.length, 2);
  assert.equal(engine.list()[0].runCount, 2);
  engine.stop();
});

test("a later rule action supersedes another rule's delayed off timer", async () => {
  const calls = [];
  const engine = new RuleEngine({
    rules: [],
    saveRules: async () => {},
    setDeviceAttributes: async (request) => calls.push(structuredClone(request)),
  });
  await engine.create({
    name: "Short timer",
    trigger: { type: "button", deviceId: "remote-1", clickPattern: "singlePress" },
    actions: [{ deviceId: "light-1", isOn: true }],
    offAfterSeconds: 1,
  });
  await engine.create({
    name: "Keep on",
    trigger: { type: "button", deviceId: "remote-2", clickPattern: "singlePress" },
    actions: [{ deviceId: "light-1", isOn: true }],
  });

  await engine.handleEvent({
    id: "timer-1",
    type: "remotePressEvent",
    time: new Date().toISOString(),
    data: { id: "remote-1", clickPattern: "singlePress" },
  });
  await new Promise((resolve) => setTimeout(resolve, 100));
  await engine.handleEvent({
    id: "timer-2",
    type: "remotePressEvent",
    time: new Date().toISOString(),
    data: { id: "remote-2", clickPattern: "singlePress" },
  });
  await new Promise((resolve) => setTimeout(resolve, 1_050));

  assert.equal(calls.filter((call) => call.attributes.isOn === false).length, 0);
  engine.stop();
});

test("overnight weekday conditions carry into the following morning", async () => {
  const calls = [];
  const engine = new RuleEngine({
    rules: [],
    saveRules: async () => {},
    setDeviceAttributes: async (request) => calls.push(request),
  });
  await engine.create({
    name: "Monday night",
    trigger: { type: "motion", deviceId: "motion-1" },
    conditions: { days: ["Mon"], startTime: "20:00", endTime: "07:00" },
    actions: [{ deviceId: "light-1", isOn: true }],
  });

  const mondayNight = new Date(2032, 0, 1, 22, 0, 0, 0);
  while (mondayNight.getDay() !== 1) mondayNight.setDate(mondayNight.getDate() + 1);
  const mondayMorning = new Date(mondayNight);
  mondayMorning.setHours(1);
  const tuesdayMorning = new Date(mondayNight);
  tuesdayMorning.setDate(tuesdayMorning.getDate() + 1);
  tuesdayMorning.setHours(1);

  await engine.handleEvent({
    id: "overnight-before",
    type: "deviceStateChanged",
    time: mondayMorning.toISOString(),
    data: { id: "motion-1", attributes: { isDetected: true } },
  });
  await engine.handleEvent({
    id: "overnight-after",
    type: "deviceStateChanged",
    time: tuesdayMorning.toISOString(),
    data: { id: "motion-1", attributes: { isDetected: true } },
  });

  assert.equal(calls.length, 1);
  engine.stop();
});

test("rule replacement clears optional durations and rejects unsafe device ids", async () => {
  const engine = new RuleEngine({
    rules: [],
    saveRules: async () => {},
    setDeviceAttributes: async () => {},
  });
  const created = await engine.create({
    name: "Replace me",
    trigger: { type: "time", time: "12:00" },
    actions: [{ deviceId: "light-1", isOn: true }],
    offAfterSeconds: 60,
    cooldownSeconds: 10,
  });
  const replaced = await engine.update(
    created.id,
    {
      name: "Replaced",
      trigger: { type: "time", time: "12:00" },
      conditions: {},
      actions: [{ deviceId: "light-1", isOn: true }],
    },
    { replace: true },
  );
  assert.equal(replaced.offAfterSeconds, undefined);
  assert.equal(replaced.cooldownSeconds, undefined);
  await assert.rejects(
    engine.create({
      name: "Unsafe",
      trigger: { type: "motion", deviceId: "../motion" },
      actions: [{ deviceId: "light-1", isOn: true }],
    }),
    /unsupported characters/,
  );
  engine.stop();
});
