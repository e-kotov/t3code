# Approved: upstream trusted device keys and fork direct-session renewal

PR #83 integrates upstream through `4574c6013d52867878038967297a885f1692383c`.
Egor approved the reviewed snapshot update on 2026-11-14: retain upstream trusted-device
approval/revocation and fork bearer-only renewal as separate paths. The exact surface
tripwire now includes `proofKeyThumbprintOf`, `revokeByProofKey`, and
`auth_sessions.proof_key_thumbprint`. No eligibility, DPoP rejection, expiry or revocation
behavior changed. This records the decision required by
`docs/operations/upstream-sync.md#session-renewal-tripwires` for upstream `a2edd281df`.

## Compared behavior

- **Policy and transports:** upstream Connect uses proof-key-bound DPoP sessions and
  optional per-device approval (off by default). Fork renewal accepts only still-valid
  direct bearer pairing sessions and genuine bearer agent links. `isRenewable` explicitly
  excludes proof-key-bound and DPoP sessions. The HTTP endpoint reads Bearer headers,
  not cookies, and rejects clients disallowed by managed policy. Neither path replaces
  the other for its current clients.
- **Expiry and offline recovery:** upstream Connect exchanges approved-key credentials
  for one-hour signed tokens and can mint again using the trusted key. Device approval
  itself has no expiry and lasts until revocation. Fork renewal extends the same bearer
  session in place (default 30-day window, 365-day maximum age), only while the presented
  token remains valid. It does not recover expired sessions. Old bearer tokens retain
  their own signed expiry; already-open direct sockets still close at their original expiry.
- **Revocation and concurrency:** upstream adds `proofKeyThumbprintOf`, `revokeByProofKey`
  and `auth_sessions.proof_key_thumbprint`. Revoking a different device's bound session
  removes that key's trust, sessions and unspent credentials; own-key exceptions remain
  upstream's policy. Device mint/exchange/revoke operations use the Connect trust lock.
  Fork renewal uses a conditional SQL update of an unexpired, non-revoked bearer session;
  normal session revocation wins before the update or invalidates every token afterward.
  Proof-key revocation selects only rows bound to that key, so ordinary bearer renewal
  rows are not its targets.
- **Scopes and identity:** upstream exchange intersects requested scopes with the grant
  and requires DPoP proofs for bound transports. Fork renewal re-signs existing claims,
  checks that session ID, method, subject, proof key, scopes, peer-link and runtime ceiling
  remain identical, and changes only expiry. No new renewal eligibility is proposed.
- **Migration:** migration 090 adds nullable proof-key storage and the trusted-device
  table; existing bearer rows remain unbound. Upstream records keys that successfully
  exchange while approval is disabled, allowing subsequent approval enablement to retain
  those devices. Legacy session rows are not retroactively proof-bound. Fork clients retain
  their existing direct-renewal driver/supervisor mounts and peer-link recovery path.

## Approved scope

Keep upstream device approval/revocation and fork bearer-only renewal intact. Update only
the three reviewed surface additions. Retain the exact member/column comparisons,
all three expiry/socket tripwires and DPoP rejection tests. Future surface changes still
fail and require review; this decision does not preapprove additional authentication changes.

## Evidence and remaining limits

Sources reviewed: `SessionStore.ts`, `EnvironmentAuth.ts`, `ForkSessionRenewal.ts`,
`forkSessionRenewalHttp.ts`, `persistence/AuthSessions.ts`, migration 090,
`docs/internals/t3-connect.md`, and upstream device approval/revocation tests.
Before approval, the compatibility run produced 78 passing tests and only the expected
surface-tripwire failure. After the approved snapshot update, rerun those same four suites,
including upstream device approval/revocation and all fork renewal/tripwire cases. Record
results and any execution limits in the PR; this decision does not imply full CI success.
