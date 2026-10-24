/**
 * Minimal ESM resolver for the test suite.
 *
 * Application code uses two conventions that plain Node ESM does not resolve:
 *   - sibling imports without extensions (`./http`)
 *   - the `@/` alias from tsconfig paths (`@/lib/db`)
 *
 * This hook retries with `.ts` / `.tsx` / `/index.ts` before giving up, and maps
 * `@/x` to the repository root so tests can import route handlers directly.
 */
const ROOT = new URL("../", import.meta.url);

export async function resolve(specifier, context, nextResolve) {
  const aliased = specifier.startsWith("@/");
  const base = aliased ? new URL(specifier.slice(2), ROOT).href : specifier;
  const isRelative =
    base.startsWith("./") || base.startsWith("../") || base.startsWith("file:");
  const hasExtension = /\.[a-zA-Z0-9]+$/.test(base);

  if (!aliased && !isRelative && hasExtension) return nextResolve(specifier, context);

  try {
    return await nextResolve(base, context);
  } catch (err) {
    // Some packages (notably `next/server`) use extensionless subpath exports
    // that Node's ESM resolver rejects outside the bundler.
    if (!aliased && !isRelative && !hasExtension) {
      try {
        return await nextResolve(`${base}.js`, context);
      } catch {
        /* fall through to TypeScript candidates */
      }
    }
    for (const suffix of [".ts", ".tsx", "/index.ts", "/index.tsx"]) {
      try {
        return await nextResolve(base + suffix, context);
      } catch {
        /* try the next candidate */
      }
    }
    throw err;
  }
}
