// ─── Circuit Breaker States ───────────────────────────────────

export type CircuitState = 'CLOSED' | 'OPEN' | 'HALF_OPEN';

// ─── Send / Status Types ─────────────────────────────────────

export interface SendPayload {
  notificationId: string;
  trackingId:     string;
  userId:         string;
  recipient:      string;           // phone / email / device token / etc.
  subject?:       string;
  body:           string;
  templateId?:    string;
  metadata:       Record<string, unknown>;
}

export interface SendResult {
  success:           boolean;
  providerMessageId?: string;
  errorCode?:        string;
  errorMessage?:     string;
  latencyMs:         number;
}

export interface StatusResult {
  providerMessageId: string;
  status:            'SENT' | 'DELIVERED' | 'FAILED' | 'UNKNOWN';
  deliveredAt?:      Date;
  errorCode?:        string;
}

// ─── Circuit Breaker Implementation ──────────────────────────

interface CircuitBreakerOptions {
  threshold:         number;   // consecutive failures before OPEN
  timeoutMs:         number;   // how long to stay OPEN
  halfOpenRequests:  number;   // probes allowed in HALF_OPEN
}

export class CircuitBreaker {
  private state:            CircuitState = 'CLOSED';
  private failureCount:     number       = 0;
  private lastFailureTime:  number       = 0;
  private halfOpenAttempts: number       = 0;

  private readonly threshold:        number;
  private readonly timeoutMs:        number;
  private readonly halfOpenRequests: number;

  constructor(opts?: Partial<CircuitBreakerOptions>) {
    this.threshold        = opts?.threshold        ?? parseInt(process.env['CIRCUIT_BREAKER_THRESHOLD']       ?? '5',  10);
    this.timeoutMs        = opts?.timeoutMs        ?? parseInt(process.env['CIRCUIT_BREAKER_TIMEOUT_MS']      ?? '30000', 10);
    this.halfOpenRequests = opts?.halfOpenRequests ?? parseInt(process.env['CIRCUIT_BREAKER_HALF_OPEN_REQUESTS'] ?? '2',  10);
  }

  isAllowed(): boolean {
    const now = Date.now();

    if (this.state === 'CLOSED') return true;

    if (this.state === 'OPEN') {
      if (now - this.lastFailureTime >= this.timeoutMs) {
        this.state            = 'HALF_OPEN';
        this.halfOpenAttempts = 0;
        return true;
      }
      return false;
    }

    // HALF_OPEN: allow limited probes
    if (this.halfOpenAttempts < this.halfOpenRequests) {
      this.halfOpenAttempts++;
      return true;
    }
    return false;
  }

  recordSuccess(): void {
    this.failureCount = 0;
    this.state        = 'CLOSED';
  }

  recordFailure(): void {
    this.failureCount++;
    this.lastFailureTime = Date.now();

    if (this.state === 'HALF_OPEN') {
      this.state = 'OPEN';
      return;
    }

    if (this.failureCount >= this.threshold) {
      this.state = 'OPEN';
    }
  }

  getState(): CircuitState { return this.state; }
  getFailureCount(): number { return this.failureCount; }
}

// ─── Retry with Jittered Exponential Backoff ─────────────────

export async function withRetry<T>(
  fn:           () => Promise<T>,
  maxAttempts:  number = 3,
  baseDelayMs:  number = 1000,
  maxDelayMs:   number = 30_000,
): Promise<T> {
  let lastError: Error = new Error('Unknown error');

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      return await fn();
    } catch (err) {
      lastError = err instanceof Error ? err : new Error(String(err));
      if (attempt === maxAttempts) break;

      // Jittered exponential backoff
      const exponential = Math.min(baseDelayMs * Math.pow(2, attempt - 1), maxDelayMs);
      const jitter      = Math.random() * 0.3 * exponential;
      const delay       = Math.floor(exponential + jitter);

      await new Promise(resolve => setTimeout(resolve, delay));
    }
  }

  throw lastError;
}

// ─── Abstract Delivery Provider ───────────────────────────────

export abstract class DeliveryProvider {
  protected readonly circuitBreaker: CircuitBreaker;
  abstract readonly channelName: string;

  constructor(circuitOpts?: Partial<CircuitBreakerOptions>) {
    this.circuitBreaker = new CircuitBreaker(circuitOpts);
  }

  /**
   * Send a notification through this provider.
   * Automatically wraps execution in circuit breaker + retry logic.
   */
  async send(payload: SendPayload): Promise<SendResult> {
    if (!this.circuitBreaker.isAllowed()) {
      return {
        success:      false,
        errorCode:    'CIRCUIT_OPEN',
        errorMessage: `Circuit breaker OPEN for ${this.channelName}`,
        latencyMs:    0,
      };
    }

    const start = Date.now();
    try {
      const result = await withRetry(
        () => this.sendImpl(payload),
        parseInt(process.env['MAX_RETRY_ATTEMPTS'] ?? '3', 10),
        parseInt(process.env['RETRY_BASE_DELAY_MS'] ?? '1000', 10),
        parseInt(process.env['RETRY_MAX_DELAY_MS'] ?? '30000', 10),
      );
      this.circuitBreaker.recordSuccess();
      return { ...result, latencyMs: Date.now() - start };
    } catch (err) {
      this.circuitBreaker.recordFailure();
      const message = err instanceof Error ? err.message : String(err);
      return {
        success:      false,
        errorCode:    'PROVIDER_ERROR',
        errorMessage: message,
        latencyMs:    Date.now() - start,
      };
    }
  }

  /**
   * Provider-specific implementation.
   */
  protected abstract sendImpl(payload: SendPayload): Promise<SendResult>;

  /**
   * Poll for delivery status from the provider.
   */
  abstract getStatus(providerMessageId: string): Promise<StatusResult>;

  getCircuitState(): CircuitState {
    return this.circuitBreaker.getState();
  }
}
