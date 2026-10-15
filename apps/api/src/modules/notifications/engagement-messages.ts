import type { Locale, PushText } from './messages.js';

/** 7000 -> '7 000 so‘m'. */
const soum = (n: number) => `${String(n).replace(/\B(?=(\d{3})+(?!\d))/g, ' ')} so‘m`;

/** Push texts of the rider-engagement features: referral rewards, ride chat, tips. */
export const engagementPush = {
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
