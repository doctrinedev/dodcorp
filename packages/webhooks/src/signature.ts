import { createHmac, timingSafeEqual } from 'node:crypto';
import { WebhookVerificationError } from './errors.js';

/** The only signature scheme currently emitted and accepted. */
const SCHEME = 'v1';

/** Default replay window, in seconds, either side of the signed timestamp. */
export const DEFAULT_TOLERANCE_SECONDS = 300;

/** A webhook body, either as a string or as the raw bytes received. */
export type WebhookPayload = string | Uint8Array;

export interface SignOptions {
  /**
   * Unix timestamp (seconds) to sign with. Defaults to now.
   * Provide this only for tests or for re-signing a recorded delivery.
   */
  timestamp?: number;
}

export interface VerifyOptions {
  /**
   * Accepted clock skew in seconds either side of the signed timestamp.
   * Pass `0` to disable the freshness check entirely — only do that when
   * replay protection is handled elsewhere.
   */
  toleranceSeconds?: number;
  /** Unix timestamp (seconds) to compare against. Defaults to now. */
  now?: number;
}

/**
 * Signs a webhook payload, returning the value for the signature header.
 *
 * The header format is `t=<unix-seconds>,v1=<hex-hmac>`, where the HMAC is
 * SHA-256 over the bytes `<timestamp>.<payload>` keyed by `secret`. Binding the
 * timestamp into the signed material is what makes the replay window
 * meaningful: an attacker cannot keep a captured signature valid by editing the
 * `t=` field, because doing so invalidates the HMAC.
 *
 * @example
 * ```ts
 * const header = signWebhookPayload(JSON.stringify(event), secret);
 * await fetch(url, { headers: { 'dodcorp-signature': header }, body });
 * ```
 */
export function signWebhookPayload(
  payload: WebhookPayload,
  secret: string,
  options: SignOptions = {},
): string {
  const timestamp = options.timestamp ?? currentUnixSeconds();
  const digest = computeDigest(payload, secret, timestamp);
  return `t=${String(timestamp)},${SCHEME}=${digest}`;
}

/**
 * Verifies a webhook signature header, throwing if the payload is not
 * authentic, not fresh, or not parseable.
 *
 * Pass the **raw** request body — the exact bytes received. Re-serialising a
 * parsed JSON object will change the bytes and the signature will not match.
 *
 * Multiple `v1=` values in one header are accepted, so a receiver stays working
 * across a secret rotation while both the old and new secret are being sent.
 *
 * @throws {WebhookVerificationError} on any failure; inspect `.code` to
 * distinguish a stale delivery from a forged one.
 */
export function verifyWebhookSignature(
  payload: WebhookPayload,
  header: string,
  secret: string,
  options: VerifyOptions = {},
): void {
  const { timestamp, signatures } = parseSignatureHeader(header);

  const tolerance = options.toleranceSeconds ?? DEFAULT_TOLERANCE_SECONDS;
  if (tolerance > 0) {
    const now = options.now ?? currentUnixSeconds();
    if (Math.abs(now - timestamp) > tolerance) {
      throw new WebhookVerificationError(
        'timestamp_out_of_tolerance',
        `Signature timestamp ${String(timestamp)} is outside the ${String(tolerance)}s tolerance window.`,
      );
    }
  }

  const expected = computeDigest(payload, secret, timestamp);
  const matched = signatures.some((candidate) => constantTimeEquals(candidate, expected));
  if (!matched) {
    throw new WebhookVerificationError(
      'signature_mismatch',
      'No signature in the header matched the computed digest.',
    );
  }
}

/**
 * Boolean form of {@link verifyWebhookSignature}, for callers that do not need
 * to know *why* verification failed.
 */
export function isValidWebhookSignature(
  payload: WebhookPayload,
  header: string,
  secret: string,
  options: VerifyOptions = {},
): boolean {
  try {
    verifyWebhookSignature(payload, header, secret, options);
    return true;
  } catch (error) {
    if (error instanceof WebhookVerificationError) return false;
    throw error;
  }
}

interface ParsedSignatureHeader {
  timestamp: number;
  signatures: string[];
}

function parseSignatureHeader(header: string): ParsedSignatureHeader {
  if (typeof header !== 'string' || header.trim() === '') {
    throw new WebhookVerificationError(
      'malformed_header',
      'Signature header is missing or empty.',
    );
  }

  let timestamp: number | undefined;
  const signatures: string[] = [];

  for (const part of header.split(',')) {
    const separator = part.indexOf('=');
    if (separator === -1) continue;
    const key = part.slice(0, separator).trim();
    const value = part.slice(separator + 1).trim();

    if (key === 't' && timestamp === undefined) {
      if (!/^\d+$/.test(value)) {
        throw new WebhookVerificationError(
          'malformed_header',
          `Signature timestamp "${value}" is not a Unix seconds value.`,
        );
      }
      timestamp = Number(value);
    } else if (key === SCHEME && value !== '') {
      signatures.push(value);
    }
  }

  if (timestamp === undefined) {
    throw new WebhookVerificationError(
      'malformed_header',
      'Signature header has no "t=" timestamp field.',
    );
  }
  if (signatures.length === 0) {
    throw new WebhookVerificationError(
      'no_supported_signature',
      `Signature header has no "${SCHEME}=" field.`,
    );
  }

  return { timestamp, signatures };
}

function computeDigest(payload: WebhookPayload, secret: string, timestamp: number): string {
  const signedMaterial = Buffer.concat([
    Buffer.from(`${String(timestamp)}.`, 'utf8'),
    toBuffer(payload),
  ]);
  return createHmac('sha256', secret).update(signedMaterial).digest('hex');
}

function toBuffer(payload: WebhookPayload): Buffer {
  return typeof payload === 'string' ? Buffer.from(payload, 'utf8') : Buffer.from(payload);
}

/**
 * Length-safe constant-time comparison. `timingSafeEqual` throws on a length
 * mismatch, which would itself leak length, so the lengths are checked first —
 * both digests are fixed-width hex, making that check non-revealing.
 */
function constantTimeEquals(a: string, b: string): boolean {
  const bufferA = Buffer.from(a, 'utf8');
  const bufferB = Buffer.from(b, 'utf8');
  if (bufferA.length !== bufferB.length) return false;
  return timingSafeEqual(bufferA, bufferB);
}

function currentUnixSeconds(): number {
  return Math.floor(Date.now() / 1000);
}
