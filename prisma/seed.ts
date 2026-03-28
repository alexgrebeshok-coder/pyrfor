import { execSync } from "node:child_process";

execSync("tsx prisma/seed-expense-taxonomy.ts", { stdio: "inherit" });
execSync("tsx prisma/seed-demo.ts", { stdio: "inherit" });
