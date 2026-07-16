import { isIP } from "node:net";
import { createDirigeraClient } from "dirigera";
import { discoverGatewayIP } from "dirigera/dist/src/mdnsDiscovery.js";
import { HubUpdateListener } from "./hub-websocket.js";

const HUB_REQUEST_TIMEOUT_MS = 12_000;
const GATEWAY_DISCOVERY_TIMEOUT_MS = 8_000;
const PAIRING_TIMEOUT_MS = 70_000;

function parseBoolean(value, fallback) {
  if (value === undefined || value === "") return fallback;
  return !["0", "false", "no", "off"].includes(value.toLowerCase());
}

function apiError(code, message, status = 500) {
  const error = new Error(message);
  error.code = code;
  error.status = status;
  return error;
}

function isPrivateIPv4(ip) {
  const [a, b] = ip.split(".").map(Number);
  return (
    a === 10 ||
    a === 127 ||
    (a === 169 && b === 254) ||
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 168) ||
    (a === 100 && b >= 64 && b <= 127)
  );
}

function isPrivateIPv6(ip) {
  const normalized = ip.toLowerCase();
  return (
    normalized === "::1" ||
    normalized.startsWith("fc") ||
    normalized.startsWith("fd") ||
    normalized.startsWith("fe8") ||
    normalized.startsWith("fe9") ||
    normalized.startsWith("fea") ||
    normalized.startsWith("feb")
  );
}

export function validateGatewayIP(value) {
  if (typeof value !== "string" || value.length > 64) {
    throw apiError(
      "INVALID_GATEWAY_IP",
      "gatewayIP must be a private IPv4 or IPv6 address.",
      400,
    );
  }

  const ip = value.trim().replace(/^\[|\]$/g, "");
  const version = isIP(ip);
  if (
    version === 0 ||
    (version === 4 && !isPrivateIPv4(ip)) ||
    (version === 6 && !isPrivateIPv6(ip))
  ) {
    throw apiError(
      "INVALID_GATEWAY_IP",
      "gatewayIP must be a private IPv4 or IPv6 address.",
      400,
    );
  }

  return ip;
}

function formatGatewayIP(ip) {
  return ip && isIP(ip) === 6 ? `[${ip}]` : ip;
}

function publicErrorMessage(error) {
  if (error?.code === "ECONNREFUSED") return "The DIRIGERA hub refused the connection.";
  if (error?.code === "ENETUNREACH" || error?.code === "EHOSTUNREACH") {
    return "The DIRIGERA hub is unreachable.";
  }
  if (error?.code === "ETIMEDOUT" || error?.code === "HUB_TIMEOUT") {
    return "The DIRIGERA hub did not respond in time.";
  }
  if (error?.name === "DirigeraError") return "The DIRIGERA hub rejected the request.";
  return "The DIRIGERA connection failed.";
}

function withTimeout(promise, timeoutMs, code = "HUB_TIMEOUT") {
  let timer;
  return Promise.race([
    promise,
    new Promise((_, reject) => {
      timer = setTimeout(() => {
        reject(apiError(code, "The DIRIGERA hub did not respond in time.", 504));
      }, timeoutMs);
      timer.unref?.();
    }),
  ]).finally(() => clearTimeout(timer));
}

export class HubManager {
  #config;
  #persistConfig;
  #onEvent;
  #onInternalError;
  #client = null;
  #updateListener = null;
  #generation = 0;
  #connectPromise = null;
  #pairPromise = null;
  #retryTimer = null;
  #retryDelayMs = 15_000;
  #stopped = false;
  #rejectUnauthorized;

  constructor({ config, persistConfig, onEvent, onInternalError = () => {} }) {
    this.#config = config;
    this.#persistConfig = persistConfig;
    this.#onEvent = onEvent;
    this.#onInternalError = onInternalError;
    this.#rejectUnauthorized = parseBoolean(
      process.env.DIRIGERA_REJECT_UNAUTHORIZED,
      true,
    );

    this.state = {
      connected: false,
      listening: false,
      connecting: false,
      pairing: false,
      lastConnectedAt: null,
      lastEventAt: null,
      lastError: null,
      hub: null,
    };
  }

  get paired() {
    return Boolean(this.#config.accessToken);
  }

  get gatewayIP() {
    return this.#config.gatewayIP;
  }

  get client() {
    if (!this.paired) {
      throw apiError(
        "NOT_PAIRED",
        "The bridge has not been paired with a DIRIGERA hub.",
        409,
      );
    }
    if (!this.#client) {
      throw apiError(
        "HUB_UNAVAILABLE",
        "The DIRIGERA client is not currently available.",
        503,
      );
    }
    return this.#client;
  }

  async initialize() {
    if (this.paired) {
      await this.connect().catch(() => {});
    }
  }

  async connect() {
    if (this.#stopped || !this.paired) return null;
    if (this.#connectPromise) return this.#connectPromise;

    this.#connectPromise = this.#connectNow().finally(() => {
      this.#connectPromise = null;
    });
    return this.#connectPromise;
  }

  async #connectNow() {
    this.state.connecting = true;
    const generation = ++this.#generation;

    try {
      const gatewayIP = this.#config.gatewayIP
        ? validateGatewayIP(this.#config.gatewayIP)
        : validateGatewayIP(
            await withTimeout(
              discoverGatewayIP(),
              GATEWAY_DISCOVERY_TIMEOUT_MS,
              "GATEWAY_DISCOVERY_TIMEOUT",
            ),
          );
      const client = await withTimeout(
        createDirigeraClient({
          gatewayIP: formatGatewayIP(gatewayIP),
          accessToken: this.#config.accessToken,
          rejectUnauthorized: this.#rejectUnauthorized,
        }),
        HUB_REQUEST_TIMEOUT_MS,
      );

      if (this.#stopped || generation !== this.#generation) {
        return null;
      }

      const hub = await withTimeout(client.hub.status(), 6_000);
      if (this.#stopped || generation !== this.#generation) return null;

      this.#updateListener?.stop();
      this.#updateListener = null;
      this.#client = client;
      this.state.hub = hub;
      this.state.connected = true;
      this.state.lastConnectedAt = new Date().toISOString();
      this.state.lastError = null;
      this.#retryDelayMs = 15_000;
      this.#clearRetry();

      this.#updateListener = new HubUpdateListener({
        gatewayIP: formatGatewayIP(gatewayIP),
        accessToken: this.#config.accessToken,
        rejectUnauthorized: this.#rejectUnauthorized,
        onOpen: () => {
          if (generation === this.#generation && !this.#stopped) {
            this.state.listening = true;
          }
        },
        onClose: () => {
          if (generation === this.#generation) this.state.listening = false;
        },
        onError: (error) => {
          if (generation !== this.#generation || this.#stopped) return;
          this.state.lastError = {
            code: error.code || "HUB_EVENT_STREAM_ERROR",
            message: "The DIRIGERA event stream failed.",
            at: new Date().toISOString(),
          };
          this.#onInternalError(error);
        },
        onEvent: async (event) => {
          if (generation !== this.#generation || this.#stopped) return;
          this.state.connected = true;
          this.state.lastEventAt = new Date().toISOString();
          await this.#onEvent(event);
        },
      });
      this.#updateListener.start();
      return client;
    } catch (error) {
      this.state.connected = false;
      this.state.listening = false;
      this.state.lastError = {
        code: error?.code || "HUB_CONNECTION_FAILED",
        message: publicErrorMessage(error),
        at: new Date().toISOString(),
      };
      this.#scheduleRetry();
      throw apiError(
        "HUB_CONNECTION_FAILED",
        publicErrorMessage(error),
        error?.status === 504 ? 504 : 503,
      );
    } finally {
      this.state.connecting = false;
    }
  }

  #scheduleRetry() {
    if (this.#stopped || !this.paired || this.#retryTimer) return;
    this.#retryTimer = setTimeout(() => {
      this.#retryTimer = null;
      this.connect().catch(() => {});
    }, this.#retryDelayMs);
    this.#retryTimer.unref?.();
    this.#retryDelayMs = Math.min(this.#retryDelayMs * 2, 300_000);
  }

  #clearRetry() {
    if (this.#retryTimer) clearTimeout(this.#retryTimer);
    this.#retryTimer = null;
  }

  async probeStatus() {
    if (!this.paired) return null;
    if (!this.#client) await this.connect();

    try {
      const hub = await withTimeout(this.client.hub.status(), 6_000);
      this.state.connected = true;
      this.state.hub = hub;
      this.state.lastConnectedAt = new Date().toISOString();
      this.state.lastError = null;
      return hub;
    } catch (error) {
      this.state.connected = false;
      this.state.lastError = {
        code: error?.code || "HUB_CONNECTION_FAILED",
        message: publicErrorMessage(error),
        at: new Date().toISOString(),
      };
      this.#scheduleRetry();
      throw apiError(
        "HUB_UNAVAILABLE",
        publicErrorMessage(error),
        error?.status === 504 ? 504 : 503,
      );
    }
  }

  async pair(gatewayIP) {
    if (this.#pairPromise) {
      throw apiError(
        "PAIRING_IN_PROGRESS",
        "A pairing attempt is already in progress.",
        409,
      );
    }

    const selectedIP = gatewayIP
      ? validateGatewayIP(gatewayIP)
      : this.#config.gatewayIP
        ? validateGatewayIP(this.#config.gatewayIP)
        : null;

    this.#pairPromise = this.#pairNow(selectedIP).finally(() => {
      this.#pairPromise = null;
      this.state.pairing = false;
    });
    this.state.pairing = true;
    return this.#pairPromise;
  }

  async #pairNow(gatewayIP) {
    const startedAt = Date.now();
    let accessToken;
    try {
      const pairingClient = await withTimeout(
        createDirigeraClient({
          gatewayIP: formatGatewayIP(gatewayIP),
          rejectUnauthorized: this.#rejectUnauthorized,
        }),
        HUB_REQUEST_TIMEOUT_MS,
      );
      accessToken = await withTimeout(
        pairingClient.authenticate(),
        PAIRING_TIMEOUT_MS,
        "PAIRING_TIMEOUT",
      );
      if (!accessToken) {
        throw apiError(
          "PAIRING_FAILED",
          "The DIRIGERA hub did not return an access token.",
          502,
        );
      }

    } catch (error) {
      if (error?.code === "INVALID_GATEWAY_IP") throw error;
      const timedOut = error?.code === "PAIRING_TIMEOUT" || Date.now() - startedAt >= 55_000;
      throw apiError(
        timedOut ? "PAIRING_TIMEOUT" : "PAIRING_FAILED",
        timedOut
          ? "Pairing timed out. Press the hub action button and try again."
          : "Pairing with the DIRIGERA hub failed.",
        timedOut ? 408 : 502,
      );
    }

    if (this.#stopped) {
      throw apiError("BRIDGE_STOPPED", "The bridge stopped before pairing completed.", 503);
    }

    try {
      this.#config = await this.#persistConfig({
        ...this.#config,
        gatewayIP,
        accessToken,
      });
    } catch {
      throw apiError(
        "LOCAL_STORAGE_FAILED",
        "The access token could not be saved to local storage.",
        500,
      );
    }

    this.#updateListener?.stop();
    this.#updateListener = null;
    this.#client = null;
    this.state.connected = false;
    this.state.listening = false;
    this.#retryDelayMs = 15_000;
    this.#clearRetry();
    await this.connect().catch(() => null);
    return { paired: true, connected: this.state.connected, gatewayIP };
  }

  async run(operation) {
    if (!this.#client && this.paired) await this.connect();
    try {
      const result = await withTimeout(
        Promise.resolve().then(() => operation(this.client)),
        HUB_REQUEST_TIMEOUT_MS,
      );
      if (this.#stopped) {
        throw apiError("BRIDGE_STOPPED", "The bridge is stopping.", 503);
      }
      this.state.connected = true;
      this.state.lastConnectedAt = new Date().toISOString();
      this.state.lastError = null;
      return result;
    } catch (error) {
      if (
        error?.code === "NOT_PAIRED" ||
        error?.code === "HUB_UNAVAILABLE" ||
        error?.code === "BRIDGE_STOPPED"
      ) {
        throw error;
      }
      this.state.connected = false;
      this.state.lastError = {
        code: error?.code || "HUB_REQUEST_FAILED",
        message: publicErrorMessage(error),
        at: new Date().toISOString(),
      };
      throw apiError("HUB_REQUEST_FAILED", publicErrorMessage(error), 502);
    }
  }

  stop() {
    this.#stopped = true;
    this.#generation += 1;
    this.#clearRetry();
    this.#updateListener?.stop();
    this.#updateListener = null;
    this.#client = null;
    this.state.connected = false;
    this.state.listening = false;
  }
}
