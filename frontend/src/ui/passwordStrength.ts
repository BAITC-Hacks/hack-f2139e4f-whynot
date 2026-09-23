import type { PasswordStrength } from '../types';

export const PASSWORD_MIN_LENGTH=15;
export const PASSWORD_MAX_LENGTH=128;
export function passwordLength(password:string):number{return Array.from(password.normalize('NFC')).length;}
export function validateNewPassword(password:string,confirmation:string):string|null{
  const length=passwordLength(password);
  if(length<PASSWORD_MIN_LENGTH)return 'Используйте не менее 15 символов. Можно составить пароль из нескольких слов.';
  if(length>PASSWORD_MAX_LENGTH)return 'Пароль должен содержать не более 128 символов.';
  if(password.normalize('NFC')!==confirmation.normalize('NFC'))return 'Пароли не совпадают.';
  return null;
}

export type PasswordCheckStatus='idle'|'pending'|'ready'|'error';
export interface PasswordCheckSnapshot{input:string;status:PasswordCheckStatus;result:PasswordStrength|null}
export type PasswordStrengthRequest=(password:string,signal:AbortSignal)=>Promise<PasswordStrength>;

// Owns only the current in-memory draft; passwords never enter URLs or storage.
export function createPasswordStrengthChecker(request:PasswordStrengthRequest,publish:(snapshot:PasswordCheckSnapshot)=>void,delayMs=500){
  let generation=0;
  let timer:ReturnType<typeof setTimeout>|undefined;
  let controller:AbortController|undefined;
  function cancel(){generation++;if(timer!==undefined)clearTimeout(timer);timer=undefined;controller?.abort();controller=undefined;}
  return {
    update(input:string){
      cancel();const current=generation;
      if(!input){publish({input:'',status:'idle',result:null});return;}
      publish({input,status:'pending',result:null});
      timer=setTimeout(async()=>{
        timer=undefined;const active=new AbortController();controller=active;
        try{const result=await request(input,active.signal);if(current===generation&&!active.signal.aborted)publish({input,status:'ready',result});}
        catch{if(current===generation&&!active.signal.aborted)publish({input,status:'error',result:null});}
        finally{if(current===generation)controller=undefined;}
      },delayMs);
    },
    cancel,
  };
}

// During React's render-before-effect window, never paint a result for old text.
export function currentPasswordCheck(input:string,snapshot:PasswordCheckSnapshot):PasswordCheckSnapshot{
  return snapshot.input===input?snapshot:{input,status:input?'pending':'idle',result:null};
}
