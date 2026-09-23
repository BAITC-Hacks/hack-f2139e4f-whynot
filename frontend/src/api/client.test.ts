import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

beforeEach(() => {
  vi.resetModules();
  vi.stubEnv('VITE_USE_MOCKS', 'false');
  vi.stubEnv('VITE_API_BASE_URL', '/api/v1');
});
afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs(); });

describe('Сессия и голосовой ввод через API', () => {
  it('использует cookie и не позволяет actorId подменить аккаунт', async () => {
    const fetcher = vi.fn().mockResolvedValue(new Response('[]', { status: 200 }));
    vi.stubGlobal('fetch', fetcher);
    const { api } = await import('./client');
    await api.getMyTasks('another-business-id');
    expect(fetcher).toHaveBeenCalledWith('/api/v1/tasks/mine', expect.objectContaining({ credentials: 'include', method: 'GET' }));
    expect(new Headers(fetcher.mock.calls[0][1].headers).has('X-Actor-ID')).toBe(false);
  });

  it('передаёт аудио как multipart и оставляет boundary браузеру', async () => {
    const fetcher = vi.fn().mockResolvedValue(new Response(JSON.stringify({ text: 'Нужна автоматизация', provider: 'openai' }), { status: 200 }));
    vi.stubGlobal('fetch', fetcher);
    const { api } = await import('./client');
    const result = await api.transcribeAudio(new Blob(['audio'], { type: 'audio/webm' }), 'recording.webm');
    const options = fetcher.mock.calls[0][1] as RequestInit;
    expect(fetcher.mock.calls[0][0]).toBe('/api/v1/ai/transcribe');
    expect(options.credentials).toBe('include');
    expect(new Headers(options.headers).has('Content-Type')).toBe(false);
    expect(options.body).toBeInstanceOf(FormData);
    const file = (options.body as FormData).get('file') as File;
    expect(file.name).toBe('recording.webm');
    expect(result.text).toBe('Нужна автоматизация');
  });

  it('уведомляет об истёкшей сессии только для защищённого запроса', async () => {
    const browser = new EventTarget();
    const expired = vi.fn(); browser.addEventListener('auth:expired', expired);
    vi.stubGlobal('window', browser);
    vi.stubGlobal('fetch', vi.fn().mockImplementation(async () => new Response(JSON.stringify({ error: { code: 'AUTH_REQUIRED' } }), { status: 401 })));
    const { api } = await import('./client');
    await expect(api.login({ email: 'member@example.test', password: 'wrong-password' })).rejects.toMatchObject({ status: 401 });
    expect(expired).not.toHaveBeenCalled();
    await expect(api.getMyTasks('any')).rejects.toMatchObject({ status: 401 });
    expect(expired).toHaveBeenCalledTimes(1);
  });

  it('не имитирует создание аккаунта в демо-режиме', async () => {
    vi.stubEnv('VITE_USE_MOCKS', 'true');
    const fetcher = vi.fn(); vi.stubGlobal('fetch', fetcher);
    const { api } = await import('./client');
    await expect(api.register({ name: 'Бизнес', email: 'member@example.test', password: 'long-password', role: 'business' })).rejects.toMatchObject({ code: 'DEMO_ONLY' });
    expect(fetcher).not.toHaveBeenCalled();
  });
});
