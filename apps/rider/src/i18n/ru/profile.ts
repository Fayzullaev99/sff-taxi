import type { Shape } from '../core';
import type { profile as uz } from '../uz/profile';

export const profile: Shape<typeof uz> = {
  phone: 'Телефон',
  nameLabel: 'Имя',
  namePlaceholder: 'Водитель будет обращаться к вам по этому имени',
  nameSaved: 'Имя сохранено',
  gender: {
    title: 'Ваш пол',
    hint: 'Женщины могут выбрать в заказе «Женщину-водителя».',
    confirmTitle: 'Пол: {gender}',
    confirmMessage:
      'Пол можно изменить раз в 30 дней. Выбор женщины-водителя доступен только женщинам.',
  },
  menu: {
    promosSubtitle: 'Пригласите друга — получите бонус',
    intercityBookings: 'Мои межгородские брони',
    supportSubtitle: 'Жалобы и забытые вещи',
  },
  push: {
    title: 'Уведомления',
    on: 'Включены: сообщим, когда водитель найден и когда он на месте.',
    unsupported: 'На этом устройстве уведомления недоступны.',
    off: 'Выключены. Включите, чтобы узнать, когда водитель на месте.',
    enable: 'Включить уведомления',
  },
  help: {
    title: 'Помощь',
    text: 'Цены известны заранее и не меняются в пути. После подачи несколько минут ожидания бесплатно.',
  },
  signOut: {
    title: 'Выйти из аккаунта?',
    message:
      'Сохранённые адреса и поездки останутся в аккаунте: вы увидите их при следующем входе.',
    confirm: 'Выйти',
  },
  promos: {
    codeTitle: 'Промокод',
    codeHint: 'Введите код: скидка на подходящую поездку появится в заказе сама.',
    codeHintReferral: 'Код приглашения от друга тоже вводится здесь.',
    invitedBy: 'Приглашение друга ({code}): скидка на первую поездку',
    myCodes: 'Мои промокоды',
    bonusTitle: 'Бонус',
    bonusHint: 'Списывается сам в следующих поездках: до {percent}% стоимости поездки.',
    historyOpen: 'История бонусов',
    historyClose: 'Скрыть историю',
    remove: {
      title: 'Удалить {code}?',
      message: 'Код можно будет ввести снова позже.',
      failed: 'Не удалось удалить',
      a11y: 'Удалить {code}',
    },
    loading: 'Загрузка…',
    noBonus:
      'Бонусов пока нет. Приглашайте друзей — вы получите бонус, когда они завершат первую поездку.',
    invite: {
      title: 'Пригласить друга',
      yourCode: 'Ваш код приглашения',
      yourCodeA11y: 'Ваш код приглашения: {code}',
      stats: 'Приглашено: {invited} · бонус получен: {rewarded} · всего {earned}',
    },
  },
  promo: {
    fixedDiscount: 'Скидка {amount}',
    percentDiscount: 'Скидка {percent}%',
    percentDiscountCapped: 'Скидка {percent}%, до {amount}',
    cargoS: 'Малый груз',
    cargoM: 'Средний груз',
    services: {
      taxi: 'такси',
      delivery: 'доставка',
      cargo: 'грузоперевозка',
    },
    minFare: 'от {amount}',
    firstRideOnly: 'на первую поездку',
    validUntil: 'до {date}',
    credit: {
      referral_bonus: 'Бонус за друга',
      ride: 'Списано в поездке',
      ride_release: 'Отменённая поездка: возвращено',
      revoke: 'Бонус отменён',
      adjustment: 'Корректировка',
    },
    inviteOffer: 'Другу — {gift} на первую поездку, вам — бонус {bonus}, когда он её завершит.',
    inviteGift: 'скидка {percent}% (до {amount})',
    inviteGiftPlain: 'скидка',
    referralLine: 'Приглашение друга',
    promoLine: 'Промокод {code}',
    bonusLine: 'Бонус',
  },
  invite: {
    title: 'Друг пригласил вас в SFF Taxi',
    text: 'С кодом приглашения первая поездка дешевле. Код вводится один раз и только до первой поездки.',
    signIn: 'Войти и применить код',
    signInA11y: 'Войти, затем применить код {code}',
    later: 'Позже',
  },
  promoLink: {
    title: 'Ваш промокод: {code}',
    text: 'Код сохранится в вашем кошельке, и в подходящей поездке цена будет показана со скидкой. Условия указаны рядом с кодом.',
    signIn: 'Войти и применить код',
    signInA11y: 'Войти, затем применить код {code}',
    later: 'Позже',
  },
  links: {
    callFailed: 'Не удалось позвонить',
    dialManually: 'Наберите номер вручную: {phone}',
    openFailed: 'Не удалось открыть ссылку',
  },
};
