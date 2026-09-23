import { useEffect, useMemo, useState } from 'react';
import { api } from '../api/client';
import { createPasswordStrengthChecker, currentPasswordCheck, type PasswordCheckSnapshot } from '../ui/passwordStrength';

export function usePasswordStrength(password:string){
  const [snapshot,setSnapshot]=useState<PasswordCheckSnapshot>({input:'',status:'idle',result:null});
  const checker=useMemo(()=>createPasswordStrengthChecker(api.passwordStrength,setSnapshot),[]);
  useEffect(()=>{checker.update(password);return()=>checker.cancel()},[checker,password]);
  return currentPasswordCheck(password,snapshot);
}
