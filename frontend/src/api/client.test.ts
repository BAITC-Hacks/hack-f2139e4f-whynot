import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const fetchMock = vi.fn<typeof fetch>();
beforeEach(() => {
  vi.resetModules();
  vi.stubEnv('VITE_USE_MOCKS', 'false');
  vi.stubEnv('VITE_API_BASE_URL', '/api/v1');
  vi.stubGlobal('fetch', fetchMock);
  fetchMock.mockReset();
});
afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs(); });
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status });

describe('Настоящий API: сессия и новые функции', () => {
  it('отправляет cookie, не подменяет аккаунт демо-заголовком', async () => {
    fetchMock.mockResolvedValue(json([]));
    const { api } = await import('./client');
    await api.getMyTasks('business-1');
    expect(fetchMock).toHaveBeenCalledWith('/api/v1/tasks/mine', expect.objectContaining({ credentials: 'include' }));
    const headers = new Headers(fetchMock.mock.calls[0][1]?.headers);
    expect(headers.has('X-Actor-ID')).toBe(false);
  });
  it('сохраняет полные ответы и передаёт только последние 40 вопросов задачи', async () => {
    fetchMock.mockImplementation(async url => json(String(url).endsWith('/auth/me') ? { actor: { id: 'actor' } } : {}));
    const { api } = await import('./client');
    const questions = Array.from({ length: 45 }, (_, i) => ({ field: 'data' as const, question: `Вопрос ${i}` }));
    await api.assistTask('actor', 'task/id', { data: 'CSV продаж.\nДанные за год.' }, questions);
    expect(fetchMock.mock.calls[1][0]).toBe('/api/v1/tasks/task%2Fid/assist');
    expect(JSON.parse(fetchMock.mock.calls[1][1]?.body as string)).toEqual({ answers: { data: 'CSV продаж.\nДанные за год.' }, previous_questions: questions.slice(-40) });
  });
  it('отправляет аудио как multipart, позволяя браузеру задать boundary', async () => {
    fetchMock.mockImplementation(async url => json(String(url).endsWith('/auth/me') ? { actor: { id: 'actor' } } : { text: 'Нужен прогноз', provider: 'openai' }));
    const { api } = await import('./client');
    const file = new File(['audio-test'], 'recording.webm', { type: 'audio/webm' });
    await expect(api.transcribeAudio('actor', file)).resolves.toEqual({ text: 'Нужен прогноз', provider: 'openai' });
    const [, options] = fetchMock.mock.calls[1];
    expect(options?.body).toBeInstanceOf(FormData);
    expect((options?.body as FormData).get('file')).toBe(file);
    expect(new Headers(options?.headers).has('Content-Type')).toBe(false);
    expect(options?.credentials).toBe('include');
  });
  it('различает отсутствие сессии при запуске и истечение сессии в кабинете', async () => {
    fetchMock.mockImplementation(async () => json({ error: { code: 'LOGIN_REQUIRED', message: 'Войдите' } }, 401));
    const { api, subscribeSessionExpired } = await import('./client');
    const expired = vi.fn();
    const unsubscribe = subscribeSessionExpired(expired);
    await expect(api.getSession()).rejects.toMatchObject({ code: 'LOGIN_REQUIRED' });
    expect(expired).not.toHaveBeenCalled();
    await expect(api.getBusinessProfile('actor')).rejects.toMatchObject({ code: 'LOGIN_REQUIRED' });
    expect(expired).toHaveBeenCalledTimes(1);
    unsubscribe();
  });
  it('старый ответ 401 не сбрасывает уже открытый новый аккаунт', async () => {
    let finishOld!: (response: Response) => void;
    fetchMock.mockImplementationOnce(() => new Promise<Response>(resolve => { finishOld = resolve; }));
    const { api, subscribeSessionExpired } = await import('./client');
    const expired = vi.fn();
    const unsubscribe = subscribeSessionExpired(expired);
    const oldRequest = api.getMyTasks('old');
    fetchMock.mockResolvedValue(json({ actor: { id: 'new', role: 'student', name: 'Команда' } }));
    await api.login({ email: 'qa@example.test', password: 'test-password-only' });
    finishOld(json({ error: { code: 'LOGIN_REQUIRED', message: 'Войдите' } }, 401));
    await expect(oldRequest).rejects.toMatchObject({ code: 'LOGIN_REQUIRED' });
    expect(expired).not.toHaveBeenCalled();
    unsubscribe();
  });
  it('фоновая смена аккаунта защищает новую сессию от старого 401, но не скрывает её собственное истечение', async () => {
    let finishOld!: (response: Response) => void;
    fetchMock.mockImplementationOnce(() => new Promise<Response>(resolve => { finishOld = resolve; }));
    const { api, invalidateSessionRequests, subscribeSessionExpired } = await import('./client');
    const expired = vi.fn();
    const unsubscribe = subscribeSessionExpired(expired);
    const oldRequest = api.getMyTasks('account-A');
    fetchMock.mockResolvedValueOnce(json({ actor: { id: 'account-B', role: 'business', name: 'Компания B' } }));
    const session = await api.getSession();
    expect(session.actor.id).toBe('account-B');
    // RoleContext applies this epoch change after focus/BroadcastChannel discovers B.
    invalidateSessionRequests();
    expect(expired).not.toHaveBeenCalled();
    finishOld(json({ error: { code: 'LOGIN_REQUIRED', message: 'Войдите' } }, 401));
    await expect(oldRequest).rejects.toMatchObject({ code: 'LOGIN_REQUIRED' });
    expect(expired).not.toHaveBeenCalled();
    fetchMock.mockResolvedValueOnce(json({ error: { code: 'LOGIN_REQUIRED', message: 'Войдите' } }, 401));
    await expect(api.getMyTasks('account-B')).rejects.toMatchObject({ code: 'LOGIN_REQUIRED' });
    expect(expired).toHaveBeenCalledTimes(1);
    unsubscribe();
  });
  it('отменяет сохранение, если аккаунт сменился во время проверки сессии', async () => {
    let finishCheck!: (response: Response) => void;
    fetchMock.mockImplementationOnce(() => new Promise<Response>(resolve => { finishCheck = resolve; }));
    const { api, invalidateSessionRequests, subscribeSessionExpired } = await import('./client');
    const expired = vi.fn();
    const unsubscribe = subscribeSessionExpired(expired);
    const oldSave = api.createTask('account-A', { raw_description: 'Описание аккаунта A', topic: 'retail' });
    fetchMock.mockResolvedValueOnce(json({ actor: { id: 'account-B', role: 'business', name: 'Компания B' } }));
    await api.getSession();
    invalidateSessionRequests();
    // A late preflight can still report A; its epoch must prevent the POST.
    finishCheck(json({ actor: { id: 'account-A', role: 'business', name: 'Компания A' } }));
    await expect(oldSave).rejects.toMatchObject({ code: 'SESSION_CHANGED' });
    expect(fetchMock.mock.calls.map(([url]) => url)).toEqual(['/api/v1/auth/me', '/api/v1/auth/me']);
    expect(expired).not.toHaveBeenCalled();
    unsubscribe();
  });
  it('не сохраняет форму предыдущего аккаунта после смены общей cookie', async () => {
    fetchMock.mockResolvedValue(json({ actor: { id: 'account-B' } }));
    const { api, subscribeSessionExpired } = await import('./client');
    const expired = vi.fn();
    const unsubscribe = subscribeSessionExpired(expired);
    await expect(api.createTask('account-A', { raw_description: 'Приватное описание A', topic: 'retail' })).rejects.toMatchObject({ code: 'SESSION_CHANGED' });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0][0]).toBe('/api/v1/auth/me');
    expect(expired).toHaveBeenCalledTimes(1);
    unsubscribe();
  });
  it('сохраняет явное отключение истории и использует пагинацию сервера', async () => {
    fetchMock.mockImplementation(async url => json(String(url).endsWith('/auth/me') ? { actor: { id: 'actor' } } : { items: [], total: 0, limit: 20, offset: 20 }));
    const { api } = await import('./client');
    await api.saveBusinessProfile('actor', { company_name: 'Компания', industry: '', description: '', goals: '', values: '', use_history_for_ai: false });
    expect(JSON.parse(fetchMock.mock.calls[1][1]?.body as string).use_history_for_ai).toBe(false);
    await api.getStudentHistory('actor', 20, 20);
    expect(fetchMock.mock.calls[2][0]).toBe('/api/v1/students/history?limit=20&offset=20');
  });
});
