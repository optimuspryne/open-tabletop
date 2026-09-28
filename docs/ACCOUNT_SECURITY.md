# Account passwords and recovery

Status: implemented, with automated verification completed. The user reported the account flows,
revised layout and configured SMTP setup working on 2026-09-28. This does not certify every device or
every recovery failure case; the acceptance checklist below remains available for deployment testing.

The user reported the account features working on 2026-09-28. The subsequent approved layout fix
moves Account security beside Admin in the page header and wraps the account card's identity/actions
without overlap. `public/index.html` relocates the existing control, `public/landing.js`'s `setView`
controls its visibility, and `public/styles.css` reuses the existing compact icon behavior and adds
wrapping styles. `scripts/account-security-test.mjs` checks header bounds and identity/control
separation in both modes, with long names and admin/non-admin layouts. `CHANGELOG.md` records the fix.
No new production functions or icons are introduced. Refresh the browser to test this layout update.

## User flows

- **Create an account:** enter a password twice. Both inputs are masked, allow paste/password
  managers, and enforce matching passwords of 8–128 characters. Errors identify the affected field.
- **Account security → Set password:** replaces the browser prompt. Adding a password does not
  request or grant host access. Requesting host access redirects passwordless users here, then
  continues the existing approval request. Existing password accounts use **Change password**,
  which also requires the current password. Forgotten passwords use recovery below.
- **Account security → Recovery email:** sends a verification link to the account's existing email.
  Open it in the signed-in browser that requested it and press Continue. Old emails are unverified
  after upgrading; verification is not inferred from their presence in the database.
- **Account security → Recovery codes:** generates ten single-use codes, displayed once with Copy
  and Download. Save them outside the browser. Regeneration replaces previous codes and invalidates
  any outstanding recovery grant; leaving the screen clears the displayed plaintext.
- **Recover account / reset password:** use a verified email link or username/email plus a saved
  code. Email links require an explicit Continue action, so previewing a URL does not consume it.
  Existing password accounts must choose and confirm a new password. Passwordless accounts can
  recover without adding one. Both preserve account identity, rooms, roles, private hands and
  library ownership. Recovery never grants host/admin privileges.
- Successful password changes and recovery revoke previous sessions, email/grant tokens and all
  recovery codes, then issue one new device session. Live room access is revoked through the
  existing access service. Save new recovery codes afterward.

Recovery must be enrolled before access is lost. An unverified email alone cannot reclaim an old
passwordless account. The feature adds no administrator impersonation or ownership bypass.

## SMTP configuration

Email is optional; recovery codes and password changes work without it. Install dependencies with
`npm ci`, apply migration `023_account_recovery.sql`, restart the server and refresh clients.
The application supports the existing owner/runtime role separation and default table privileges.
Fresh installs include migration 023 in `postgres/schema.sql`; existing snapshots remain compatible.

| Variable | Meaning |
| --- | --- |
| `PUBLIC_ORIGIN` | Canonical origin used in email links, e.g. `https://tabletop.example.com`. No path, credentials, query or fragment. HTTPS required except localhost development. Never derived from request headers. |
| `SMTP_HOST` | SMTP hostname. Omit to disable email recovery. |
| `SMTP_PORT` | Defaults to 587. Port 465 uses implicit TLS; all other ports require STARTTLS. Certificate verification remains enabled. |
| `SMTP_FROM` | Sender email address authorized by your provider; a bare address, not a display-name string. |
| `SMTP_USER` | Optional SMTP authentication username; must be supplied with a password. |
| `SMTP_PASSWORD_FILE` | Preferred secret file. Takes precedence over `SMTP_PASSWORD`; trailing newlines are removed. |
| `SMTP_PASSWORD` | Optional environment fallback for the SMTP password. Never commit a real value. |

When `SMTP_HOST` is supplied, invalid/incomplete settings fail startup. An unreachable provider is
reported as a generic server-side delivery failure; the application does not log recipient addresses,
link tokens, message bodies or SMTP credentials. Outbound network access to the chosen SMTP port is
required. No inbound SMTP listener, local mail server or new web port is introduced.

### Bare-metal Node.js installation

Set these values in the project `.env` when launching with `npm start`, which loads that file.
Alternatively, supply them through the service manager; a direct `node server.js` invocation must
explicitly load the environment. Replace the example origin, SMTP host, sender and login with your
own, and use the port specified by your provider:

```dotenv
PUBLIC_ORIGIN=https://tabletop.example.com
SMTP_HOST=smtp.example.com
SMTP_PORT=587
SMTP_FROM=tabletop@example.com
SMTP_USER=your-smtp-username
SMTP_PASSWORD_FILE=/etc/open-tabletop/smtp_password
```

Create the password file using a local editor. It contains **only the SMTP/app password as plain
text**, for example the dummy value below (replace it with the generated password):

```text
abcdefghijklmnop
```

Do not include quotes, `SMTP_PASSWORD=`, JSON or other configuration. A trailing newline is fine.
Use an absolute path, make the file readable by the account running the application, and restrict
access (for example, mode `600` with that account as owner). Parent directories must also allow that
account to reach the file. Do not commit the file or paste its contents into logs or support requests.
`SMTP_PASSWORD` can be supplied as an environment alternative; a configured password file takes
precedence. No Docker secret mount is needed on bare metal.

Restart the application through its existing service/process manager after changing these settings.
For a foreground `npm start` process, stop and start it again. No new inbound port is required;
allow outbound connections to the provider's SMTP port.

### Docker Compose installation

Compose forwards the settings from `.env`. Use the same provider settings as above, but the password
path must be inside the container. To use a file-backed password, create `secrets/smtp_password.txt`
with only the password, as described above,
and use a `docker-compose.override.yml` such as:

```yaml
services:
  app:
    environment:
      SMTP_PASSWORD_FILE: /run/secrets/smtp_password
    secrets:
      - smtp_password
secrets:
  smtp_password:
    file: ./secrets/smtp_password.txt
```

Keep that file outside version control and readable only by the appropriate operator/runtime user.
Recreate the application container so it receives the updated environment and secret mount:

```bash
docker compose up -d --force-recreate app
```

An ordinary container restart does not load changed Compose environment values. If this is also a
code upgrade, rebuild/deploy the updated application image using the normal upgrade procedure.

### SMTP provider setup

Use your provider's documented SMTP hostname, port and authentication username. The application
uses implicit TLS on port `465` and requires STARTTLS on other ports, commonly `587`.
Set `SMTP_FROM` to an address your provider authorizes for sending. The public website origin
and sender address need not have identical
hostnames. For example, a site at `https://tabletop.example.com` can send from `tabletop@example.com`.

Check your provider's documentation for SMTP access requirements. It may require a dedicated app
password or SMTP credential instead of your normal account password, and SMTP access may depend
on your account plan. Where supported, create a dedicated credential for Open Tabletop with only
the access needed to send mail, and store its password in the configured password file.

Configure the provider's sender/domain verification and DNS requirements with that provider. Test
actual delivery, spam-folder placement and expired links before relying on email recovery.

### Delivery and recovery smoke test

1. Sign in and open **Account security**, then request verification for the displayed email address.
2. Open the received link in the same signed-in browser and select **Continue**. The account should
   now show a verified recovery email. Existing addresses are not automatically verified.
3. In a signed-out browser, select **Recover account / reset password**, enter that verified email,
   and follow the emailed link. Existing password accounts must choose and confirm a new password;
   passwordless accounts may remain passwordless. Both retain the same account identity.
4. Confirm the old sessions no longer work and save a new set of recovery codes after recovery.

Email links expire after 30 minutes and work once. Allow at least 60 seconds between email requests.
The public recovery form deliberately returns the same response for unknown/unverified addresses;
a success message alone does not confirm delivery. If email is unavailable, check that `SMTP_HOST`
reached the app process. For failed delivery, check outbound network access, the sender address,
the app-password permissions and spam folders. Server logs show a generic `[recovery-mail] delivery
failed` message; provider delivery logs may offer more detail. Never disable TLS certificate checks.

## Security and persistence contracts

`shared/passwords.js` defines password confirmation validation for browser and server. The old
`/host/request` password mutation is removed: it now requires a previously set password.
`/auth/signup` requires `confirmation` whenever a password is supplied; passwordless signup remains
unchanged. New browser forms use semantic submit events, native password inputs and shared controls.
There is no new gameplay gesture; keyboard, touch and mouse use the same form path. Compact mode
keeps essential labels visible and touch uses stacked 44px-minimum buttons.

`server/account-security-queries.js`, exposed as `db.accountSecurity`, owns credential transactions.
It locks the account first, rechecks the current session or recovery proof, and commits password
updates, proof consumption, revocation and the replacement session atomically. The expected password
hash is compared again after asynchronous hashing, so stale verification cannot replace newer
credentials. Recovery proofs are bound to the stored email. Failed writes roll back proof consumption.

`account_recovery_tokens` stores only hashes with purpose (`verify`, `recover`, `grant`), account,
email and expiry, with at most one token per account/purpose. Email tokens expire after 30 minutes;
exchanged recovery grants after 10 minutes. `account_recovery_codes` stores ten hashes per account;
codes contain 128 random bits and remain valid until used, replaced or revoked. Password hashing
uses the existing salted scrypt implementation; random credentials use the existing token helpers.
No recovery credential enters synchronized room state, public account projections or game snapshots.

`server/http/routes/account-security.js` provides:

| Method and path under `/auth` | Contract |
| --- | --- |
| `GET /security/config` | Public email availability flag only. |
| `GET /security` | Authenticated email verification state, remaining code count and account projection. |
| `POST /password` | Authenticated `{password, confirmation, currentPassword?}`; existing passwords require current-password verification. |
| `POST /recovery/codes` | Authenticated code regeneration; plaintext returned once. |
| `POST /recovery/verify/request` | Authenticated verification email request. |
| `POST /recovery/verify` | Authenticated `{token}`; must belong to the same live account/email. |
| `POST /recovery/request` | Public `{email}`; same response whether the address is unknown, unverified or enrolled. |
| `POST /recovery/exchange` | `{token}` or `{login,code}` becomes a short-lived recovery grant, not a login session. |
| `POST /recovery/complete` | `{grant,password?,confirmation?}` consumes the grant; existing password accounts cannot remove their password. |

All `/auth` responses use `Cache-Control: no-store`; new routes use the existing IP token bucket
and bounded JSON parsing. Email issuance also has a database-enforced 60-second account cooldown.
A bounded, serial in-process queue responds before account lookup/delivery to avoid account-dependent
request timing and SMTP fan-out. A restart may drop queued emails; users can request again. Failed
mail delivery discards that email token. Plaintext email links use fragments that are removed from
browser history before exchange and are not sent as HTTP request paths or referrer data.

Nodemailer is the sole new runtime dependency. Only server-authored plain text is sent, with file/URL
content access disabled and bounded connection/greeting/socket timeouts.

## Verification and handoff

- `npm run test:accounts` exercises production landing/account modules with fixture HTTP responses at
  1280px mouse and 390/360px touch, in full and compact modes, including field masking, confirmation,
  hosting continuation, code clearing, password reset and non-consuming link previews.
- Unit/HTTP tests cover input validation, optional/configured SMTP, bounded mail work, safe errors,
  public recovery response consistency and live-access revocation wiring.
- Database integration tests cover migration of existing password/passwordless accounts, verification,
  cooldowns, expired/replaced proofs, concurrent single-use consumption, cross-account rejection,
  password-reset requirements, rollback, session replacement and membership preservation.
- Required suites passed: `npm run check` (912 tests plus lint/format/style checks),
  `npm run test:input` (58 tests), `npm run test:components`, `npm run test:devices` (7 profiles),
  `npm run test:integration` (24 tests), and `npm run test:accounts` (6 layout/input combinations
  plus fragment-link and passwordless completion coverage). The component fixture reported eight
  missing generated asset thumbnails; its assertions and notecard editor checks passed.
- Manual acceptance: signup mismatch and success; adding/changing a password; requesting host access;
  email verification; passwordless recovery and password reset by both methods; replay/expiry;
  recovery from a second browser; old-session disconnection; copying/downloading codes. The user
  reported functional and SMTP success; individual checklist items and real devices are not inferred.

## Implementation inventory

The implementation reuses existing authentication, password hashing, token generation, rate limiting,
public user projections, room-access revocation and semantic UI controls. A dedicated transaction
module is necessary because recovery proof consumption, credential changes and session replacement
must commit together. Password confirmation is shared between browser and server.

| Files | Changes and principal functions |
| --- | --- |
| `shared/passwords.js` | Adds length constants and `passwordError` for shared confirmation validation. |
| `server/account-security-queries.js` | Adds `createAccountSecurityQueries`; transaction/account/session locking, token insertion and access rotation helpers support `status`, `credentials`, `setPassword`, `replaceCodes`, `issueEmail`, `discardEmail`, `verifyEmail`, `exchange` and `recover`. |
| `server/recovery-mail.js` | Adds `recoveryMailConfig`, `createRecoveryMailer` and `createRecoveryMailQueue` for optional TLS SMTP and bounded asynchronous delivery. |
| `server/http/routes/account-security.js` | Adds `createAccountSecurityRouter` and its password, enrollment, verification, proof-exchange and completion handlers. |
| `server/database.js`, `db.js` | Composes and exports `accountSecurity`. |
| `server.js` | Composes the new router/mailer and removes the unused rooms-router password-hashing injection. |
| `server/http/routes/auth.js` | Extends signup validation with confirmation and marks authentication responses non-cacheable. |
| `server/http/routes/rooms.js` | Changes the host-request handler to require an existing password; removes its password mutation. |
| `postgres/023_account_recovery.sql`, `postgres/schema.sql` | Adds verification/cooldown fields and recovery tables, including fresh-install migration bookkeeping. |
| `public/account-security.js` | Adds `createAccountSecurityUI`, transient-secret cleanup, navigation/submission helpers, password/recovery/code/link handlers and `validatePasswordFields`. |
| `public/landing.js` | Extends `setView`, signup and boot; composes account security and changes `onRequestHost` to use the masked form and show continuation errors on the home view. |
| `public/index.html`, `public/styles.css` | Adds approved password-confirmation/security/recovery forms and accessible responsive styles. |
| `scripts/build-icons.mjs`, `public/admin.html`, `public/table.html` | Registers the approved lock/mail/key icons and regenerates shared sprites (also in `public/index.html`). |
| `package.json`, `package-lock.json` | Adds Nodemailer and the `test:accounts` command. |
| `.env.example`, `docker-compose.yml` | Documents/forwards optional SMTP and canonical-origin settings. |
| `test/backend-account-security.js` | Adds shared validation, SMTP/queue and production HTTP route tests. |
| `test/integration/database.js`, `scripts/test-database.mjs` | Adds recovery transaction/failure tests and migration-023 upgrade verification using the separate database roles. |
| `scripts/account-security-test.mjs` | Adds actual-browser account-flow tests with fixture HTTP responses, input/layout coverage and screenshots. |
| `CHANGELOG.md`, `docs/REFERENCE.md`, `docs/ARCHITECTURE.md`, `docs/GESTURES.md`, `docs/ACCOUNT_SECURITY.md` | Records the feature, contracts, ownership boundaries, input behavior, setup, verification and manual handoff. |
