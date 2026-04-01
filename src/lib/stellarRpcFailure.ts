/**
 * @dev Stable classification for failures returned by Stellar-facing dependencies.
 * Raw upstream messages must never cross the API trust boundary.
 */
export enum StellarRPCFailureClass {
  TIMEOUT = 'TIMEOUT',
  RATE_LIMIT = 'RATE_LIMIT',
  UPSTREAM_ERROR = 'UPSTREAM_ERROR',
  MALFORMED_RESPONSE = 'MALFORMED_RESPONSE',
  UNAUTHORIZED = 'UNAUTHORIZED',
  UNKNOWN = 'UNKNOWN',
}

/**
 * @dev Maps arbitrary dependency failures into deterministic, client-safe buckets.
 */
export function classifyStellarRPCFailure(error: unknown): StellarRPCFailureClass {
  if (
    error instanceof Error &&
    (error.name === 'AbortError' || error.message.toLowerCase().includes('timeout'))
  ) {
    return StellarRPCFailureClass.TIMEOUT;
  }

  if (typeof error === 'object' && error !== null) {
    const status = (error as { status?: number }).status;
    if (status === 429) {
      return StellarRPCFailureClass.RATE_LIMIT;
    }
    if (status === 401 || status === 403) {
      return StellarRPCFailureClass.UNAUTHORIZED;
    }
    if (typeof status === 'number' && status >= 500) {
      return StellarRPCFailureClass.UPSTREAM_ERROR;
    }
  }

  if (error instanceof SyntaxError) {
    return StellarRPCFailureClass.MALFORMED_RESPONSE;
  }

  return StellarRPCFailureClass.UNKNOWN;
}
