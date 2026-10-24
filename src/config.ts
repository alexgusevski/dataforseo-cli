import * as fs from "fs";
import * as path from "path";
import * as os from "os";

const CONFIG_DIR = path.join(os.homedir(), ".config", "dataforseo-cli");
const CONFIG_FILE = path.join(CONFIG_DIR, "config.json");

interface Config {
  login: string;
  password: string;
  max_cost?: number;
  session_cap?: number;
}

// Non-secret settings that `dataforseo-cli config` may read and change.
export const SETTINGS: Record<string, string> = {
  max_cost: "Refuse any single call whose estimated cost exceeds this many USD (default 1)",
  session_cap: "Refuse calls once the session total would exceed this many USD (default: no cap)",
};

function readConfig(): Partial<Config> {
  try {
    return JSON.parse(fs.readFileSync(CONFIG_FILE, "utf-8"));
  } catch {
    return {};
  }
}

export function getSetting(key: string): number | undefined {
  const v = (readConfig() as any)[key];
  return typeof v === "number" ? v : undefined;
}

export function setSetting(key: string, value: number | undefined): void {
  if (!(key in SETTINGS)) throw new Error(`Unknown setting "${key}". Known: ${Object.keys(SETTINGS).join(", ")}`);
  const config: any = readConfig();
  if (value === undefined) delete config[key];
  else config[key] = value;
  fs.mkdirSync(CONFIG_DIR, { recursive: true });
  fs.writeFileSync(CONFIG_FILE, JSON.stringify(config, null, 2), { mode: 0o600 });
}

export function setApiKey(login: string, password: string): void {
  setCredentials(login, password);
}

export function setCredentials(login?: string, password?: string, base64?: string): void {
  if (base64) {
    const decoded = Buffer.from(base64, "base64").toString("utf-8");
    const colonIdx = decoded.indexOf(":");
    if (colonIdx === -1) {
      console.error("Invalid base64 token: expected format login:password");
      process.exit(1);
    }
    login = decoded.substring(0, colonIdx);
    password = decoded.substring(colonIdx + 1);
  }
  if (!login || !password) {
    console.error("Credentials required: provide login+password or base64 token");
    process.exit(1);
  }
  fs.mkdirSync(CONFIG_DIR, { recursive: true });
  fs.writeFileSync(CONFIG_FILE, JSON.stringify({ ...readConfig(), login, password }, null, 2), { mode: 0o600 });
  console.log(`API credentials saved to ${CONFIG_FILE}`);
}

export function getApiKey(): { login: string; password: string } {
  if (!fs.existsSync(CONFIG_FILE)) {
    console.error(
      "No API credentials found. Run: dataforseo-cli --set-credentials login=XXX password=XXX"
    );
    process.exit(1);
  }
  const config: Config = JSON.parse(fs.readFileSync(CONFIG_FILE, "utf-8"));
  return config;
}

function maskLogin(login: string): string {
  const atIdx = login.indexOf("@");
  if (atIdx <= 2) return login[0] + "*".repeat(Math.max(atIdx - 1, 0)) + login.substring(atIdx);
  return login[0] + "*".repeat(atIdx - 2) + login[atIdx - 1] + login.substring(atIdx);
}

export function checkCredentials(): { configured: boolean; maskedLogin?: string } {
  if (!fs.existsSync(CONFIG_FILE)) {
    return { configured: false };
  }
  try {
    const config: Config = JSON.parse(fs.readFileSync(CONFIG_FILE, "utf-8"));
    if (config.login && config.password) {
      return { configured: true, maskedLogin: maskLogin(config.login) };
    }
    return { configured: false };
  } catch {
    return { configured: false };
  }
}

export function getAuthHeader(): string {
  const { login, password } = getApiKey();
  return "Basic " + Buffer.from(`${login}:${password}`).toString("base64");
}
