# Connect Gateway Webhooks

The Connect Gateway emits signed HTTP POST notifications when lifecycle events occur for an API key. Merchants register HTTPS endpoints and subscribe to event types; the gateway delivers JSON payloads with retries and a dead-letter queue for exhausted failures.

All webhook management is admin-only. Include the same bearer token used for `/admin/keys`:

```http
Authorization: Bearer $GATEWAY_ADMIN_TOKEN
```

## Events

| Event type | Description |
| --- | --- |
| `escrow.created` | An escrow was created for a trade. |
| `trade.completed` | A trade reached a completed state. |
| `dispute.opened` | A dispute was opened on a trade. |
| `payment.reported` | A payment was reported for a trade. |
| `subscription.created` | A recurring subscription was created. |
| `subscription.charged` | A subscription billing cycle succeeded and created an escrow. |
| `subscription.failed` | A subscription charge exhausted its retry budget and stopped. |
| `subscription.canceled` | A subscription was canceled; future charges stop. |

`endpoint.verification` is a reserved system event used only during URL verification. It is not subscribable and will never appear in `enabledEvents`.

See [Subscription events](#subscription-events) for the recurring-payment lifecycle and payloads.

## Registering an endpoint

Base path: `/admin/webhooks`. All routes require the admin bearer token.

### `POST /admin/webhooks`

Register a new endpoint for an API key.

**Body**

```json
{
  "apiKeyId": "key_…",
  "url": "https://example.com/webhooks/pacto",
  "enabledEvents": ["escrow.created", "trade.completed"],
  "description": "Production webhook"
}
```

| Field | Required | Notes |
| --- | --- | --- |
| `apiKeyId` | yes | API key that owns this endpoint. |
| `url` | yes | Must be a valid `http:` or `https:` URL. |
| `enabledEvents` | yes | Non-empty array; each value must be one of the event types above. |
| `description` | no | Optional label for operators. |

**Response `201`**

```json
{ "endpoint": { "id": "…", "secret": "whsec_…", "verified": false, "status": "enabled", … } }
```

The `secret` (prefix `whsec_`) is returned **once** at creation. Store it immediately; list and fetch routes never include it.

### `GET /admin/webhooks?apiKeyId=`

List endpoints. Optional `apiKeyId` filters to one API key.

**Response `200`**

```json
{ "endpoints": [ … ] }
```

Each endpoint object includes `id`, `apiKeyId`, `url`, `enabledEvents`, `status`, `verified`, `description`, `createdAt`, and `updatedAt` — never `secret`.

### `GET /admin/webhooks/:id`

Fetch one endpoint by ID.

**Response `200`** — `{ "endpoint": { … } }`  
**Response `404`** — `{ "error": "endpoint not found" }`

### `POST /admin/webhooks/:id/verify`

Trigger URL verification (see [Verification](#verification)).

**Response `200`** — `{ "result": { "verified": true, "status": 200 } }` or `{ "result": { "verified": false, "status": …, "error": "…" } }`  
**Response `404`** — endpoint not found.

### `POST /admin/webhooks/:id/enable`

Set endpoint `status` to `enabled`.

**Response `200`** — `{ "endpoint": { … } }`

### `POST /admin/webhooks/:id/disable`

Set endpoint `status` to `disabled`. Disabled endpoints do not receive deliveries.

**Response `200`** — `{ "endpoint": { … } }`

### `DELETE /admin/webhooks/:id`

Remove an endpoint.

**Response `204`** — no body  
**Response `404`** — endpoint not found.

### `GET /admin/webhooks/deliveries?status=&endpointId=&eventId=&limit=`

Inspect delivery records. Query parameters are all optional:

| Param | Values |
| --- | --- |
| `status` | `pending`, `succeeded`, `failed`, `dead` |
| `endpointId` | Filter by endpoint. |
| `eventId` | Filter by event. |
| `limit` | Positive integer (default **100**). |

**Response `200`** — `{ "deliveries": [ … ] }`

### `GET /admin/webhooks/dlq?limit=`

List deliveries in `dead` status (dead-letter queue). Optional `limit` (default **100**).

**Response `200`** — `{ "deliveries": [ … ] }`

### `POST /admin/webhooks/deliveries/:id/retry`

Re-queue a dead-letter delivery for another delivery attempt.

**Response `200`** — `{ "delivery": { … } }` (status reset to `pending`)  
**Response `404`** — delivery not found.

## Verification

An endpoint must be **verified** before it receives real events. New endpoints start with `verified: false`.

Call `POST /admin/webhooks/:id/verify`. The gateway sends a signed POST to the endpoint URL with this payload:

```json
{
  "id": "evt_verify_…",
  "type": "endpoint.verification",
  "created": 1710000000,
  "data": { "challenge": "<random hex token>" }
}
```

The endpoint must:

1. Respond with an HTTP **2xx** status.
2. Return a JSON body that echoes the challenge: `{ "challenge": "<same value>" }`.

On success the endpoint is marked `verified: true`. On failure the response includes `{ "verified": false, "error": "…" }` and `verified` stays `false`.

`dispatchEvent` only creates deliveries for endpoints that are **enabled**, **verified**, and subscribed to the event type (`enabledEvents` contains the type).

## Signing & verifying deliveries

Every delivery is a `POST` with `Content-Type: application/json` and a `Pacto-Signature` header:

```http
Pacto-Signature: t=<unixSeconds>,v1=<hexHmac>
```

The signed payload is the string `${t}.${rawRequestBody}` (timestamp, dot, raw body bytes). The HMAC is **SHA-256** using the endpoint's `whsec_` secret; `v1` is the lowercase hex digest.

Receivers should:

1. Parse `t` and `v1` from the header.
2. Reject timestamps outside a tolerance window (default **300 seconds**) to prevent replay.
3. Recompute the HMAC over `${t}.${rawBody}` and compare with `v1` using a timing-safe equality check.

Real event bodies look like:

```json
{
  "id": "evt_…",
  "type": "escrow.created",
  "created": 1710000000,
  "data": { … }
}
```

**Node.js verification example**

```javascript
import { createHmac, timingSafeEqual } from 'node:crypto';

function verifyWebhook(rawBody, signatureHeader, secret, toleranceSec = 300) {
  const parts = Object.fromEntries(
    signatureHeader.split(',').map((p) => p.trim().split('=')),
  );
  const t = Number(parts.t);
  const v1 = parts.v1;
  if (Math.abs(Math.floor(Date.now() / 1000) - t) > toleranceSec) return false;

  const expected = createHmac('sha256', secret)
    .update(`${t}.${rawBody}`)
    .digest('hex');
  const a = Buffer.from(v1, 'utf8');
  const b = Buffer.from(expected, 'utf8');
  return a.length === b.length && timingSafeEqual(a, b);
}
```

## Retries & dead-letter queue

Deliveries start in `pending` status. A background runner polls for due deliveries on a fixed interval and attempts HTTP delivery (10 s timeout per attempt).

A delivery **fails** on network error, timeout, or any non-2xx response. Failed deliveries are retried with exponential backoff:

```
delay = min(WEBHOOK_BACKOFF_BASE_MS × 2^(attempt − 1), WEBHOOK_BACKOFF_CAP_MS)
```

After `WEBHOOK_MAX_ATTEMPTS` (default **5**) failed attempts the delivery moves to **`dead`** status and appears in the DLQ (`GET /admin/webhooks/dlq`). Operators can replay it with `POST /admin/webhooks/deliveries/:id/retry`, which resets it to `pending` and schedules an immediate attempt with a fresh attempt budget.

## Subscription events

Recurring subscriptions (`/v1/subscriptions`) drive a billing loop that reuses the escrow
and quote engines. A background runner polls for subscriptions whose `nextChargeAt` is due
and charges them without manual intervention; each event is delivered through the same
signed-webhook pipeline as everything above. Subscriptions are **test mode only** — a
live-mode key receives `501 not_implemented`.

| Event type | When | Payload `data` |
| --- | --- | --- |
| `subscription.created` | A subscription is created via `POST /v1/subscriptions`. | `subscriptionId`, `from`, `to`, `amount`, `interval` |
| `subscription.charged` | A billing cycle succeeds: an escrow is created and the FX is re-priced via the quote engine. | `subscriptionId`, `escrowId`, `amount`, `asset`, `quoteId` |
| `subscription.failed` | A charge has failed `SUBSCRIPTION_MAX_ATTEMPTS` times. The subscription moves to `past_due` and **stops charging** (no indefinite retry). | `subscriptionId`, `reason`, `attempts` |
| `subscription.canceled` | The subscription is canceled via `POST /v1/subscriptions/:id/cancel`. Future charges stop. | `subscriptionId` |

**Charge lifecycle.** On each cycle the runner re-prices the plan with the quote engine and
creates an escrow, then emits `subscription.charged`. A failed charge is retried with
exponential backoff up to `SUBSCRIPTION_MAX_ATTEMPTS` total attempts; once exhausted the
subscription becomes `past_due`, emits `subscription.failed` exactly once, and is no longer
picked up by the runner. Canceling a subscription is terminal and emits
`subscription.canceled`.

**Test controls.** In test mode, `POST /v1/test/subscriptions/:id/advance` runs one charge
synchronously (deterministic, no waiting for the poll interval), and
`POST /v1/test/subscriptions/:id/fail-next` forces the next charge to fail with
`insufficient_funds` — useful for exercising the `subscription.failed` path.

## Configuration

| Variable | Default | Description |
| --- | --- | --- |
| `GATEWAY_ADMIN_TOKEN` | — | **Required** for all `/admin/*` routes, including webhooks. |
| `WEBHOOK_MAX_ATTEMPTS` | `5` | Maximum delivery attempts before dead-lettering. |
| `WEBHOOK_BACKOFF_BASE_MS` | `5000` | Base delay (ms) for exponential backoff. |
| `WEBHOOK_BACKOFF_CAP_MS` | `3600000` | Maximum backoff delay (ms); default 1 hour. |
| `WEBHOOK_POLL_INTERVAL_MS` | `5000` | How often the background runner polls for due deliveries. |
| `SUBSCRIPTION_MAX_ATTEMPTS` | `3` | Charge attempts before a subscription moves to `past_due` and emits `subscription.failed`. |
| `SUBSCRIPTION_POLL_INTERVAL_MS` | `5000` | How often the subscription runner polls for due charges. |
| `TESTMODE_SUB_INTERVAL_MS` | `3000` | Accelerated interval (ms) between charge cycles in test mode. |

Invalid or non-positive values for the numeric webhook and subscription variables fall back to their defaults.

## Rate limiting

Every public `/v1/*` route (`/v1/session`, `/v1/escrows`, `/v1/quote`, `/v1/test`) is protected by an in-memory sliding-window rate limiter, keyed per publishable API key. `/health`, `/admin/*`, and the inbound webhook receiver below are not rate limited by this layer.

When a key exceeds its limit, the gateway responds:

**Response `429`**

```http
Retry-After: 42
```

```json
{ "error": { "type": "rate_limit_error", "code": "too_many_requests", "message": "rate limit exceeded" } }
```

`Retry-After` is in seconds and indicates how long until the oldest request in the current window ages out.

**Configuration**

| Variable | Default | Description |
| --- | --- | --- |
| `RATE_LIMIT_WINDOW_MS` | `60000` | Sliding window size, in milliseconds. |
| `RATE_LIMIT_MAX` | `60` | Maximum requests per key within the window. |

Invalid or non-positive values fall back to their defaults. The limiter state is in-memory per gateway process; it does not persist across restarts or synchronize across multiple instances.

## Inbound webhooks (Pacto → gateway)

The gateway also **receives** webhooks from the upstream Pacto P2P API at:

### `POST /v1/webhooks/inbound`

This endpoint is unauthenticated by API key — instead, every request must carry a signed `Pacto-Signature` header:

```http
Pacto-Signature: t=<unixSeconds>,n=<nonce>,v1=<hexHmac>
```

The signed payload is the string `${t}.${n}.${rawRequestBody}` (timestamp, dot, nonce, dot, raw body bytes), HMAC-SHA256'd with `PACTO_WEBHOOK_SECRET` and compared to `v1` using a timing-safe equality check — the same shape as outbound delivery signing above, with a nonce added for inbound replay protection.

Verification rejects a request when:

1. The timestamp `t` falls outside the tolerance window (`WEBHOOK_REPLAY_TOLERANCE_SECONDS`, default **300** seconds) of the current time.
2. The recomputed HMAC does not match `v1`.
3. The nonce `n` has already been used (replay).

**Response `400`** — malformed/missing signature, bad or stale signature, missing nonce, or an invalid JSON payload:

```json
{ "error": { "type": "webhook_error", "code": "signature_invalid", "message": "signature invalid or replay outside tolerance" } }
```

(Bad HMAC and an out-of-tolerance timestamp intentionally return the same generic `signature_invalid` error, so a caller can't distinguish which check failed.)

**Response `409`** — the nonce was already consumed by a prior request:

```json
{ "error": { "type": "webhook_error", "code": "replay_detected", "message": "nonce already used" } }
```

**Response `500`** — `PACTO_WEBHOOK_SECRET` is not configured, or event dispatch failed after a valid signature.

**Response `200`** — accepted: `{ "received": true, "eventId": "…", "deduped": <boolean> }`. `deduped: true` means an event with the same source event id was already processed and no new side effects were applied.

**Configuration**

| Variable | Default | Description |
| --- | --- | --- |
| `PACTO_WEBHOOK_SECRET` | — | **Required.** Shared secret used to verify signatures on inbound requests from Pacto. |
| `WEBHOOK_REPLAY_TOLERANCE_SECONDS` | `300` | Timestamp tolerance window for inbound signatures, in seconds. |

## Idempotent requests

`POST /v1/session` and `POST /v1/escrows` accept an optional `Idempotency-Key` header so retried requests (network errors, client timeouts, at-least-once retries) don't create duplicate sessions or escrows.

Send the same `Idempotency-Key` on a retry of the same logical request:

- **First request** with a given key: processed normally and its response is stored against `(apiKeyId, key)`.
- **Retry with the same key and the same request body**: the stored response is returned verbatim (same status code and body) without re-running the handler, and the response carries:

  ```http
  Idempotent-Replayed: true
  ```

- **Same key with a different request body**: rejected — the key must not be reused for a different request.

  **Response `409`**

  ```json
  { "error": { "type": "idempotency_error", "code": "idempotency_key_reuse", "message": "Idempotency-Key was reused with a different request body" } }
  ```

- **Same key while the original request is still being processed** (a concurrent duplicate):

  **Response `409`**

  ```json
  { "error": { "type": "idempotency_error", "code": "request_in_progress", "message": "A request with this Idempotency-Key is already in progress" } }
  ```

If no `Idempotency-Key` header is sent, the request is processed normally with no dedup behavior.
