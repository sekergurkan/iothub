import { randomUUID } from "node:crypto";
import dirigeraCertificate from "dirigera/dist/src/certificate.js";
import WebSocket from "ws";

const MAX_EVENT_BYTES = 256 * 1024;
const MAX_RECONNECT_DELAY_MS = 30_000;

function listenerError(code, message) {
  const error = new Error(message);
  error.code = code;
  return error;
}

export class HubUpdateListener {
  #gatewayIP;
  #accessToken;
  #rejectUnauthorized;
  #onEvent;
  #onOpen;
  #onClose;
  #onError;
  #WebSocketClass;
  #socket = null;
  #heartbeat = null;
  #reconnectTimer = null;
  #reconnectDelayMs = 1_000;
  #stopped = false;

  constructor({
    gatewayIP,
    accessToken,
    rejectUnauthorized = true,
    onEvent,
    onOpen = () => {},
    onClose = () => {},
    onError = () => {},
    WebSocketClass = WebSocket,
  }) {
    this.#gatewayIP = gatewayIP;
    this.#accessToken = accessToken;
    this.#rejectUnauthorized = rejectUnauthorized;
    this.#onEvent = onEvent;
    this.#onOpen = onOpen;
    this.#onClose = onClose;
    this.#onError = onError;
    this.#WebSocketClass = WebSocketClass;
  }

  start() {
    if (this.#stopped || this.#socket) return;
    this.#connect();
  }

  #connect() {
    if (this.#stopped) return;

    let socket;
    try {
      socket = new this.#WebSocketClass(`wss://${this.#gatewayIP}:8443/v1`, {
        headers: { authorization: `Bearer ${this.#accessToken}` },
        handshakeTimeout: 8_000,
        maxPayload: MAX_EVENT_BYTES,
        perMessageDeflate: false,
        followRedirects: false,
        rejectUnauthorized: this.#rejectUnauthorized,
        ...(this.#rejectUnauthorized
          ? {
              ca: [dirigeraCertificate],
              // Hub certificates are signed by IKEA's pinned CA but addressed by IP.
              checkServerIdentity: () => undefined,
            }
          : {}),
      });
    } catch (error) {
      this.#reportError(error);
      this.#scheduleReconnect();
      return;
    }

    this.#socket = socket;
    socket.on("open", () => {
      if (this.#stopped || socket !== this.#socket) return;
      this.#reconnectDelayMs = 1_000;
      this.#onOpen();
      this.#startHeartbeat(socket);
    });

    socket.on("message", (data, isBinary) => {
      if (this.#stopped || socket !== this.#socket || isBinary) return;
      try {
        const event = JSON.parse(data.toString("utf8"));
        if (
          !event ||
          typeof event !== "object" ||
          Array.isArray(event) ||
          typeof event.type !== "string"
        ) {
          throw listenerError("INVALID_HUB_EVENT", "The hub sent an invalid event.");
        }
        Promise.resolve(this.#onEvent(event)).catch((error) => this.#reportError(error));
      } catch {
        this.#reportError(
          listenerError("INVALID_HUB_EVENT", "The hub sent malformed event data."),
        );
      }
    });

    socket.on("error", (error) => {
      if (!this.#stopped && socket === this.#socket) this.#reportError(error);
    });

    socket.on("close", () => {
      if (socket !== this.#socket) return;
      this.#clearHeartbeat();
      this.#socket = null;
      this.#onClose();
      this.#scheduleReconnect();
    });
  }

  #startHeartbeat(socket) {
    this.#clearHeartbeat();
    this.#heartbeat = setInterval(() => {
      if (socket.readyState !== this.#WebSocketClass.OPEN) return;
      socket.send(
        JSON.stringify({
          id: randomUUID(),
          specversion: "1.1.0",
          source: "urn:local:dirigera-bridge",
          time: new Date().toISOString(),
          type: "ping",
          data: null,
        }),
      );
    }, 30_000);
    this.#heartbeat.unref?.();
  }

  #clearHeartbeat() {
    if (this.#heartbeat) clearInterval(this.#heartbeat);
    this.#heartbeat = null;
  }

  #reportError(error) {
    const safeError = listenerError(
      error?.code || "HUB_EVENT_STREAM_ERROR",
      "The DIRIGERA event stream failed.",
    );
    this.#onError(safeError);
  }

  #scheduleReconnect() {
    if (this.#stopped || this.#reconnectTimer) return;
    const jitter = Math.floor(Math.random() * Math.min(500, this.#reconnectDelayMs / 4));
    this.#reconnectTimer = setTimeout(() => {
      this.#reconnectTimer = null;
      this.#connect();
    }, this.#reconnectDelayMs + jitter);
    this.#reconnectTimer.unref?.();
    this.#reconnectDelayMs = Math.min(this.#reconnectDelayMs * 2, MAX_RECONNECT_DELAY_MS);
  }

  stop() {
    this.#stopped = true;
    this.#clearHeartbeat();
    if (this.#reconnectTimer) clearTimeout(this.#reconnectTimer);
    this.#reconnectTimer = null;
    const socket = this.#socket;
    this.#socket = null;
    if (socket) {
      socket.removeAllListeners();
      socket.terminate();
    }
  }
}
