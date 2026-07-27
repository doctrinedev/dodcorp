import { describe, expect, it } from 'vitest';
import { WebhookVerificationError } from './errors.js';
import {
  DEFAULT_TOLERANCE_SECONDS,
  isValidWebhookSignature,
  signWebhookPayload,
  verifyWebhookSignature,
} from './signature.js';

const SECRET = 'whsec_test_2f8a1c6e4b0d';
const PAYLOAD = JSON.stringify({ id: 'evt_1', type: 'invoice.paid', amount: 4200 });
const NOW = 1_760_000_000;

/** Asserts that `fn` throws a WebhookVerificationError carrying `code`. */
function expectRejection(fn: () => void, code: string): void {
  expect(fn).toThrowError(WebhookVerificationError);
  try {
    fn();
    expect.unreachable('expected verification to throw');
  } catch (error) {
    expect((error as WebhookVerificationError).code).toBe(code);
  }
}

describe('signWebhookPayload', () => {
  it('produces a header carrying the timestamp and a v1 signature', () => {
    const header = signWebhookPayload(PAYLOAD, SECRET, { timestamp: NOW });
    expect(header).toMatch(/^t=1760000000,v1=[0-9a-f]{64}$/);
  });

  it('is deterministic for a fixed timestamp', () => {
    const a = signWebhookPayload(PAYLOAD, SECRET, { timestamp: NOW });
    const b = signWebhookPayload(PAYLOAD, SECRET, { timestamp: NOW });
    expect(a).toBe(b);
  });

  it('binds the timestamp into the signature', () => {
    const a = signWebhookPayload(PAYLOAD, SECRET, { timestamp: NOW });
    const b = signWebhookPayload(PAYLOAD, SECRET, { timestamp: NOW + 1 });
    expect(a.split('v1=')[1]).not.toBe(b.split('v1=')[1]);
  });

  it('defaults to the current time', () => {
    const header = signWebhookPayload(PAYLOAD, SECRET);
    const timestamp = Number(/t=(\d+)/.exec(header)?.[1]);
    expect(Math.abs(timestamp - Math.floor(Date.now() / 1000))).toBeLessThanOrEqual(2);
  });
});

describe('verifyWebhookSignature', () => {
  it('accepts a signature it just produced', () => {
    const header = signWebhookPayload(PAYLOAD, SECRET, { timestamp: NOW });
    expect(() => {
      verifyWebhookSignature(PAYLOAD, header, SECRET, { now: NOW });
    }).not.toThrow();
  });

  it('rejects a tampered payload', () => {
    const header = signWebhookPayload(PAYLOAD, SECRET, { timestamp: NOW });
    const tampered = JSON.stringify({ id: 'evt_1', type: 'invoice.paid', amount: 999_999 });
    expectRejection(
      () => {
        verifyWebhookSignature(tampered, header, SECRET, { now: NOW });
      },
      'signature_mismatch',
    );
  });

  it('rejects a signature made with a different secret', () => {
    const header = signWebhookPayload(PAYLOAD, 'whsec_attacker', { timestamp: NOW });
    expectRejection(
      () => {
        verifyWebhookSignature(PAYLOAD, header, SECRET, { now: NOW });
      },
      'signature_mismatch',
    );
  });

  it('rejects a replayed delivery beyond the tolerance window', () => {
    const header = signWebhookPayload(PAYLOAD, SECRET, { timestamp: NOW });
    expectRejection(
      () => {
        verifyWebhookSignature(PAYLOAD, header, SECRET, {
          now: NOW + DEFAULT_TOLERANCE_SECONDS + 1,
        });
      },
      'timestamp_out_of_tolerance',
    );
  });

  it('accepts a delivery at the edge of the tolerance window', () => {
    const header = signWebhookPayload(PAYLOAD, SECRET, { timestamp: NOW });
    expect(() => {
      verifyWebhookSignature(PAYLOAD, header, SECRET, {
        now: NOW + DEFAULT_TOLERANCE_SECONDS,
      });
    }).not.toThrow();
  });

  it('rejects a timestamp too far in the future', () => {
    const header = signWebhookPayload(PAYLOAD, SECRET, { timestamp: NOW + 10_000 });
    expectRejection(
      () => {
        verifyWebhookSignature(PAYLOAD, header, SECRET, { now: NOW });
      },
      'timestamp_out_of_tolerance',
    );
  });

  it('skips the freshness check when tolerance is 0', () => {
    const header = signWebhookPayload(PAYLOAD, SECRET, { timestamp: NOW });
    expect(() => {
      verifyWebhookSignature(PAYLOAD, header, SECRET, {
        now: NOW + 10_000_000,
        toleranceSeconds: 0,
      });
    }).not.toThrow();
  });

  it('rejects an attacker who rewrites the timestamp to stay fresh', () => {
    const header = signWebhookPayload(PAYLOAD, SECRET, { timestamp: NOW });
    const digest = header.split('v1=')[1] ?? '';
    const forged = `t=${String(NOW + 10_000)},v1=${digest}`;
    expectRejection(
      () => {
        verifyWebhookSignature(PAYLOAD, forged, SECRET, { now: NOW + 10_000 });
      },
      'signature_mismatch',
    );
  });

  it('accepts either signature during a secret rotation', () => {
    const oldSecret = 'whsec_old';
    const newSecret = 'whsec_new';
    const oldDigest = signWebhookPayload(PAYLOAD, oldSecret, { timestamp: NOW }).split('v1=')[1];
    const newDigest = signWebhookPayload(PAYLOAD, newSecret, { timestamp: NOW }).split('v1=')[1];
    const header = `t=${String(NOW)},v1=${oldDigest ?? ''},v1=${newDigest ?? ''}`;

    for (const secret of [oldSecret, newSecret]) {
      expect(() => {
        verifyWebhookSignature(PAYLOAD, header, secret, { now: NOW });
      }).not.toThrow();
    }
  });

  it('verifies raw bytes identically to the equivalent string', () => {
    const bytes = new TextEncoder().encode(PAYLOAD);
    const fromBytes = signWebhookPayload(bytes, SECRET, { timestamp: NOW });
    const fromString = signWebhookPayload(PAYLOAD, SECRET, { timestamp: NOW });
    expect(fromBytes).toBe(fromString);
    expect(() => {
      verifyWebhookSignature(bytes, fromString, SECRET, { now: NOW });
    }).not.toThrow();
  });

  it('tolerates whitespace and unknown fields in the header', () => {
    const digest = signWebhookPayload(PAYLOAD, SECRET, { timestamp: NOW }).split('v1=')[1] ?? '';
    const header = ` t=${String(NOW)} , v2=unsupported , v1=${digest} `;
    expect(() => {
      verifyWebhookSignature(PAYLOAD, header, SECRET, { now: NOW });
    }).not.toThrow();
  });

  describe('malformed input', () => {
    const cases: ReadonlyArray<[name: string, header: string, code: string]> = [
      ['empty header', '', 'malformed_header'],
      ['whitespace only', '   ', 'malformed_header'],
      ['no timestamp field', 'v1=abc', 'malformed_header'],
      ['non-numeric timestamp', 't=not-a-number,v1=abc', 'malformed_header'],
      ['no signature field', `t=${String(NOW)}`, 'no_supported_signature'],
      ['only unsupported schemes', `t=${String(NOW)},v2=abc`, 'no_supported_signature'],
      ['empty signature value', `t=${String(NOW)},v1=`, 'no_supported_signature'],
    ];

    it.each(cases)('rejects %s', (_name, header, code) => {
      expectRejection(() => {
        verifyWebhookSignature(PAYLOAD, header, SECRET, { now: NOW });
      }, code);
    });
  });

  it('rejects a signature of the right shape but wrong value', () => {
    const header = `t=${String(NOW)},v1=${'a'.repeat(64)}`;
    expectRejection(
      () => {
        verifyWebhookSignature(PAYLOAD, header, SECRET, { now: NOW });
      },
      'signature_mismatch',
    );
  });
});

describe('isValidWebhookSignature', () => {
  it('returns true for a good signature', () => {
    const header = signWebhookPayload(PAYLOAD, SECRET, { timestamp: NOW });
    expect(isValidWebhookSignature(PAYLOAD, header, SECRET, { now: NOW })).toBe(true);
  });

  it('returns false instead of throwing for a bad one', () => {
    expect(isValidWebhookSignature(PAYLOAD, 'garbage', SECRET, { now: NOW })).toBe(false);
  });
});
