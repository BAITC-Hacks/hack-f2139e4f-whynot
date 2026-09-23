import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createPasswordStrengthChecker, currentPasswordCheck, passwordLength, validateNewPassword, type PasswordCheckSnapshot } from './passwordStrength';
import type { PasswordStrength } from '../types';

const strong:PasswordStrength={score:4,level:'strong',label:'Хороший',acceptable:true,length:24,min_length:15,max_length:128,checks:[{code:'min_length',passed:true,message:'Не менее 15 символов'},{code:'max_length',passed:true,message:'Не более 128 символов'},{code:'not_common',passed:true,message:'Не распространённый пароль'}],suggestions:[]};
function deferred<T>(){let resolve!:(value:T)=>void, reject!:(error:unknown)=>void;const promise=new Promise<T>((yes,no)=>{resolve=yes;reject=no});return{promise,resolve,reject}}

describe('Длина и подтверждение нового пароля',()=>{
  it('считает символы после NFC, сохраняя пробелы и Unicode',()=>{
    expect(passwordLength('😀'.repeat(15))).toBe(15);
    expect(passwordLength('e\u0301'.repeat(15))).toBe(15);
    expect(passwordLength('  фраза с пробелами  ')).toBe(21);
    expect(validateNewPassword('e\u0301'.repeat(15),'é'.repeat(15))).toBeNull();
    expect(validateNewPassword('😀'.repeat(128),'😀'.repeat(128))).toBeNull();
  });
  it('проверяет границы и несовпадение без требования цифр или регистра',()=>{
    expect(validateNewPassword('é'.repeat(14),'é'.repeat(14))).toContain('15');
    expect(validateNewPassword('😀'.repeat(129),'😀'.repeat(129))).toContain('128');
    expect(validateNewPassword('длинная фраза для пароля','другая длинная фраза')).toBe('Пароли не совпадают.');
    expect(validateNewPassword('несколько спокойных слов','несколько спокойных слов')).toBeNull();
  });
});

describe('Отложенная проверка пароля',()=>{
  beforeEach(()=>vi.useFakeTimers());
  afterEach(()=>vi.useRealTimers());
  it('отправляет только последний ввод после паузы и не запрашивает пустой пароль',async()=>{
    const request=vi.fn().mockResolvedValue(strong),publish=vi.fn();const checker=createPasswordStrengthChecker(request,publish);
    checker.update('first draft');await vi.advanceTimersByTimeAsync(300);checker.update('second draft');await vi.advanceTimersByTimeAsync(499);expect(request).not.toHaveBeenCalled();await vi.advanceTimersByTimeAsync(1);expect(request).toHaveBeenCalledTimes(1);expect(request.mock.calls[0][0]).toBe('second draft');
    checker.update('');await vi.advanceTimersByTimeAsync(500);expect(request).toHaveBeenCalledTimes(1);expect(publish).toHaveBeenLastCalledWith({input:'',status:'idle',result:null});checker.cancel();
  });
  it('отменяет предыдущий запрос и игнорирует поздний ответ даже если транспорт не остановился',async()=>{
    const first=deferred<PasswordStrength>(),second=deferred<PasswordStrength>();const request=vi.fn().mockReturnValueOnce(first.promise).mockReturnValueOnce(second.promise);const snapshots:PasswordCheckSnapshot[]=[];const checker=createPasswordStrengthChecker(request,value=>snapshots.push(value));
    checker.update('first draft');await vi.advanceTimersByTimeAsync(500);const firstSignal=request.mock.calls[0][1] as AbortSignal;
    checker.update('second draft');expect(firstSignal.aborted).toBe(true);expect(snapshots.at(-1)).toMatchObject({input:'second draft',status:'pending',result:null});await vi.advanceTimersByTimeAsync(500);
    second.resolve(strong);await vi.advanceTimersByTimeAsync(0);const count=snapshots.length;first.resolve({...strong,score:0,level:'weak',label:'Слабый'});await vi.advanceTimersByTimeAsync(0);
    expect(snapshots).toHaveLength(count);expect(snapshots.at(-1)).toMatchObject({input:'second draft',status:'ready',result:strong});checker.cancel();
  });
  it('сразу скрывает старый зелёный результат до запуска следующего React-эффекта',()=>{
    const old:PasswordCheckSnapshot={input:'old draft',status:'ready',result:strong};
    expect(currentPasswordCheck('new draft',old)).toEqual({input:'new draft',status:'pending',result:null});
    expect(currentPasswordCheck('',old)).toEqual({input:'',status:'idle',result:null});
  });
  it('при ошибке показывает непроверенное состояние и не делает отправку формы зависимой от preview',async()=>{
    const request=vi.fn().mockRejectedValueOnce(new Error('network')).mockResolvedValueOnce(strong),publish=vi.fn();const checker=createPasswordStrengthChecker(request,publish);
    const candidate='separate uncommon words';checker.update(candidate);await vi.advanceTimersByTimeAsync(500);expect(publish).toHaveBeenLastCalledWith({input:candidate,status:'error',result:null});expect(validateNewPassword(candidate,candidate)).toBeNull();
    checker.update(candidate+' more');await vi.advanceTimersByTimeAsync(500);expect(publish).toHaveBeenLastCalledWith(expect.objectContaining({status:'ready'}));checker.cancel();
  });
  it('не публикует ответ после размонтирования формы',async()=>{
    const pending=deferred<PasswordStrength>(),publish=vi.fn();const checker=createPasswordStrengthChecker(()=>pending.promise,publish);
    checker.update('candidate draft');await vi.advanceTimersByTimeAsync(500);checker.cancel();const count=publish.mock.calls.length;pending.resolve(strong);await vi.advanceTimersByTimeAsync(0);expect(publish).toHaveBeenCalledTimes(count);
  });
});
