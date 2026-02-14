import * as fs from "fs";
import * as path from "path";
import * as os from "os";

const CONFIG_DIR = path.join(os.homedir(), ".config", "dataforseo-cli");
const CONFIG_FILE = path.join(CONFIG_DIR, "config.json");

interface Config {
  login: string;
  password: string;
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
  fs.writeFileSync(CONFIG_FILE, JSON.stringify({ login, password }, null, 2));
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

export function getAuthHeader(): string {
  const { login, password } = getApiKey();
  return "Basic " + Buffer.from(`${login}:${password}`).toString("base64");
}
