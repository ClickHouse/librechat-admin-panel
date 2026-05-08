import { describe, it, expect, beforeEach, vi } from 'vitest';

const ensureFreshBearer = vi.fn();
const refreshOn401 = vi.fn();

vi.mock('./refresh', () => ({
  ensureFreshBearer: (...args: unknown[]) => ensureFreshBearer(...args),
  refreshOn401: (...args: unknown[]) => refreshOn401(...args),
}));

import { apiFetch } from './api';

const fetchMock = vi.fn();

beforeEach(() => {
  fetchMock.mockReset();
  ensureFreshBearer.mockReset();
  refreshOn401.mockReset();
  vi.stubGlobal('fetch', fetchMock);
});

function jsonResponse(status: number, body: unknown = {}): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

describe('apiFetch', () => {
  it('throws when no bearer is available', async () => {
    ensureFreshBearer.mockResolvedValueOnce(undefined);
    await expect(apiFetch('/api/admin/grants')).rejects.toThrow(/No admin session token/);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('sends Authorization with the bearer returned by ensureFreshBearer', async () => {
    ensureFreshBearer.mockResolvedValueOnce('jwt-fresh');
    fetchMock.mockResolvedValueOnce(jsonResponse(200));

    await apiFetch('/api/admin/grants');

    const [, init] = fetchMock.mock.calls[0];
    const headers = (init as RequestInit).headers as Record<string, string>;
    expect(headers.Authorization).toBe('Bearer jwt-fresh');
    expect(refreshOn401).not.toHaveBeenCalled();
  });

  it('passes through the proactive-refresh skew window of 30s', async () => {
    ensureFreshBearer.mockResolvedValueOnce('jwt-fresh');
    fetchMock.mockResolvedValueOnce(jsonResponse(200));
    await apiFetch('/api/admin/grants');
    expect(ensureFreshBearer).toHaveBeenCalledWith(30_000);
  });

  it('retries exactly once on 401, using the refreshed bearer', async () => {
    ensureFreshBearer.mockResolvedValueOnce('jwt-stale');
    refreshOn401.mockResolvedValueOnce('jwt-fresh');
    fetchMock
      .mockResolvedValueOnce(jsonResponse(401, { error: 'expired' }))
      .mockResolvedValueOnce(jsonResponse(200, { ok: true }));

    const response = await apiFetch('/api/admin/grants');

    expect(response.status).toBe(200);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(refreshOn401).toHaveBeenCalledTimes(1);

    const [, init1] = fetchMock.mock.calls[0];
    const [, init2] = fetchMock.mock.calls[1];
    expect((init1 as RequestInit).headers).toMatchObject({ Authorization: 'Bearer jwt-stale' });
    expect((init2 as RequestInit).headers).toMatchObject({ Authorization: 'Bearer jwt-fresh' });
  });

  it('does not retry when the second response is also 401', async () => {
    ensureFreshBearer.mockResolvedValueOnce('jwt-stale');
    refreshOn401.mockResolvedValueOnce('jwt-fresh');
    fetchMock
      .mockResolvedValueOnce(jsonResponse(401))
      .mockResolvedValueOnce(jsonResponse(401, { error: 'still bad' }));

    const response = await apiFetch('/api/admin/grants');

    expect(response.status).toBe(401);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(refreshOn401).toHaveBeenCalledTimes(1);
  });

  it('returns the original 401 when refreshOn401 fails', async () => {
    ensureFreshBearer.mockResolvedValueOnce('jwt-stale');
    refreshOn401.mockResolvedValueOnce(undefined);
    const expired = jsonResponse(401, { error: 'expired' });
    fetchMock.mockResolvedValueOnce(expired);

    const response = await apiFetch('/api/admin/grants');

    expect(response.status).toBe(401);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('does not call refreshOn401 on non-401 errors', async () => {
    ensureFreshBearer.mockResolvedValueOnce('jwt-fresh');
    fetchMock.mockResolvedValueOnce(jsonResponse(500, { error: 'server' }));

    const response = await apiFetch('/api/admin/grants');

    expect(response.status).toBe(500);
    expect(refreshOn401).not.toHaveBeenCalled();
  });

  it('lets caller-supplied headers be overridden by the Authorization header', async () => {
    ensureFreshBearer.mockResolvedValueOnce('jwt-fresh');
    fetchMock.mockResolvedValueOnce(jsonResponse(200));

    await apiFetch('/api/admin/grants', {
      method: 'POST',
      headers: { Authorization: 'Bearer attacker', 'X-Custom': 'keep-me' },
    });

    const [, init] = fetchMock.mock.calls[0];
    const headers = (init as RequestInit).headers as Record<string, string>;
    expect(headers.Authorization).toBe('Bearer jwt-fresh');
    expect(headers['X-Custom']).toBe('keep-me');
  });
});
