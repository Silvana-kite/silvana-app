import { afterEach, describe, expect, it, vi } from 'vitest';
import { SiilvanaApiClient } from './index.js';

describe('SiilvanaApiClient', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('uses a versioned base URL exactly once and forwards ETag', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(null, { status: 304 }));
    vi.stubGlobal('fetch', fetchMock);

    const result = await new SiilvanaApiClient('http://localhost:3000/v1/').catalog('"catalog-old"');

    expect(fetchMock).toHaveBeenCalledWith('http://localhost:3000/v1/catalog', {
      headers: { 'If-None-Match': '"catalog-old"' },
    });
    expect(result).toEqual({ unchanged: true, etag: '"catalog-old"' });
  });
});
