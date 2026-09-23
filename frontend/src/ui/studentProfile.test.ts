import { describe, expect, it } from 'vitest';
import { completeStudentProfile, studentDraft, studentProfileInput, validateStudentProfile } from './studentProfile';

describe('Профиль студента',()=>{
  it('нормализует username, международный телефон и объединяет направления без дублей',()=>{
    const input=studentProfileInput({username:' @Student_42 ',phone:' +7 (700) 123-45-67 ',positions:['Backend','Frontend'],customPositions:'backend, Мобильная разработка',skills:'Python; React\npython, SQL'});
    expect(input).toEqual({username:'student_42',phone:'+77001234567',positions:['Backend','Frontend','Мобильная разработка'],skills:['Python','React','SQL']});
    expect(validateStudentProfile(input)).toEqual({});
  });
  it('сохраняет пользовательские направления при повторном редактировании',()=>{
    const profile={actor_id:'student',username:'learner',phone:'+77001234567',positions:['Backend','Исследование пользователей'],skills:['Python','Figma']};
    expect(studentProfileInput(studentDraft(profile))).toEqual({username:'learner',phone:profile.phone,positions:profile.positions,skills:profile.skills});
  });
  it('требует заполнить пустой старый профиль и запрещает неподходящие данные',()=>{
    expect(completeStudentProfile({actor_id:'legacy',username:null,phone:'',positions:[],skills:[]})).toBe(false);
    expect(validateStudentProfile({username:'42_я',phone:'+7letter123456',positions:[],skills:[]})).toHaveProperty('username');
    expect(Object.keys(validateStudentProfile({username:'42_я',phone:'+7letter123456',positions:[],skills:[]})).sort()).toEqual(['phone','positions','skills','username']);
  });
  it('ограничивает число и длину направлений и навыков',()=>{
    const base={username:'learner',phone:'+77001234567',positions:['Backend'],skills:['React']};
    expect(validateStudentProfile({...base,positions:Array.from({length:11},(_,index)=>`Role ${index}`)})).toHaveProperty('positions');
    expect(validateStudentProfile({...base,positions:['x'.repeat(81)],skills:['x'.repeat(101)]})).toMatchObject({positions:expect.any(String),skills:expect.any(String)});
    expect(validateStudentProfile({...base,skills:Array.from({length:31},(_,index)=>`Skill ${index}`)})).toHaveProperty('skills');
  });
});
