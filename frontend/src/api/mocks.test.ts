import { beforeEach, describe, expect, it } from 'vitest';
import { mockRequest, resetMocks } from './mocks';
import { emptyCard } from '../ui/fields';
import type { CatalogPage, CatalogTask, Milestone, Proposal, Task, Team } from '../types';
beforeEach(resetMocks);
describe('Поведение демонстрационного API',()=>{
 it('подтверждает карточку вручную, сохраняет опубликованный снимок и защищает от старой ревизии',async()=>{
  const created=await mockRequest<Task>('/tasks','business-1','POST',{raw_description:'Нужен прогноз',topic:'retail'});
  let current=await mockRequest<Task>(`/tasks/${created.id}/card`,'business-1','PUT',{expected_revision:1,card:{...emptyCard(),title:'Прогноз',context:'Продажи считают вручную',need:'Ускорить закупки'}});
  expect(current.rating.score).toBe(0);expect(current.rating.preview_score).toBe(20);
  await expect(mockRequest(`/tasks/${current.id}/publish`,'business-1','POST',{expected_revision:current.revision})).rejects.toMatchObject({code:'CONFIRMATION_REQUIRED'});
  current=await mockRequest<Task>(`/tasks/${current.id}/confirm`,'business-1','POST',{expected_revision:current.revision});expect(current.rating.score).toBe(20);
  await mockRequest(`/tasks/${current.id}/publish`,'business-1','POST',{expected_revision:current.revision});
  const changed=await mockRequest<Task>(`/tasks/${current.id}/card`,'business-1','PUT',{expected_revision:current.revision,card:{...current.card,title:'Новое название',data:'CSV'}});
  expect(changed.rating.score).toBe(20);expect(changed.rating.preview_score).toBe(40);expect(changed.confirmed_revision).toBeNull();
  const published=await mockRequest<CatalogTask>(`/catalog/${current.id}`);expect(published.card.title).toBe('Прогноз');expect(published.rating.score).toBe(20);
  await expect(mockRequest(`/tasks/${current.id}/confirm`,'business-1','POST',{expected_revision:current.revision})).rejects.toMatchObject({code:'STALE_REVISION'});
 });
 it('показывает слабые задачи, принимает несколько команд и начисляет этап только один раз',async()=>{
  const catalog=await mockRequest<CatalogPage>('/catalog');const weak=catalog.items.find(t=>t.rating.readiness==='draft')!;expect(weak).toBeDefined();
  const proposal=await mockRequest<Proposal>(`/tasks/${weak.id}/proposals`,'student-2','POST',{idea:'Мой план решения',plan:'Анализ и прототип',timeline:'2 недели',prototype_url:null});
  await expect(mockRequest(`/proposals/${proposal.id}/milestones`,'business-1','POST',{code:'prototype',evidence:'Прототип готов'})).rejects.toMatchObject({code:'TEAM_NOT_SELECTED'});
  await mockRequest(`/proposals/${proposal.id}/decision`,'business-1','POST',{decision:'accepted'});
  await mockRequest('/proposals/demo-proposal-1/decision','business-1','POST',{decision:'accepted'});
  const stage=await mockRequest<Milestone>(`/proposals/${proposal.id}/milestones`,'business-1','POST',{code:'prototype',evidence:'Прототип готов'});
  const repeat=await mockRequest<Milestone>(`/proposals/${proposal.id}/milestones`,'business-1','POST',{code:'prototype',evidence:'Прототип готов'});expect(repeat.id).toBe(stage.id);
  const team=await mockRequest<Team>('/teams/me','student-2');expect(team.points).toBe(20);
  await expect(mockRequest(`/proposals/${proposal.id}/decision`,'business-1','POST',{decision:'rejected'})).rejects.toMatchObject({code:'DECISION_FINAL'});
 });
 it('не раскрывает приватную карточку студенту',async()=>{await expect(mockRequest('/tasks/demo-draft-1','student-1')).rejects.toMatchObject({status:403});await expect(mockRequest('/tasks/mine')).rejects.toMatchObject({status:401})});
});
