# Connect Gateway Multi-merchant (sub-accounts)

A single platform `pk_`/`sk_` pair can host many **sub-merchants**. Each sub-merchant has isolated escrow settlement and isolated webhook delivery, so a platform never mixes one sub-merchant's funds or events with another's. Sub-merchants have no keys of their own — they are created and managed by the platform key that owns them.

Sub-merchant management is admin-only. Include the same bearer token used for `/admin/keys`:

```http
Authorization: Bearer $GATEWAY_ADMIN_TOKEN
```

`merchantId` is optional everywhere it appears. A platform that never creates a sub-merchant behaves exactly as before — sessions, escrows, and webhooks with no `merchantId` are **platform-level**.

## Managing sub-merchants

Base path: `/admin/keys/:keyId/merchants` and `/admin/merchants/:id`. All routes require the admin bearer token. `:keyId` is the platform `ApiKey` id.

### `POST /admin/keys/:keyId/merchants`

Create a sub-merchant under a platform key.

**Body**

```json
{ "name": "Acme Storefront" }
```

| Field | Required | Notes |
| --- | --- | --- |
| `name` | yes | Non-empty string label for the sub-merchant. |

**Response `201`**

```json
{ "merchant": { "id": "mrc_…", "apiKeyId": "key_…", "name": "Acme Storefront", "status": "active", "createdAt": "…", "updatedAt": "…" } }
```

**Response `404`** — `{ "error": "key not found" }` (unknown `:keyId`).
**Response `400`** — `{ "error": "name is required" }`.

### `GET /admin/keys/:keyId/merchants`

List a platform key's sub-merchants, each with **settled volume aggregated by asset**.

**Response `200`**

```json
{
  "merchants": [
    {
      "id": "mrc_…",
      "apiKeyId": "key_…",
      "name": "Acme Storefront",
      "status": "active",
      "createdAt": "…",
      "updatedAt": "…",
      "volume": [ { "asset": "USDC", "total": 1250.0 } ]
    }
  ]
}
```

`volume` is the sum of `amount` for this sub-merchant's escrows that reached `released` (settled), grouped by `asset`. A sub-merchant with no settlements yet returns `"volume": []`.

**Response `404`** — `{ "error": "key not found" }`.

### `POST /admin/merchants/:id/disable`

Disable a sub-merchant (sets `status` to `disabled`). Disabled sub-merchants can no longer be attached to new sessions, endpoints, or inbound events (validation treats them like unknown ids).

**Response `200`** — `{ "merchant": { …, "status": "disabled" } }`
**Response `404`** — `{ "error": "merchant not found" }`.

## Scoping a checkout session

Pass an optional `merchantId` when creating a session so its escrow settlement is attributed to that sub-merchant.

### `POST /v1/session`

```json
{ "mode": "buy", "listingId": "lst_…", "merchantId": "mrc_…" }
```

| Field | Required | Notes |
| --- | --- | --- |
| `merchantId` | no | Scope the session (and any escrow created under it) to this sub-merchant. Must be an `active` sub-merchant owned by the authenticated publishable key. |

An unknown, disabled, or foreign `merchantId` is rejected:

**Response `400`**

```json
{ "error": { "type": "validation_error", "code": "invalid_request", "message": "merchantId is unknown, disabled, or not owned by this key" } }
```

The `merchantId` is echoed back on the session response. Escrows created under the session (`POST /v1/escrows`) inherit it, and when an escrow settles (`released`) its `amount`/`asset` are recorded against that sub-merchant's settled volume.

## Isolated webhook delivery

Webhook endpoints can be scoped to a sub-merchant via the optional `merchantId` on `POST /admin/webhooks` (see [Webhooks](./WEBHOOKS.md#registering-an-endpoint)). Delivery is strictly isolated:

- An event carrying `merchantId = M` is delivered **only** to endpoints scoped to `M`.
- An event with no `merchantId` (platform-level) is delivered **only** to endpoints with no `merchantId`.

So one sub-merchant's escrow events never reach another sub-merchant's endpoint, and never reach a platform-level endpoint (and vice-versa). This applies to:

- **Inbound webhooks** (`POST /v1/webhooks/inbound`) — include an optional `merchantId` in the signed payload; it is validated against the payload's `apiKeyId`.
- **Subscription events** — a subscription created from a session that carried a `merchantId` inherits it, so `subscription.created` / `charged` / `failed` / `canceled` are all delivered scoped to that sub-merchant.

## Data model

| Model | Purpose |
| --- | --- |
| `Merchant` | A sub-account owned by a platform `ApiKey` (`name`, `status`). |
| `MerchantSettlement` | One row per settled escrow (`escrowId` unique → idempotent), holding `amount`/`asset` for volume aggregation. |

`merchantId` is a nullable foreign key on `CheckoutSession`, `WebhookEndpoint`, `WebhookEvent`, and `Subscription`; `null` means platform-level. All columns are additive and nullable, so existing single-merchant integrations are unaffected.

## Notes & limits

- Sub-merchants have **no keys of their own** — there is no per-sub-merchant `pk_`/`sk_` or key rotation. They are addressed by `merchantId` under the platform key.
- Settled volume is currently recorded from the **test-mode escrow simulator** on `released`; live escrow settlement remains `501 not_implemented` (as elsewhere in the gateway).
