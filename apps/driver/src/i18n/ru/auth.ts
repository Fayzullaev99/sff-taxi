import type { Shape } from '../core';
import type { auth as uz } from '../uz/auth';

export const auth: Shape<typeof uz> = {
  tagline: 'Честные заказы, низкая комиссия, прозрачные правила',
  phoneLabel: 'Ваш номер телефона',
  getCode: 'Получить код',
  codeWillBeSent: 'На ваш номер придёт 6-значный код подтверждения',
  codeLabel: 'Код из SMS',
  enterCodeSentTo: 'Введите код, отправленный на номер {phone}',
  signIn: 'Войти',
  resend: 'Отправить код ещё раз',
  resendIn: 'Отправить код ещё раз ({seconds} с)',
  changePhone: 'Изменить номер',
};
