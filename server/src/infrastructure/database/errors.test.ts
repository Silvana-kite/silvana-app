import { describe, expect, it } from 'vitest';
import { formatDatabaseError } from './errors.js';

describe('database error diagnostics', () => {
  it('shows connection codes hidden by an empty AggregateError message', () => {
    const error = new AggregateError([
      Object.assign(new Error('connect timed out'), { code: 'ETIMEDOUT' }),
      Object.assign(new Error('connection refused'), { code: 'ECONNREFUSED' }),
    ]);
    const result = formatDatabaseError(new Error('Migration failed', { cause: error }));
    expect(result).toContain('Migration failed');
    expect(result).toContain('ETIMEDOUT: connect timed out');
    expect(result).toContain('ECONNREFUSED: connection refused');
  });

  it('redacts connection URLs and both encoded and decoded passwords in nested errors', () => {
    const url = 'postgresql://user:secret%40value@db.example/test';
    const error = new Error(`Connection failed: ${url}`, {
      cause: new AggregateError([new Error('secret@value secret%40value'), new Error('postgres://other:password@other.example/db')]),
    });
    const result = formatDatabaseError(error, url);
    expect(result).not.toContain('secret');
    expect(result).not.toContain('password');
    expect(result).not.toContain('postgres');
  });

  it('handles circular causes and non-Error failures', () => {
    const error = new Error('connection lost');
    error.cause = error;
    expect(formatDatabaseError(error)).toBe('Error: connection lost');
    expect(formatDatabaseError('failed')).toBe('failed');
  });
});
