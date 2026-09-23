import { Input, Textarea } from './ui';
import { POSITION_PRESETS, type StudentProfileDraft, type StudentProfileErrors } from '../ui/studentProfile';

export function StudentProfileFields({value,onChange,errors={},disabled=false}:{value:StudentProfileDraft;onChange:(value:StudentProfileDraft)=>void;errors?:StudentProfileErrors;disabled?:boolean}) {
  return <>
    <Input label="ID студента" autoComplete="nickname" required maxLength={33} value={value.username} disabled={disabled} onChange={event=>onChange({...value,username:event.target.value})} error={errors.username} placeholder="@your_name" hint="Уникальное имя в Tapsyrma: от 3 до 32 латинских букв, цифр или _." />
    <Input label="Номер телефона" type="tel" inputMode="tel" autoComplete="tel" required maxLength={30} value={value.phone} disabled={disabled} onChange={event=>onChange({...value,phone:event.target.value})} error={errors.phone} placeholder="+7 700 123 45 67" hint="Номер не отображается в публичном каталоге. Контакт лидера доступен бизнесу после отклика команды." />
    <fieldset className="student-positions" disabled={disabled} aria-describedby="student-positions-hint"><legend>Направления работы *</legend><div className="position-options">{POSITION_PRESETS.map(position=><label key={position}><input type="checkbox" checked={value.positions.includes(position)} onChange={event=>onChange({...value,positions:event.target.checked?[...value.positions,position]:value.positions.filter(item=>item!==position)})} /><span>{position}</span></label>)}</div><p id="student-positions-hint" className="muted text-small">Можно выбрать несколько направлений и добавить свои.</p></fieldset>
    <Input label="Другие направления" maxLength={810} value={value.customPositions} disabled={disabled} onChange={event=>onChange({...value,customPositions:event.target.value})} placeholder="Например: мобильная разработка, исследование пользователей" hint="Перечислите через запятую. Всего до 10 направлений." error={errors.positions} />
    <Textarea label="Личные навыки" required maxLength={3030} rows={3} value={value.skills} disabled={disabled} onChange={event=>onChange({...value,skills:event.target.value})} error={errors.skills} placeholder="Python, React, Figma, SQL…" hint="От 1 до 30 навыков через запятую. Они помогут представить ваш опыт команде." />
  </>;
}
