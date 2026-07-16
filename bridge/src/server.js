import { randomUUID, timingSafeEqual } from "node:crypto";
import { createServer } from "node:http";
import { pathToFileURL } from "node:url";
import {
  loadOrCreateConfig,
  loadRuleDocument,
  resolveDataPaths,
  saveConfig,
  saveRuleDocument,
} from "./config.js";
import { EventStore } from "./event-store.js";
import { HubManager } from "./hub-manager.js";
import { RuleEngine, RuleValidationError } from "./rule-engine.js";

const BRIDGE_VERSION = "1.0.0";
const DEFAULT_HOST = "127.0.0.1";
const DEFAULT_PORT = 8787;
const MAX_BODY_BYTES = 64 * 1024;
const MAX_SSE_CLIENTS = 32;
const FORBIDDEN_KEYS = new Set(["__proto__", "prototype", "constructor"]);

class ApiError extends Error {
  constructor(status, code, message, details = undefined) {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

function parsePort(value) {
  if (value === undefined || value === "") return DEFAULT_PORT;
  const port = Number(value);
  if (!Number.isInteger(port) || port < 1 || port > 65_535) {
    throw new Error("PORT must be an integer between 1 and 65535.");
  }
  return port;
}

function parseBoolean(value, fallback = false) {
  if (value === undefined || value === "") return fallback;
  return ["1", "true", "yes", "on"].includes(value.toLowerCase());
}

function validateBindHost(host) {
  if (typeof host !== "string" || !host.trim() || /[\s/]/.test(host)) {
    throw new Error("HOST must be a valid bind address.");
  }
  const normalized = host.trim();
  const loopback = ["127.0.0.1", "::1", "localhost"].includes(normalized);
  if (!loopback && !parseBoolean(process.env.ALLOW_REMOTE_BIND)) {
    throw new Error(
      "Refusing a non-loopback HOST. Set ALLOW_REMOTE_BIND=true only if remote access is intentional.",
    );
  }
  return normalized;
}

function corsConfiguration() {
  const configured = process.env.CORS_ORIGINS?.trim();
  if (!configured || configured === "*") return { any: true, origins: new Set() };
  const origins = new Set(
    configured
      .split(",")
      .map((origin) => origin.trim())
      .filter(Boolean),
  );
  return { any: false, origins };
}

function corsHeaders(request, cors) {
  const origin = request.headers.origin;
  const allowed = !origin || cors.any || cors.origins.has(origin);
  return {
    allowed,
    headers: {
      ...(origin && allowed
        ? { "Access-Control-Allow-Origin": cors.any ? "*" : origin }
        : {}),
      "Access-Control-Allow-Methods": "GET, POST, PATCH, PUT, DELETE, OPTIONS",
      "Access-Control-Allow-Headers":
        "Content-Type, X-Bridge-Key, Last-Event-ID, Cache-Control",
      "Access-Control-Expose-Headers": "X-Bridge-Version",
      "Access-Control-Allow-Private-Network": "true",
      "Access-Control-Max-Age": "600",
      Vary: "Origin, Access-Control-Request-Headers, Access-Control-Request-Private-Network",
      "X-Bridge-Version": BRIDGE_VERSION,
    },
  };
}

function writeHeaders(response, headers) {
  for (const [name, value] of Object.entries(headers)) response.setHeader(name, value);
}

function sendJson(response, status, payload, headers = {}) {
  if (response.headersSent) {
    response.end();
    return;
  }
  const body = payload === undefined ? "" : `${JSON.stringify(payload)}\n`;
  writeHeaders(response, headers);
  response.statusCode = status;
  response.setHeader("Content-Type", "application/json; charset=utf-8");
  response.setHeader("Content-Length", Buffer.byteLength(body));
  response.setHeader("Cache-Control", "no-store");
  response.setHeader("X-Content-Type-Options", "nosniff");
  response.end(body);
}

function normalizeApiError(error) {
  if (error instanceof ApiError || error instanceof RuleValidationError) return error;
  if (
    Number.isInteger(error?.status) &&
    error.status >= 400 &&
    error.status <= 599 &&
    typeof error?.code === "string" &&
    /^[A-Z][A-Z0-9_]+$/.test(error.code)
  ) {
    return new ApiError(error.status, error.code, error.message, error.details);
  }
  return new ApiError(500, "INTERNAL_ERROR", "An unexpected bridge error occurred.");
}

function sendError(response, error, headers = {}) {
  const apiError = normalizeApiError(error);
  sendJson(
    response,
    apiError.status,
    {
      error: {
        code: apiError.code,
        message: apiError.message,
        ...(apiError.details ? { details: apiError.details } : {}),
      },
    },
    headers,
  );
}

function authorized(request, expectedKey) {
  const supplied = request.headers["x-bridge-key"];
  if (typeof supplied !== "string") return false;
  const expectedBuffer = Buffer.from(expectedKey);
  const suppliedBuffer = Buffer.from(supplied);
  return (
    expectedBuffer.length === suppliedBuffer.length &&
    timingSafeEqual(expectedBuffer, suppliedBuffer)
  );
}

async function readJsonBody(request, { optional = false } = {}) {
  const contentType = request.headers["content-type"];
  if (contentType && !/^application\/json(?:\s*;|$)/i.test(contentType)) {
    throw new ApiError(415, "UNSUPPORTED_MEDIA_TYPE", "Content-Type must be application/json.");
  }

  let size = 0;
  const chunks = [];
  for await (const chunk of request) {
    size += chunk.length;
    if (size > MAX_BODY_BYTES) {
      request.resume();
      throw new ApiError(413, "BODY_TOO_LARGE", "The JSON request body is too large.");
    }
    chunks.push(chunk);
  }

  if (size === 0) {
    if (optional) return {};
    throw new ApiError(400, "BODY_REQUIRED", "A JSON request body is required.");
  }

  try {
    const body = JSON.parse(Buffer.concat(chunks).toString("utf8"));
    if (!body || typeof body !== "object" || Array.isArray(body)) {
      throw new ApiError(400, "INVALID_BODY", "The JSON body must be an object.");
    }
    return body;
  } catch (error) {
    if (error instanceof ApiError) throw error;
    throw new ApiError(400, "INVALID_JSON", "The request body is not valid JSON.");
  }
}

function validateJsonValue(value, path = "attributes", depth = 0) {
  if (depth > 8) {
    throw new ApiError(400, "INVALID_ATTRIBUTES", `${path} is nested too deeply.`);
  }
  if (value === null || ["string", "boolean"].includes(typeof value)) return;
  if (typeof value === "number") {
    if (!Number.isFinite(value)) {
      throw new ApiError(400, "INVALID_ATTRIBUTES", `${path} contains a non-finite number.`);
    }
    return;
  }
  if (Array.isArray(value)) {
    if (value.length > 128) {
      throw new ApiError(400, "INVALID_ATTRIBUTES", `${path} contains too many items.`);
    }
    value.forEach((item, index) => validateJsonValue(item, `${path}[${index}]`, depth + 1));
    return;
  }
  if (!value || typeof value !== "object") {
    throw new ApiError(400, "INVALID_ATTRIBUTES", `${path} contains an unsupported value.`);
  }
  const entries = Object.entries(value);
  if (entries.length > 64) {
    throw new ApiError(400, "INVALID_ATTRIBUTES", `${path} contains too many fields.`);
  }
  for (const [key, item] of entries) {
    if (FORBIDDEN_KEYS.has(key)) {
      throw new ApiError(400, "INVALID_ATTRIBUTES", `${path} contains a forbidden field.`);
    }
    validateJsonValue(item, `${path}.${key}`, depth + 1);
  }
}

function validateAttributes(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new ApiError(400, "INVALID_ATTRIBUTES", "attributes must be a JSON object.");
  }
  if (Object.keys(value).length === 0) {
    throw new ApiError(400, "INVALID_ATTRIBUTES", "attributes must not be empty.");
  }
  validateJsonValue(value);
  if (JSON.stringify(value).length > 32_768) {
    throw new ApiError(400, "INVALID_ATTRIBUTES", "attributes is too large.");
  }
  return value;
}

function validateTransitionTime(value) {
  if (value === undefined) return undefined;
  if (!Number.isInteger(value) || value < 0 || value > 600_000) {
    throw new ApiError(
      400,
      "INVALID_TRANSITION_TIME",
      "transitionTime must be an integer between 0 and 600000 milliseconds.",
    );
  }
  return value;
}

function routeId(value, type = "resource") {
  let decoded;
  try {
    decoded = decodeURIComponent(value);
  } catch {
    throw new ApiError(400, "INVALID_ID", `The ${type} id is invalid.`);
  }
  if (!/^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/.test(decoded)) {
    throw new ApiError(400, "INVALID_ID", `The ${type} id is invalid.`);
  }
  return decoded;
}

function methodNotAllowed(allowed) {
  const error = new ApiError(405, "METHOD_NOT_ALLOWED", "The HTTP method is not allowed here.");
  error.allowed = allowed;
  return error;
}

function publicExecutionError(error) {
  if (!error) return undefined;
  return {
    code: typeof error.code === "string" ? error.code : "RULE_ACTION_FAILED",
    message: "A rule action could not be completed.",
  };
}

function makeBridgeEvent(execution) {
  const triggerEvent = execution.triggerEvent
    ? {
        type: execution.triggerEvent.type,
        id: execution.triggerEvent.id,
        time: execution.triggerEvent.time,
      }
    : undefined;
  return {
    id: randomUUID(),
    specversion: "1.0",
    source: "urn:local:dirigera-bridge",
    time: execution.at || new Date().toISOString(),
    type: execution.status === "success" ? "bridgeRuleExecuted" : "bridgeRuleFailed",
    data: {
      ...(execution.ruleId ? { ruleId: execution.ruleId } : {}),
      ...(execution.ruleName ? { ruleName: execution.ruleName } : {}),
      ...(execution.source ? { source: execution.source } : {}),
      ...(execution.deviceId ? { deviceId: execution.deviceId } : {}),
      ...(triggerEvent ? { triggerEvent } : {}),
      ...(execution.error ? { error: publicExecutionError(execution.error) } : {}),
    },
  };
}

function writeSse(response, event) {
  if (response.destroyed || response.writableEnded) return;
  const accepted = response.write(
    `id: ${event.bridgeSequence}\nevent: update\ndata: ${JSON.stringify(event)}\n\n`,
  );
  if (!accepted) response.destroy();
}

export async function createBridgeService(options = {}) {
  const paths = resolveDataPaths(options.dataDirectory);
  const [{ config: initialConfig, created }, ruleDocument] = await Promise.all([
    loadOrCreateConfig(paths),
    loadRuleDocument(paths),
  ]);
  let config = initialConfig;
  const eventStore = new EventStore(options.eventHistoryLimit);
  const cors = corsConfiguration();
  const sseResponses = new Set();
  let ruleEngine;

  const hubManager = new HubManager({
    config,
    persistConfig: async (nextConfig) => {
      config = await saveConfig(paths, nextConfig);
      return config;
    },
    onEvent: async (event) => {
      eventStore.record(event);
      await ruleEngine?.handleEvent(event);
    },
    onInternalError: (error) => {
      eventStore.record(makeBridgeEvent({ status: "error", source: "eventHandler", error }));
    },
  });

  ruleEngine = new RuleEngine({
    rules: ruleDocument.rules,
    saveRules: (rules) => saveRuleDocument(paths, rules),
    setDeviceAttributes: (request) =>
      hubManager.run((client) => client.devices.setAttributes(request)),
    onExecution: (execution) => eventStore.record(makeBridgeEvent(execution)),
  });

  async function handleRequest(request, response) {
    const corsResult = corsHeaders(request, cors);
    const commonHeaders = corsResult.headers;

    if (!corsResult.allowed) {
      throw new ApiError(403, "ORIGIN_NOT_ALLOWED", "The request origin is not allowed.");
    }

    if (request.method === "OPTIONS") {
      writeHeaders(response, commonHeaders);
      response.statusCode = 204;
      response.setHeader("Content-Length", "0");
      response.end();
      return;
    }

    let url;
    try {
      url = new URL(request.url, "http://127.0.0.1");
    } catch {
      throw new ApiError(400, "INVALID_URL", "The request URL is invalid.");
    }
    const { pathname } = url;

    if (pathname === "/api/health") {
      if (request.method !== "GET") throw methodNotAllowed(["GET"]);
      sendJson(
        response,
        200,
        { ok: true, service: "dirigera-local-bridge", version: BRIDGE_VERSION },
        commonHeaders,
      );
      return;
    }

    if (!pathname.startsWith("/api/")) {
      throw new ApiError(404, "NOT_FOUND", "The requested endpoint does not exist.");
    }
    if (!authorized(request, config.bridgeKey)) {
      throw new ApiError(401, "UNAUTHORIZED", "A valid X-Bridge-Key header is required.");
    }

    if (pathname === "/api/pair") {
      if (request.method !== "POST") throw methodNotAllowed(["POST"]);
      const body = await readJsonBody(request, { optional: true });
      const result = await hubManager.pair(body.gatewayIP);
      sendJson(response, 200, { ok: true, ...result }, commonHeaders);
      return;
    }

    if (pathname === "/api/status") {
      if (request.method !== "GET") throw methodNotAllowed(["GET"]);
      if (hubManager.paired && !hubManager.state.pairing) {
        await hubManager.probeStatus().catch(() => null);
      }
      sendJson(
        response,
        200,
        {
          ok: true,
          version: BRIDGE_VERSION,
          paired: hubManager.paired,
          connected: hubManager.state.connected,
          connecting: hubManager.state.connecting,
          pairing: hubManager.state.pairing,
          listening: hubManager.state.listening,
          gatewayIP: hubManager.gatewayIP,
          hub: hubManager.state.hub,
          lastConnectedAt: hubManager.state.lastConnectedAt,
          lastEventAt: hubManager.state.lastEventAt,
          lastError: hubManager.state.lastError,
          ruleCount: ruleEngine.list().length,
          eventCount: eventStore.list({ limit: 5_000 }).length,
          uptimeSeconds: Math.floor(process.uptime()),
        },
        commonHeaders,
      );
      return;
    }

    if (pathname === "/api/home") {
      if (request.method !== "GET") throw methodNotAllowed(["GET"]);
      const home = await hubManager.run((client) => client.home());
      sendJson(response, 200, home, commonHeaders);
      return;
    }

    const deviceMatch = /^\/api\/devices\/([^/]+)$/.exec(pathname);
    if (deviceMatch) {
      if (request.method !== "PATCH") throw methodNotAllowed(["PATCH"]);
      const id = routeId(deviceMatch[1], "device");
      const body = await readJsonBody(request);
      const attributes = validateAttributes(body.attributes);
      const transitionTime = validateTransitionTime(body.transitionTime);
      await hubManager.run((client) =>
        client.devices.setAttributes({ id, attributes, transitionTime }),
      );
      sendJson(response, 200, { ok: true, id }, commonHeaders);
      return;
    }

    const roomMatch = /^\/api\/rooms\/([^/]+)\/state$/.exec(pathname);
    if (roomMatch) {
      if (request.method !== "POST") throw methodNotAllowed(["POST"]);
      const id = routeId(roomMatch[1], "room");
      const body = await readJsonBody(request);
      const transitionTime = validateTransitionTime(body.transitionTime);
      if (body.deviceType !== undefined && typeof body.deviceType !== "string") {
        throw new ApiError(400, "INVALID_DEVICE_TYPE", "deviceType must be a string.");
      }
      const deviceType = body.deviceType?.trim();
      if (deviceType && !/^[A-Za-z][A-Za-z0-9_-]{0,63}$/.test(deviceType)) {
        throw new ApiError(400, "INVALID_DEVICE_TYPE", "deviceType is invalid.");
      }
      if (body.isOn !== undefined && typeof body.isOn !== "boolean") {
        throw new ApiError(400, "INVALID_STATE", "isOn must be a boolean.");
      }

      if (body.attributes !== undefined || transitionTime !== undefined) {
        const attributes =
          body.attributes === undefined
            ? { isOn: body.isOn }
            : { ...validateAttributes(body.attributes), ...(body.isOn === undefined ? {} : { isOn: body.isOn }) };
        validateAttributes(attributes);
        await hubManager.run((client) =>
          client.rooms.setAttributes({ id, deviceType, attributes, transitionTime }),
        );
      } else if (body.isOn !== undefined) {
        await hubManager.run((client) => client.rooms.setIsOn({ id, deviceType, isOn: body.isOn }));
      } else {
        throw new ApiError(
          400,
          "INVALID_STATE",
          "The body must include isOn or attributes.",
        );
      }
      sendJson(response, 200, { ok: true, id }, commonHeaders);
      return;
    }

    const sceneMatch = /^\/api\/scenes\/([^/]+)\/trigger$/.exec(pathname);
    if (sceneMatch) {
      if (request.method !== "POST") throw methodNotAllowed(["POST"]);
      const id = routeId(sceneMatch[1], "scene");
      await hubManager.run((client) => client.scenes.trigger({ id }));
      sendJson(response, 200, { ok: true, id }, commonHeaders);
      return;
    }

    if (pathname === "/api/rules") {
      if (request.method === "GET") {
        sendJson(response, 200, ruleEngine.list(), commonHeaders);
        return;
      }
      if (request.method === "POST") {
        const rule = await ruleEngine.create(await readJsonBody(request));
        sendJson(response, 201, rule, commonHeaders);
        return;
      }
      throw methodNotAllowed(["GET", "POST"]);
    }

    const ruleMatch = /^\/api\/rules\/([^/]+)$/.exec(pathname);
    if (ruleMatch) {
      const id = routeId(ruleMatch[1], "rule");
      if (request.method === "GET") {
        const rule = ruleEngine.get(id);
        if (!rule) throw new ApiError(404, "RULE_NOT_FOUND", "The requested rule does not exist.");
        sendJson(response, 200, rule, commonHeaders);
        return;
      }
      if (request.method === "PUT" || request.method === "PATCH") {
        const rule = await ruleEngine.update(id, await readJsonBody(request), {
          replace: request.method === "PUT",
        });
        sendJson(response, 200, rule, commonHeaders);
        return;
      }
      if (request.method === "DELETE") {
        await ruleEngine.delete(id);
        sendJson(response, 200, { ok: true, id }, commonHeaders);
        return;
      }
      throw methodNotAllowed(["GET", "PUT", "PATCH", "DELETE"]);
    }

    if (pathname === "/api/events") {
      if (request.method !== "GET") throw methodNotAllowed(["GET"]);
      const events = eventStore.list({
        after: url.searchParams.get("after"),
        limit: url.searchParams.get("limit"),
      });
      sendJson(response, 200, { events }, commonHeaders);
      return;
    }

    if (pathname === "/api/events/stream") {
      if (request.method !== "GET") throw methodNotAllowed(["GET"]);
      if (sseResponses.size >= MAX_SSE_CLIENTS) {
        throw new ApiError(503, "TOO_MANY_STREAMS", "Too many event streams are open.");
      }

      writeHeaders(response, commonHeaders);
      response.statusCode = 200;
      response.setHeader("Content-Type", "text/event-stream; charset=utf-8");
      response.setHeader("Cache-Control", "no-cache, no-transform");
      response.setHeader("Connection", "keep-alive");
      response.setHeader("X-Accel-Buffering", "no");
      response.flushHeaders();
      response.write("retry: 3000\n\n");

      const after = request.headers["last-event-id"] ?? url.searchParams.get("after");
      for (const event of eventStore.list({ after, limit: 500 })) writeSse(response, event);

      sseResponses.add(response);
      const unsubscribe = eventStore.subscribe((event) => writeSse(response, event));
      const heartbeat = setInterval(() => {
        if (
          !response.destroyed &&
          !response.writableEnded &&
          !response.write(": keepalive\n\n")
        ) {
          response.destroy();
        }
      }, 20_000);
      heartbeat.unref?.();

      const cleanup = () => {
        clearInterval(heartbeat);
        unsubscribe();
        sseResponses.delete(response);
      };
      request.once("close", cleanup);
      response.once("close", cleanup);
      return;
    }

    throw new ApiError(404, "NOT_FOUND", "The requested endpoint does not exist.");
  }

  const server = createServer((request, response) => {
    const fallbackCorsHeaders = corsHeaders(request, cors).headers;
    handleRequest(request, response).catch((error) => {
      if (error?.allowed) response.setHeader("Allow", error.allowed.join(", "));
      sendError(response, error, fallbackCorsHeaders);
    });
  });
  server.requestTimeout = 75_000;
  server.headersTimeout = 10_000;
  server.keepAliveTimeout = 5_000;
  server.maxHeadersCount = 64;

  ruleEngine.start();

  return {
    server,
    configCreated: created,
    get bridgeKey() {
      return config.bridgeKey;
    },
    paths,
    hubManager,
    ruleEngine,
    eventStore,
    async initializeHub() {
      await hubManager.initialize();
    },
    async close() {
      ruleEngine.stop();
      hubManager.stop();
      for (const response of sseResponses) response.end();
      sseResponses.clear();
      if (!server.listening) return;
      await new Promise((resolve, reject) => {
        server.close((error) => (error ? reject(error) : resolve()));
        server.closeIdleConnections?.();
      });
    },
  };
}

export async function startBridge(options = {}) {
  const host = validateBindHost(options.host ?? process.env.HOST ?? DEFAULT_HOST);
  const port = parsePort(options.port ?? process.env.PORT);
  const service = await createBridgeService(options);

  await new Promise((resolve, reject) => {
    const onError = (error) => {
      service.server.off("listening", onListening);
      reject(error);
    };
    const onListening = () => {
      service.server.off("error", onError);
      resolve();
    };
    service.server.once("error", onError);
    service.server.once("listening", onListening);
    service.server.listen({ host, port });
  });

  const address = service.server.address();
  const actualPort = typeof address === "object" && address ? address.port : port;
  console.log(`[bridge] Listening on http://${host}:${actualPort}`);
  if (service.configCreated) {
    console.log(`[bridge] Bridge key (shown once): ${service.bridgeKey}`);
  }
  service.initializeHub().catch(() => {});
  return service;
}

const isMain =
  process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isMain) {
  const service = await startBridge().catch((error) => {
    console.error(`[bridge] Startup failed: ${error?.message || "unknown error"}`);
    process.exitCode = 1;
    return null;
  });

  if (service) {
    let stopping = false;
    const shutdown = async () => {
      if (stopping) return;
      stopping = true;
      await service.close().catch(() => {});
    };
    process.once("SIGINT", shutdown);
    process.once("SIGTERM", shutdown);
  }
}
