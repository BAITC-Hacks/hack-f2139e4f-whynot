import { useEffect, useRef, useState, type FormEvent } from 'react';
import { Link } from 'react-router-dom';
import { CheckCircle2, Save } from 'lucide-react';
import { api, errorMessage, USE_MOCKS } from '../api/client';
import { Card, Button, ErrorBanner, PageHeader, Skeleton } from '../components/ui';
import { StudentProfileFields } from '../components/StudentProfileFields';
import { useAsync } from '../hooks/useAsync';
import { useRole } from '../context/RoleContext';
import { studentDraft, studentProfileInput, validateStudentProfile, type StudentProfileErrors } from '../ui/studentProfile';
import type { StudentProfile } from '../types';

function ProfileForm({profile}:{profile:StudentProfile}) {
  const [draft,setDraft]=useState(()=>studentDraft(profile));
  const [errors,setErrors]=useState<StudentProfileErrors>({});
  const [error,setError]=useState(''),[busy,setBusy]=useState(false),[saved,setSaved]=useState(false);
  const {refreshTeam}=useRole();
  const active=useRef(true);
  useEffect(()=>{active.current=true;return()=>{active.current=false}},[]);
  async function submit(event:FormEvent){
    event.preventDefault();if(busy)return;const input=studentProfileInput(draft),validation=validateStudentProfile(input);setErrors(validation);if(Object.keys(validation).length)return;
    setBusy(true);setError('');setSaved(false);
    try{const result=await api.saveStudentProfile(input);if(!active.current)return;setDraft(studentDraft(result));setSaved(true);await refreshTeam();}catch(caught){if(active.current)setError(errorMessage(caught))}finally{if(active.current)setBusy(false)}
  }
  return <Card><form className="stack" onSubmit={submit}><StudentProfileFields value={draft} onChange={value=>{setDraft(value);setSaved(false)}} errors={errors} disabled={busy}/>{error&&<ErrorBanner message={error}/>}<Button type="submit" loading={busy}><Save size={17}/>Сохранить профиль</Button>{saved&&<p className="notice" role="status"><CheckCircle2 size={18}/>Профиль сохранён. Теперь можно создать команду или присоединиться к ней.</p>}<Link className="text-link" to="/team/profile">Перейти к моей команде</Link></form></Card>;
}
export function StudentProfilePage(){
  const {actor}=useRole();
  const request=useAsync(()=>USE_MOCKS?Promise.resolve(null):api.getStudentProfile(),[actor?.id]);
  return <div className="page" style={{maxWidth:760,marginInline:'auto'}}><PageHeader title="Мой профиль" subtitle="Контакты, направления работы и навыки для участия в команде."/>{USE_MOCKS?<Card>Личный профиль доступен при подключении к серверу.</Card>:request.loading?<Skeleton lines={7}/>:request.error?<ErrorBanner message={request.error} onRetry={request.reload}/>:request.data&&<ProfileForm key={actor?.id} profile={request.data}/>}</div>;
}
