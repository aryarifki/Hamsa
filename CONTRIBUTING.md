# Contributing

Thanks for considering a contribution. Hamsa is intentionally small: a single Node process, a single SQLite file, no ORM and no UI framework. Please keep it that way.

## Setup

```bash
git clone https://github.com/aryarifki/Hamsa.git
cd Hamsa
cp .env.example .env        # set HAMSA_SECRET
npm install
npm run dev
```

Before opening a pull request:

```bash
npm run typecheck
npm test
npm run build
```

All three must pass. The test suite runs against an in-memory database and must not make network calls.

## What makes a good change

- **A bug fix with a test.** If the bug is in a pure function, add the failing case to `tests/core.test.mjs` first.
- **A new intelligence module** that returns the shared `ModuleResult` shape and degrades gracefully without an API key.
- **A documentation fix.** If the README lies, that is a bug.
- **A security improvement** with a note in `docs/SECURITY.md` describing the threat it addresses.

## What will be declined

- Adding a phone-number-to-location feature, a third-party camera scanner, or private-channel scraping. These are product boundaries, documented in `docs/ACCEPTABLE_USE.md`.
- Bundling API keys, scraped datasets, or credentials of any kind.
- An ORM, a component library, a state manager, or a separate queue service. The dependency list is a feature.
- Copying code or assets from a commercial OSINT product. Contributions must be original and MIT-compatible.
- Formatting-only pull requests that touch unrelated files.

## Code style

- TypeScript strict mode, no `any` in new code. `unknown` plus a narrowing check is fine.
- Functions that touch the database live in `lib/`; pages should not contain SQL.
- SQL is parameterised, always. `WHERE user_id = ?` on every read and write of user-owned rows.
- Comments explain *why*, not *what*. If a block needs a comment to explain what it does, rename something.
- Server Actions re-derive the user from the session; never trust a hidden field for identity.
- Anything that writes to the database also writes an audit entry.

## Adding a module

1. Create `lib/intel/<name>.ts` exporting an async function that returns `ModuleResult`.
2. Add the key to `ModuleKey` and `costOf()` in `lib/tokens.ts`.
3. Add a case to the dispatcher in `lib/lookup.ts`.
4. Add the page under `app/(console)/lookup/<name>/page.tsx` using `<LookupConsole module="<name>" />`.
5. Document the payload shape in `docs/API.md`.
6. Add at least one test that exercises the offline path.

## Commit messages

Conventional style, imperative mood:

```
fix(security): reject revoked device tokens on ping
feat(intel): add ASN fallback for private IP ranges
docs(api): document the 402 response body
```

Reference an issue when there is one.

## Reporting a vulnerability

Do not open a public issue. Use GitHub's private security advisory on the repository. Include reproduction steps and the impact you believe the issue has.

## License

By contributing you agree that your contribution is licensed under the MIT License, and that you have the right to submit it.
