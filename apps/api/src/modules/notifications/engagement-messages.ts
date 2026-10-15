import type { Locale, PushText } from './messages.js';

/** 7000 -> '7 000 so‘m'. */
const soum = (n: number) => `${String(n).replace(/\B(?=(\d{3})+(?!\d))/g, ' ')} so‘m`;

/** Push texts of the rider-engagement features: referral rewards, ride chat, tips. */
export const engagementPush = {
  /** The driver: a tip handed over in cash (recorded) or paid by card onto the balance. */
  tip: (l: Locale, method: 'cash' | 'card', amount: number): PushText =>
    l === 'ru'
      ? {
          title: 'Чаевые',
          body:
            method === 'cash'
              ? 'Пассажир оставит ' + soum(amount) + ' наличными.'
              : soum(amount) + ' зачислено на ваш баланс.',
        }
      : {
          title: 'Choychaqa',
          body:
            method === 'cash'
              ? 'Yo‘lovchi ' + soum(amount) + ' choychaqani naqd beradi.'
              : soum(amount) + ' balansingizga tushdi.',
        },
  /** A chat message from the driver (`name`: the driver's given name) or from the rider. */
  chatMessage: (
    l: Locale,
    from: 'driver' | 'rider',
    name: string | null,
    text: string,
  ): PushText =>
    l === 'ru'
      ? {
          title:
            from === 'driver' ? `Водитель${name ? `: ${name}` : ''}` : 'Сообщение от пассажира',
          body: text,
        }
      : {
          title: from === 'driver' ? `Haydovchi${name ? `: ${name}` : ''}` : 'Yo‘lovchidan xabar',
          body: text,
        },
  referralRewarded: (l: Locale, amount: number): PushText =>
    l === 'ru'
      ? {
          title: 'Бонус за приглашение',
          body: `Друг совершил первую поездку: вам ${soum(amount)} на поездки.`,
        }
      : {
          title: 'Taklif uchun bonus',
          body: `Do‘stingiz birinchi safarini yakunladi: sizga ${soum(amount)} bonus.`,
        },
};
