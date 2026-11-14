import { spawn } from "node:child_process";
import { existsSync } from "node:fs";

const children = [];
let shuttingDown = false;

function shutdown(code = 0) {
  if (shuttingDown) return;
  shuttingDown = true;
  for (const child of children) child.kill("SIGTERM");
  setTimeout(() => process.exit(code), 250);
}

function launch(args, env) {
  const child = spawn(process.execPath, args, {
    cwd: process.cwd(),
    env: { ...process.env, ...env },
    stdio: "inherit",
  });
  children.push(child);
  child.on("exit", (code, signal) => {
    if (!shuttingDown) {
      console.error(`[production] child exited code=${code} signal=${signal ?? "none"}`);
      shutdown(code || 1);
    }
  });
}

process.on("SIGINT", () => shutdown());
process.on("SIGTERM", () => shutdown());

if (!existsSync(".next/standalone/server.js")) {
  throw new Error("Hamsa production build is missing; run npm run build first");
}
if (!existsSync("osiris/.next/standalone/server.js")) {
  throw new Error("OSIRIS production build is missing; run npm run build:osiris first");
}

launch([".next/standalone/server.js"], {
  HOSTNAME: process.env.HOSTNAME || "127.0.0.1",
  PORT: process.env.PORT || "3101",
});
launch(["osiris/.next/standalone/server.js"], {
  HOSTNAME: "127.0.0.1",
  PORT: process.env.OSIRIS_PORT || "3102",
});
