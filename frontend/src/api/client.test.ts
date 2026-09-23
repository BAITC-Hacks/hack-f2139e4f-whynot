import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

beforeEach(() => {
  vi.resetModules();
  vi.stubEnv('VITE_USE_MOCKS', 'false');
  vi.stubEnv('VITE_API_BASE_URL', '/api/v1');
});
afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs(); });

describe('Сессия и голосовой ввод через API', () => {
  it('проверяет пароль через JSON POST своего backend без URL-параметров и кеширования',async()=>{
    const fetcher=vi.fn().mockResolvedValue(new Response('{}',{status:200}));vi.stubGlobal('fetch',fetcher);
    const {api}=await import('./client');const candidate='  Unicode e\u0301 phrase  ';await api.passwordStrength(candidate);
    expect(fetcher.mock.calls[0][0]).toBe('/api/v1/auth/password-strength');expect(fetcher.mock.calls[0][1]).toMatchObject({method:'POST',credentials:'include',cache:'no-store'});expect(JSON.parse(fetcher.mock.calls[0][1].body)).toEqual({password:candidate});
  });
  it('отменяет preview пароля по внешнему сигналу без ошибки таймаута',async()=>{
    vi.stubGlobal('fetch',vi.fn().mockImplementation((_url:string,options:RequestInit)=>new Promise((_resolve,reject)=>{options.signal?.addEventListener('abort',()=>reject(new DOMException('aborted','AbortError')),{once:true})})));
    const {api}=await import('./client');const controller=new AbortController();const request=api.passwordStrength('test candidate',controller.signal);controller.abort();await expect(request).rejects.toMatchObject({name:'AbortError'});
  });
  it('передаёт профиль студента при регистрации и код приглашения через JSON POST',async()=>{
    const fetcher=vi.fn().mockImplementation(async()=>new Response('{}',{status:200}));vi.stubGlobal('fetch',fetcher);
    const {api}=await import('./client');
    const input={name:'Student',email:'student@example.test',password:'test-password-long',role:'student' as const,username:'student_1',phone:'+77001234567',positions:['Backend','Frontend'],skills:['Python','React']};
    await api.register(input);expect(JSON.parse(fetcher.mock.calls[0][1].body)).toEqual(input);
    await api.joinTeam('Team Name','invite-code');
    expect(fetcher.mock.calls[1][0]).toBe('/api/v1/teams/join');expect(fetcher.mock.calls[1][1]).toMatchObject({method:'POST',credentials:'include'});expect(JSON.parse(fetcher.mock.calls[1][1].body)).toEqual({name:'Team Name',invite_code:'invite-code'});
  });
  it('запрашивает переписку с независимым курсором и не включает контакты в URL',async()=>{
    const fetcher=vi.fn().mockImplementation(async()=>new Response('{}',{status:200}));vi.stubGlobal('fetch',fetcher);
    const {api}=await import('./client');
    await api.getMessages('proposal/one',123,50);expect(fetcher.mock.calls[0][0]).toBe('/api/v1/proposals/proposal%2Fone/messages?after_id=123&limit=50');
    await api.sendMessage('proposal/one','Обсудим результат');expect(fetcher.mock.calls[1][1]).toMatchObject({method:'POST',credentials:'include'});expect(JSON.parse(fetcher.mock.calls[1][1].body)).toEqual({body:'Обсудим результат'});
    await api.getProposalContact('proposal/one');expect(fetcher.mock.calls[2][0]).toBe('/api/v1/proposals/proposal%2Fone/contact');
  });
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
    await expect(api.joinTeam('Team','code')).rejects.toMatchObject({code:'DEMO_ONLY'});
    await expect(api.sendMessage('proposal','message')).rejects.toMatchObject({code:'DEMO_ONLY'});
    expect(fetcher).not.toHaveBeenCalled();
  });
});
