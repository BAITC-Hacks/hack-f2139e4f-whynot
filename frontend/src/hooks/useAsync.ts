import { useCallback, useEffect, useRef, useState, type DependencyList } from 'react';
import { errorMessage } from '../api/client';
export function useAsync<T>(loader:()=>Promise<T>,deps:DependencyList=[]){
 const [data,setData]=useState<T|null>(null),[loading,setLoading]=useState(true),[error,setError]=useState<string|null>(null);const latest=useRef(loader);latest.current=loader;const request=useRef(0);
 const reload=useCallback(async()=>{const id=++request.current;setLoading(true);setError(null);try{const result=await latest.current();if(id===request.current)setData(result)}catch(e){if(id===request.current)setError(errorMessage(e))}finally{if(id===request.current)setLoading(false)}},[]);
 useEffect(()=>{setData(null);void reload();return()=>{request.current++}},[reload,...deps]);
 return {data,setData,loading,error,reload};
}
