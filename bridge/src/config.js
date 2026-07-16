import { randomBytes, randomUUID } from "node:crypto";
import {
  chmod,
  link,
  mkdir,
  open,
  readFile,
  rename,
  rm,
} from "node:fs/promises";
import { dirname, isAbsolute, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const BRIDGE_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const DEFAULT_DATA_DIR = join(BRIDGE_ROOT, ".data");

export function resolveDataPaths(dataDirectory = process.env.BRIDGE_DATA_DIR) {
  const dataDir = dataDirectory
    ? isAbsolute(dataDirectory)
      ? dataDirectory
      : resolve(process.cwd(), dataDirectory)
    : DEFAULT_DATA_DIR;

  return {
    dataDir,
    configPath: join(dataDir, "config.json"),
    rulesPath: join(dataDir, "rules.json"),
  };
}

export async function ensurePrivateDataDirectory(dataDir) {
  await mkdir(dataDir, { recursive: true, mode: 0o700 });
  await chmod(dataDir, 0o700);
}

async function writeJsonFile(filePath, value, flags = "wx") {
  const handle = await open(filePath, flags, 0o600);
  try {
    await handle.writeFile(`${JSON.stringify(value, null, 2)}\n`, "utf8");
    await handle.sync();
  } finally {
    await handle.close();
  }
  await chmod(filePath, 0o600);
}

async function createJsonFile(filePath, value) {
  const temporaryPath = `${filePath}.${process.pid}.${randomUUID()}.tmp`;
  await writeJsonFile(temporaryPath, value);

  try {
    await link(temporaryPath, filePath);
    await chmod(filePath, 0o600);
    return true;
  } catch (error) {
    if (error?.code === "EEXIST") {
      return false;
    }
    throw error;
  } finally {
    await rm(temporaryPath, { force: true });
  }
}

export async function atomicWriteJson(filePath, value) {
  const temporaryPath = `${filePath}.${process.pid}.${randomUUID()}.tmp`;
  await writeJsonFile(temporaryPath, value);
  try {
    await rename(temporaryPath, filePath);
    await chmod(filePath, 0o600);
  } finally {
    await rm(temporaryPath, { force: true });
  }
}

async function readJson(filePath) {
  const contents = await readFile(filePath, "utf8");
  try {
    return JSON.parse(contents);
  } catch {
    const error = new Error(`Invalid JSON in ${filePath}`);
    error.code = "INVALID_LOCAL_DATA";
    throw error;
  }
}

function validateStoredConfig(config) {
  const homeAssistantValid =
    config?.homeAssistant === undefined ||
    config?.homeAssistant === null ||
    (typeof config.homeAssistant === "object" &&
      !Array.isArray(config.homeAssistant) &&
      typeof config.homeAssistant.baseUrl === "string" &&
      typeof config.homeAssistant.accessToken === "string");
  const valid =
    config &&
    typeof config === "object" &&
    !Array.isArray(config) &&
    config.version === 1 &&
    typeof config.bridgeKey === "string" &&
    config.bridgeKey.length >= 32 &&
    (config.gatewayIP === null || typeof config.gatewayIP === "string") &&
    (config.accessToken === null || typeof config.accessToken === "string") &&
    homeAssistantValid;

  if (!valid) {
    const error = new Error("The local bridge configuration is invalid.");
    error.code = "INVALID_LOCAL_DATA";
    throw error;
  }
}

export async function loadOrCreateConfig(paths = resolveDataPaths()) {
  await ensurePrivateDataDirectory(paths.dataDir);

  const now = new Date().toISOString();
  const initialConfig = {
    version: 1,
    bridgeKey: randomBytes(32).toString("base64url"),
    gatewayIP: process.env.DIRIGERA_GATEWAY_IP?.trim() || null,
    accessToken: null,
    homeAssistant: null,
    createdAt: now,
    updatedAt: now,
  };

  const created = await createJsonFile(paths.configPath, initialConfig);
  const config = created ? initialConfig : await readJson(paths.configPath);
  validateStoredConfig(config);
  await chmod(paths.configPath, 0o600);

  return { config, created };
}

export async function saveConfig(paths, config) {
  const nextConfig = {
    version: 1,
    bridgeKey: config.bridgeKey,
    gatewayIP: config.gatewayIP ?? null,
    accessToken: config.accessToken ?? null,
    homeAssistant: config.homeAssistant ?? null,
    createdAt: config.createdAt,
    updatedAt: new Date().toISOString(),
  };
  validateStoredConfig(nextConfig);
  await atomicWriteJson(paths.configPath, nextConfig);
  return nextConfig;
}

export async function loadRuleDocument(paths = resolveDataPaths()) {
  await ensurePrivateDataDirectory(paths.dataDir);
  const initialDocument = { version: 1, rules: [] };
  const created = await createJsonFile(paths.rulesPath, initialDocument);
  const document = created ? initialDocument : await readJson(paths.rulesPath);

  if (
    !document ||
    typeof document !== "object" ||
    document.version !== 1 ||
    !Array.isArray(document.rules)
  ) {
    const error = new Error("The local rules file is invalid.");
    error.code = "INVALID_LOCAL_DATA";
    throw error;
  }

  await chmod(paths.rulesPath, 0o600);
  return document;
}

export async function saveRuleDocument(paths, rules) {
  await atomicWriteJson(paths.rulesPath, { version: 1, rules });
}
