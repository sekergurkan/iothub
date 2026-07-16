import { randomUUID } from "node:crypto";

const DAY_NAMES = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const DAY_ALIASES = new Map([
  ["sun", "Sun"],
  ["sunday", "Sun"],
  ["mon", "Mon"],
  ["monday", "Mon"],
  ["tue", "Tue"],
  ["tues", "Tue"],
  ["tuesday", "Tue"],
  ["wed", "Wed"],
  ["wednesday", "Wed"],
  ["thu", "Thu"],
  ["thur", "Thu"],
  ["thurs", "Thu"],
  ["thursday", "Thu"],
  ["fri", "Fri"],
  ["friday", "Fri"],
  ["sat", "Sat"],
  ["saturday", "Sat"],
]);
const FORBIDDEN_KEYS = new Set(["__proto__", "prototype", "constructor"]);
const CLICK_PATTERNS = new Set(["singlePress", "doublePress", "longPress"]);
const TRIGGER_TYPES = new Set(["motion", "occupancy", "button", "time"]);

export class RuleValidationError extends Error {
  constructor(message, path = undefined) {
    super(message);
    this.name = "RuleValidationError";
    this.code = "INVALID_RULE";
    this.status = 400;
    this.details = path ? { path } : undefined;
  }
}

function fail(message, path) {
  throw new RuleValidationError(message, path);
}

function isObject(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function requiredString(value, path, maximum = 160) {
  if (typeof value !== "string" || !value.trim() || value.trim().length > maximum) {
    fail(`${path} must be a non-empty string of at most ${maximum} characters.`, path);
  }
  return value.trim();
}

function normalizeRuleId(value) {
  if (value === undefined || value === null || value === "") return randomUUID();
  if (typeof value !== "string" || !/^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/.test(value)) {
    fail("id contains unsupported characters.", "id");
  }
  return value;
}

function normalizeDeviceId(value, path) {
  const id = requiredString(value, path, 128);
  if (!/^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/.test(id)) {
    fail(`${path} contains unsupported characters.`, path);
  }
  return id;
}

function optionalInteger(value, path, { minimum = 0, maximum }) {
  if (value === undefined || value === null) return undefined;
  if (
    !Number.isInteger(value) ||
    value < minimum ||
    (maximum !== undefined && value > maximum)
  ) {
    fail(`${path} must be an integer between ${minimum} and ${maximum}.`, path);
  }
  return value;
}

function normalizeTime(value, path) {
  if (typeof value !== "string") fail(`${path} must use HH:MM format.`, path);
  const match = /^(\d{1,2}):(\d{2})$/.exec(value.trim());
  if (!match) fail(`${path} must use HH:MM format.`, path);
  const hour = Number(match[1]);
  const minute = Number(match[2]);
  if (hour > 23 || minute > 59) fail(`${path} must contain a valid local time.`, path);
  return `${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}`;
}

function normalizeDays(value, path) {
  if (value === undefined || value === null) return undefined;
  if (!Array.isArray(value) || value.length === 0 || value.length > 7) {
    fail(`${path} must be a non-empty array of weekday names.`, path);
  }

  const days = value.map((day, index) => {
    if (typeof day !== "string") {
      fail(`${path}[${index}] must be a weekday name.`, `${path}[${index}]`);
    }
    const normalized = DAY_ALIASES.get(day.trim().toLowerCase());
    if (!normalized) {
      fail(`${path}[${index}] is not a supported weekday.`, `${path}[${index}]`);
    }
    return normalized;
  });
  return [...new Set(days)];
}

function safeClone(value, path = "value", depth = 0) {
  if (depth > 8) fail(`${path} is nested too deeply.`, path);
  if (value === null || typeof value === "string" || typeof value === "boolean") {
    return value;
  }
  if (typeof value === "number") {
    if (!Number.isFinite(value)) fail(`${path} must contain finite numbers.`, path);
    return value;
  }
  if (Array.isArray(value)) {
    if (value.length > 128) fail(`${path} contains too many items.`, path);
    return value.map((item, index) => safeClone(item, `${path}[${index}]`, depth + 1));
  }
  if (!isObject(value)) fail(`${path} must contain JSON values only.`, path);

  const entries = Object.entries(value);
  if (entries.length > 64) fail(`${path} contains too many fields.`, path);
  const clone = {};
  for (const [key, item] of entries) {
    if (FORBIDDEN_KEYS.has(key)) fail(`${path} contains a forbidden field.`, `${path}.${key}`);
    clone[key] = safeClone(item, `${path}.${key}`, depth + 1);
  }
  return clone;
}

function normalizeTrigger(input) {
  if (!isObject(input)) fail("trigger must be an object.", "trigger");
  if (!TRIGGER_TYPES.has(input.type)) {
    fail("trigger.type must be motion, occupancy, button, or time.", "trigger.type");
  }

  if (input.type === "time") {
    const days = normalizeDays(input.days, "trigger.days");
    return {
      type: "time",
      time: normalizeTime(input.time, "trigger.time"),
      ...(days ? { days } : {}),
    };
  }

  const trigger = {
    type: input.type,
    deviceId: normalizeDeviceId(input.deviceId, "trigger.deviceId"),
  };

  if (input.type === "button") {
    if (!CLICK_PATTERNS.has(input.clickPattern)) {
      fail(
        "trigger.clickPattern must be singlePress, doublePress, or longPress.",
        "trigger.clickPattern",
      );
    }
    trigger.clickPattern = input.clickPattern;
  } else {
    if (input.isDetected !== undefined && typeof input.isDetected !== "boolean") {
      fail("trigger.isDetected must be a boolean.", "trigger.isDetected");
    }
    trigger.isDetected = input.isDetected ?? true;
  }

  return trigger;
}

function normalizeConditions(input) {
  if (input === undefined || input === null) return {};
  if (!isObject(input)) fail("conditions must be an object.", "conditions");

  const startValue = input.startTime ?? input.timeRange?.start ?? input.time?.start;
  const endValue = input.endTime ?? input.timeRange?.end ?? input.time?.end;
  if ((startValue === undefined) !== (endValue === undefined)) {
    fail(
      "conditions.startTime and conditions.endTime must be provided together.",
      "conditions",
    );
  }

  const days = normalizeDays(input.days, "conditions.days");
  return {
    ...(days ? { days } : {}),
    ...(startValue !== undefined
      ? {
          startTime: normalizeTime(startValue, "conditions.startTime"),
          endTime: normalizeTime(endValue, "conditions.endTime"),
        }
      : {}),
  };
}

function normalizeAction(input, index) {
  const path = `actions[${index}]`;
  if (!isObject(input)) fail(`${path} must be an object.`, path);

  const deviceId = normalizeDeviceId(input.deviceId ?? input.targetId, `${path}.deviceId`);
  const attributesInput = input.attributes;
  if (attributesInput !== undefined && !isObject(attributesInput)) {
    fail(`${path}.attributes must be an object.`, `${path}.attributes`);
  }
  const attributes = attributesInput ? safeClone(attributesInput, `${path}.attributes`) : {};

  if (input.isOn !== undefined) {
    if (typeof input.isOn !== "boolean") {
      fail(`${path}.isOn must be a boolean.`, `${path}.isOn`);
    }
    attributes.isOn = input.isOn;
  }

  if (input.brightness !== undefined) {
    if (
      typeof input.brightness !== "number" ||
      !Number.isFinite(input.brightness) ||
      input.brightness < 1 ||
      input.brightness > 100
    ) {
      fail(`${path}.brightness must be between 1 and 100.`, `${path}.brightness`);
    }
    attributes.lightLevel = input.brightness;
  }

  if (input.temperature !== undefined) {
    if (
      typeof input.temperature !== "number" ||
      !Number.isFinite(input.temperature) ||
      input.temperature < 1_500 ||
      input.temperature > 6_500
    ) {
      fail(
        `${path}.temperature must be between 1500 and 6500 kelvin.`,
        `${path}.temperature`,
      );
    }
    attributes.colorTemperature = input.temperature;
  }

  if (Object.keys(attributes).length === 0) {
    fail(`${path} must define at least one light attribute.`, path);
  }
  if (JSON.stringify(attributes).length > 16_384) {
    fail(`${path}.attributes is too large.`, `${path}.attributes`);
  }

  const transitionTime = optionalInteger(input.transitionTime, `${path}.transitionTime`, {
    minimum: 0,
    maximum: 600_000,
  });
  const offAfterSeconds = optionalInteger(
    input.offAfterSeconds,
    `${path}.offAfterSeconds`,
    { minimum: 1, maximum: 86_400 },
  );

  return {
    deviceId,
    ...(input.isOn !== undefined ? { isOn: input.isOn } : {}),
    ...(input.brightness !== undefined ? { brightness: input.brightness } : {}),
    ...(input.temperature !== undefined ? { temperature: input.temperature } : {}),
    ...(attributesInput ? { attributes } : {}),
    ...(transitionTime !== undefined ? { transitionTime } : {}),
    ...(offAfterSeconds !== undefined ? { offAfterSeconds } : {}),
  };
}

function isIsoDate(value) {
  return (
    typeof value === "string" &&
    Number.isFinite(Date.parse(value)) &&
    new Date(value).toISOString() === value
  );
}

export function normalizeRule(
  input,
  { existing = null, stored = false, replace = false } = {},
) {
  if (!isObject(input)) fail("The rule must be a JSON object.");

  const name = requiredString(input.name ?? existing?.name, "name", 120);
  const enabledValue = input.enabled ?? existing?.enabled ?? true;
  if (typeof enabledValue !== "boolean") fail("enabled must be a boolean.", "enabled");

  const trigger = normalizeTrigger(input.trigger ?? existing?.trigger);
  const conditions = normalizeConditions(input.conditions ?? existing?.conditions);
  const actionInput = input.actions ?? existing?.actions;
  if (!Array.isArray(actionInput) || actionInput.length === 0 || actionInput.length > 32) {
    fail("actions must contain between 1 and 32 actions.", "actions");
  }
  const actions = actionInput.map(normalizeAction);
  const offAfterValue = Object.hasOwn(input, "offAfterSeconds")
    ? input.offAfterSeconds
    : replace
      ? undefined
      : existing?.offAfterSeconds;
  const cooldownValue = Object.hasOwn(input, "cooldownSeconds")
    ? input.cooldownSeconds
    : replace
      ? undefined
      : existing?.cooldownSeconds;
  const offAfterSeconds = optionalInteger(
    offAfterValue,
    "offAfterSeconds",
    { minimum: 1, maximum: 86_400 },
  );
  const cooldownSeconds = optionalInteger(
    cooldownValue,
    "cooldownSeconds",
    { minimum: 0, maximum: 86_400 },
  );

  const now = new Date().toISOString();
  const idValue = existing?.id ?? input.id;
  const id = normalizeRuleId(idValue);
  const createdAt =
    (stored && isIsoDate(input.createdAt) && input.createdAt) || existing?.createdAt || now;
  const lastRunInput = stored ? input.lastRun : existing?.lastRun;
  const lastRun = isIsoDate(lastRunInput) ? lastRunInput : null;
  const runCountInput = stored ? input.runCount : existing?.runCount;
  const runCount = Number.isInteger(runCountInput) && runCountInput >= 0 ? runCountInput : 0;

  return {
    id,
    name,
    enabled: enabledValue,
    trigger,
    conditions,
    actions,
    ...(offAfterSeconds !== undefined ? { offAfterSeconds } : {}),
    ...(cooldownSeconds !== undefined ? { cooldownSeconds } : {}),
    lastRun,
    runCount,
    createdAt,
    updatedAt: stored && isIsoDate(input.updatedAt) ? input.updatedAt : now,
  };
}

function clockValue(date) {
  return date.getHours() * 60 + date.getMinutes();
}

function parseTimeValue(time) {
  const [hour, minute] = time.split(":").map(Number);
  return hour * 60 + minute;
}

function dayMatches(days, date) {
  return !days || days.includes(DAY_NAMES[date.getDay()]);
}

function conditionsMatch(conditions, date) {
  if (!conditions.startTime) return dayMatches(conditions.days, date);

  const value = clockValue(date);
  const start = parseTimeValue(conditions.startTime);
  const end = parseTimeValue(conditions.endTime);
  if (start <= end) {
    return dayMatches(conditions.days, date) && value >= start && value <= end;
  }

  if (value >= start) return dayMatches(conditions.days, date);
  if (value <= end) {
    const previousDay = DAY_NAMES[(date.getDay() + 6) % 7];
    return !conditions.days || conditions.days.includes(previousDay);
  }
  return false;
}

function ruleIsCoolingDown(rule, now = Date.now()) {
  return Boolean(
    rule.cooldownSeconds &&
      rule.lastRun &&
      now - Date.parse(rule.lastRun) < rule.cooldownSeconds * 1_000,
  );
}

function eventMatchesTrigger(trigger, event) {
  if (trigger.type === "button") {
    return (
      event?.type === "remotePressEvent" &&
      event?.data?.id === trigger.deviceId &&
      event?.data?.clickPattern === trigger.clickPattern
    );
  }

  if (trigger.type === "motion" || trigger.type === "occupancy") {
    return (
      event?.type === "deviceStateChanged" &&
      event?.data?.id === trigger.deviceId &&
      event?.data?.attributes?.isDetected === trigger.isDetected
    );
  }

  return false;
}

function actionAttributes(action) {
  const attributes = action.attributes ? safeClone(action.attributes, "action.attributes") : {};
  if (action.isOn !== undefined) attributes.isOn = action.isOn;
  if (action.brightness !== undefined) attributes.lightLevel = action.brightness;
  if (action.temperature !== undefined) attributes.colorTemperature = action.temperature;
  return attributes;
}

function minuteKey(date) {
  return `${date.getFullYear()}-${date.getMonth()}-${date.getDate()}-${date.getHours()}-${date.getMinutes()}`;
}

export class RuleEngine {
  #rules;
  #saveRules;
  #setDeviceAttributes;
  #onExecution;
  #mutationQueue = Promise.resolve();
  #running = new Set();
  #pendingEvents = new Map();
  #offTimers = new Map();
  #deviceActionVersions = new Map();
  #seenEventIds = new Set();
  #seenEventOrder = [];
  #scheduleTimer = null;
  #lastMinute = minuteKey(new Date());
  #stopped = false;

  constructor({ rules, saveRules, setDeviceAttributes, onExecution = () => {} }) {
    this.#rules = rules.map((rule, index) => {
      try {
        return normalizeRule(rule, { stored: true });
      } catch (error) {
        if (error instanceof RuleValidationError) {
          error.message = `Stored rule ${index} is invalid: ${error.message}`;
          error.code = "INVALID_LOCAL_DATA";
          error.status = 500;
        }
        throw error;
      }
    });
    if (new Set(this.#rules.map((rule) => rule.id)).size !== this.#rules.length) {
      const error = new Error("The local rules file contains duplicate rule ids.");
      error.code = "INVALID_LOCAL_DATA";
      error.status = 500;
      throw error;
    }
    this.#saveRules = saveRules;
    this.#setDeviceAttributes = setDeviceAttributes;
    this.#onExecution = onExecution;
  }

  start() {
    if (this.#stopped || this.#scheduleTimer) return;
    this.#scheduleNextTick();
  }

  #scheduleNextTick() {
    if (this.#stopped) return;
    const delay = 60_000 - (Date.now() % 60_000) + 50;
    this.#scheduleTimer = setTimeout(() => {
      this.#scheduleTimer = null;
      this.handleTimeTick(new Date()).catch((error) => {
        this.#onExecution({ status: "error", source: "scheduler", error });
      });
      this.#scheduleNextTick();
    }, delay);
    this.#scheduleTimer.unref?.();
  }

  list() {
    return structuredClone(this.#rules);
  }

  get(id) {
    const rule = this.#rules.find((item) => item.id === id);
    return rule ? structuredClone(rule) : null;
  }

  #mutate(mutator) {
    const operation = this.#mutationQueue.then(async () => {
      const { nextRules, result } = mutator(this.#rules);
      await this.#saveRules(nextRules);
      this.#rules = nextRules;
      return structuredClone(result);
    });
    this.#mutationQueue = operation.catch(() => {});
    return operation;
  }

  create(input) {
    return this.#mutate((rules) => {
      const rule = normalizeRule(input);
      if (rules.some((item) => item.id === rule.id)) {
        const error = new Error("A rule with this id already exists.");
        error.code = "RULE_ALREADY_EXISTS";
        error.status = 409;
        throw error;
      }
      return { nextRules: [...rules, rule], result: rule };
    });
  }

  update(id, input, { replace = false } = {}) {
    const operation = this.#mutate((rules) => {
      const index = rules.findIndex((rule) => rule.id === id);
      if (index === -1) {
        const error = new Error("The requested rule does not exist.");
        error.code = "RULE_NOT_FOUND";
        error.status = 404;
        throw error;
      }
      const rule = normalizeRule(input, { existing: rules[index], replace });
      const nextRules = rules.slice();
      nextRules[index] = rule;
      return { nextRules, result: rule };
    });
    return operation.then((rule) => {
      this.#clearRuleTimers(id);
      return rule;
    });
  }

  delete(id) {
    const operation = this.#mutate((rules) => {
      const index = rules.findIndex((rule) => rule.id === id);
      if (index === -1) {
        const error = new Error("The requested rule does not exist.");
        error.code = "RULE_NOT_FOUND";
        error.status = 404;
        throw error;
      }
      const [removed] = rules.slice(index, index + 1);
      return {
        nextRules: rules.filter((rule) => rule.id !== id),
        result: removed,
      };
    });
    return operation.then((rule) => {
      this.#clearRuleTimers(id);
      return rule;
    });
  }

  async handleEvent(event) {
    if (this.#stopped || !event || typeof event !== "object") return;
    if (typeof event.id === "string") {
      if (this.#seenEventIds.has(event.id)) return;
      this.#seenEventIds.add(event.id);
      this.#seenEventOrder.push(event.id);
      if (this.#seenEventOrder.length > 1_000) {
        this.#seenEventIds.delete(this.#seenEventOrder.shift());
      }
    }

    const eventDate = Number.isFinite(Date.parse(event.time)) ? new Date(event.time) : new Date();
    const matches = this.#rules.filter(
      (rule) =>
        rule.enabled &&
        eventMatchesTrigger(rule.trigger, event) &&
        conditionsMatch(rule.conditions, eventDate),
    );
    await Promise.allSettled(matches.map((rule) => this.#execute(rule, event)));
  }

  async handleTimeTick(date = new Date()) {
    const key = minuteKey(date);
    if (key === this.#lastMinute) return;
    this.#lastMinute = key;

    const time = `${String(date.getHours()).padStart(2, "0")}:${String(
      date.getMinutes(),
    ).padStart(2, "0")}`;
    const matches = this.#rules.filter(
      (rule) =>
        rule.enabled &&
        rule.trigger.type === "time" &&
        rule.trigger.time === time &&
        dayMatches(rule.trigger.days, date) &&
        conditionsMatch(rule.conditions, date),
    );
    await Promise.allSettled(matches.map((rule) => this.#execute(rule, { type: "time", time })));
  }

  async #execute(rule, triggerEvent) {
    if (this.#running.has(rule.id)) {
      this.#pendingEvents.set(rule.id, triggerEvent);
      return;
    }
    this.#running.add(rule.id);
    let currentRule = rule;
    let currentEvent = triggerEvent;
    let firstError;
    try {
      while (currentRule && !this.#stopped) {
        if (ruleIsCoolingDown(currentRule)) break;
        try {
          await this.#executeOnce(currentRule, currentEvent);
        } catch (error) {
          firstError ??= error;
        }

        const pendingEvent = this.#pendingEvents.get(rule.id);
        if (!pendingEvent) break;
        this.#pendingEvents.delete(rule.id);
        currentRule = this.#rules.find((item) => item.id === rule.id && item.enabled);
        currentEvent = pendingEvent;
      }
    } finally {
      this.#running.delete(rule.id);
      this.#pendingEvents.delete(rule.id);
    }

    if (firstError) throw firstError;
  }

  async #executeOnce(rule, triggerEvent) {
    const startedAt = new Date().toISOString();
    try {
      for (const action of rule.actions) {
        const attributes = actionAttributes(action);
        const actionVersion = this.#beginDeviceAction(action.deviceId);
        await this.#setDeviceAttributes({
          id: action.deviceId,
          attributes,
          transitionTime: action.transitionTime,
        });

        const delay = action.offAfterSeconds ?? rule.offAfterSeconds;
        if (
          delay &&
          attributes.isOn === true &&
          this.#deviceActionVersions.get(action.deviceId) === actionVersion
        ) {
          this.#scheduleOff(rule, action, delay, actionVersion);
        }
      }

      await this.#recordRun(rule.id, startedAt);
      this.#onExecution({
        status: "success",
        ruleId: rule.id,
        ruleName: rule.name,
        triggerEvent,
        at: startedAt,
      });
    } catch (error) {
      this.#onExecution({
        status: "error",
        ruleId: rule.id,
        ruleName: rule.name,
        triggerEvent,
        error,
        at: startedAt,
      });
      throw error;
    }
  }

  async #recordRun(id, lastRun) {
    await this.#mutate((rules) => {
      const index = rules.findIndex((rule) => rule.id === id);
      if (index === -1) return { nextRules: rules, result: null };
      const updated = {
        ...rules[index],
        lastRun,
        runCount: rules[index].runCount + 1,
      };
      const nextRules = rules.slice();
      nextRules[index] = updated;
      return { nextRules, result: updated };
    });
  }

  #beginDeviceAction(deviceId) {
    const version = (this.#deviceActionVersions.get(deviceId) ?? 0) + 1;
    this.#deviceActionVersions.set(deviceId, version);
    this.#clearDeviceTimer(deviceId);
    return version;
  }

  #clearDeviceTimer(deviceId) {
    const existing = this.#offTimers.get(deviceId);
    if (!existing) return;
    clearTimeout(existing.timer);
    this.#offTimers.delete(deviceId);
  }

  #scheduleOff(rule, action, seconds, actionVersion) {
    this.#clearDeviceTimer(action.deviceId);

    const timer = setTimeout(async () => {
      const current = this.#offTimers.get(action.deviceId);
      if (
        current?.timer !== timer ||
        this.#deviceActionVersions.get(action.deviceId) !== actionVersion
      ) {
        return;
      }
      this.#offTimers.delete(action.deviceId);
      try {
        await this.#setDeviceAttributes({
          id: action.deviceId,
          attributes: { isOn: false },
          transitionTime: action.transitionTime,
        });
        this.#onExecution({
          status: "success",
          source: "offTimer",
          ruleId: rule.id,
          ruleName: rule.name,
          deviceId: action.deviceId,
          at: new Date().toISOString(),
        });
      } catch (error) {
        this.#onExecution({
          status: "error",
          source: "offTimer",
          ruleId: rule.id,
          ruleName: rule.name,
          deviceId: action.deviceId,
          error,
          at: new Date().toISOString(),
        });
      }
    }, seconds * 1_000);
    timer.unref?.();
    this.#offTimers.set(action.deviceId, { timer, ruleId: rule.id });
  }

  #clearRuleTimers(ruleId) {
    for (const [deviceId, entry] of this.#offTimers) {
      if (entry.ruleId === ruleId) {
        clearTimeout(entry.timer);
        this.#offTimers.delete(deviceId);
      }
    }
  }

  stop() {
    this.#stopped = true;
    if (this.#scheduleTimer) clearTimeout(this.#scheduleTimer);
    this.#scheduleTimer = null;
    for (const entry of this.#offTimers.values()) clearTimeout(entry.timer);
    this.#offTimers.clear();
    this.#pendingEvents.clear();
  }
}
