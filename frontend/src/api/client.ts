import type { Actor, AssistResult, CardData, CardField, CatalogFilters, CatalogPage, CatalogTask, Milestone, MilestoneCode, Proposal, ProposalInput, Question, Task, TaskCreateInput, Team, TeamInput } from '../types';
import { ApiError } from './errors';
export { ApiError, errorMessage } from './errors';
export const USE_MOCKS = import.meta.env.VITE_USE_MOCKS === 'true';
export const API_BASE_URL = (import.meta.env.VITE_API_BASE_URL || (import.meta.env.VITE_API_URL ? `${import.meta.env.VITE_API_URL.replace(/\/$/,'')}/api/v1` : '/api/v1')).replace(/\/$/,'');
const messages:Record<string,string>={STALE_REVISION:'Карточка была изменена. Загрузите актуальную версию и сравните её со своими правками.',CONFIRMATION_REQUIRED:'Сначала подтвердите текущую редакцию карточки.',TEAM_REQUIRED:'Создайте профиль команды, чтобы отправлять предложения.',DECISION_FINAL:'Решение по этому отклику уже принято. Его нельзя изменить.',TEAM_NOT_SELECTED:'Подтверждать этапы можно только у принятых предложений.',MILESTONE_EXISTS:'Этот этап уже подтверждён с другим описанием результата.',ACTOR_REQUIRED:'Выберите демо-пользователя в шапке.',BUSINESS_REQUIRED:'Это действие доступно только бизнесу.',STUDENT_REQUIRED:'Это действие доступно только команде.',AUTH_NOT_CONFIGURED:'Демо-вход выключен на сервере. Обратитесь к владельцу backend.',CARD_LABELS_REQUIRED:'Укажите название задачи и тему перед публикацией.',VALIDATION_ERROR:'Проверьте обязательные поля, длину текста и корректность ссылки.',TASK_NOT_FOUND:'Задача не найдена или недоступна выбранному пользователю.',PROPOSAL_NOT_FOUND:'Отклик не найден или недоступен выбранному пользователю.'};
Object.assign(messages, {
 AUTH_REQUIRED:'Войдите в аккаунт, чтобы продолжить.', ACTOR_REQUIRED:'Войдите в аккаунт, чтобы продолжить.',
 INVALID_CREDENTIALS:'Неверный email или пароль.', EMAIL_TAKEN:'Этот email уже зарегистрирован. Войдите или восстановите пароль.',
 EMAIL_EXISTS:'Этот email уже зарегистрирован. Войдите или восстановите пароль.',
 INVALID_RESET_TOKEN:'Ссылка восстановления недействительна или уже использована. Запросите новую.',
 LOGIN_REQUIRED:'Войдите в аккаунт, чтобы продолжить.', ACCOUNT_EXISTS:'Этот email уже зарегистрирован. Войдите или восстановите пароль.',
 INVALID_RESET:'Ссылка восстановления недействительна или уже использована. Запросите новую.',
 UNTRUSTED_ORIGIN:'Сервер не разрешает запросы с этого адреса сайта. Проверьте настройки приложения.',
 RATE_LIMITED:'Слишком много попыток. Подождите немного и повторите.',
 OPENAI_NOT_CONFIGURED:'Голосовой ввод пока не настроен. Вы можете заполнить описание текстом.',
});
async function request<T>(path:string,actorId?:string,method='GET',body?:unknown,timeoutMs=45000):Promise<T>{
 if(USE_MOCKS && (path.startsWith('/auth/') || path==='/ai/transcribe'))throw new ApiError('Регистрация и голосовой ввод доступны при подключении к серверу. Сейчас включён демонстрационный режим.','DEMO_ONLY');
 if(USE_MOCKS){try{const {mockRequest}=await import('./mocks');return await mockRequest<T>(path,actorId,method,body)}catch(error){throw error instanceof ApiError?error:new ApiError('Не удалось обработать запрос в мок-режиме.')}}
 const multipart=typeof FormData!=='undefined' && body instanceof FormData;
 const abort=new AbortController();const timeout=setTimeout(()=>abort.abort(),timeoutMs);
 try {
  const response=await fetch(API_BASE_URL+path,{method,credentials:'include',headers:{Accept:'application/json',...(body!==undefined&&!multipart?{'Content-Type':'application/json'}:{})},body:body===undefined?undefined:multipart?body as FormData:JSON.stringify(body),signal:abort.signal});
  if(response.status===401&&!path.startsWith('/auth/')&&typeof window!=='undefined')window.dispatchEvent(new Event('auth:expired'));
  let payload:unknown;try{payload=await response.json()}catch{throw new ApiError('Сервер вернул некорректный ответ. Проверьте адрес API.','INVALID_RESPONSE',response.status)}
  if(!response.ok){const details=(payload as {error?:{code?:string;message?:string}})?.error;const code=details?.code||'REQUEST_FAILED';const text=messages[code]||(details?.message&&/[А-Яа-яЁё]/.test(details.message)?details.message:`Не удалось выполнить запрос (код ${response.status}). Попробуйте ещё раз.`);throw new ApiError(text,code,response.status)}
  return payload as T;
 } catch(error){if(error instanceof ApiError)throw error;if(error instanceof DOMException&&error.name==='AbortError')throw new ApiError('Сервер отвечает слишком долго. Попробуйте ещё раз.','TIMEOUT');throw new ApiError('Нет соединения с сервером. Проверьте, что backend запущен, и повторите запрос.','NETWORK_ERROR')}
 finally{clearTimeout(timeout)}
}
export { request as apiRequest };
const id=(value:string)=>encodeURIComponent(value);
export const api={
 me:()=>request<{actor:Actor}>('/auth/me'),
 login:(input:{email:string;password:string})=>request<{actor:Actor}>('/auth/login',undefined,'POST',input),
 register:(input:{name:string;email:string;password:string;role:Actor['role']})=>request<{actor:Actor}>('/auth/register',undefined,'POST',input),
 logout:()=>request<{message:string}>('/auth/logout',undefined,'POST'),
 forgotPassword:(email:string)=>request<{message:string;delivery?:'file'|'smtp'}>('/auth/forgot-password',undefined,'POST',{email}),
 resetPassword:(token:string,password:string)=>request<{message:string}>('/auth/reset-password',undefined,'POST',{token,password}),
 transcribeAudio:(file:Blob,filename:string)=>{const form=new FormData();form.append('file',file,filename);return request<{text:string;provider:'openai'}>('/ai/transcribe',undefined,'POST',form,65000)},
 getActors:()=>request<Actor[]>('/demo/actors'),
 createTask:(actorId:string,input:TaskCreateInput)=>request<Task>('/tasks',actorId,'POST',input),
 getMyTasks:(actorId:string)=>request<Task[]>('/tasks/mine',actorId),
 getTask:(actorId:string,taskId:string)=>request<Task>(`/tasks/${id(taskId)}`,actorId),
 assistTask:(actorId:string,taskId:string,answers:Partial<Record<CardField,string>>={},previousQuestions:Question[]=[])=>request<AssistResult>(`/tasks/${id(taskId)}/assist`,actorId,'POST',{answers,previous_questions:previousQuestions}),
 updateCard:(actorId:string,taskId:string,card:CardData,revision:number)=>request<Task>(`/tasks/${id(taskId)}/card`,actorId,'PUT',{card,expected_revision:revision}),
 confirmTask:(actorId:string,taskId:string,revision:number)=>request<Task>(`/tasks/${id(taskId)}/confirm`,actorId,'POST',{expected_revision:revision}),
 publishTask:(actorId:string,taskId:string,revision:number)=>request<Task>(`/tasks/${id(taskId)}/publish`,actorId,'POST',{expected_revision:revision}),
 getCatalog:(filters:CatalogFilters={})=>{const search=new URLSearchParams();Object.entries(filters).forEach(([key,value])=>{if(value!==undefined&&value!=='')search.set(key,String(value))});return request<CatalogPage>('/catalog'+(search.size?'?'+search:''))},
 getCatalogTask:(taskId:string)=>request<CatalogTask>(`/catalog/${id(taskId)}`),
 getTeams:()=>request<Team[]>('/teams'),
 getMyTeam:(actorId:string)=>request<Team>('/teams/me',actorId),
 saveTeam:(actorId:string,input:TeamInput)=>request<Team>('/teams/me',actorId,'PUT',input),
 createProposal:(actorId:string,taskId:string,input:ProposalInput)=>request<Proposal>(`/tasks/${id(taskId)}/proposals`,actorId,'POST',input),
 getTaskProposals:(actorId:string,taskId:string)=>request<Proposal[]>(`/tasks/${id(taskId)}/proposals`,actorId),
 getMyProposals:(actorId:string)=>request<Proposal[]>('/proposals/mine',actorId),
 decideProposal:(actorId:string,proposalId:string,decision:'accepted'|'rejected',note='')=>request<Proposal>(`/proposals/${id(proposalId)}/decision`,actorId,'POST',{decision,note}),
 getMilestones:(actorId:string,proposalId:string)=>request<Milestone[]>(`/proposals/${id(proposalId)}/milestones`,actorId),
 confirmMilestone:(actorId:string,proposalId:string,code:MilestoneCode,evidence:string)=>request<Milestone>(`/proposals/${id(proposalId)}/milestones`,actorId,'POST',{code,evidence}),
};
