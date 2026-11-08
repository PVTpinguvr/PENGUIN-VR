# PENGUIN VR account API (Stage 6.1)

Small Node.js API for account bootstrap, unique usernames, preferences, daily Penguin Bucks, friends, recent players, cosmetics ownership/purchases/equipping, global leaderboard data, player reports, owner moderation, and persistent timed/permanent bans. It uses Node's built-in SQLite module and has no npm runtime dependencies.

## Requirements

- Node.js 22.13 or later (the built-in `node:sqlite` module is still marked experimental by Node and may print a warning).
- A persistent writable volume for `penguin-vr.sqlite`.
- HTTPS in production.
- A configured identity token issuer and its public JWKS endpoint.

## Configure and run

1. Copy `.env.example` to `.env` or set environment variables in your host. Node does not load `.env` automatically; set the variables in your deployment environment.
2. Set `AUTH_JWKS_URL` to the identity provider's JWKS endpoint. For Unity Authentication the documented JWKS endpoint is `https://player-auth.services.api.unity.com/.well-known/jwks.json`.
3. Set `AUTH_ISSUER` and `AUTH_AUDIENCE` to the exact `iss` and `aud` values in a real, unexpired signed player token from the configured Unity project/environment. Do not guess these values or accept unsigned client claims. The API requires RS256, validates the signature against JWKS, issuer, audience, subject, expiry and not-before time, and rejects requests if configuration is incomplete.
4. Do **not** set an owner ID. On a fresh database, ownership remains unclaimed until a dedicated game server confirms the first successful NGO connection after redeeming that player's valid admission ticket. A one-time Stage 4.4 migration fallback is applied only if the database had an `accounts` table but did not yet have a `game_owner` table.
5. Run `node server.mjs`.
6. Run the tests with `node --test` (22 tests currently pass, including the first-confirmed-NGO-join owner ordering regression test).

The API deliberately returns HTTP 503 on every authenticated endpoint until the verifier is configured. `/health` remains available and reports `authConfigured: false` while locked. Do not disable this fail-closed behaviour.

## Endpoints

- `GET /health` — liveness and authentication-configuration status.
- `POST /v1/server/admit` (server-key-only) with `{ "ticket": "<opaque ticket>", "serverId": "eu-west-01" }` — validates server shared key and atomically redeems a ticket once. It re-checks the ban and returns verified identity/appearance data, but does not claim ownership.
- `POST /v1/server/confirm-join` (server-key-only) with `{ "ticketHash": "<sha256-of-ticket>", "serverId": "eu-west-01" }` — confirms a previously redeemed ticket after NGO reports the client connected; re-checks ban state, records the join and claims the first owner atomically. Repeated confirmation is idempotent.
- `POST /v1/server/validate` (server-key-only) with `{ "accountIds": ["..."] }` — returns currently banned account IDs for the trusted game server to disconnect.
- `POST /v1/game/join` — disabled; returns HTTP 410 `dedicated_server_required`. A player client cannot claim ownership by reporting a join.
- `GET /v1/profile/me` — current authenticated profile (404 before bootstrap).
- `POST /v1/profile/bootstrap` — idempotently allocates `penguin0001`, `penguin0002`, etc. from a SQLite sequence, keyed by verified JWT subject. Profile creation alone does not claim game ownership.
- `POST /v1/server/tickets` (player-authenticated) with `{ "serverId": "eu-west-01" }` — issues an opaque random 256-bit ticket bound to that server ID, expires in 60 seconds, stores only the SHA-256 hash and does not claim ownership.
- `PATCH /v1/profile/username` — changes to a unique 3–16 character username.
- `GET /v1/preferences` and `PUT /v1/preferences` — persistent mutes, voice flags/volumes, handedness and graphics preference.
- `POST /v1/rewards/daily/claim` — grants 100 Penguin Bucks no more than once per 86,400 server seconds.
- `GET /v1/leaderboard` — public leaderboard fields, without account IDs.
- `POST /v1/reports` — records reporter/target account IDs, allowed reason, timestamp, server and mode. A distinct-account threshold of 10 reports in 60 minutes creates an urgent-review record. This never creates an automatic ban.
- `GET /v1/access` — returns the authenticated account's access state and active ban details. This is the only authenticated account endpoint a banned user may access, so the client can render the ban notice and appeal instructions.
- `GET /v1/owner/moderation/reports` — owner-only report history and urgent-review flags, including account IDs, usernames, dates, server IDs and game modes.
- `GET /v1/owner/moderation/bans` — owner-only ban history, including active, expired and revoked records.
- `GET /v1/owner/moderation/summary` — owner-only recent report/ban summary and urgent review list.
- `GET /v1/owner/moderation/players/:accountId` — owner-only player profile, report history and ban history.
- `POST /v1/owner/moderation/bans` — owner-only ban creation. Supported durations: `10m`, `1h`, `24h`, `7d`, `30d`, `permanent`, or `custom` with `customSeconds` from 60 to 31,536,000. Reasons are selected from the report reason list and optional details are retained.
- `POST /v1/owner/moderation/bans/:banId/revoke` — owner-only revocation with an audit note.
- `GET /v1/cosmetics` — returns the server-owned catalogue (the starter Classic Cap costs 100 Penguin Bucks), authenticated account ownership/equipped flags and current Penguin Bucks balance. The API grants the OWNER PENGUIN companion only when the authenticated token subject matches the permanent `game_owner` database row.
- `POST /v1/cosmetics/purchase` with `{ "cosmeticId": "classic-cap" }` — validates the catalogue item, rejects owner-only items, checks balance, deducts currency and records ownership in a single SQLite transaction. Duplicate purchases do not deduct again.
- `POST /v1/cosmetics/equip` with `{ "cosmeticId": "classic-cap" }` — equips an owned item into its predefined slot. Owner companion equip is restricted to the first-join owner recorded in the database.
- `DELETE /v1/cosmetics/equip/:slot` — clears the authenticated account’s equipped item for that slot.
- `GET /v1/social/friends` — friends for the authenticated account only.
- `GET /v1/social/friend-requests` — incoming and outgoing pending requests for the authenticated account.
- `POST /v1/social/friend-requests` with `{ "targetAccountId": "..." }` — send a request to an existing account. Self-requests, already-friends requests and duplicate pending requests are rejected.
- `POST /v1/social/friend-requests/:requestId/accept` or `/decline` — only the intended recipient can respond. Accepting creates one canonical friendship row.
- `DELETE /v1/social/friends/:targetAccountId` — remove a friendship belonging to the authenticated account.
- `GET /v1/social/recent-players` — the authenticated account's own recent-player list.
- `POST /v1/social/recent-players` with `{ "targetAccountId": "...", "serverId": "..." }` — record an encounter for the authenticated viewer. Repeat encounters update `lastSeenAt` and increment `encounterCount`.

Every authenticated request uses a Bearer token. The API takes `accountId` only from the verified token's `sub` claim; clients cannot choose the account being read or updated.

## Current security limits

Cosmetic prices and ownership are validated by the backend; Unity clients do not submit prices or balances. The owner identity is persisted in a single-row `game_owner` table and comes from the verified identity attached to a one-time ticket. The new dedicated-server path has the game server redeem that ticket over HTTPS with `GAME_SERVER_SHARED_SECRET`; after NGO confirms the client connected, the server calls `/v1/server/confirm-join`. Ticket redemption alone does not claim ownership. SQLite `BEGIN IMMEDIATE` serializes competing owner claims. Tickets are random 256-bit values, bound to a server ID, expire after 60 seconds and are stored as SHA-256 hashes. Redemption is one-use and checks current ban state again; the subsequent join confirmation rechecks ban state and is idempotent. `GAME_SERVER_SHARED_SECRET` must be at least 32 characters and must never be placed in a Quest build.

The dedicated server now sets `PenguinNetworkAccountIdentity`, owner entitlement and equipped-cosmetic NetworkVariables; those variables are server-write-only in NGO. Hand pose values are also submitted through ownership-required ServerRpc and receive basic reach/speed validation. This does not yet make the player root, collision/locomotion, game modes, rewards or all live economy actions fully authoritative. The server-only validation endpoint supports periodic ban checks and disconnects on the server. The old client-report `/v1/game/join` route returns 410.

A Stage 4.4 database migration can only approximate historical ownership by choosing the earliest registered account (`created_at`, then SQLite insertion order), because that release did not store join history. The migration runs only when the database had an `accounts` table but no `game_owner` table before the schema upgrade. Fresh databases and Stage 4.5+ databases with an unclaimed owner row stay unclaimed through profile creation, ticket issue and ticket redemption until the dedicated server confirms a successful NGO connection. The owner row persists across reinstall/backend restart if the same database and linked authenticated account are retained. Link the owner account to a durable sign-in provider; a lost anonymous Unity Authentication identity cannot recover its old account.

Ban enforcement is performed at the API boundary: once a ban is active, every authenticated account, cosmetic, social, report, reward and matchmaking-registration endpoint returns HTTP 403 with the ban details. Only `GET /v1/access` remains available. Expired bans are automatically considered inactive using server time; they remain in the audit history as `expired`. The game client checks access before Relay operations and polls during a session; on a positive ban result it cooperatively leaves the Relay session. A client-hosted Relay room cannot be remotely forced to disconnect by this API. Immediate disconnection and prevention of a modified client continuing to use a live relay require dedicated authoritative server/session enforcement. This API never intentionally crashes or corrupts another player's client.

This is a useful development service, not yet a full live-game authority. Friend requests and recent-player records are account-scoped, but recent encounters can only be considered trustworthy after the game records them from verified peer identities; the current client-hosted Relay architecture does not provide that guarantee. The API has process-local rate limiting and does not yet implement a full financial purchase ledger or server/player presence. It does not itself authenticate NGO peer connections. The Stage 6 dedicated game server now verifies one-time tickets and populates `PenguinNetworkAccountIdentity` from server-side account data; never fill that component from a client-supplied username or account ID. The client-hosted Relay path still lacks that authority and must not be treated as production-secure. For a multi-instance production deployment, move rate limits and report notifications to shared infrastructure and put the SQLite database on a supported persistent volume or migrate to a managed database.


## Dedicated Linux server process

`PenguinDedicatedServerRuntime` starts automatically in a Unity batch-mode player. On the server process, inject these values through your hosting provider's secret/config store:

```text
PENGUIN_BACKEND_URL=https://your-backend.example
PENGUIN_SERVER_SHARED_SECRET=<same secret configured as GAME_SERVER_SHARED_SECRET>
PENGUIN_SERVER_ID=eu-west-01
PENGUIN_SERVER_BIND=0.0.0.0
PENGUIN_SERVER_PORT=7777
PENGUIN_SERVER_CERTIFICATE_PATH=/run/secrets/penguin-server.crt
PENGUIN_SERVER_PRIVATE_KEY_PATH=/run/secrets/penguin-server.key
```

The server secret must be at least 32 characters and the server private key must never be put in the client build, committed to source control or printed in logs. The server runtime enables UTP DTLS using the certificate/key files. The client must configure the certificate common name and trusted root CA so the DTLS server is authenticated. `PENGUIN_SERVER_ID` must match the ID used by the player when requesting the ticket. The project contains an Editor menu item `PENGUIN VR > Build Linux Dedicated Server`, which builds enabled Build Profile scenes with the Unity 6 Linux server subtarget. The repository currently has no authored scenes or serialized player prefab, so create those in Unity first. Configure NetworkManager's player prefab with a `NetworkObject`, `NetworkTransform`, `PenguinNetworkAccountIdentity` and `PenguinNetworkPose`, and add `PenguinDedicatedServerRuntime` to the server scene with its NetworkManager/UnityTransport references assigned.

This backend and Unity source have not yet been deployed together. Before production, compile the server in Unity, run a real client-ticket/server-admission test, test banned-player disconnect and integrate server allocation into public/private/Quick Play UI.
