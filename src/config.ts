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
  fs.mkdirSync(CONFIG_DIR, { recursive: true });
  fs.writeFileSync(CONFIG_FILE, JSON.stringify({ login, password }, null, 2));
  console.log(`API credentials saved to ${CONFIG_FILE}`);
}

export function getApiKey(): { login: string; password: string } {
  if (!fs.existsSync(CONFIG_FILE)) {
    console.error(
      "No API credentials found. Run: dataforseo-cli --set-api-key login=XXX password=XXX"
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
