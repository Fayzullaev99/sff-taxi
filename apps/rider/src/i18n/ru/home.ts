import type { Shape } from '../core';
import type { home as uz } from '../uz/home';

export const home: Shape<typeof uz> = {
  addressLookingUp: 'Определяем адрес…',
  pinnedPlace: 'Место, отмеченное меткой',
  awaitingPayment: 'Ожидается оплата',
  activeRide: 'У вас есть активная поездка',
  scheduledA11y: 'Предзаказы: {count}. Ближайший {when}',
  locating: 'Определяем местоположение',
  myLocation: 'Моё местоположение',
  greeting: 'Привет, {name}!',
  whereToGo: 'Куда едем?',
  fromA11y: 'Откуда: {address}. Изменить',
  fromCaption: 'ОТКУДА',
  vagueLocation: 'Местоположение примерное (±{metres} м) — передвиньте метку на точное место',
  mapA11y: 'Карта. Передвигайте карту, чтобы выбрать место подачи.',
  whereTo: {
    taxi: 'Куда?',
    cargo: 'Куда везём груз?',
    delivery: 'Куда везём посылку?',
  },
  saved: {
    home: {
      label: 'Дом',
      add: 'Добавить дом',
      go: 'Поехать домой: {address}',
      addAddress: 'Добавить домашний адрес',
    },
    work: {
      label: 'Работа',
      add: 'Добавить работу',
      go: 'Поехать на работу: {address}',
      addAddress: 'Добавить рабочий адрес',
    },
  },
  goAgain: 'Поехать снова: {place}',
  fixedFare: 'Фиксированная цена: {route}',
  intercityA11y: 'Межгородские рейсы: забронировать место',
  points: {
    pickup: 'Место подачи',
    dropoff: 'Место назначения',
  },
  search: {
    fromTitle: 'Откуда?',
    stopTitle: 'Остановка {n}',
    pickupPlaceholder: 'Откуда вас забрать?',
    placeholder: 'Улица, махалля или название места',
    inputA11y: 'Поиск адреса',
    clear: 'Очистить',
    locatingShort: 'Определяем…',
    myLocationHint: 'По GPS, точное место',
    placesFailed: 'Сохранённые и недавние адреса не загрузились',
    tapToRetry: 'Нажмите, чтобы повторить',
    onMap: 'Указать на карте',
    onMapHint: 'Поставьте метку в нужное место',
    pickPlace: 'Указать место',
    pickPlaceHint: 'Ваше местоположение или координаты',
    noGeocoder: 'Поиск адресов пока не работает — укажите место на карте.',
    recentSection: 'НЕДАВНИЕ АДРЕСА',
    nothingFound: 'Ничего не найдено. Попробуйте написать иначе или укажите место на карте.',
    notServiceable: 'отсюда пока не забираем',
    hideHint: 'Удерживайте, чтобы скрыть',
    hide: {
      title: 'Скрыть адрес',
      message:
        '«{place}» будет убран из недавних адресов. История поездок не изменится; если вы снова поедете сюда, адрес появится в списке опять.',
      confirm: 'Скрыть',
    },
  },
  pickOnMap: {
    stopCaption: 'ОСТАНОВКА',
    toCaption: 'КУДА',
  },
  mapless: {
    title: 'Карта на этом устройстве не отображается',
    homeHint:
      'Укажите место подачи кнопкой «Моё местоположение» или через поиск в строке «Откуда».',
    pickerHint:
      'Карта на этом устройстве не отображается: определите своё местоположение или введите координаты.',
    latitude: 'Широта',
    longitude: 'Долгота',
    latitudeExample: 'Например, 40.49598',
    longitudeExample: 'Например, 68.77587',
  },
  rideFallback: {
    toDestination: 'До места назначения {distance}',
    toStop: 'До остановки {n} {distance}',
  },
  locate: {
    placeOnMap: 'поставьте метку на карте сами',
    placeFromSearch: 'выберите адрес через поиск',
    denied: {
      title: 'Нет доступа к геопозиции',
      message: 'Чтобы водитель точно нашёл вас, разрешите доступ к геопозиции или {place}.',
      action: 'Разрешить',
    },
    blocked: {
      title: 'Доступ к геопозиции отключён',
      message:
        'В разделе Настройки → Разрешения → Геопозиция выберите «При использовании приложения» или {place}.',
      action: 'Открыть настройки',
    },
    servicesOff: {
      title: 'Геолокация (GPS) на телефоне выключена',
      message: 'Включите геолокацию — тогда место подачи будет точным. Или {place}.',
      action: 'Включить геолокацию',
    },
    unavailable: {
      title: 'Не удалось определить местоположение',
      message: 'Выйдите на более открытое место и попробуйте снова или {place}.',
    },
  },
  area: {
    movePin: 'Передвиньте метку в ту сторону.',
    pickFromSearch: 'Выберите место подачи в строке «Откуда».',
    tryElsewhere: 'Попробуйте поставить метку в другом месте.',
    upcomingTitle: '{city} — скоро',
    upcomingMessage: 'Скоро начнём работать в городе {city}. Пока заказать отсюда нельзя.',
    outsideTitle: 'В этом районе мы пока не работаем',
    nearest: 'Ближайшая зона обслуживания: {city}, в {distance} отсюда. {advice}',
    expanding: 'Зоны обслуживания скоро расширятся. {advice}',
  },
  offline: {
    noInternet: 'Нет подключения к интернету. Переподключаемся…',
    noServer: 'Нет связи с сервером. Переподключаемся…',
  },
  notice: {
    openA11y: '{text}. Открыть',
  },
  update: {
    title: 'Обновите приложение',
    message:
      'Вышла новая версия SFF Taxi. Чтобы продолжить заказывать поездки, обновите приложение.',
    versions: 'У вас: {current} · нужна: {minimum}',
    appStore: 'Обновить в App Store',
    googlePlay: 'Обновить в Google Play',
    appStoreManual: 'Обновите приложение SFF Taxi в App Store.',
    orderByPhone: 'Заказать через оператора',
  },
  states: {
    offlineTitle: 'Нет связи',
    errorTitle: 'Что-то пошло не так',
  },
  stepper: {
    decrease: 'Уменьшить',
    increase: 'Увеличить',
  },
  push: {
    channelName: 'Поездки',
    channelDescription: 'Водитель найден, на месте, заказ отменён',
  },
};
