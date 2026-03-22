import { existsSync } from "node:fs";
import { resolve } from "node:path";

import { config as loadDotenv } from "dotenv";

export function loadStandardEnvFiles() {
  for (const filename of [".env.local", ".env.production", ".env"]) {
    const path = resolve(process.cwd(), filename);
    if (existsSync(path)) {
      loadDotenv({ path });
    }
  }
}
