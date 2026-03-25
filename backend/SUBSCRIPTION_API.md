# Subscription CRUD API Documentation

## Architecture Overview

This implementation provides authenticated CRUD endpoints for subscriptions with the following features:

1. **Authentication**: JWT token or HTTP-only cookie based authentication
2. **Ownership Validation**: Every request validates subscription ownership
3. **Blockchain Sync**: Automatic synchronization with on-chain contracts
4. **Idempotency**: Request deduplication using idempotency keys
5. **Race Condition Handling**: Optimistic locking and transaction management
6. **Partial Failure Management**: Graceful handling of on-chain/off-chain failures

## Authentication

All endpoints require authentication via one of:

- **Bearer Token**: `Authorization: Bearer <token>`
- **HTTP-only Cookie**: `authToken` cookie (set by login endpoint)

## Endpoints

### List Subscriptions

```http
GET /api/subscriptions
Authorization: Bearer <token>
```

**Query Parameters:**
- `status` (optional): Filter by status (`active`, `cancelled`, `paused`, `trial`)
- `category` (optional): Filter by category
- `limit` (optional): Number of results (default: all)
- `offset` (optional): Pagination offset

**Response:**
```json
{
  "success": true,
  "data": [
    {
      "id": "uuid",
      "name": "Netflix",
      "price": 15.99,
      "billing_cycle": "monthly",
      "status": "active",
      ...
    }
  ],
  "pagination": {
    "total": 10,
    "limit": 20,
    "offset": 0
  }
}
```

### Get Subscription

```http
GET /api/subscriptions/:id
Authorization: Bearer <token>
```

**Response:**
```json
{
  "success": true,
  "data": {
    "id": "uuid",
    "name": "Netflix",
    ...
  }
}
```

### Create Subscription

```http
POST /api/subscriptions
Authorization: Bearer <token>
Idempotency-Key: <unique-key>
Content-Type: application/json

{
  "name": "Netflix",
  "price": 15.99,
  "billing_cycle": "monthly",
  "status": "active",
  "category": "Entertainment",
  "next_billing_date": "2024-02-01",
  "renewal_url": "https://netflix.com/account",
  "tags": ["streaming", "entertainment"]
}
```

**Idempotency:**
- Include `Idempotency-Key` header to prevent duplicate operations
- Same key + same payload = cached response (within 24 hours)

**Response:**
```json
{
  "success": true,
  "data": {
    "id": "uuid",
    "name": "Netflix",
    ...
  },
  "blockchain": {
    "synced": true,
    "transactionHash": "0x...",
    "error": null
  }
}
```

**Status Codes:**
- `201`: Created successfully, blockchain synced
- `207`: Created successfully, blockchain sync failed (partial success)

### Update Subscription

```http
PATCH /api/subscriptions/:id
Authorization: Bearer <token>
Idempotency-Key: <unique-key>
If-Match: <version> (optional, for optimistic locking)
Content-Type: application/json

{
  "price": 19.99,
  "status": "paused"
}
```

**Response:**
```json
{
  "success": true,
  "data": {
    "id": "uuid",
    "name": "Netflix",
    "price": 19.99,
    ...
  },
  "blockchain": {
    "synced": true,
    "transactionHash": "0x...",
    "error": null
  }
}
```

### Delete Subscription

```http
DELETE /api/subscriptions/:id
Authorization: Bearer <token>
```

**Response:**
```json
{
  "success": true,
  "message": "Subscription deleted",
  "blockchain": {
    "synced": true,
    "transactionHash": "0x...",
    "error": null
  }
}
```

### Retry Blockchain Sync

```http
POST /api/subscriptions/:id/retry-sync
Authorization: Bearer <token>
```

**Response:**
```json
{
  "success": true,
  "transactionHash": "0x...",
  "error": null
}
```

### Bulk Operations

```http
POST /api/subscriptions/bulk
Authorization: Bearer <token>
Content-Type: application/json

{
  "operation": "delete",
  "ids": ["uuid1", "uuid2", "uuid3"]
}
```

**Operations:**
- `delete`: Delete multiple subscriptions
- `update`: Update multiple subscriptions (requires `data` field)

**Response:**
```json
{
  "success": true,
  "results": [
    { "id": "uuid1", "success": true, "result": {...} },
    { "id": "uuid2", "success": true, "result": {...} }
  ],
  "errors": [
    { "id": "uuid3", "error": "Subscription not found" }
  ]
}
```

## Error Handling

### Standard Error Response

```json
{
  "success": false,
  "error": "Error message"
}
```

### Status Codes

- `400`: Bad Request (validation error)
- `401`: Unauthorized (missing/invalid token)
- `403`: Forbidden (ownership validation failed)
- `404`: Not Found
- `207`: Multi-Status (partial success - database succeeded, blockchain failed)
- `500`: Internal Server Error

## Idempotency

### How It Works

1. Client sends request with `Idempotency-Key` header
2. Server hashes request payload
3. Server checks for existing record with same key + user + hash
4. If found, returns cached response
5. If not found, processes request and stores response

### Best Practices

- Generate unique keys per operation (UUID recommended)
- Key should be unique per user + operation + payload
- Keys expire after 24 hours
- Don't reuse keys for different operations

### Example

```typescript
const idempotencyKey = crypto.randomUUID();

// First request
const response1 = await fetch('/api/subscriptions', {
  method: 'POST',
  headers: {
    'Authorization': `Bearer ${token}`,
    'Idempotency-Key': idempotencyKey,
    'Content-Type': 'application/json'
  },
  body: JSON.stringify({ name: 'Netflix', price: 15.99, ... })
});

// Retry with same key - returns cached response
const response2 = await fetch('/api/subscriptions', {
  method: 'POST',
  headers: {
    'Authorization': `Bearer ${token}`,
    'Idempotency-Key': idempotencyKey, // Same key
    'Content-Type': 'application/json'
  },
  body: JSON.stringify({ name: 'Netflix', price: 15.99, ... }) // Same payload
});
```

## Race Condition Handling

### Optimistic Locking

Use `If-Match` header with version number to prevent concurrent updates:

```http
PATCH /api/subscriptions/:id
If-Match: 42
```

If version doesn't match, request fails with 409 Conflict.

### Database-Level Protection

- Row-level security (RLS) ensures users can only access their own subscriptions
- Unique constraints prevent duplicate operations
- Database transactions ensure atomicity for multi-step operations

## Partial Failure Management

### Strategy

1. **Database First**: Always write to database first (source of truth)
2. **Blockchain Second**: Attempt blockchain sync (best effort)
3. **Graceful Degradation**: Return success even if blockchain fails
4. **Status Reporting**: Include blockchain sync status in response
5. **Retry Mechanism**: Provide endpoint to retry failed syncs

### Response Format

```json
{
  "success": true,
  "data": {...},
  "blockchain": {
    "synced": false,
    "transactionHash": null,
    "error": "Network timeout"
  }
}
```

### Retry Failed Syncs

```http
POST /api/subscriptions/:id/retry-sync
```

This endpoint attempts to sync the subscription to blockchain again.

## Security

### Payload Size Limits

To prevent denial-of-service attacks and ensure system stability, the following payload size limits are enforced on all API requests:

| Endpoint Range | Payload Type | Size Limit |
|----------------|--------------|------------|
| Global (Default) | JSON / URL-encoded | 10 KB |
| `/api/audit/*` | Batch Audit Events | 100 KB |
| `/api/admin/*` | Admin Operations | 50 KB |

Requests exceeding these limits will receive a `413 Payload Too Large` response.

### Request Validation

All request bodies are validated using Zod schemas with strict type checking and maximum length constraints for string fields:

- **Names / Providers**: Max 100 characters
- **Categories**: Max 50 characters
- **Notes / Descriptions**: Max 500 characters
- **URLs (Logo, Website, Renewal)**: Max 2000 characters
- **Tags**: Max 50 characters per tag

Validation failures will return a `400 Bad Request` with detailed field-level error messages.

## Database Schema

### Required Table

Run the idempotency table migration:

```sql
-- See scripts/008_create_idempotency_table.sql
```

### Existing Tables

- `subscriptions`: Main subscription data (already exists)
- `blockchain_logs`: Blockchain sync status (already exists)

## Implementation Details

### Services

- **SubscriptionService**: Core CRUD operations with blockchain sync
- **BlockchainService**: On-chain contract interaction
- **IdempotencyService**: Request deduplication

### Middleware

- **authenticate**: JWT/cookie validation
- **validateSubscriptionOwnership**: Ownership check
- **validateBulkSubscriptionOwnership**: Bulk ownership validation

### Error Recovery

- Database operations are atomic
- Blockchain failures don't block database operations
- Failed syncs can be retried via `/retry-sync` endpoint
- Idempotency prevents duplicate operations

## Testing

### Example cURL Commands

```bash
# List subscriptions
curl -H "Authorization: Bearer $TOKEN" \
  http://localhost:3001/api/subscriptions

# Create subscription (with idempotency)
curl -X POST \
  -H "Authorization: Bearer $TOKEN" \
  -H "Idempotency-Key: $(uuidgen)" \
  -H "Content-Type: application/json" \
  -d '{"name":"Netflix","price":15.99,"billing_cycle":"monthly"}' \
  http://localhost:3001/api/subscriptions

# Update subscription
curl -X PATCH \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"price":19.99}' \
  http://localhost:3001/api/subscriptions/$ID

# Delete subscription
curl -X DELETE \
  -H "Authorization: Bearer $TOKEN" \
  http://localhost:3001/api/subscriptions/$ID
```

## Future Enhancements

1. **Webhook Support**: Notify external systems of subscription changes
2. **Event Sourcing**: Full audit trail of all operations
3. **Versioning**: API versioning for backward compatibility
4. **Rate Limiting**: Per-user rate limits
5. **Caching**: Redis cache for frequently accessed subscriptions
