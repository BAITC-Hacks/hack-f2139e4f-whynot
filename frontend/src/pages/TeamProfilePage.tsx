import { useEffect, useState, type FormEvent } from 'react';
import { Link } from 'react-router-dom';
import { CheckCircle2, Copy, LogOut, Plus, RefreshCw, Save, ShieldCheck, Users } from 'lucide-react';
import { api, errorMessage, USE_MOCKS } from '../api/client';
import { Badge, Button, Card, ErrorBanner, Input, PageHeader, Skeleton, Tags, Textarea } from '../components/ui';
import { useRole } from '../context/RoleContext';
import { useToast } from '../context/ToastContext';
import { useAsync } from '../hooks/useAsync';
import { completeStudentProfile, uniqueTags } from '../ui/studentProfile';
import type { Team, TeamInput } from '../types';

function TeamForm({team,onSaved}:{team?:Team;onSaved:(team:Team)=>Promise<void>}){
  const {actor}=useRole();
  const [name,setName]=useState(team?.name || ''),[interests,setInterests]=useState(team?.interests.join(', ') || ''),[skills,setSkills]=useState(team?.skills.join(', ') || ''),[technologies,setTechnologies]=useState(team?.technologies.join(', ') || '');
  const [busy,setBusy]=useState(false),[error,setError]=useState(''),[errors,setErrors]=useState<Record<string,string>>({});
  async function save(event:FormEvent){
    event.preventDefault();if(busy||!actor)return;
    const input:TeamInput={name:name.trim(),interests:uniqueTags(interests),skills:uniqueTags(skills),technologies:uniqueTags(technologies)};
    const validation:Record<string,string>={};if(!input.name)validation.name='Введите название команды.';
    for(const key of ['interests','skills','technologies'] as const)if(input[key].length>30||input[key].some(tag=>tag.length>100))validation[key]='До 30 тегов, не длиннее 100 символов каждый.';
    setErrors(validation);if(Object.keys(validation).length)return;setBusy(true);setError('');
    try{const result=team?await api.saveTeam(actor.id,input):await api.createTeam(input);await onSaved(result)}catch(caught){setError(errorMessage(caught))}finally{setBusy(false)}
  }
  return <form className="stack" onSubmit={save}><Input label="Название команды" required maxLength={200} value={name} disabled={busy} onChange={event=>setName(event.target.value)} error={errors.name} placeholder="Например, WhyNot"/><Textarea label="Интересы и отрасли" rows={2} maxLength={3030} value={interests} disabled={busy} onChange={event=>setInterests(event.target.value)} error={errors.interests} placeholder="Образование, retail, логистика" hint="Теги через запятую помогают подобрать задачи."/><Textarea label="Навыки команды" rows={2} maxLength={3030} value={skills} disabled={busy} onChange={event=>setSkills(event.target.value)} error={errors.skills} placeholder="Анализ данных, дизайн, разработка"/><Textarea label="Технологии" rows={2} maxLength={3030} value={technologies} disabled={busy} onChange={event=>setTechnologies(event.target.value)} error={errors.technologies} placeholder="Python, React, Figma, PostgreSQL"/>{error&&<ErrorBanner message={error}/>}<Button type="submit" loading={busy}>{team?<Save size={17}/>:<Plus size={17}/>} {team?'Сохранить профиль команды':'Создать команду'}</Button>{!team&&<p className="muted text-small">Вы станете лидером. Пригласите ещё 2–4 участников: отклики доступны командам из 3–5 человек.</p>}</form>;
}

function JoinTeamForm({onJoined}:{onJoined:()=>Promise<void>}){
  const [name,setName]=useState(''),[inviteCode,setInviteCode]=useState('');
  const [busy,setBusy]=useState(false),[error,setError]=useState('');
  async function join(event:FormEvent){event.preventDefault();if(busy||!name.trim()||!inviteCode.trim())return;setBusy(true);setError('');try{await api.joinTeam(name.trim(),inviteCode.trim());await onJoined()}catch(caught){setError(errorMessage(caught))}finally{setBusy(false)}}
  return <form className="stack" onSubmit={join}><p className="muted">Получите название команды и код у её лидера.</p><Input label="Название команды для вступления" required maxLength={200} disabled={busy} value={name} onChange={event=>setName(event.target.value)}/><Input label="Код приглашения" autoComplete="off" spellCheck={false} required maxLength={100} disabled={busy} value={inviteCode} onChange={event=>setInviteCode(event.target.value)}/>{error&&<ErrorBanner message={error}/>}<Button type="submit" loading={busy}><Users size={17}/>Присоединиться к команде</Button></form>;
}

export function TeamProfilePage(){
  const {actor,team,teamLoading,refreshTeam}=useRole();const {toast}=useToast();
  const profile=useAsync(()=>USE_MOCKS?Promise.resolve(null):api.getStudentProfile(),[actor?.id]);
  const [mode,setMode]=useState<'create'|'join'>('create');
  const [invite,setInvite]=useState<{teamId:string;code:string}|null>(null);
  const [busy,setBusy]=useState(false),[error,setError]=useState(''),[confirmLeave,setConfirmLeave]=useState(false);
  useEffect(()=>{void refreshTeam().catch(()=>{})},[refreshTeam,actor?.id]);
  const leader=!!team&&(team.is_leader ?? team.owner_id===actor?.id);
  const count=team?.member_count ?? team?.members?.length ?? 1;
  const ready=team?.ready ?? (USE_MOCKS || count>=3&&count<=5);
  const code=invite?.teamId===team?.id?invite?.code:'';
  const incomplete=!!profile.data&&!completeStudentProfile(profile.data);
  async function saved(result:Team){if(result.invite_code)setInvite({teamId:result.id,code:result.invite_code});await refreshTeam();toast('Команда сохранена.');}
  async function rotate(){if(busy)return;setBusy(true);setError('');try{const result=await api.rotateTeamInvite();if(team)setInvite({teamId:team.id,code:result.invite_code});toast('Новый код приглашения готов.')}catch(caught){setError(errorMessage(caught))}finally{setBusy(false)}}
  async function leave(){if(busy)return;setBusy(true);setError('');try{await api.leaveTeam();setInvite(null);setConfirmLeave(false);await refreshTeam();toast('Вы вышли из команды.')}catch(caught){setError(errorMessage(caught))}finally{setBusy(false)}}
  async function copy(){if(!code)return;try{await navigator.clipboard.writeText(code);toast('Код скопирован.')}catch{toast('Скопируйте код из поля вручную.','info')}}
  return <div className="page"><PageHeader title="Моя команда" subtitle="Объединитесь в команду из 3–5 человек. Лидер отправляет предложения, вся команда участвует в обсуждении." actions={<Link className="button button-secondary" to="/student/profile">Мой профиль</Link>}/>{USE_MOCKS?<Card><p>Создание команд, приглашения и вступление доступны при подключении к серверу.</p>{team&&<p>Демо-команда: {team.name}</p>}</Card>:teamLoading||profile.loading?<Skeleton lines={7}/>:profile.error?<ErrorBanner message={profile.error} onRetry={profile.reload}/>:<>
    {incomplete&&<div className="notice"><p>Сначала заполните ID студента, телефон, направления и навыки в <Link to="/student/profile">личном профиле</Link>. Это необходимо для участия в команде.</p></div>}
    {!team?(!incomplete&&<Card><div className="tabs" role="group" aria-label="Начать работу в команде"><Button variant={mode==='create'?'primary':'ghost'} onClick={()=>setMode('create')}>Создать команду</Button><Button variant={mode==='join'?'primary':'ghost'} onClick={()=>setMode('join')}>Вступить по коду</Button></div>{mode==='create'?<TeamForm onSaved={saved}/>:<JoinTeamForm onJoined={async()=>{await refreshTeam();toast('Вы присоединились к команде.')}}/>}</Card>):<div className="split-layout"><div className="stack"><Card className="stack"><div className="row between"><div><h2>{team.name}</h2><p className="muted">{count} из 5 участников · {team.points} XP</p></div><Badge>{leader?'Вы — лидер':'Вы — участник'}</Badge></div><div className="notice">{ready?<><CheckCircle2 size={20}/><span>Команда готова. Лидер может отправлять предложения бизнесу.</span></>:<><Users size={20}/><span>Набор команды: для отклика нужно ещё {Math.max(0,3-count)} участника.</span></>}</div><Button variant="secondary" size="sm" onClick={()=>void refreshTeam().catch(()=>{})}><RefreshCw size={15}/>Обновить состав</Button><div className="stack">{(team.members || []).map(member=><section className="team-member" key={member.actor_id}><div className="row between"><strong>{member.name}</strong>{member.is_leader&&<Badge><ShieldCheck size={14}/>Лидер</Badge>}</div>{member.username&&<p className="muted text-small">@{member.username}</p>}<Tags items={member.positions}/>{member.skills.length>0&&<p className="muted text-small">Навыки: {member.skills.join(', ')}</p>}</section>)}</div><Link className="text-link" to="/team/proposals">Отклики и обсуждения команды</Link></Card>
      {leader&&<Card className="stack"><h3>Пригласить участников</h3><p className="muted text-small">Передайте участникам название «{team.name}» и код. Новый код заменяет предыдущий.</p>{code&&<><Input label="Код приглашения команды" readOnly value={code} autoComplete="off" spellCheck={false}/><Button variant="secondary" onClick={()=>void copy()}><Copy size={16}/>Скопировать код</Button></>}<Button variant="secondary" loading={busy} onClick={()=>void rotate()}>Создать новый код приглашения</Button></Card>}
      <Card className="stack"><h3>{leader?'Управление командой':'Участие в команде'}</h3>{leader&&count>1?<p className="muted">Лидер может выйти только из команды без других участников и без откликов.</p>:confirmLeave?<div className="stack"><p>После выхода чат команды станет недоступен. Сохранённые результаты останутся в вашей истории.</p><div className="row"><Button variant="danger" loading={busy} onClick={()=>void leave()}>Подтвердить выход</Button><Button variant="ghost" disabled={busy} onClick={()=>setConfirmLeave(false)}>Отмена</Button></div></div>:<Button variant="ghost" onClick={()=>setConfirmLeave(true)}><LogOut size={16}/>Выйти из команды</Button>}{error&&<ErrorBanner message={error}/>}</Card>
    </div><aside className="stack"><Card className="stack"><h2>Профиль команды</h2>{leader?<TeamForm key={team.id} team={team} onSaved={saved}/>:<><p className="muted text-small">Профиль редактирует лидер команды.</p><h3>Интересы</h3><Tags items={team.interests}/><h3>Навыки</h3><Tags items={team.skills}/><h3>Технологии</h3><Tags items={team.technologies}/></>}</Card><Card><Link className="text-link" to="/recommendations">Найти подходящие задачи</Link><p className="muted text-small">Решение по предложению принимает бизнес. Низкий рейтинг задачи не мешает отправить отклик.</p></Card></aside></div>}
  </>}</div>;
}
