/**
 * Minimal ESM resolver for the test suite.
 *
 * Application code imports siblings without extensions (`./http`), which the
 * Next.js bundler resolves but plain Node ESM does not. This hook retries with
 * `.ts` / `.tsx` / `/index.ts` before giving up.
 */
export async function resolve(specifier, context, nextResolve) {
  const isRelative = specifier.startsWith("./") || specifier.startsWith("../");
  const hasExtension = /\.[a-zA-Z0-9]+$/.test(specifier);

  if (!isRelative || hasExtension) return nextResolve(specifier, context);

  try {
    return await nextResolve(specifier, context);
  } catch (err) {
    for (const suffix of [".ts", ".tsx", "/index.ts", "/index.tsx"]) {
      try {
        return await nextResolve(specifier + suffix, context);
      } catch {
        /* try the next candidate */
      }
    }
    throw err;
  }
}
