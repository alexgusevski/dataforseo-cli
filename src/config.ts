import * as fs from "fs";
import * as path from "path";
import * as os from "os";
import { randomUUID } from "crypto";

const CONFIG_DIR = path.join(os.homedir(), ".config", "dataforseo-cli");
const CONFIG_FILE = path.join(CONFIG_DIR, "config.json");

interface Config {
  login: string;
  password: string;
}

const ENV_LOGIN = "DATAFORSEO_LOGIN";
const ENV_PASSWORD = "DATAFORSEO_PASSWORD";
const ENV_AUTH = "DATAFORSEO_AUTH";

function decodeAuthToken(base64: string): Config {
  let decoded: string;
  try {
    decoded = Buffer.from(base64, "base64").toString("utf-8");
  } catch {
    throw new Error("Invalid base64 token");
  }

  const colonIdx = decoded.indexOf(":");
  if (colonIdx <= 0 || colonIdx === decoded.length - 1) {
    throw new Error("Invalid base64 token: expected login:password");
  }

  return {
    login: decoded.substring(0, colonIdx),
    password: decoded.substring(colonIdx + 1),
  };
}

function credentialsFromEnv(): Config | null {
  const token = process.env[ENV_AUTH];
  if (token) return decodeAuthToken(token);

  const login = process.env[ENV_LOGIN];
  const password = process.env[ENV_PASSWORD];
  if (!login && !password) return null;
  if (!login || !password) {
    throw new Error(`${ENV_LOGIN} and ${ENV_PASSWORD} must be set together`);
  }
  return { login, password };
}

function credentialsFromFile(): Config | null {
  if (!fs.existsSync(CONFIG_FILE)) return null;
  if (process.platform !== "win32") {
    // Repair files created by older CLI versions, which relied on the user's
    // umask and could therefore leave credentials world-readable.
    fs.chmodSync(CONFIG_DIR, 0o700);
    fs.chmodSync(CONFIG_FILE, 0o600);
  }
  const parsed: unknown = JSON.parse(fs.readFileSync(CONFIG_FILE, "utf-8"));
  if (
    typeof parsed !== "object" ||
    parsed === null ||
    typeof (parsed as Config).login !== "string" ||
    typeof (parsed as Config).password !== "string" ||
    !(parsed as Config).login ||
    !(parsed as Config).password
  ) {
    throw new Error(`Invalid credentials file: ${CONFIG_FILE}`);
  }
  return parsed as Config;
}

export function setApiKey(login: string, password: string): void {
  setCredentials(login, password);
}

export function setCredentials(login?: string, password?: string, base64?: string): void {
  if (base64) {
    const decoded = decodeAuthToken(base64);
    login = decoded.login;
    password = decoded.password;
  }
  if (!login || !password) {
    throw new Error("Credentials required: provide login+password or base64 token");
  }
  fs.mkdirSync(CONFIG_DIR, { recursive: true, mode: 0o700 });
  if (process.platform !== "win32") fs.chmodSync(CONFIG_DIR, 0o700);
  if (fs.existsSync(CONFIG_FILE) && process.platform !== "win32") {
    fs.chmodSync(CONFIG_FILE, 0o600);
  }

  const temporary = path.join(CONFIG_DIR, `.config.${process.pid}.${randomUUID()}.tmp`);
  try {
    fs.writeFileSync(temporary, JSON.stringify({ login, password }, null, 2), {
      encoding: "utf8",
      flag: "wx",
      mode: 0o600,
    });
    if (process.platform !== "win32") fs.chmodSync(temporary, 0o600);
    fs.renameSync(temporary, CONFIG_FILE);
    if (process.platform !== "win32") fs.chmodSync(CONFIG_FILE, 0o600);
  } finally {
    try {
      if (fs.existsSync(temporary)) fs.unlinkSync(temporary);
    } catch {
      // A private abandoned temp file is preferable to hiding the real error.
    }
  }
  console.log(`API credentials saved to ${CONFIG_FILE}`);
}

export function getApiKey(): { login: string; password: string } {
  const config = credentialsFromEnv() ?? credentialsFromFile();
  if (config) return config;
  throw new Error(
    "No API credentials found. Set DATAFORSEO_LOGIN and DATAFORSEO_PASSWORD, " +
      "or run: dataforseo-cli --set-credentials login=XXX password=XXX"
  );
}

function maskLogin(login: string): string {
  const atIdx = login.indexOf("@");
  if (atIdx === -1) {
    if (login.length <= 2) return "*".repeat(login.length);
    return login[0] + "*".repeat(login.length - 2) + login[login.length - 1];
  }

  const local = login.slice(0, atIdx);
  const domain = login.slice(atIdx);
  if (local.length <= 1) return `*${domain}`;
  if (local.length === 2) return `${local[0]}*${domain}`;
  return `${local[0]}${"*".repeat(local.length - 2)}${local[local.length - 1]}${domain}`;
}

export function checkCredentials(): { configured: boolean; maskedLogin?: string } {
  try {
    const config = credentialsFromEnv() ?? credentialsFromFile();
    return config
      ? { configured: true, maskedLogin: maskLogin(config.login) }
      : { configured: false };
  } catch {
    return { configured: false };
  }
}

export function getAuthHeader(): string {
  const { login, password } = getApiKey();
  return "Basic " + Buffer.from(`${login}:${password}`).toString("base64");
}
