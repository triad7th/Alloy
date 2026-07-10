import { describe, expect, it } from 'vitest';
import { StorageError } from './errors';

describe('StorageError.fromHttpStatus', () => {
  // Twin fixture: swift/Tests/AlloyStorageTests/StorageErrorTests.swift uses the same table.
  const cases: Array<[number, string]> = [
    [401, 'auth'],
    [403, 'auth'],
    [404, 'notFound'],
    [409, 'conflict'],
    [412, 'conflict'],
    [429, 'quota'],
    [500, 'unreachable'],
    [503, 'unreachable'],
    [0, 'unreachable'],
  ];
  it.each(cases)('maps HTTP %i to %s', (status, category) => {
    const err = StorageError.fromHttpStatus(status);
    expect(err.category).toBe(category);
    expect(err.status).toBe(status);
    expect(err).toBeInstanceOf(Error);
  });

  it('keeps an explicit message and defaults to HTTP <status>', () => {
    expect(StorageError.fromHttpStatus(404, 'gone').message).toBe('gone');
    expect(StorageError.fromHttpStatus(500).message).toBe('HTTP 500');
  });
});
