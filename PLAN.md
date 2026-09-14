# API Mock Hub — Plan

A self-hosted NestJS service where a team keeps a shared, versioned set of mock endpoints.
Anyone can propose endpoints (add / modify / delete), attach a commit message, and let the
other side review and approve. Approved endpoints are live immediately at
`http://<vps-ip>:<port>/<path>` and documented in Swagger.

> **Status (2026-09-14):** Phases 1 and 2 are implemented and tested. See README.md for usage.
> Implementation notes that refine this plan are in sections 14 and 15.

Two directions, one flow:

| Who proposes | Why | Who approves |
|---|---|---|
| Backend | "Here is the contract for the endpoints I am building" | Frontend (or anyone but the author) |
| Frontend | "I need this data shape from the backend" | Backend |

---

## 1. Goals and non-goals

**Goals**
- Zero blocking between frontend and backend: the contract exists and is callable before the real code does.
- Every change is a *proposal* with a message, a diff, reviews, and an approval. Nothing goes live silently.
- Import endpoints in bulk (JSON) or one by one. Export the live set as OpenAPI for the real backend.
- Real HTTP responses with static data: status code, headers, JSON body, optional delay.
- Swagger UI that always reflects the live set.
- Simple to host: one Docker container, one data volume.

**Non-goals (v1)**
- Not a proxy to the real backend. Not a contract-testing tool. Not a replacement for Git for the real code.
- No SSO / OAuth. Simple username + password accounts managed by an admin.

---

## 2. Core concepts

### Endpoint
The unit of work. Unique by `(method, path)` in the live set.

```ts
Endpoint {
  id: string                    // uuid
  method: 'GET'|'POST'|'PUT'|'PATCH'|'DELETE'|'HEAD'|'OPTIONS'
  path: string                  // "/users/:id"  (express style; converted to {id} for OpenAPI)
  summary?: string
  description?: string
  tags: string[]                // groups in Swagger, e.g. "auth", "orders"
  request?: {
    params?:  Param[]           // { name, example, description }
    query?:   Param[]
    headers?: Param[]
    bodyExample?: unknown       // shown in Swagger as request example
  }
  response: {
    status: number              // 200, 201, 404 ...
    headers?: Record<string,string>
    body: unknown               // static JSON returned as-is
    delayMs?: number            // simulate latency
  }
  owner: string                 // username of last approved author
  version: number               // bumped on every approved change (optimistic locking)
  createdAt, updatedAt: string
}
```

### Proposal (the "commit" the user writes)
A set of changes plus a message. Open until approved or rejected.

```ts
Proposal {
  id: string
  title: string                 // short, like a commit subject
  message: string               // body / rationale
  kind: 'publish' | 'request'   // backend publishes contract | frontend requests data
  author: string
  status: 'open' | 'approved' | 'rejected' | 'conflict'
  changes: Change[]
  reviews: Review[]             // { reviewer, decision: 'approve'|'request-changes', comment, at }
  comments: Comment[]           // { author, text, at }
  createdAt, resolvedAt?: string
}

Change {
  type: 'add' | 'update' | 'delete'
  endpointId?: string           // for update/delete
  baseVersion?: number          // endpoint.version the change was written against
  before?: Endpoint             // snapshot for the diff
  after?: Endpoint              // desired state
}
```

### Commit (history, immutable)
Created automatically when a proposal is approved and applied.

```ts
Commit {
  id: string
  seq: number                   // 1, 2, 3 ... registry version after apply
  proposalId: string
  message: string
  author: string
  approvedBy: string[]
  changes: Change[]             // frozen copy
  at: string
}
```

### Approval rules (project settings, editable by admin)

| Setting | Default | Meaning |
|---|---|---|
| `requireApproval` | `true` | If false, proposals apply on creation (solo/tiny teams) |
| `minApprovals` | `1` | Approvals needed before apply |
| `approverMustDiffer` | `true` | Author cannot approve own proposal |
| `requiredApproverRole` | `none` | e.g. `backend` for `request` proposals, `frontend` for `publish` |

When the rule is satisfied the proposal is **applied automatically**: endpoints updated,
a Commit written, the mock router and Swagger doc refreshed in memory. No extra "merge" click.

**Conflicts.** On apply, each change's `baseVersion` is checked against the live endpoint.
If someone else's proposal changed it first, the proposal is marked `conflict`; the author
re-edits it against the new version and reviewers re-approve.

---

## 3. URL layout

Everything the hub needs lives under one reserved prefix so mock paths can use the root.

| URL | What |
|---|---|
| `/<anything>` | Mock router. Matches live endpoints, returns static response. |
| `/_hub/` | Web UI (SPA) |
| `/_hub/docs` | Swagger UI of the **mock endpoints** (regenerated on every commit) |
| `/_hub/openapi.json` | Same, as OpenAPI 3 JSON (also the export) |
| `/_hub/api/...` | Management REST API (auth, endpoints, proposals, commits, import) |
| `/_hub/api-docs` | Swagger UI of the management API itself (decorator based) |
| `/_hub/preview/<proposalId>/<path>` | Phase 3: call an endpoint as it would be *after* the proposal |

Mock paths starting with `/_hub` are rejected at validation time.

---

## 4. Management API (v1)

All under `/_hub/api`. JWT bearer auth on everything except `POST /auth/login`.

```
POST   /auth/login                      { username, password } -> { token, user }
GET    /auth/me

GET    /endpoints?tag=&method=&q=       live set
GET    /endpoints/:id
GET    /endpoints/export?format=hub|openapi

POST   /proposals                       { title, message, kind, changes[] }
GET    /proposals?status=open|approved|rejected|conflict&author=
GET    /proposals/:id                   includes computed diff per change
PATCH  /proposals/:id                   author edits changes/message while open (resets reviews)
POST   /proposals/:id/reviews           { decision, comment }  -> may auto-apply
POST   /proposals/:id/comments          { text }
POST   /proposals/:id/close             author/admin withdraws

POST   /import                          { format: 'hub'|'openapi', data, title?, message? }
                                        -> creates ONE proposal with N changes (add/update)
                                        ?direct=true (admin only) applies without review, for bootstrap

GET    /commits?limit=&before=
GET    /commits/:id

GET    /settings            PATCH /settings                  (admin)
GET    /users               POST /users   PATCH /users/:id   (admin)

GET    /events                           SSE stream: proposal.created, proposal.reviewed,
                                         commit.applied  (UI live refresh; Phase 3)
```

Roles: `admin`, `backend`, `frontend`. Roles matter only for `requiredApproverRole` and admin routes.

---

## 5. Mock router

- A NestJS middleware mounted for `*`, skipping `/_hub/*`.
- On every commit the `RegistryService` recompiles the route table with `path-to-regexp`.
  Sort: more static segments first, then params, so `/users/me` beats `/users/:id`.
- Match method + path → optional `delayMs` → set headers → send `status` + `body`.
- `OPTIONS` handled by CORS (allow all origins, all headers) so browsers can call it from any dev host.
- No match → `404 { "error": "No mock for GET /x", "hint": "http://host/_hub/?new=GET%20/x" }`.
- JSON body limit raised to 5 MB for large fixtures.

---

## 6. Swagger / OpenAPI

Two documents:

1. **Management API** — normal `@nestjs/swagger` decorators on the hub's own controllers. Static.
2. **Mock endpoints** — generated by `OpenApiGeneratorService` from the live registry:
   paths (`:id` → `{id}`), parameters, request body example, response status, headers,
   response example = the static body. Served by `swagger-ui-express` with `url: '/_hub/openapi.json'`
   so a page reload always shows the latest commit.

Import direction: an existing backend Swagger JSON is parsed into endpoints; the response
`example` (or first `examples`, or a schema-derived stub) becomes the static body.

---

## 7. Storage

**JSON files on disk** behind a repository interface. Simple, human readable, trivially
backed up, mountable as a Docker volume.

```
data/
  endpoints.json     live set
  proposals.json
  commits.json
  users.json
  settings.json
```

- Loaded into memory at boot; every write goes through a single async mutex and
  `write-file-atomic` (temp file + rename) so a crash never leaves a half-written file.
- Repository interface (`get/list/save`) keeps a later swap to SQLite/Postgres a local change.
- Fine for thousands of endpoints; this is a team tool, not a public service.

---

## 8. Auth & security

- Username + bcrypt password, JWT (12h). First admin comes from env `ADMIN_USER` / `ADMIN_PASSWORD`.
- Management API and UI require login. **Mock routes are open** on purpose (frontend apps and
  mobile builds call them without tokens). Optional `MOCK_API_KEY` env: when set, mock routes
  require header `x-mock-key`.
- Intended for an internal VPS. Put Nginx/Caddy with TLS in front if exposed to the internet.

---

## 9. Web UI (Phase 2)

React + Vite + TypeScript, built to static files served by Nest at `/_hub/`.

Pages:
- **Login**
- **Endpoints** — table (method, path, tags, owner, version), filter, "Try" link to Swagger,
  "Edit" → opens the editor as a new change in a draft proposal.
- **Endpoint editor** — method, path, tags, summary, request params, status, headers,
  JSON body editor with validation (CodeMirror), delay.
- **New proposal** — cart of pending changes, title/message, kind, submit. Also "Import JSON"
  which fills the cart.
- **Proposals** — list by status; detail with per-change diff (side-by-side JSON diff),
  comments, Approve / Request changes buttons, conflict banner.
- **History** — commits list, each expandable to its changes.
- **Admin** — users, settings.

---

## 10. Phases

**Phase 1 — Engine (server only, fully usable through `/_hub/api-docs`)**
1. Nest project, config, JSON store with atomic writes, seed admin.
2. Auth module (login, JWT guard, roles).
3. Endpoints module + RegistryService (validation, uniqueness, compile routes).
4. Mock router middleware + CORS + 404 hint.
5. Proposals module: create, review, auto-apply, conflict detection, commits.
6. OpenAPI generator + `/_hub/docs`; import (hub JSON, OpenAPI 3).
7. Tests: route matching, apply/conflict rules, e2e propose→approve→call.
8. Dockerfile, docker-compose (volume `./data`), `.env.example`, README.

**Phase 2 — Web UI** (pages above), served from the same container.

**Phase 3 — Nice to have**
- Proposal preview routes `/_hub/preview/:proposalId/*`
- SSE live refresh in the UI
- Multiple response scenarios per endpoint chosen by header `x-mock-scenario`
- Simple templating in bodies (`{{params.id}}`, `{{query.page}}`)
- Request log (last 50 calls per endpoint) for debugging
- Revert a commit (creates an inverse proposal)
- Postman collection import; Slack/webhook notification on new proposal

---

## 11. Project layout

```
api-mock-hub/
  src/
    main.ts
    app.module.ts
    config/            env schema
    common/            guards, decorators, filters, mutex, atomic file
    storage/           JsonStore + repositories
    auth/              login, jwt strategy, roles guard
    users/
    settings/
    endpoints/         dto, validation, registry.service, controller
    proposals/         service (apply, conflict, diff), controller
    commits/
    mock/              mock-router.middleware, matcher
    openapi/           generator.service, docs.controller
    import/            parsers/hub-json.ts, parsers/openapi.ts
    events/            sse (phase 3)
  client/              React + Vite (phase 2)
  data/                runtime data (gitignored) + seed.example.json
  test/                e2e
  Dockerfile  docker-compose.yml  .env.example  README.md
```

Stack: NestJS 11, TypeScript, `path-to-regexp`, `class-validator`, `@nestjs/swagger`,
`swagger-ui-express`, `jsonwebtoken`, `bcryptjs`, `write-file-atomic`, `jest` + `supertest`.

---

## 12. Example: hub JSON import format

```json
{
  "endpoints": [
    {
      "method": "GET",
      "path": "/users/:id",
      "tags": ["users"],
      "summary": "Get one user",
      "response": { "status": 200, "body": { "id": 1, "name": "Sara", "role": "admin" } }
    },
    {
      "method": "POST",
      "path": "/auth/login",
      "tags": ["auth"],
      "request": { "bodyExample": { "email": "a@b.c", "password": "x" } },
      "response": { "status": 201, "body": { "token": "jwt..." }, "delayMs": 300 }
    }
  ]
}
```

---

## 13. Plan review — decisions, risks, alternatives considered

| Topic | Decision | Why / risk |
|---|---|---|
| Mock paths at root vs `/mock/*` prefix | Root, hub reserved under `/_hub` | Matches the ask (`ip:port/<path>`); frontends can point their base URL at the hub with no rewriting. Risk is only a real API using `/_hub`, negligible. |
| Real Git under the hood vs own commit model | Own model (Proposal → Commit) in JSON | Real Git gives branches/merges for free but brings merge conflicts, a git binary in the container, and a much harder UI. Own model is a few hundred lines and fits the exact workflow. |
| Auto-apply on approval vs explicit merge | Auto-apply | One click fewer. If a team wants a manual gate, `minApprovals` + a later "merge" button is a small addition. |
| Storage: JSON files vs SQLite vs Postgres | JSON files | Simplest to run and back up; readable; single process so a mutex is enough. Repository interface keeps the door open. |
| Optimistic locking with `version` | Yes | Two people editing the same endpoint is the realistic failure mode; without it the second approval silently overwrites the first. |
| UI as SPA vs server rendered | React SPA, Phase 2 | Diff view, JSON editor and review threads are much easier in a SPA. Phase 1 stays usable through the management Swagger, so the engine ships early. |
| Mock routes without auth | Open by default, optional API key | Frontend/mobile builds must call them freely. Internal VPS assumption; document TLS/reverse proxy. |
| Import creates a proposal, not live data | Yes (admin `direct=true` for bootstrap) | Keeps the "nothing goes live unreviewed" rule even for bulk imports. |
| Dynamic Swagger with `@nestjs/swagger` | Generate document ourselves, serve with swagger-ui-express | Nest's decorator doc is built once at boot; it cannot reflect runtime endpoints. Generating a plain OpenAPI object is straightforward. |

**Assumptions to confirm**
1. Team size is small (< 30 users); simple username/password accounts are enough.
2. Responses are static JSON (no dynamic templating) in v1.
3. Single instance deployment (no horizontal scaling), so in-memory registry + JSON files are fine.
4. Hosting on a Linux VPS via Docker Compose.

---

## 14. Implementation notes (Phase 1)

What changed or got more precise while building:

- **Ids.** Proposals and commits use sequential numbers (`#12`), which are easier to type in Swagger and chat. Endpoints keep UUIDs.
- **Statuses.** `open`, `conflict`, `approved`, `rejected` (by a reviewer), `closed` (withdrawn by the author).
- **Extra proposal actions.** `POST /proposals/:id/reject`, `/close`, and `/rebase`. Rebase resolves a conflict by basing the author's desired content on the latest live versions. Reviews are cleared so the new diff gets looked at.
- **Early conflict flagging.** When a proposal is applied, other open proposals that no longer apply are marked `conflict` immediately.
- **Request changes blocks.** Any outstanding `request-changes` review blocks applying until that reviewer approves.
- **Update targets.** Changes can target an endpoint by `endpointId` or by `ref` such as `"GET /users/:id"`. An update replaces the whole endpoint.
- **Methods.** `GET POST PUT PATCH DELETE HEAD`. `OPTIONS` is left to CORS, since browser preflights would never reach an OPTIONS mock. `HEAD` falls back to the `GET` mock.
- **Paths.** Only `:param` and `*wildcard`. Routes that differ only by parameter name or letter case count as the same route.
- **Validation.** One function validates endpoints for both API calls and imports. Swagger DTO classes are documentation only.
- **Storage.** `StoreService.write()` serialises writes, rolls back memory on error, and saves atomically. There is no separate repository per collection.
- **Import.** Accepts hub JSON, an array, one endpoint, OpenAPI 3 or Swagger 2. Identical routes are skipped. The OpenAPI server path is prefixed by default and can be overridden with `basePath`.
- **Docker.** Uses a named volume instead of a bind mount, so the non-root container user can always write.

---

## 15. Implementation notes (Phase 2, web UI)

- **Stack.** React 19, Vite, TypeScript, CodeMirror for JSON, and the `diff` package for line diffs. No router or state library.
- **Routing.** Hash routes such as `/_hub/#/proposals/12`. The server needs no SPA fallback, and links can be shared in chat.
- **Serving.** Nest serves `client/dist` as static assets under `/_hub/`, and `GET /_hub` returns its `index.html`. Without a build, a small landing page is shown.
- **Draft.** Pending changes live in the browser's localStorage, one draft per user. A draft can also edit an existing proposal, which replaces its changes and clears reviews.
- **Staleness.** The draft compares each update with the live endpoint and offers to re-base on the newer version before submitting.
- **Try it.** Calls the mock from the browser on the same origin. The mock API key, if used, is kept in localStorage.
- **Plain HTTP.** No browser API that needs HTTPS is used, such as `crypto.randomUUID` or the clipboard, because the hub often runs on `http://ip:port`.
- **Server additions.** `endpointId` filters on proposals and commits, `endpointIds` on proposal summaries, and a `create` link in mock 404 responses.
