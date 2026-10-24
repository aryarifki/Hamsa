# Authorization records

Hamsa is only used against targets for which there is a documented lawful basis. This directory is the place to keep that documentation for each deployment/engagement.

The repository is private. Do not commit real client names, target identifiers, signed PDFs or personal data here — keep those in your case-management system and store only a pointer (reference ID, date, scope, approver) in this folder. If your policy requires the signed instrument itself, store it in the access-controlled document store and reference it.

## What every engagement record needs

| Field | Why |
| --- | --- |
| Engagement / case reference | Ties every Hamsa case (`authorization_ref`) to a real instrument |
| Principal (client or authority) | Who asked for the work |
| Lawful basis | Consent, contract, legal obligation, vital interests, public task or legitimate interests |
| Scope | Domains, accounts, phone numbers, devices, cameras, time window |
| Exclusions | Sibling brands, employees' personal assets, third-party infrastructure |
| Approver and date | Who signed off, and when |
| Expiry / review date | When the authority must be renewed or the data deleted |
| Handling rules | Storage location, retention, who may access the output |

## Rules of thumb

1. **One record per engagement**, created before the first lookup.
2. **The scope must name what is excluded**, not only what is included. A camera module enrolment is in scope only for streams the client owns or operates.
3. **Consent for tracking is separate.** A signed engagement does not replace the device owner's consent reference recorded in `tracked_devices.consent_ref`.
4. **Revocation is immediate.** When the basis ends, revoke device tokens and stop the camera schedules in the same change window.
5. **Deletion is recorded.** Note when snapshots, location history and case data were purged, and by whom.

## Template

Copy [`TEMPLATE.md`](TEMPLATE.md) and fill it in. Keep the filled copy outside version control unless it contains no client-identifying data.
