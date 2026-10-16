import type { Shape } from '../core';
import type { history as uz } from '../uz/history';

export const history: Shape<typeof uz> = {
  emptyTitle: 'Поездок пока нет',
  emptyMessage: 'Закажите первую поездку с карты.',
  callTaxi: 'Вызвать такси',
  status: {
    completed: 'Завершена',
    scheduledAt: 'Предзаказ · {when}',
    active: 'Активна',
  },
  fromPlace: 'от {place}',
  rowA11y: '{when}, от {from} до {to}, {status}, {amount}',
  cancelledFree: 'Отменён бесплатно',
  cancelFee: 'Плата за отмену',
  scheduled: {
    cancelQuestion: 'Отменить предзаказ?',
    keep: 'Оставить',
    cancelFailed: 'Не удалось отменить',
    note: 'Поиск водителя начинается за 15 минут до назначенного времени. Одновременно можно оформить до {max} предзаказов.',
    rowA11y: '{when}, до {to}, {amount}',
    depositUnpaid: 'Депозит не оплачен — нажмите, чтобы оплатить',
    searchStarts: 'Поиск начнётся в {time}',
    depositPaid: 'депозит {amount} оплачен',
    emptyTitle: 'Предзаказов нет',
    emptyMessage:
      'При выборе тарифа нажмите «Позже» и закажите такси заранее — от 30 минут до 24 часов.',
  },
  places: {
    home: 'Дом',
    work: 'Работа',
    homeTitle: 'Адрес дома',
    workTitle: 'Адрес работы',
    newPlace: 'Новый адрес',
    unhidden: 'Скрытые недавние адреса снова видны в поиске.',
    removeQuestion: 'Удалить адрес?',
    removeFailed: 'Не удалось удалить',
    tapToAdd: 'Нажмите, чтобы добавить',
    addOther: 'Добавить другой адрес',
    maxReached: 'Можно сохранить не больше {max} адресов.',
    syncedNote:
      'Адреса хранятся в вашем аккаунте: они будут здесь, даже если войти с другого телефона.',
    hideHint: 'Чтобы скрыть один из недавних адресов, удерживайте его в поиске.',
    unhide: 'Вернуть скрытые адреса',
    removeA11y: 'Удалить адрес «{title}»',
  },
};
