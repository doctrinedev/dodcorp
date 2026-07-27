/**
 * Why verification of a webhook signature failed.
 *
 * Callers should branch on `code` rather than on the message text, which is
 * only meant for logs.
 */
export type WebhookVerificationErrorCode =
  /** The signature header was absent, empty, or not in the expected format. */
  | 'malformed_header'
  /** The header parsed, but carried no signature of a scheme we understand. */
  | 'no_supported_signature'
  /** The timestamp is outside the accepted tolerance window (replay defence). */
  | 'timestamp_out_of_tolerance'
  /** The header parsed and was fresh, but no signature matched. */
  | 'signature_mismatch';

/**
 * Thrown by {@link verifyWebhookSignature} when a payload cannot be trusted.
 *
 * Treat every instance as a rejected request: never fall through to handling
 * the payload after catching this.
 */
export class WebhookVerificationError extends Error {
  override readonly name = 'WebhookVerificationError';
  readonly code: WebhookVerificationErrorCode;

  constructor(code: WebhookVerificationErrorCode, message: string) {
    super(message);
    this.code = code;
  }
}
