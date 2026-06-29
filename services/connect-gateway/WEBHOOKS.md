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

`endpoint.verification` is a reserved system event used only during URL verification. It is not subscribable and will never appear in `enabledEvents`.

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
| `enabledEvents` | yes | Non-empty array; each value must be one of the four event types above. |
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

## Configuration

| Variable | Default | Description |
| --- | --- | --- |
| `GATEWAY_ADMIN_TOKEN` | — | **Required** for all `/admin/*` routes, including webhooks. |
| `WEBHOOK_MAX_ATTEMPTS` | `5` | Maximum delivery attempts before dead-lettering. |
| `WEBHOOK_BACKOFF_BASE_MS` | `5000` | Base delay (ms) for exponential backoff. |
| `WEBHOOK_BACKOFF_CAP_MS` | `3600000` | Maximum backoff delay (ms); default 1 hour. |
| `WEBHOOK_POLL_INTERVAL_MS` | `5000` | How often the background runner polls for due deliveries. |

Invalid or non-positive values for the numeric webhook variables fall back to their defaults.
