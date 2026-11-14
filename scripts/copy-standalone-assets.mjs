import { cp, mkdir } from "node:fs/promises";
import { join } from "node:path";

const root = process.argv[2] ? join(process.cwd(), process.argv[2]) : process.cwd();
const next = join(root, ".next");
const standalone = join(next, "standalone");

await mkdir(join(standalone, ".next"), { recursive: true });
await cp(join(next, "static"), join(standalone, ".next", "static"), { recursive: true });

try {
  await cp(join(root, "public"), join(standalone, "public"), { recursive: true });
} catch (error) {
  if (error.code !== "ENOENT") throw error;
}

console.log(`[standalone] copied assets for ${root}`);
