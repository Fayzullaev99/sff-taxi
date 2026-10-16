import type { Shape } from '../core';
import type { payments as uz } from '../uz/payments';

export const payments: Shape<typeof uz> = {
  checking: 'Проверяем оплату…',
  cardWith: 'Карта ({providers})',
  payVia: 'Оплатить через {provider}',
  refundPending: {
    title: 'Деньги вернутся на вашу карту',
    message:
      'Предоплата {amount} будет возвращена полностью. Банк обычно зачисляет её в течение 1–3 рабочих дней.',
  },
  refunded: {
    title: 'Деньги возвращены',
    messageAt: '{amount} возвращены на вашу карту ({when}).',
    message: '{amount} возвращены на вашу карту.',
  },
  failed: {
    title: 'Оплата не прошла',
    message: 'Оплата не была произведена за 10 минут, заказ отменён. Деньги с карты не списаны.',
  },
  notCharged: {
    title: 'Деньги с карты не списаны',
    message: 'Заказ отменён до оплаты.',
  },
  paid: {
    title: 'Оплачено картой',
    message: 'Предоплата: {amount}.',
  },
};
