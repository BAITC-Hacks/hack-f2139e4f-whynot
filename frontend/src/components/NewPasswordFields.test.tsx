import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { NewPasswordFields } from './NewPasswordFields';

describe('Поля нового пароля',()=>{
  it('пустые поля нейтральны, поддерживают менеджер паролей и показывают требования текстом',()=>{
    const markup=renderToStaticMarkup(<NewPasswordFields password="" confirmation="" onPasswordChange={()=>{}} onConfirmationChange={()=>{}}/>);
    expect(markup).toContain('Выберите пароль');expect(markup).toContain('Не менее 15 символов');expect(markup).toContain('password-strength-neutral');expect(markup).not.toContain('password-strength-weak');
    expect(markup.match(/autoComplete="new-password"/g)).toHaveLength(2);expect(markup).toContain('Показать: пароль');expect(markup).toContain('aria-live="polite"');
  });
  it('не обрезает emoji или NFC-последовательности HTML-ограничением UTF-16',()=>{
    const candidate='😀'.repeat(128);const markup=renderToStaticMarkup(<NewPasswordFields label="Новый пароль" password={candidate} confirmation={candidate} onPasswordChange={()=>{}} onConfirmationChange={()=>{}}/>);
    expect(markup).toContain('128 / 128 символов');expect(markup).not.toMatch(/maxLength|minLength/);expect(markup).toContain('Проверяем пароль');
  });
});
