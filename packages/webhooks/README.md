# @dodcorp/webhooks

Webhook signing and signature verification for DodCorp webhook deliveries.

Zero dependencies. Node 20.11+. Ships ESM and CJS with types for both.

> **Status: alpha.** The public API may change before `1.0.0`. Installs from the
> `alpha` dist-tag until then.

## Install

```sh
npm install @dodcorp/webhooks@alpha
```

## Verifying an incoming webhook

Verification runs against the **raw request body**. If you hand it a re-serialised
object, the bytes change and the signature will not match.

```ts
import express from 'express';
import { verifyWebhookSignature, WebhookVerificationError } from '@dodcorp/webhooks';

const app = express();

app.post('/webhooks', express.raw({ type: 'application/json' }), (req, res) => {
  try {
    verifyWebhookSignature(req.body, req.get('dodcorp-signature') ?? '', process.env.WEBHOOK_SECRET!);
  } catch (error) {
    if (error instanceof WebhookVerificationError) {
      // error.code: 'malformed_header' | 'no_supported_signature'
      //           | 'timestamp_out_of_tolerance' | 'signature_mismatch'
      return res.status(400).send(error.code);
    }
    throw error;
  }

  const event = JSON.parse(req.body.toString('utf8'));
  // ... handle the event
  res.sendStatus(204);
});
```

If you only need a yes/no, use `isValidWebhookSignature`, which returns a boolean
instead of throwing.

## Signing an outgoing webhook

```ts
import { signWebhookPayload } from '@dodcorp/webhooks';

const body = JSON.stringify(event);
const signature = signWebhookPayload(body, endpointSecret);

await fetch(endpoint.url, {
  method: 'POST',
  headers: { 'content-type': 'application/json', 'dodcorp-signature': signature },
  body,
});
```

## Header format

```
t=1760000000,v1=3f2a...64-hex-chars
```

`v1` is HMAC-SHA256 over the bytes `<timestamp>.<payload>`, keyed by the endpoint
secret. The timestamp is part of the signed material, so an attacker cannot
refresh a captured delivery by editing `t=` — that invalidates the HMAC.

Deliveries older or newer than `toleranceSeconds` (default `300`) are rejected,
which bounds the replay window. Pass `toleranceSeconds: 0` to disable that check
only if you are deduplicating delivery IDs elsewhere.

## Secret rotation

A header may carry several `v1=` values, and verification passes if **any** of
them matches. To rotate without dropping deliveries: sign with both the old and
new secret, move receivers onto the new secret, then stop signing with the old
one.

```ts
const t = Math.floor(Date.now() / 1000);
const withOld = signWebhookPayload(body, oldSecret, { timestamp: t });
const withNew = signWebhookPayload(body, newSecret, { timestamp: t });
const header = `${withOld},${withNew.split(',').slice(1).join(',')}`;
```

## API

| Export | Purpose |
| --- | --- |
| `signWebhookPayload(payload, secret, options?)` | Returns the signature header value. |
| `verifyWebhookSignature(payload, header, secret, options?)` | Throws `WebhookVerificationError` unless the payload is authentic and fresh. |
| `isValidWebhookSignature(payload, header, secret, options?)` | Boolean form of the above. |
| `WebhookVerificationError` | Carries a `.code` describing the failure. |
| `DEFAULT_TOLERANCE_SECONDS` | `300`. |

`payload` accepts a `string` or `Uint8Array`/`Buffer`.

## License

MIT
