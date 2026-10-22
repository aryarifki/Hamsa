# Acceptable use

Hamsa is a tool for **authorized** investigations. It records who ran what, against which target, and under which authorization reference. That record exists so the work can be defended — and so misuse can be attributed.

This document is a policy template, not legal advice. Have counsel review it for your jurisdiction before you deploy.

## The rule

Use Hamsa only where you have a lawful basis to process the data you are querying, and only within the scope that basis allows.

"Lawful basis" means one of:

- **Consent** — the person agreed, and you can produce the agreement.
- **Contract** — the processing is necessary to perform an engagement the subject is party to.
- **Legal obligation** — a statute requires the check.
- **Vital interests** — someone's life or safety is at stake.
- **Public task** — a public authority acting within its statutory powers.
- **Legitimate interests** — a documented balancing test, not a vibe.

If you cannot name the basis in one sentence, you do not have one.

## What the product enforces

| Control | Behaviour |
| --- | --- |
| Case authorization reference | Required (min. 3 chars) to open a case; displayed on the case and in exports |
| Lawful purpose | Required (min. 10 chars); stored with the dossier |
| Consent reference for tracking | Required to enrol a device; audited |
| Audit trail | Every login, lookup, export, grant, key creation, device ping and admin action |
| Credit ledger | Every debit/credit attributable to an operator |
| Provider keys | Never shipped; the operator supplies their own and is bound by that provider's terms |
| Rate limits | Per-IP on auth, per-user on lookups, per-device on pings |

## Prohibited uses

Do **not** use Hamsa to:

1. **Stalk, harass, threaten or intimidate** any person.
2. **Locate a person from a phone number.** The product has no such capability; do not add one to a deployment you operate.
3. **Access cameras you do not own or have not been contracted to monitor.** The camera module is an inventory register, not a discovery tool.
4. **Bypass authentication** on any third-party system, or use harvested credentials to access an account.
5. **Scrape private channels or closed groups.** The Telegram module reads only the public `t.me/s/` preview.
6. **Build a profile of a minor**, except where the investigation is specifically about their safety and is authorized by a guardian or authority.
7. **Process special-category data** (health, religion, political opinion, sexual orientation, biometrics) without an explicit legal basis.
8. **Resell raw results** as a data broker.
9. **Evade a court order, subpoena or regulatory hold.**
10. **Test the deployment against production data without a change record.**

## Handling the output

Lookup results are **leads, not facts**. Carrier data can be stale, geolocation is approximate, a username match can be a different human, and a breach record proves only that an address appeared in a dump — not that the person is the attacker.

Before a result appears in a client deliverable:

1. Corroborate it with a second, independent source.
2. Record the confidence level and the timestamp of collection.
3. Note what the result does **not** establish.
4. Store the record in the case file, not in a spreadsheet or chat export.

## Retention and deletion

Set a retention period before you collect, not after. A practical default:

- Active case: kept for the engagement plus any statutory period.
- Closed case: reviewed at 90 days; retained only if a legal hold applies.
- Audit log: retained for the period your regulator or insurer requires (often 1–3 years).
- Backups: inherit the same schedule; deletion must reach them too.

To delete an investigation, delete the case (which cascades to `case_items`), then delete the associated lookups and their exports. Audit entries are retained by design; if your policy requires removing the actor identifier, replace it with a case code rather than deleting the row.

## Data subject requests

A person may ask what you hold about them. Respond from `lookups` and `cases` filtered by their identifier, plus `audit_log` for who accessed it. Exports are generated per record (JSON, Markdown, print). Correlating a request across modules is manual on purpose — there is no "find everything about this human" button, and building one would turn the tool into a people-search engine.

## International transfers

Provider lookups leave your infrastructure. If the provider is outside your jurisdiction, the transfer needs its own basis (SCCs, adequacy decision, or a documented derogation). Prefer keyless/offline paths where they answer the question: phone metadata and IP classification both work with no external call.

## Incident reporting

If you suspect misuse of your deployment:

1. Preserve the audit log and database (do not delete the case).
2. Identify the actor from `audit_log` and `sessions`.
3. Revoke their sessions and API keys from **Admin → Operators** and **Settings → API keys**.
4. Rotate `HAMSA_SECRET` if provider credentials or camera passwords may have been exposed, then re-enter them.
5. Notify whoever your policy requires.

## Operator declaration

By running a lookup you are asserting:

> I am authorized to process this target's data, the purpose is recorded in a case file, and I will retain the result only as long as that purpose requires.

If that sentence is not true, do not press the button.
