import { RetryEngine, RetryableError, PermanentError, buildRetryableError, classifyHttpError } from './RetryEngine';

// ---- Helpers ----------------------------------------------

function deadline(seconds_from_now: number): Date {
  return new Date(Date.now() + seconds_from_now * 1000);
}

function makeFailingFn(fail_times: number, error: Error) {
  let calls = 0;
  return jest.fn(async () => {
    if (calls++ < fail_times) throw error;
    return 'ok';
  });
}

// ---- Tests ------------------------------------------------

describe('RetryEngine', () => {
  jest.useFakeTimers();

  afterEach(() => {
    jest.clearAllTimers();
    jest.clearAllMocks();
  });

  it('returns result on first successful attempt', async () => {
    const engine = new RetryEngine({ deadline_utc: deadline(3600) });
    const fn = jest.fn(async () => 42);

    const result = await engine.run(fn);

    expect(result.value).toBe(42);
    expect(result.attempts).toBe(1);
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it('retries on TRANSIENT error and succeeds', async () => {
    const engine = new RetryEngine({ deadline_utc: deadline(3600), config: { base_ms: 1, jitter_ms: 0 } });
    const err = new RetryableError('503', 'TRANSIENT');
    const fn = makeFailingFn(2, err);

    const runPromise = engine.run(fn);
    // Advance timers to skip waits
    for (let i = 0; i < 5; i++) {
      await Promise.resolve();
      jest.runAllTimers();
      await Promise.resolve();
    }

    const result = await runPromise;
    expect(result.value).toBe('ok');
    expect(result.attempts).toBe(3);
  });

  it('throws immediately on PERMANENT error without retrying', async () => {
    const engine = new RetryEngine({ deadline_utc: deadline(3600) });
    const fn = jest.fn(async () => { throw new PermanentError('401 Unauthorized', 401); });

    await expect(engine.run(fn)).rejects.toThrow(PermanentError);
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it('throws after max_attempts exhausted', async () => {
    const engine = new RetryEngine({ deadline_utc: deadline(3600), config: { base_ms: 1, jitter_ms: 0, max_attempts: 3 } });
    const err = new RetryableError('503', 'TRANSIENT');
    const fn = jest.fn(async () => { throw err; });

    const runPromise = engine.run(fn).catch(e => e);
    for (let i = 0; i < 10; i++) {
      await Promise.resolve();
      jest.runAllTimers();
      await Promise.resolve();
    }

    const result = await runPromise;
    expect(result).toBeInstanceOf(Error);
    expect(fn).toHaveBeenCalledTimes(3);
  });

  it('aborts when deadline is < 60 seconds away', async () => {
    const engine = new RetryEngine({ deadline_utc: deadline(30) });
    const fn = jest.fn(async () => { throw new RetryableError('503', 'TRANSIENT'); });

    await expect(engine.run(fn)).rejects.toThrow('deadline too close');
    expect(fn).toHaveBeenCalledTimes(1);
  });
});

// ---- classifyHttpError ------------------------------------

describe('classifyHttpError', () => {
  it.each([
    [429, 'RATE_LIMIT'],
    [400, 'PERMANENT'],
    [401, 'PERMANENT'],
    [403, 'PERMANENT'],
    [422, 'PERMANENT'],
    [500, 'TRANSIENT'],
    [502, 'TRANSIENT'],
    [503, 'TRANSIENT'],
    [504, 'TRANSIENT'],
  ])('classifies %i as %s', (status, expected) => {
    expect(classifyHttpError(status)).toBe(expected);
  });

  it('classifies timeout messages correctly', () => {
    expect(classifyHttpError(0, 'ETIMEDOUT')).toBe('TIMEOUT');
    expect(classifyHttpError(0, 'ECONNABORTED')).toBe('TIMEOUT');
  });
});

// ---- buildRetryableError ----------------------------------

describe('buildRetryableError', () => {
  it('returns PermanentError for 401', () => {
    expect(buildRetryableError(401, 'Unauthorized')).toBeInstanceOf(PermanentError);
  });

  it('returns RetryableError for 503', () => {
    expect(buildRetryableError(503, 'Service Unavailable')).toBeInstanceOf(RetryableError);
  });

  it('parses Retry-After header into ms', () => {
    const err = buildRetryableError(429, 'Rate limited', '30') as RetryableError;
    expect(err).toBeInstanceOf(RetryableError);
    expect(err.retry_after_ms).toBe(30_000);
  });
});
