import { createHash, randomUUID } from "node:crypto";
import { isIP } from "node:net";
import WebSocket from "ws";

const REQUEST_TIMEOUT_MS = 12_000;
const SOCKET_TIMEOUT_MS = 15_000;
const XIAOMI_PLATFORMS = new Set(["xiaomi_home", "xiaomi_miio", "miot"]);
const SUPPORTED_TYPES = new Set(["light", "airPurifier", "dehumidifier", "camera"]);

function apiError(code, message, status = 500) {
  const error = new Error(message);
  error.code = code;
  error.status = status;
  return error;
}

function isPrivateIPv4(hostname) {
  const [a, b] = hostname.split(".").map(Number);
  return (
    a === 10 ||
    a === 127 ||
    (a === 169 && b === 254) ||
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 168) ||
    (a === 100 && b >= 64 && b <= 127)
  );
}

function isPrivateHost(hostname) {
  const normalized = hostname.toLowerCase().replace(/^\[|\]$/g, "");
  if (
    normalized === "localhost" ||
    normalized === "host.docker.internal" ||
    normalized.endsWith(".local")
  ) {
    return true;
  }
  const version = isIP(normalized);
  if (version === 4) return isPrivateIPv4(normalized);
  if (version === 6) {
    return normalized === "::1" || normalized.startsWith("fc") || normalized.startsWith("fd") || normalized.startsWith("fe80:");
  }
  return false;
}

export function validateHomeAssistantBaseUrl(value) {
  if (typeof value !== "string" || !value.trim() || value.length > 512) {
    throw apiError(
      "INVALID_HOME_ASSISTANT_URL",
      "Home Assistant URL must be a local http(s) URL.",
      400,
    );
  }

  let url;
  try {
    url = new URL(value.trim());
  } catch {
    throw apiError(
      "INVALID_HOME_ASSISTANT_URL",
      "Home Assistant URL must be a local http(s) URL.",
      400,
    );
  }
  if (
    !["http:", "https:"].includes(url.protocol) ||
    url.username ||
    url.password ||
    url.search ||
    url.hash ||
    !["", "/"].includes(url.pathname) ||
    !isPrivateHost(url.hostname)
  ) {
    throw apiError(
      "INVALID_HOME_ASSISTANT_URL",
      "Home Assistant URL must use a loopback, private-network, or .local address.",
      400,
    );
  }
  return url.origin;
}

export function validateHomeAssistantAccessToken(value) {
  if (
    typeof value !== "string" ||
    value.length < 20 ||
    value.length > 4_096 ||
    /[\r\n]/.test(value)
  ) {
    throw apiError(
      "INVALID_HOME_ASSISTANT_TOKEN",
      "A valid Home Assistant long-lived access token is required.",
      400,
    );
  }
  return value;
}

function publicConnectionError(error) {
  if (error?.code === "HOME_ASSISTANT_AUTH_FAILED") {
    return "Home Assistant rejected the access token.";
  }
  if (error?.code === "HOME_ASSISTANT_TIMEOUT") {
    return "Home Assistant did not respond in time.";
  }
  return "Home Assistant could not be reached.";
}

function safeDeviceId(value) {
  return `ha_${createHash("sha256").update(value).digest("base64url").slice(0, 24)}`;
}

function domainOf(entityId) {
  return typeof entityId === "string" ? entityId.split(".", 1)[0] : "";
}

function compact(object) {
  return Object.fromEntries(
    Object.entries(object).filter(([, value]) => value !== undefined && value !== null),
  );
}

function finiteNumber(value) {
  if (value === "" || value === null || value === undefined) return undefined;
  const number = Number(value);
  return Number.isFinite(number) ? number : undefined;
}

function percentFromBrightness(value) {
  const number = finiteNumber(value);
  return number === undefined ? undefined : Math.max(0, Math.min(100, Math.round((number / 255) * 100)));
}

function entityText(entity) {
  return [
    entity.entityId,
    entity.entry?.name,
    entity.entry?.original_name,
    entity.state?.attributes?.friendly_name,
    entity.state?.attributes?.device_class,
  ]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();
}

function findEntity(entities, predicate) {
  return entities.find((entity) => predicate(entity, entityText(entity)));
}

function numericSensor(entities, patterns) {
  const entity = findEntity(
    entities,
    (item, text) =>
      (domainOf(item.entityId) === "sensor" || domainOf(item.entityId) === "number") &&
      patterns.some((pattern) => pattern.test(text)),
  );
  return finiteNumber(entity?.state?.state);
}

function booleanEntityValue(entity) {
  if (!entity?.state) return undefined;
  if (["on", "open", "true", "1"].includes(entity.state.state)) return true;
  if (["off", "closed", "false", "0"].includes(entity.state.state)) return false;
  return undefined;
}

function chooseDeviceType(device, entities) {
  const text = [device?.name, device?.name_by_user, device?.model, device?.manufacturer]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();
  const allText = `${text} ${entities.map(entityText).join(" ")}`;
  const domains = new Set(entities.map((entity) => domainOf(entity.entityId)));

  if (/camera|kamera|c701|mjsxj|chuangmi\.camera/.test(allText)) return "camera";
  if (domains.has("humidifier") || /dehumid|nem alma|derh|csj0/.test(allText)) {
    return "dehumidifier";
  }
  if (domains.has("fan") && /purifier|airp|hava temiz|zhimi/.test(allText)) {
    return "airPurifier";
  }
  if (domains.has("light")) return "light";
  return null;
}

function eventTypeFor(entity) {
  const text = entityText(entity);
  if (/baby.*cry|cry.*baby|bebek.*ağla/.test(text)) return "babyCry";
  if (/pet|animal|evcil/.test(text)) return "petDetected";
  if (/no[-_ ]*human|long[-_ ]*time[-_ ]*no[-_ ]*human/.test(text)) return null;
  if (/someone.*appear|person|human|kişi|insan/.test(text)) return "personDetected";
  if (/abnormal.*sound|sound.*abnormal|anormal.*ses/.test(text)) return "abnormalSound";
  if (/geo.?fence|geofence/.test(text)) return "geofence";
  if (/motion|hareket/.test(text)) return "motionDetected";
  return null;
}

function cameraEventSummary(entity) {
  if (!entity) return undefined;
  const labels = {
    babyCry: "Bebek ağlaması",
    petDetected: "Evcil hayvan",
    personDetected: "Kişi",
    abnormalSound: "Olağandışı ses",
    geofence: "Konum",
    motionDetected: "Hareket",
  };
  const type = eventTypeFor(entity);
  if (!type) return undefined;
  const changedAt = entity.state?.last_changed;
  const date = changedAt ? new Date(changedAt) : null;
  const time = date && Number.isFinite(date.getTime())
    ? date.toLocaleString("tr-TR", {
        day: "2-digit",
        month: "2-digit",
        hour: "2-digit",
        minute: "2-digit",
      })
    : null;
  return `${labels[type] || type}${time ? ` · ${time}` : ""}`;
}

function deviceStateAttributes(device, entities, type, areaName) {
  const primary =
    type === "light"
      ? findEntity(entities, (entity) => domainOf(entity.entityId) === "light")
      : type === "airPurifier"
        ? findEntity(entities, (entity) => domainOf(entity.entityId) === "fan")
        : type === "dehumidifier"
          ? findEntity(entities, (entity) => domainOf(entity.entityId) === "humidifier")
          : findEntity(
              entities,
              (entity, text) =>
                domainOf(entity.entityId) === "camera" ||
                (domainOf(entity.entityId) === "switch" && /camera|kamera/.test(text) && !/privacy|gizlilik|sleep/.test(text)),
            );
  const primaryAttributes = primary?.state?.attributes ?? {};
  const available = entities.some(
    (entity) => entity.state && !["unavailable", "unknown"].includes(entity.state.state),
  );
  const privacyEntity = findEntity(
    entities,
    (entity, text) => domainOf(entity.entityId) === "switch" && /privacy|gizlilik|sleep/.test(text),
  );
  const tankEntity = findEntity(
    entities,
    (entity, text) => domainOf(entity.entityId) === "binary_sensor" && /tank.*full|full.*tank|water.*full|depo.*dolu/.test(text),
  );
  const lastEventEntity = entities
    .filter((entity) => eventTypeFor(entity))
    .sort((a, b) => String(b.state?.last_changed ?? "").localeCompare(String(a.state?.last_changed ?? "")))[0];
  const colorTemperature =
    finiteNumber(primaryAttributes.color_temp_kelvin) ??
    (finiteNumber(primaryAttributes.color_temp)
      ? Math.round(1_000_000 / finiteNumber(primaryAttributes.color_temp))
      : undefined);
  const availableModes =
    primaryAttributes.preset_modes ?? primaryAttributes.available_modes ?? undefined;

  return compact({
    customName: device?.name_by_user || device?.name || primaryAttributes.friendly_name || "Xiaomi cihazı",
    model: device?.model || "Xiaomi Home",
    room: areaName,
    isReachable: available,
    isOn: primary ? booleanEntityValue(primary) : undefined,
    lightLevel: type === "light" ? percentFromBrightness(primaryAttributes.brightness) : undefined,
    colorTemperature: type === "light" ? colorTemperature : undefined,
    pm25:
      finiteNumber(primaryAttributes.pm25) ??
      numericSensor(entities, [/pm.?2[._ ]?5/, /particulate.*2[._ ]?5/]),
    pm10:
      finiteNumber(primaryAttributes.pm10) ?? numericSensor(entities, [/pm.?10/, /particulate.*10/]),
    humidity:
      finiteNumber(primaryAttributes.current_humidity) ??
      numericSensor(entities, [/humidity/, /nem/]),
    targetHumidity: finiteNumber(primaryAttributes.humidity),
    temperature:
      finiteNumber(primaryAttributes.current_temperature) ??
      numericSensor(entities, [/temperature/, /sıcaklık/]),
    filterLife:
      finiteNumber(primaryAttributes.filter_life_remaining) ??
      finiteNumber(primaryAttributes.filter_life) ??
      numericSensor(entities, [/filter.*life/, /filter.*remaining/, /filtre.*öm/]),
    percentage: finiteNumber(primaryAttributes.percentage),
    presetMode: primaryAttributes.preset_mode ?? primaryAttributes.mode,
    availableModes: Array.isArray(availableModes) ? availableModes : undefined,
    waterTankFull: booleanEntityValue(tankEntity),
    privacy: booleanEntityValue(privacyEntity),
    lastEvent: cameraEventSummary(lastEventEntity),
  });
}

function capabilitiesFor(entities, type, attributes) {
  const domains = new Set(entities.map((entity) => domainOf(entity.entityId)));
  const privacy = findEntity(
    entities,
    (entity, text) => domainOf(entity.entityId) === "switch" && /privacy|gizlilik|sleep/.test(text),
  );
  const cameraPower = findEntity(
    entities,
    (entity, text) =>
      domainOf(entity.entityId) === "switch" &&
      /camera|kamera/.test(text) &&
      !/privacy|gizlilik|sleep/.test(text),
  );
  return compact({
    power:
      domains.has("light") || domains.has("fan") || domains.has("humidifier") ||
      (type === "camera" && Boolean(cameraPower)),
    brightness: type === "light",
    colorTemperature:
      type === "light" &&
      entities.some((entity) => {
        const attrs = entity.state?.attributes ?? {};
        return attrs.color_temp_kelvin !== undefined || attrs.min_color_temp_kelvin !== undefined ||
          (Array.isArray(attrs.supported_color_modes) && attrs.supported_color_modes.includes("color_temp"));
      }),
    percentage: type === "airPurifier" && attributes.percentage !== undefined,
    presetMode: Array.isArray(attributes.availableModes) && attributes.availableModes.length > 0,
    targetHumidity: type === "dehumidifier" && domains.has("humidifier"),
    privacy: Boolean(privacy),
  });
}

function sameAttributes(left, right) {
  return JSON.stringify(left) === JSON.stringify(right);
}

export class HomeAssistantManager {
  #config;
  #persistConfig;
  #onEvent;
  #onInternalError;
  #fetch;
  #WebSocket;
  #socket = null;
  #connectPromise = null;
  #retryTimer = null;
  #retryDelayMs = 15_000;
  #stopped = false;
  #intentionalClose = false;
  #generation = 0;
  #nextRequestId = 1;
  #pendingRequests = new Map();
  #states = new Map();
  #entityRegistry = new Map();
  #deviceRegistry = new Map();
  #areaRegistry = new Map();
  #groups = new Map();

  constructor({
    config,
    persistConfig,
    onEvent,
    onInternalError = () => {},
    fetchImpl = globalThis.fetch,
    WebSocketImpl = WebSocket,
  }) {
    this.#config = config;
    this.#persistConfig = persistConfig;
    this.#onEvent = onEvent;
    this.#onInternalError = onInternalError;
    this.#fetch = fetchImpl;
    this.#WebSocket = WebSocketImpl;
    this.state = {
      connected: false,
      listening: false,
      connecting: false,
      lastConnectedAt: null,
      lastEventAt: null,
      lastError: null,
    };
  }

  get configured() {
    return Boolean(this.#config.homeAssistant?.baseUrl && this.#config.homeAssistant?.accessToken);
  }

  get baseUrl() {
    return this.#config.homeAssistant?.baseUrl ?? null;
  }

  status() {
    return {
      configured: this.configured,
      connected: this.state.connected,
      listening: this.state.listening,
      baseUrl: this.baseUrl,
      deviceCount: this.#groups.size,
      lastConnectedAt: this.state.lastConnectedAt,
      lastEventAt: this.state.lastEventAt,
      lastError: this.state.lastError?.message ?? null,
    };
  }

  async initialize() {
    if (this.configured) await this.connect().catch(() => null);
  }

  async #request(pathname, { method = "GET", body, baseUrl, accessToken } = {}) {
    const selectedBaseUrl = baseUrl ?? this.baseUrl;
    const selectedToken = accessToken ?? this.#config.homeAssistant?.accessToken;
    if (!selectedBaseUrl || !selectedToken) {
      throw apiError(
        "HOME_ASSISTANT_NOT_CONFIGURED",
        "Home Assistant has not been configured.",
        409,
      );
    }

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
    timer.unref?.();
    let response;
    try {
      response = await this.#fetch(new URL(pathname, `${selectedBaseUrl}/`), {
        method,
        headers: {
          Authorization: `Bearer ${selectedToken}`,
          ...(body === undefined ? {} : { "Content-Type": "application/json" }),
        },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
        redirect: "error",
        signal: controller.signal,
      });
    } catch (error) {
      if (error?.name === "AbortError") {
        throw apiError(
          "HOME_ASSISTANT_TIMEOUT",
          "Home Assistant did not respond in time.",
          504,
        );
      }
      throw apiError(
        "HOME_ASSISTANT_UNAVAILABLE",
        "Home Assistant could not be reached.",
        503,
      );
    } finally {
      clearTimeout(timer);
    }

    if (response.status === 401 || response.status === 403) {
      throw apiError(
        "HOME_ASSISTANT_AUTH_FAILED",
        "Home Assistant rejected the access token.",
        401,
      );
    }
    if (!response.ok) {
      throw apiError(
        "HOME_ASSISTANT_REQUEST_FAILED",
        "Home Assistant rejected the request.",
        response.status >= 400 && response.status < 600 ? response.status : 502,
      );
    }
    if (response.status === 204) return null;
    try {
      return await response.json();
    } catch {
      throw apiError(
        "HOME_ASSISTANT_INVALID_RESPONSE",
        "Home Assistant returned an invalid response.",
        502,
      );
    }
  }

  async configure({ baseUrl, accessToken }) {
    const normalizedBaseUrl = validateHomeAssistantBaseUrl(baseUrl);
    const normalizedToken = validateHomeAssistantAccessToken(accessToken);
    await this.#request("/api/", {
      baseUrl: normalizedBaseUrl,
      accessToken: normalizedToken,
    });

    this.#closeSocket();
    this.#config = await this.#persistConfig({
      ...this.#config,
      homeAssistant: { baseUrl: normalizedBaseUrl, accessToken: normalizedToken },
    });
    this.#stopped = false;
    await this.connect().catch(() => null);
    return this.status();
  }

  async forget() {
    this.#generation += 1;
    this.#clearRetry();
    this.#closeSocket();
    this.#states.clear();
    this.#entityRegistry.clear();
    this.#deviceRegistry.clear();
    this.#areaRegistry.clear();
    this.#groups.clear();
    this.state.connected = false;
    this.state.listening = false;
    this.state.lastError = null;
    this.#config = await this.#persistConfig({ ...this.#config, homeAssistant: null });
    return this.status();
  }

  async connect() {
    if (this.#stopped || !this.configured) return null;
    if (this.#connectPromise) return this.#connectPromise;
    this.#connectPromise = this.#connectNow().finally(() => {
      this.#connectPromise = null;
    });
    return this.#connectPromise;
  }

  async #connectNow() {
    const generation = ++this.#generation;
    this.state.connecting = true;
    try {
      const states = await this.#request("/api/states");
      if (!Array.isArray(states)) {
        throw apiError(
          "HOME_ASSISTANT_INVALID_RESPONSE",
          "Home Assistant returned an invalid state list.",
          502,
        );
      }
      this.#states = new Map(states.map((state) => [state.entity_id, state]));
      await this.#connectSocket(generation);
      if (generation !== this.#generation || this.#stopped) return null;
      this.#rebuildDevices();
      this.state.connected = true;
      this.state.lastConnectedAt = new Date().toISOString();
      this.state.lastError = null;
      this.#retryDelayMs = 15_000;
      this.#clearRetry();
      return this.listDevices();
    } catch (error) {
      if (generation !== this.#generation || this.#stopped) return null;
      this.state.connected = false;
      this.state.listening = false;
      this.state.lastError = {
        code: error?.code || "HOME_ASSISTANT_CONNECTION_FAILED",
        message: publicConnectionError(error),
        at: new Date().toISOString(),
      };
      if (error?.code !== "HOME_ASSISTANT_AUTH_FAILED") this.#scheduleRetry();
      throw apiError(
        error?.code || "HOME_ASSISTANT_CONNECTION_FAILED",
        publicConnectionError(error),
        error?.status || 503,
      );
    } finally {
      this.state.connecting = false;
    }
  }

  #connectSocket(generation) {
    return new Promise((resolve, reject) => {
      const socketUrl = new URL("/api/websocket", `${this.baseUrl}/`);
      socketUrl.protocol = socketUrl.protocol === "https:" ? "wss:" : "ws:";
      const socket = new this.#WebSocket(socketUrl, { maxPayload: 2 * 1024 * 1024 });
      this.#intentionalClose = false;
      this.#socket = socket;
      let settled = false;
      const timeout = setTimeout(() => {
        if (settled) return;
        settled = true;
        this.#intentionalClose = true;
        socket.close();
        reject(apiError("HOME_ASSISTANT_TIMEOUT", "Home Assistant did not respond in time.", 504));
      }, SOCKET_TIMEOUT_MS);
      timeout.unref?.();

      const fail = (error) => {
        if (settled) return;
        settled = true;
        clearTimeout(timeout);
        reject(error);
      };
      const finish = async () => {
        try {
          const [entities, devices, areas] = await Promise.all([
            this.#socketRequest("config/entity_registry/list"),
            this.#socketRequest("config/device_registry/list"),
            this.#socketRequest("config/area_registry/list"),
          ]);
          if (generation !== this.#generation || this.#stopped) return;
          this.#entityRegistry = new Map(
            (Array.isArray(entities) ? entities : []).map((entry) => [entry.entity_id, entry]),
          );
          this.#deviceRegistry = new Map(
            (Array.isArray(devices) ? devices : []).map((device) => [device.id, device]),
          );
          this.#areaRegistry = new Map(
            (Array.isArray(areas) ? areas : []).map((area) => [area.area_id, area]),
          );
          await this.#socketRequest("subscribe_events", { event_type: "state_changed" });
          if (generation !== this.#generation || this.#stopped) return;
          this.state.listening = true;
          settled = true;
          clearTimeout(timeout);
          resolve();
        } catch (error) {
          fail(error);
        }
      };

      socket.on("message", (raw) => {
        let message;
        try {
          message = JSON.parse(raw.toString());
        } catch {
          this.#onInternalError(apiError("HOME_ASSISTANT_INVALID_MESSAGE", "Invalid Home Assistant WebSocket message."));
          return;
        }
        if (message.type === "auth_required") {
          socket.send(
            JSON.stringify({
              type: "auth",
              access_token: this.#config.homeAssistant.accessToken,
            }),
          );
          return;
        }
        if (message.type === "auth_invalid") {
          fail(apiError("HOME_ASSISTANT_AUTH_FAILED", "Home Assistant rejected the access token.", 401));
          return;
        }
        if (message.type === "auth_ok") {
          finish();
          return;
        }
        this.#handleSocketMessage(message);
      });
      socket.once("error", () => {
        fail(apiError("HOME_ASSISTANT_UNAVAILABLE", "Home Assistant could not be reached.", 503));
      });
      socket.once("close", () => {
        clearTimeout(timeout);
        this.state.connected = false;
        this.state.listening = false;
        for (const pending of this.#pendingRequests.values()) {
          pending.reject(apiError("HOME_ASSISTANT_UNAVAILABLE", "Home Assistant connection closed.", 503));
          clearTimeout(pending.timer);
        }
        this.#pendingRequests.clear();
        if (!settled) fail(apiError("HOME_ASSISTANT_UNAVAILABLE", "Home Assistant connection closed.", 503));
        if (!this.#intentionalClose && !this.#stopped && generation === this.#generation) {
          this.#scheduleRetry();
        }
      });
    });
  }

  #socketRequest(type, payload = {}) {
    if (!this.#socket || this.#socket.readyState !== this.#WebSocket.OPEN) {
      return Promise.reject(
        apiError("HOME_ASSISTANT_UNAVAILABLE", "Home Assistant connection is not ready.", 503),
      );
    }
    const id = this.#nextRequestId++;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.#pendingRequests.delete(id);
        reject(apiError("HOME_ASSISTANT_TIMEOUT", "Home Assistant did not respond in time.", 504));
      }, SOCKET_TIMEOUT_MS);
      timer.unref?.();
      this.#pendingRequests.set(id, { resolve, reject, timer });
      this.#socket.send(JSON.stringify({ id, type, ...payload }), (error) => {
        if (!error) return;
        clearTimeout(timer);
        this.#pendingRequests.delete(id);
        reject(apiError("HOME_ASSISTANT_UNAVAILABLE", "Home Assistant request could not be sent.", 503));
      });
    });
  }

  #handleSocketMessage(message) {
    if (message.type === "result" && Number.isInteger(message.id)) {
      const pending = this.#pendingRequests.get(message.id);
      if (!pending) return;
      this.#pendingRequests.delete(message.id);
      clearTimeout(pending.timer);
      if (message.success) pending.resolve(message.result);
      else pending.reject(apiError("HOME_ASSISTANT_REQUEST_FAILED", "Home Assistant rejected a WebSocket request.", 502));
      return;
    }
    if (message.type === "event" && message.event?.event_type === "state_changed") {
      this.#handleStateChanged(message.event).catch((error) => this.#onInternalError(error));
    }
  }

  async #handleStateChanged(event) {
    const entityId = event?.data?.entity_id;
    if (typeof entityId !== "string") return;
    const previousDevices = new Map(
      [...this.#groups.entries()].map(([id, group]) => [id, group.canonical]),
    );
    const newState = event.data.new_state;
    if (newState) this.#states.set(entityId, newState);
    else this.#states.delete(entityId);
    this.#rebuildDevices();
    this.state.lastEventAt = new Date().toISOString();

    const entry = this.#entityRegistry.get(entityId);
    const key = entry?.device_id || `entity:${entityId}`;
    const id = safeDeviceId(key);
    const group = this.#groups.get(id);
    if (!group) return;
    const previous = previousDevices.get(id);
    const current = group.canonical;
    if (!previous || !sameAttributes(previous.attributes, current.attributes)) {
      await Promise.resolve(
        this.#onEvent({
          id: randomUUID(),
          type: "deviceStateChanged",
          time: event.time_fired || new Date().toISOString(),
          data: {
            id,
            provider: "home-assistant",
            attributes: current.attributes,
            oldAttributes: previous?.attributes ?? {},
          },
        }),
      );
    }

    const changedEntity = {
      entityId,
      entry,
      state: newState,
    };
    const mappedEventType = eventTypeFor(changedEntity);
    const domain = domainOf(entityId);
    const becameActive =
      domain === "event" ||
      (domain === "binary_sensor" && newState?.state === "on" && event.data.old_state?.state !== "on");
    if (mappedEventType && becameActive) {
      await Promise.resolve(
        this.#onEvent({
          id: randomUUID(),
          type: "deviceEvent",
          time: event.time_fired || new Date().toISOString(),
          data: { id, provider: "home-assistant", eventType: mappedEventType },
        }),
      );
    }
  }

  #rebuildDevices() {
    const grouped = new Map();
    for (const [entityId, entry] of this.#entityRegistry) {
      if (entry.disabled_by) continue;
      const device = entry.device_id ? this.#deviceRegistry.get(entry.device_id) : null;
      const xiaomiPlatform = XIAOMI_PLATFORMS.has(entry.platform);
      const xiaomiManufacturer = /xiaomi|mi home|zhimi|dmaker|chuangmi/i.test(
        String(device?.manufacturer ?? ""),
      );
      if (!xiaomiPlatform && !xiaomiManufacturer) continue;
      const state = this.#states.get(entityId);
      if (!state) continue;
      const key = entry.device_id || `entity:${entityId}`;
      if (!grouped.has(key)) grouped.set(key, { device, entries: [] });
      grouped.get(key).entries.push({ entityId, entry, state });
    }

    const nextGroups = new Map();
    for (const [key, group] of grouped) {
      const type = chooseDeviceType(group.device, group.entries);
      if (!SUPPORTED_TYPES.has(type)) continue;
      const entryAreaId = group.entries.find((entity) => entity.entry.area_id)?.entry.area_id;
      const areaId = group.device?.area_id || entryAreaId;
      const areaName = areaId ? this.#areaRegistry.get(areaId)?.name : undefined;
      const id = safeDeviceId(key);
      const attributes = deviceStateAttributes(group.device, group.entries, type, areaName);
      const canonical = {
        id,
        type,
        deviceType: type,
        provider: "home-assistant",
        source: "home-assistant",
        isReachable: attributes.isReachable,
        attributes,
        capabilities: capabilitiesFor(group.entries, type, attributes),
      };
      nextGroups.set(id, { ...group, key, type, canonical });
    }
    this.#groups = nextGroups;
  }

  listDevices() {
    return [...this.#groups.values()].map((group) => structuredClone(group.canonical));
  }

  getDevice(id) {
    const device = this.#groups.get(id)?.canonical;
    if (!device) {
      throw apiError("HOME_ASSISTANT_DEVICE_NOT_FOUND", "The Home Assistant device was not found.", 404);
    }
    return structuredClone(device);
  }

  async getDeviceFresh(id) {
    const group = this.#groups.get(id);
    if (!group) {
      throw apiError("HOME_ASSISTANT_DEVICE_NOT_FOUND", "The Home Assistant device was not found.", 404);
    }
    const primaryDomain =
      group.type === "light"
        ? "light"
        : group.type === "airPurifier"
          ? "fan"
          : group.type === "dehumidifier"
            ? "humidifier"
            : null;
    const primary = primaryDomain ? this.#entityFor(group, primaryDomain) : null;
    if (!primary) {
      throw apiError(
        "HOME_ASSISTANT_STATE_UNAVAILABLE",
        "The current Home Assistant device state is unavailable.",
        409,
      );
    }

    const state = await this.#request(
      `/api/states/${encodeURIComponent(primary.entityId)}`,
    );
    if (!state || state.entity_id !== primary.entityId || typeof state.state !== "string") {
      throw apiError(
        "HOME_ASSISTANT_INVALID_RESPONSE",
        "Home Assistant returned an invalid device state.",
        502,
      );
    }

    const cachedState = this.#states.get(primary.entityId);
    const cachedUpdatedAt = Date.parse(
      cachedState?.last_updated ?? cachedState?.last_changed ?? "",
    );
    const freshUpdatedAt = Date.parse(state.last_updated ?? state.last_changed ?? "");
    if (
      !Number.isFinite(cachedUpdatedAt) ||
      !Number.isFinite(freshUpdatedAt) ||
      freshUpdatedAt >= cachedUpdatedAt
    ) {
      this.#states.set(primary.entityId, state);
      this.#rebuildDevices();
    }
    return this.getDevice(id);
  }

  #entityFor(group, domain, pattern = null) {
    return findEntity(
      group.entries,
      (entity, text) => domainOf(entity.entityId) === domain && (!pattern || pattern.test(text)),
    );
  }

  async #callService(domain, service, body) {
    return this.#request(`/api/services/${domain}/${service}`, { method: "POST", body });
  }

  async setDeviceAttributes({ id, attributes, transitionTime }) {
    const group = this.#groups.get(id);
    if (!group) {
      throw apiError("HOME_ASSISTANT_DEVICE_NOT_FOUND", "The Home Assistant device was not found.", 404);
    }
    const requested = { ...attributes };
    const operations = [];
    const transition =
      Number.isInteger(transitionTime) && transitionTime >= 0 ? transitionTime / 1_000 : undefined;
    const light = group.type === "light" ? this.#entityFor(group, "light") : null;
    const fan = this.#entityFor(group, "fan");
    const humidifier = this.#entityFor(group, "humidifier");
    const privacy = this.#entityFor(group, "switch", /privacy|gizlilik|sleep/);
    const cameraSwitch = findEntity(
      group.entries,
      (entity, text) =>
        domainOf(entity.entityId) === "switch" &&
        /camera|kamera/.test(text) &&
        !/privacy|gizlilik|sleep/.test(text),
    );
    const powerEntity =
      group.type === "light"
        ? light
        : group.type === "airPurifier"
          ? fan
          : group.type === "dehumidifier"
            ? humidifier
            : group.type === "camera"
              ? cameraSwitch
              : null;

    const isOn = requested.isOn;
    delete requested.isOn;
    if (isOn === true) {
      if (!powerEntity) throw apiError("HOME_ASSISTANT_ATTRIBUTE_UNSUPPORTED", "This device does not expose a power control.", 409);
      operations.push(() =>
        this.#callService(domainOf(powerEntity.entityId), "turn_on", compact({ entity_id: powerEntity.entityId, transition })),
      );
    }
    const lightLevel = requested.lightLevel ?? requested.brightness;
    delete requested.lightLevel;
    delete requested.brightness;
    if (lightLevel !== undefined) {
      if (!light || !Number.isFinite(lightLevel) || lightLevel < 0 || lightLevel > 100) {
        throw apiError("HOME_ASSISTANT_ATTRIBUTE_UNSUPPORTED", "The requested brightness is not supported.", 409);
      }
      operations.push(() =>
        this.#callService("light", "turn_on", compact({ entity_id: light.entityId, brightness_pct: lightLevel, transition })),
      );
    }
    const colorTemperature = requested.colorTemperature;
    delete requested.colorTemperature;
    if (colorTemperature !== undefined) {
      if (!light || !Number.isFinite(colorTemperature) || colorTemperature < 1_500 || colorTemperature > 6_500) {
        throw apiError("HOME_ASSISTANT_ATTRIBUTE_UNSUPPORTED", "The requested color temperature is not supported.", 409);
      }
      operations.push(() =>
        this.#callService("light", "turn_on", compact({ entity_id: light.entityId, color_temp_kelvin: colorTemperature, transition })),
      );
    }
    const percentage = requested.percentage;
    delete requested.percentage;
    if (percentage !== undefined) {
      if (!fan || !Number.isFinite(percentage) || percentage < 0 || percentage > 100) {
        throw apiError("HOME_ASSISTANT_ATTRIBUTE_UNSUPPORTED", "The requested fan percentage is not supported.", 409);
      }
      operations.push(() =>
        this.#callService("fan", "set_percentage", { entity_id: fan.entityId, percentage }),
      );
    }
    const presetMode = requested.presetMode;
    delete requested.presetMode;
    if (presetMode !== undefined) {
      if (typeof presetMode !== "string" || !presetMode.trim()) {
        throw apiError("HOME_ASSISTANT_ATTRIBUTE_UNSUPPORTED", "The requested preset mode is invalid.", 400);
      }
      if (fan) {
        operations.push(() => this.#callService("fan", "set_preset_mode", { entity_id: fan.entityId, preset_mode: presetMode }));
      } else if (humidifier) {
        operations.push(() => this.#callService("humidifier", "set_mode", { entity_id: humidifier.entityId, mode: presetMode }));
      } else {
        throw apiError("HOME_ASSISTANT_ATTRIBUTE_UNSUPPORTED", "This device does not expose preset modes.", 409);
      }
    }
    const targetHumidity = requested.targetHumidity;
    delete requested.targetHumidity;
    if (targetHumidity !== undefined) {
      if (!humidifier || !Number.isFinite(targetHumidity) || targetHumidity < 0 || targetHumidity > 100) {
        throw apiError("HOME_ASSISTANT_ATTRIBUTE_UNSUPPORTED", "The requested humidity is not supported.", 409);
      }
      operations.push(() =>
        this.#callService("humidifier", "set_humidity", { entity_id: humidifier.entityId, humidity: targetHumidity }),
      );
    }
    const privacyValue = requested.privacy;
    delete requested.privacy;
    if (privacyValue !== undefined) {
      if (!privacy || typeof privacyValue !== "boolean") {
        throw apiError("HOME_ASSISTANT_ATTRIBUTE_UNSUPPORTED", "This camera does not expose a privacy control.", 409);
      }
      operations.push(() => this.#callService("switch", privacyValue ? "turn_on" : "turn_off", { entity_id: privacy.entityId }));
    }
    if (isOn === false) {
      if (!powerEntity) throw apiError("HOME_ASSISTANT_ATTRIBUTE_UNSUPPORTED", "This device does not expose a power control.", 409);
      operations.push(() =>
        this.#callService(domainOf(powerEntity.entityId), "turn_off", compact({ entity_id: powerEntity.entityId, transition })),
      );
    }
    if (Object.keys(requested).length || operations.length === 0) {
      throw apiError("HOME_ASSISTANT_ATTRIBUTE_UNSUPPORTED", "One or more requested attributes are not supported.", 409);
    }
    for (const operation of operations) await operation();
    return { ok: true, id };
  }

  #scheduleRetry() {
    if (this.#stopped || !this.configured || this.#retryTimer) return;
    const jitter = Math.floor(Math.random() * 2_000);
    this.#retryTimer = setTimeout(() => {
      this.#retryTimer = null;
      this.connect().catch(() => null);
    }, this.#retryDelayMs + jitter);
    this.#retryTimer.unref?.();
    this.#retryDelayMs = Math.min(this.#retryDelayMs * 2, 300_000);
  }

  #clearRetry() {
    if (this.#retryTimer) clearTimeout(this.#retryTimer);
    this.#retryTimer = null;
  }

  #closeSocket() {
    this.#intentionalClose = true;
    if (this.#socket) this.#socket.close();
    this.#socket = null;
    for (const pending of this.#pendingRequests.values()) {
      clearTimeout(pending.timer);
      pending.reject(apiError("HOME_ASSISTANT_UNAVAILABLE", "Home Assistant connection closed.", 503));
    }
    this.#pendingRequests.clear();
    this.state.connected = false;
    this.state.listening = false;
  }

  stop() {
    this.#stopped = true;
    this.#generation += 1;
    this.#clearRetry();
    this.#closeSocket();
  }
}
