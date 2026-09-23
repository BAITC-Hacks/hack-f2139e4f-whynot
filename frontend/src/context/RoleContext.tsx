import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from 'react';
import { api, ApiError, errorMessage } from '../api/client';
import type { Actor, Team } from '../types';
interface RoleValue { actor:Actor|null; actors:Actor[]; role:'business'|'student'; team:Team|null; teams:Team[]; loading:boolean; error:string|null; selectActor:(id:string)=>void; refreshTeam:()=>Promise<void>; retry:()=>void }
const RoleContext=createContext<RoleValue|null>(null);
export function RoleProvider({children}:{children:ReactNode}){
 const [actors,setActors]=useState<Actor[]>([]),[actor,setActor]=useState<Actor|null>(null),[teams,setTeams]=useState<Team[]>([]),[team,setTeam]=useState<Team|null>(null),[loading,setLoading]=useState(true),[error,setError]=useState<string|null>(null);const generation=useRef(0),actorRef=useRef<Actor|null>(null);
 const load=useCallback(async()=>{const request=++generation.current;setLoading(true);setError(null);try{const [nextActors,nextTeams]=await Promise.all([api.getActors(),api.getTeams()]);if(request!==generation.current)return;setActors(nextActors);setTeams(nextTeams);const selected=nextActors.find(a=>a.id===actorRef.current?.id)||nextActors.find(a=>a.role==='business')||nextActors[0]||null;actorRef.current=selected;setActor(selected);setTeam(nextTeams.find(t=>t.owner_id===selected?.id)||null);if(!selected)setError('Сервер не вернул демо-пользователей. Запустите backend в демо-режиме.')}catch(e){if(request===generation.current)setError(errorMessage(e))}finally{if(request===generation.current)setLoading(false)}},[]);
 useEffect(()=>{void load();return()=>{generation.current++}},[load]);
 const selectActor=useCallback((id:string)=>{const next=actors.find(a=>a.id===id);if(!next||next.id===actorRef.current?.id)return;generation.current++;actorRef.current=next;setActor(next);setTeam(null);setError(null);setLoading(false)},[actors]);
 const refreshTeam=useCallback(async()=>{const current=actorRef.current;const request=++generation.current;try{const nextTeams=await api.getTeams();let nextTeam:Team|null=null;if(current?.role==='student'){try{nextTeam=await api.getMyTeam(current.id)}catch(e){if(!(e instanceof ApiError&&e.code==='TEAM_REQUIRED'))throw e}}if(request===generation.current&&current?.id===actorRef.current?.id){setTeams(nextTeams);setTeam(nextTeam);setError(null)}}catch(e){if(request===generation.current)setError(errorMessage(e));throw e}},[]);
 useEffect(()=>{if(actor){void refreshTeam().catch(()=>{/* Context error is shown in Layout. */})}},[actor?.id,refreshTeam]);
 return <RoleContext.Provider value={{actor,actors,role:actor?.role||'business',team,teams,loading,error,selectActor,refreshTeam,retry:()=>{void load()}}}>{children}</RoleContext.Provider>;
}
export function useRole(){const value=useContext(RoleContext);if(!value)throw new Error('RoleProvider не подключён.');return value}
