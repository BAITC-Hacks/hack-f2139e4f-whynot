import { useCallback, useEffect, useRef, useState, type FormEvent } from 'react';
import { MessageSquare, Send } from 'lucide-react';
import { api, ApiError, errorMessage, USE_MOCKS } from '../api/client';
import { useRole } from '../context/RoleContext';
import { Badge, Button, ErrorBanner, Skeleton, Textarea } from './ui';
import { mergeMessages, messageCursor, messageTime } from '../ui/conversation';
import type { Proposal, ProposalContact, ProposalMessage } from '../types';

function Conversation({proposal}:{proposal:Proposal}){
  const {actor}=useRole();
  const [messages,setMessages]=useState<ProposalMessage[]>([]),[loading,setLoading]=useState(true),[fetching,setFetching]=useState(false),[hasMore,setHasMore]=useState(false),[error,setError]=useState('');
  const [draft,setDraft]=useState(''),[sending,setSending]=useState(false),[sendError,setSendError]=useState(''),[readOnly,setReadOnly]=useState(false);
  const mounted=useRef(false),generation=useRef(0),cursor=useRef(0),inflight=useRef(false),sendLocked=useRef(false),more=useRef(false),denied=useRef(false);
  const fetchPage=useCallback(async()=>{
    if(inflight.current||!mounted.current||denied.current)return;
    inflight.current=true;setFetching(true);const current=generation.current;
    try{const result=await api.getMessages(proposal.id,cursor.current);if(!mounted.current||current!==generation.current)return;cursor.current=messageCursor(cursor.current,result.items);setMessages(previous=>mergeMessages(previous,result.items));more.current=result.has_more;setHasMore(result.has_more);setError('')}
    catch(caught){if(mounted.current&&current===generation.current){setError(errorMessage(caught));if(caught instanceof ApiError&&[403,404].includes(caught.status))denied.current=true}}
    finally{if(mounted.current&&current===generation.current){inflight.current=false;setFetching(false);setLoading(false)}}
  },[proposal.id]);
  useEffect(()=>{mounted.current=true;generation.current++;cursor.current=0;inflight.current=false;more.current=false;denied.current=false;setMessages([]);setLoading(true);void fetchPage();const timer=setInterval(()=>{if(!more.current)void fetchPage()},5000);return()=>{mounted.current=false;generation.current++;clearInterval(timer)}},[fetchPage]);
  async function send(event:FormEvent){
    event.preventDefault();const body=draft.trim();if(!body||body.length>4000||sendLocked.current||proposal.status==='rejected'||readOnly||denied.current)return;
    sendLocked.current=true;setSending(true);setSendError('');const current=generation.current;
    try{const result=await api.sendMessage(proposal.id,body);if(!mounted.current||current!==generation.current)return;setMessages(previous=>mergeMessages(previous,[result]));setDraft('');void fetchPage()}
    catch(caught){if(mounted.current&&current===generation.current){setSendError(errorMessage(caught));if(caught instanceof ApiError&&caught.code==='CHAT_READ_ONLY')setReadOnly(true);if(caught instanceof ApiError&&[403,404].includes(caught.status))denied.current=true}}
    finally{sendLocked.current=false;if(mounted.current&&current===generation.current)setSending(false)}
  }
  const closed=proposal.status==='rejected'||readOnly;
  return <section className="proposal-conversation stack" aria-label="Переписка по предложению">
    <p className="muted text-small">Обсуждение доступно бизнесу и текущим участникам команды. Открытый чат проверяет новые сообщения каждые 5 секунд.</p>
    {loading?<Skeleton lines={3}/>:<div className="conversation-messages" role="log" aria-live="polite" aria-relevant="additions">{messages.length?messages.map(message=><article className={`conversation-message ${message.sender_id===actor?.id?'is-mine':''}`} key={message.id}><div className="row between"><strong>{message.sender_name}</strong><Badge>{message.sender_role==='business'?'Бизнес':'Команда'}</Badge></div><p>{message.body}</p><time dateTime={message.created_at}>{messageTime(message.created_at)}</time></article>):!error&&<p className="muted">Сообщений пока нет. Начните обсуждение задачи.</p>}</div>}
    {hasMore&&<Button variant="secondary" loading={fetching} onClick={()=>void fetchPage()}>Загрузить следующие сообщения</Button>}
    {error&&<ErrorBanner message={error} onRetry={denied.current?undefined:()=>void fetchPage()}/>}
    {closed?<p className="notice">Предложение отклонено. Переписка сохранена и доступна только для чтения.</p>:<form className="stack" onSubmit={send}><Textarea label="Сообщение" maxLength={4000} counter rows={3} disabled={sending||denied.current} value={draft} onChange={event=>setDraft(event.target.value)} placeholder="Обсудите требования, сроки или результаты…"/>{sendError&&<ErrorBanner message={sendError}/>}<Button type="submit" loading={sending} disabled={!draft.trim()||denied.current}><Send size={16}/>Отправить сообщение</Button></form>}
  </section>;
}
export function ProposalChat({proposal}:{proposal:Proposal}){
  const [open,setOpen]=useState(false);
  return <section className="stack"><Button variant="secondary" aria-expanded={open} onClick={()=>setOpen(value=>!value)}><MessageSquare size={17}/>{open?'Закрыть обсуждение':'Обсудить предложение'}</Button>{open&&(USE_MOCKS?<p className="notice">Чат доступен при подключении к серверу.</p>:<Conversation key={proposal.id} proposal={proposal}/>)}</section>;
}
export function LeaderContact({proposalId}:{proposalId:string}){
  const [open,setOpen]=useState(false),[contact,setContact]=useState<ProposalContact|null>(null),[loading,setLoading]=useState(false),[error,setError]=useState('');
  const request=useRef(0);
  useEffect(()=>()=>{request.current++},[]);
  async function load(){if(loading)return;const current=++request.current;setLoading(true);setError('');try{const result=await api.getProposalContact(proposalId);if(current===request.current)setContact(result)}catch(caught){if(current===request.current)setError(errorMessage(caught))}finally{if(current===request.current)setLoading(false)}}
  return <section className="stack"><Button variant="ghost" aria-expanded={open} onClick={()=>{const next=!open;setOpen(next);if(next&&!contact&&!USE_MOCKS)void load()}}>Контакт лидера команды</Button>{open&&(USE_MOCKS?<p className="muted">Контакт доступен при подключении к серверу.</p>:loading?<Skeleton lines={2}/>:error?<ErrorBanner message={error} onRetry={()=>void load()}/>:contact&&<div className="leader-contact"><strong>{contact.name}</strong>{contact.username&&<span>@{contact.username}</span>}{contact.phone?<a href={`tel:${contact.phone}`}>{contact.phone}</a>:<span className="muted">Телефон пока не указан. Напишите команде в обсуждении.</span>}</div>)}</section>;
}
