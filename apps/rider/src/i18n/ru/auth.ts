import type { Shape } from '../core';
import type { auth as uz } from '../uz/auth';

export const auth: Shape<typeof uz> = {
  intro:
    'Введите номер телефона — мы отправим код подтверждения по SMS. Цена известна заранее и не меняется.',
  phoneLabel: 'Номер телефона',
  phonePlaceholder: '90 123 45 67',
  phoneIncomplete: 'Введите номер телефона полностью',
  getCode: 'Получить код',
  enterCode: 'Введите код',
  codeSentTo: 'Код отправлен на номер {phone}.',
  changeNumber: 'Изменить номер',
  codeLabel: 'Код подтверждения',
  resend: 'Отправить код ещё раз',
  resendIn: 'Отправить код ещё раз ({time})',
  nameTitle: 'Как вас зовут?',
  nameHint: 'Водитель будет обращаться к вам по этому имени.',
  nameLabel: 'Имя',
  namePlaceholder: 'Например, Азиз',
  skip: 'Пропустить',
};
