import { useId, useState } from 'react';
import { AlertCircle, CheckCircle2, Circle, CircleHelp, Eye, EyeOff, Loader2, ShieldCheck } from 'lucide-react';
import { usePasswordStrength } from '../hooks/usePasswordStrength';
import { passwordLength } from '../ui/passwordStrength';
import { Input } from './ui';

function PasswordInput({label,value,onChange,disabled,describedBy}:{label:string;value:string;onChange:(value:string)=>void;disabled?:boolean;describedBy?:string}){
  const [visible,setVisible]=useState(false);
  return <div className="password-input"><Input label={label} type={visible?'text':'password'} autoComplete="new-password" autoCapitalize="none" autoCorrect="off" spellCheck={false} required disabled={disabled} value={value} onChange={event=>onChange(event.target.value)} aria-describedby={describedBy}/><button className="password-visibility" type="button" disabled={disabled} onClick={()=>setVisible(current=>!current)} aria-label={`${visible?'Скрыть':'Показать'}: ${label.toLowerCase()}`} aria-pressed={visible}>{visible?<EyeOff size={18}/>:<Eye size={18}/>}</button></div>;
}

export function NewPasswordFields({password,confirmation,onPasswordChange,onConfirmationChange,label='Пароль',disabled=false}:{password:string;confirmation:string;onPasswordChange:(value:string)=>void;onConfirmationChange:(value:string)=>void;label?:string;disabled?:boolean}){
  const check=usePasswordStrength(password);
  const descriptionId=useId();
  const result=check.result;
  const length=passwordLength(password);
  const level=result?.level;
  const labelText=check.status==='idle'?'Выберите пароль':check.status==='pending'?'Проверяем пароль…':check.status==='error'?'Не проверен':result?.label || 'Не проверен';
  const Icon=check.status==='pending'?Loader2:check.status==='error'?CircleHelp:level==='strong'?ShieldCheck:level==='weak'?AlertCircle:level==='fair'?CircleHelp:Circle;
  const checks: Array<{code:string;message:string;passed:boolean|null}>=result?.checks || [
    {code:'min_length',message:'Не менее 15 символов',passed:password?length>=15:null},
    {code:'max_length',message:'Не более 128 символов',passed:password?length<=128:null},
    {code:'not_common',message:'Не входит в список распространённых паролей',passed:null},
  ];
  return <>
    <PasswordInput label={label} value={password} onChange={onPasswordChange} disabled={disabled} describedBy={descriptionId}/>
    <div id={descriptionId} className={`password-strength ${level?'password-strength-'+level:'password-strength-neutral'}`}>
      <div className="password-strength-heading" role="status" aria-live="polite" aria-atomic="true"><strong><Icon size={17} className={check.status==='pending'?'spin':undefined} aria-hidden="true"/>{labelText}</strong><span>{length} / 128 символов</span></div>
      <div className="password-strength-bars" role={result?'meter':undefined} aria-label={result?'Надёжность пароля':undefined} aria-valuemin={result?0:undefined} aria-valuemax={result?4:undefined} aria-valuenow={result?.score} aria-valuetext={result?.label} aria-hidden={result?undefined:true}>{[0,1,2,3,4].map(index=><span key={index} className={result&&index<=result.score?'is-filled':''}/>)}</div>
      <ul className="password-requirements">{checks.map(item=>{const CheckIcon=item.passed===true?CheckCircle2:item.passed===false?AlertCircle:Circle;return <li key={item.code} className={item.passed===null?'is-unknown':item.passed?'is-passed':'is-failed'}><CheckIcon size={14} aria-hidden="true"/><span><span className="sr-only">{item.passed===null?'Пока не проверено. ':item.passed?'Выполнено. ':'Не выполнено. '}</span>{item.message}</span></li>})}</ul>
      {check.status==='error'?<p className="muted text-small">Не удалось проверить надёжность. Можно отправить форму — пароль будет проверен при сохранении.</p>:result&&<p className="muted text-small">{result.acceptable?'Минимальные требования выполнены. Оценка показывает, насколько легко угадать пароль.':'Выполните требования выше перед сохранением.'}</p>}
      {result?.suggestions.length?<ul className="password-suggestions">{result.suggestions.map((suggestion,index)=><li key={index}>{suggestion}</li>)}</ul>:<p className="muted text-small">Подойдут несколько несвязанных слов. Разрешены пробелы и символы разных языков; специальные символы не обязательны.</p>}
    </div>
    <PasswordInput label="Повторите пароль" value={confirmation} onChange={onConfirmationChange} disabled={disabled}/>
  </>;
}
