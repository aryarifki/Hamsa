# Contributing

Thanks for considering a contribution. Hamsa is intentionally small: a single Node process, one PostgreSQL database, no ORM and no UI framework. Please keep it that way.

## Setup

```bash
git clone https://github.com/aryarifki/Hamsa.git
cd Hamsa
cp .env.example .env        # set HAMSA_SECRET and DATABASE_URL
npm install

createdb hamsa              # or: docker run -e POSTGRES_PASSWORD=... -p 5432:5432 postgres:17
npm run migrate up          # creates the baseline and applies migrations
npm run dev                 # boots and re-checks the schema
```

Camera work also needs `ffmpeg` on `PATH` (or `HAMSA_FFMPEG_PATH`). It is only required when a camera is checked or captured, not to boot the app.

Before opening a pull request:

```bash
npm run typecheck
npm test                    # needs TEST_DATABASE_URL or the local hamsa_test database
npm run build
```

All three must pass. The suite runs against a real PostgreSQL database and must not make network calls. Each test file resets the rows it uses, so run it serialized (`--test-concurrency=1`, already set in `npm test`).

## What makes a good change

- **A bug fix with a test.** If the bug is in a pure function, add the failing case to `tests/core.test.mjs` first.
- **A new intelligence module** that returns the shared `ModuleResult` shape and degrades gracefully without an API key.
- **A reversible migration.** Add it to `lib/migrations.ts` with both `up` and `down`; update `tests/migrations.test.mjs` to prove the down path does not destroy existing rows.
- **A documentation fix.** If the README lies, that is a bug.
- **A security improvement** with a note in `docs/SECURITY.md` describing the threat it addresses.

## Code style

- TypeScript strict mode, no `any` in new code. `unknown` plus a narrowing check is fine.
- Functions that touch the database live in `lib/`; pages should not contain SQL.
- SQL is parameterised, always. `WHERE user_id = ?` on every read and write of user-owned rows. `lib/db.ts` rewrites `?` to `$n`; do not use the Postgres `?` JSON operator in raw SQL.
- Comments explain *why*, not *what*. If a block needs a comment to explain what it does, rename something.
- Server Actions re-derive the user from the session; never trust a hidden field for identity.
- Anything that writes to the database also writes an audit entry.
- Secrets (camera passwords, provider keys) are encrypted at rest with `encryptSecret()` and never logged. Redact URLs before storing an error.

## Adding a module

1. Create `lib/intel/<name>.ts` exporting an async function that returns `ModuleResult`.
2. Add the key to `ModuleKey` and `costOf()` in `lib/tokens.ts`.
3. Add a case to the dispatcher in `lib/lookup.ts`.
4. Add the page under `app/(console)/lookup/<name>/page.tsx` using `<LookupConsole module="<name>" />`.
5. Document the payload shape in `docs/API.md`.
6. Add at least one test that exercises the offline path.

## Adding a schema change

1. Append a migration to `lib/migrations.ts` (`id`, `up`, `down`, optional `dataLoss`).
2. Keep the baseline `lib/schema.ts` at v1 — new installs run the baseline and then every migration.
3. Use `timestamptz`, `TEXT` ids and `INTEGER` 0/1 flags to match the existing tables.
4. Test both directions in a scratch schema; down migrations must preserve v1 rows.
5. Run `npm run migrate up` and `npm run migrate status` against a copy before shipping.

## Commit messages

Conventional style, imperative mood:

```
fix(security): reject revoked device tokens on ping
feat(cctv): add ONVIF PullPoint polling
docs(api): document the 403 response body
```

Reference an issue when there is one.

## Reporting a vulnerability

Do not open a public issue. Use GitHub's private security advisory on the repository. Include reproduction steps and the impact you believe the issue has.

## License

By contributing you agree that your contribution is licensed under the MIT License, and that you have the right to submit it.
