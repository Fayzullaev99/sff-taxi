import { describe, expect, it } from 'vitest';
import { ApiError, errorText, fieldErrors } from '../api/client';
import {
  applyOffer,
  applyPositions,
  pollInterval,
  reconnectDelay,
  staleKeys,
} from '../api/realtime';
import { nextCursorOf, ridesQuery } from '../api/queries';
import type { AdminDriver, AdminRideItem, LiveBoard, RideEvent, SosEvent } from '../api/types';
import { faviconSvg, titleWithBadge } from './alert';
import { approvalChecks, approvalProblems, expiryState, isImageFile, isImageUrl } from './drivers';
import {
  bookingPrice,
  isLiveBooking,
  isOpenTrip,
  routePriceProblems,
  seatChoices,
} from './intercity';
import { entryProblems, eventLink, fiscalProblems, isPlaceholder, resolutionsFor } from './ops';
import {
  ago,
  date,
  dateTime,
  daysBetween,
  digits,
  distance,
  duration,
  fullYears,
  isoToTashkentLocal,
  parseSom,
  signedSom,
  som,
  tashkentDay,
  tashkentLocalToIso,
  tashkentMonth,
  tashkentToday,
  time,
} from './format';
import { formatPhone, isUzPhone, normalizePhone } from './phone';
import {
  alarmKeys,
  canAssign,
  countByState,
  DEFAULT_LIVE_FILTERS,
  eventDetail,
  filterLive,
  freshKeys,
  knownPlaces,
  needsDriver,
  placeLine,
  scheduleProblem,
  sortForDispatch,
} from './rides';
import { taxCsv } from './taxes';

const place = (lat: number, lng: number, address: string | null = null) => ({
  lat,
  lng,
  address,
  landmark: null,
});

function ride(over: Partial<AdminRideItem> = {}): AdminRideItem {
  return {
    id: 'r1',
    number: 101,
    status: 'searching',
    channel: 'phone',
    kind: 'city',
    class: 'economy',
    cityId: 'c1',
    pickup: place(40.49, 68.78, 'Navoiy 1'),
    dropoff: place(40.5, 68.79, 'Bozor'),
    options: [],
    comment: null,
    distanceM: 3000,
    durationS: 420,
    fare: {
      quoted: 7000,
      waiting: 0,
      total: null,
      cancellationFee: 0,
      breakdown: {
        kind: 'city',
        rideClass: 'economy',
        distanceM: 3000,
        insideM: 3000,
        outsideM: 0,
        base: 7000,
        outside: 0,
        night: 0,
        options: {},
        total: 7000,
        seat: null,
      },
    },
    paymentMethod: 'cash',
    paymentStatus: 'pending',
    vehicle: null,
    cancelledBy: null,
    cancelReason: null,
    requestedAt: '2026-09-26T07:00:00.000Z',
    assignedAt: null,
    arrivedAt: null,
    startedAt: null,
    completedAt: null,
    cancelledAt: null,
    scheduledFor: null,
    riderPhone: '+998901112233',
    riderName: 'Dilnoza',
    driverId: null,
    dispatchStage: 'direct',
    attentionAt: null,
    ...over,
  };
}

describe('format', () => {
  it('writes money, distances and durations the Uzbek way', () => {
    expect(digits(1234567)).toBe('1 234 567');
    expect(som(45000)).toBe('45 000 so‘m');
    expect(som(-450)).toBe('−450 so‘m');
    expect(signedSom(20000)).toBe('+20 000');
    expect(signedSom(-70)).toBe('−70');
    expect(parseSom('45 000')).toBe(45000);
    expect(parseSom('4a')).toBeNull();
    expect(distance(850)).toBe('850 m');
    expect(distance(12_400)).toBe('12,4 km');
    expect(distance(null)).toBe('—');
    expect(duration(45)).toBe('45 s');
    expect(duration(420)).toBe('7 daq');
    expect(duration(3900)).toBe('1 soat 5 daq');
  });

  it('shows Tashkent time whatever the computer’s time zone', () => {
    const iso = '2026-09-26T19:30:00.000Z'; // 00:30 on the 27th in Tashkent
    expect(time(iso)).toBe('00:30');
    expect(date(iso)).toBe('27.09.2026');
    expect(dateTime(iso)).toBe('27.09 00:30');
    expect(date('2026-12-31')).toBe('31.12.2026');
    expect(tashkentDay(iso)).toBe('2026-09-27');
    expect(tashkentToday(Date.parse(iso))).toBe('2026-09-27');
    expect(tashkentMonth(Date.parse('2026-01-10T00:00:00Z'), -1)).toBe('2025-12');
  });

  it('counts years and days like the API', () => {
    expect(fullYears('2000-09-27', '2026-09-26')).toBe(25);
    expect(fullYears('2000-09-26', '2026-09-26')).toBe(26);
    expect(daysBetween('2026-09-26', '2026-10-26')).toBe(30);
    const now = Date.parse('2026-09-26T12:00:00Z');
    expect(ago('2026-09-26T11:59:40Z', now)).toBe('hozirgina');
    expect(ago('2026-09-26T11:55:00Z', now)).toBe('5 daq oldin');
    expect(ago('2026-09-26T10:40:00Z', now)).toBe('1 soat 20 daq oldin');
  });

  it('normalises Uzbek phones', () => {
    expect(normalizePhone('90 123 45 67')).toBe('+998901234567');
    expect(normalizePhone('998901234567')).toBe('+998901234567');
    expect(isUzPhone('+998 (90) 123-45-67')).toBe(true);
    expect(isUzPhone('12345')).toBe(false);
    expect(formatPhone('+998901234567')).toBe('+998 90 123 45 67');
  });
});

describe('api errors', () => {
  it('reads Uzbek messages and field issues', () => {
    const e = new ApiError(400, 'x', {
      issues: [{ path: 'reason', message: 'Sababini yozing' }],
    });
    expect(fieldErrors(e)).toEqual({ reason: 'Sababini yozing' });
    expect(errorText(new ApiError(500, 'Xatolik (500)'))).toMatch(/Serverda xatolik/);
    expect(errorText(new ApiError(409, 'Buyurtma allaqachon yakunlangan'))).toBe(
      'Buyurtma allaqachon yakunlangan',
    );
  });
});

describe('realtime', () => {
  it('invalidates what each operator event touches', () => {
    expect(staleKeys({ type: 'ride.updated', rideId: 'r1', status: 'driver_assigned' })).toEqual(
      expect.arrayContaining([['live'], ['rides'], ['ride', 'r1']]),
    );
    expect(staleKeys({ type: 'sos', sosId: 's1', rideId: 'r1' })).toEqual(
      expect.arrayContaining([['sos'], ['ride', 'r1']]),
    );
    expect(staleKeys({ type: 'driver.updated', status: 'blocked' })).toContainEqual(['drivers']);
    expect(staleKeys({ type: 'ping' })).toEqual([]);
    expect(staleKeys({ type: 'ready' }).length).toBeGreaterThan(3);
  });

  it('waits as long as the API asks before a new ticket', () => {
    expect(reconnectDelay(new ApiError(429, 'x', { retryAfterSeconds: 12 }))).toBe(12_000);
    expect(reconnectDelay(new ApiError(429, 'x'))).toBe(30_000);
    expect(reconnectDelay(new Error('offline'))).toBe(3000);
  });
});

describe('dispatch helpers', () => {
  const waiting = ride({ id: 'w', attentionAt: '2026-09-26T07:02:00.000Z' });
  const assigned = ride({ id: 'a', status: 'driver_assigned', driverId: 'd1' });
  const sos: SosEvent = {
    id: 's1',
    rideId: 'a',
    rideNumber: 102,
    rideStatus: 'in_progress',
    driverId: 'd1',
    role: 'rider',
    phone: '+998901112233',
    lat: 40.49,
    lng: 68.78,
    note: null,
    createdAt: '2026-09-26T07:05:00.000Z',
    resolvedAt: null,
    resolutionNote: null,
  };

  it('tells rides waiting for an operator and new alarms from known ones', () => {
    expect(needsDriver(waiting)).toBe(true);
    expect(needsDriver(ride())).toBe(false);
    // an attention mark stays after assignment: the ride no longer waits
    expect(needsDriver({ ...assigned, attentionAt: waiting.attentionAt })).toBe(false);
    const keys = alarmKeys([waiting, assigned], [sos, { ...sos, id: 's2', resolvedAt: 'x' }]);
    expect(keys).toEqual(['ride:w', 'sos:s1']);
    expect(freshKeys(null, keys)).toEqual([]);
    expect(freshKeys(new Set(['ride:w']), keys)).toEqual(['sos:s1']);
    expect(canAssign('searching') && canAssign('driver_assigned')).toBe(true);
    expect(canAssign('in_progress')).toBe(false);
  });

  it('puts waiting rides first, then searching ones, oldest first', () => {
    const older = ride({ id: 'o', requestedAt: '2026-09-26T06:00:00.000Z' });
    expect(sortForDispatch([assigned, ride(), older, waiting]).map((r) => r.id)).toEqual([
      'w',
      'o',
      'r1',
      'a',
    ]);
  });

  it('filters the live board by driver state, ride status, class and attention', () => {
    const board: LiveBoard = {
      drivers: [
        { id: 'd1', state: 'busy', class: 'economy' },
        { id: 'd2', state: 'free', class: 'comfort' },
        { id: 'd3', state: 'offered', class: 'economy' },
      ].map((d) => ({
        ...d,
        name: d.id,
        lat: 40.49,
        lng: 68.78,
        heading: null,
        locatedAt: null,
        onlineSince: null,
        plate: '20A123BC',
        rideId: null,
        rideStatus: null,
        offeredRideId: null,
      })) as LiveBoard['drivers'],
      rides: [waiting, assigned, ride({ id: 'c', class: 'comfort' })],
    };
    expect(countByState(board)).toEqual({ free: 1, offered: 1, busy: 1 });
    const all = filterLive(board, DEFAULT_LIVE_FILTERS);
    expect(all.drivers).toHaveLength(3);
    expect(all.rides[0]!.id).toBe('w');
    const comfortFree = filterLive(board, {
      ...DEFAULT_LIVE_FILTERS,
      driverStates: ['free'],
      rideClass: 'comfort',
    });
    expect(comfortFree.drivers.map((d) => d.id)).toEqual(['d2']);
    expect(comfortFree.rides.map((r) => r.id)).toEqual(['c']);
    expect(
      filterLive(board, { ...DEFAULT_LIVE_FILTERS, attentionOnly: true }).rides.map((r) => r.id),
    ).toEqual(['w']);
  });

  it('offers the caller’s past places, most used first', () => {
    const home = place(40.4901, 68.7801, 'Uy');
    const trips = [
      ride({ pickup: home, dropoff: place(40.51, 68.8, 'Bozor') }),
      ride({ pickup: place(40.49012, 68.78013, null), dropoff: place(40.52, 68.81, 'Vokzal') }),
    ];
    const known = knownPlaces(trips);
    expect(known[0]).toMatchObject({ address: 'Uy', uses: 2 });
    expect(known).toHaveLength(3);
    expect(placeLine({ ...home, landmark: 'maktab yonida' })).toBe('Uy (maktab yonida)');
    expect(placeLine(place(40.5, 68.7))).toBe('40.50000, 68.70000');
  });

  it('describes timeline events with driver names', () => {
    const names = (id: string) => (id === 'd1' ? 'Aziz' : null);
    const e = (type: string, data: Record<string, unknown>): RideEvent => ({
      id: type,
      type,
      actor: 'system',
      data,
      at: '2026-09-26T07:00:00.000Z',
    });
    expect(
      eventDetail(e('offered', { driverId: 'd1', kind: 'direct', etaS: 240, score: 91 }), names),
    ).toBe('Aziz, to‘g‘ridan-to‘g‘ri, yetib kelish 4 daq, reyting balli 91');
    expect(eventDetail(e('assigned', { driverId: 'd1', manual: true }), names)).toBe(
      'Aziz, operator tayinladi',
    );
    expect(eventDetail(e('cancelled', { reason: 'Takroriy', fee: 3000 }), names)).toBe(
      'Takroriy, jarima 3 000 so‘m',
    );
    expect(
      eventDetail(e('requested', { channel: 'phone', class: 'comfort', fare: 8800 }), names),
    ).toBe('telefon orqali, Komfort, 8 800 so‘m');
    expect(eventDetail(e('attention', { reason: 'no_driver' }), names)).toMatch(/topmadi/);
  });
});

describe('driver verification', () => {
  const driver: AdminDriver = {
    id: 'd1',
    fullName: 'Aziz Karimov',
    phone: '+998901112233',
    birthDate: '1990-05-01',
    pinfl: '12345678901234',
    licence: { number: 'AF1234567', categories: ['B'], issuedOn: '2015-01-01' },
    licenceCard: {
      number: 'LC-1',
      expiresOn: '2027-01-01',
      verification: 'valid',
      checkedAt: '2026-09-21T00:00:00Z',
    },
    status: 'pending',
    statusReason: null,
    approvedAt: null,
    isOnline: false,
    onlineSince: null,
    location: null,
    vehicle: {
      make: 'Chevrolet',
      model: 'Cobalt',
      colour: 'Oq',
      plate: '20A123BC',
      plateFormatted: '20 A 123 BC',
      year: 2020,
      seats: 4,
      class: 'economy',
      features: ['ac'],
    },
    documents: [],
    missingDocuments: ['selfie'],
    priority: { score: 91, acceptance: 0.8, reliability: 1, rating: 0.95, stars: 4.8 },
    stats: {
      offersReceived: 0,
      offersAccepted: 0,
      ridesCompleted: 0,
      ridesCancelled: 0,
      ratingCount: 0,
    },
    createdAt: '2026-09-20T00:00:00Z',
    history: [],
    licenceChecks: [],
    balance: 0,
  };
  const today = '2026-09-26';

  it('lists the Resolution 200 rules the API enforces on approval', () => {
    const failed = (d: AdminDriver) =>
      approvalChecks(d, today)
        .filter((c) => !c.ok)
        .map((c) => c.label);
    expect(failed(driver)).toEqual(['Barcha hujjatlar yuklangan']);
    expect(failed({ ...driver, missingDocuments: [] })).toEqual([]);
    const young = { ...driver, missingDocuments: [], birthDate: '2006-01-01' };
    expect(failed(young)).toEqual(['Yoshi 21 dan katta']);
    const damas = {
      ...driver,
      missingDocuments: [],
      vehicle: { ...driver.vehicle!, make: 'Daewoo', model: 'Damas', year: 2008 },
    };
    expect(failed(damas)).toHaveLength(2);
    const comfort = {
      ...driver,
      missingDocuments: [],
      vehicle: { ...driver.vehicle!, class: 'comfort' as const, features: [], year: 2018 },
    };
    expect(failed(comfort)).toHaveLength(2);
    const unchecked = {
      ...driver,
      missingDocuments: [],
      licenceCard: { ...driver.licenceCard, verification: 'unverified' as const },
    };
    expect(failed(unchecked)).toEqual(['Litsenziya kartochkasi reyestrda tasdiqlangan']);
  });

  it('warns about expiring cards and previews images only', () => {
    expect(expiryState('2026-09-25', today)).toBe('expired');
    expect(expiryState('2026-10-20', today)).toBe('soon');
    expect(expiryState('2027-09-26', today)).toBe('ok');
    expect(expiryState(null, today)).toBe('ok');
    expect(isImageUrl('https://cdn.example/doc.jpg')).toBe(true);
    expect(isImageUrl('https://cdn.example/doc.PDF?x=1')).toBe(false);
  });
});

describe('tax report CSV', () => {
  it('keeps PINFLs as text and totals at the bottom', () => {
    const csv = taxCsv({
      period: '2026-09',
      drivers: [
        {
          driverId: 'd1',
          fullName: 'Aziz; Karimov',
          pinfl: '01234567890123',
          rides: 3,
          base: 30000,
          amount: 300,
          remitted: false,
        },
      ],
      totals: { rides: 3, base: 30000, amount: 300 },
    });
    const lines = csv.replace('﻿', '').trim().split('\r\n');
    expect(csv.startsWith('﻿')).toBe(true);
    expect(lines).toHaveLength(3);
    expect(lines[1]).toBe('"Aziz; Karimov";="01234567890123";3;30000;300;yo‘q');
    expect(lines[2]).toBe('Jami;;3;30000;300;');
  });
});

describe('alarm badge', () => {
  it('counts waiting items in the title and the favicon', () => {
    expect(titleWithBadge(0)).toBe('SFF Taxi — dispetcher paneli');
    expect(titleWithBadge(3, 'SOS')).toBe('(3) SOS — SFF Taxi');
    expect(faviconSvg(2)).toContain('>2</text>');
    expect(faviconSvg(150)).not.toContain('<text');
  });
});

describe('live board from the stream', () => {
  const driver = (id: string, over: Partial<LiveBoard['drivers'][number]> = {}) => ({
    id,
    name: id,
    lat: 40.49,
    lng: 68.78,
    heading: null,
    locatedAt: '2026-09-26T07:00:00.000Z',
    onlineSince: null,
    plate: '20A123BC',
    class: 'economy' as const,
    rideId: null,
    rideStatus: null,
    offeredRideId: null,
    state: 'free' as const,
    ...over,
  });
  const board: LiveBoard = { drivers: [driver('d1'), driver('d2')], rides: [] };

  it('moves cars to the positions batch and asks for a refetch for new drivers', () => {
    const at = '2026-09-26T07:00:05.000Z';
    const moved = applyPositions(board, [
      { id: 'd1', lat: 40.5, lng: 68.79, heading: 90, at, busy: false },
    ]);
    expect(moved.board.drivers[0]).toMatchObject({
      lat: 40.5,
      lng: 68.79,
      heading: 90,
      locatedAt: at,
    });
    expect(moved.board.drivers[1]).toBe(board.drivers[1]);
    expect(moved.missing).toBe(false);
    // nothing changed: the same object, so nothing re-renders
    const same = applyPositions(board, [
      {
        id: 'd1',
        lat: 40.49,
        lng: 68.78,
        heading: null,
        at: board.drivers[0]!.locatedAt!,
        busy: false,
      },
    ]);
    expect(same.board).toBe(board);
    expect(
      applyPositions(board, [{ id: 'd9', lat: 1, lng: 1, heading: null, at, busy: true }]).missing,
    ).toBe(true);
  });

  it('marks drivers offered, freed or busy from offer events', () => {
    const offered = applyOffer(board, {
      type: 'offer.new',
      offerId: 'o1',
      rideId: 'r1',
      driverId: 'd1',
      expiresAt: 'x',
    });
    expect(offered.drivers[0]).toMatchObject({ state: 'offered', offeredRideId: 'r1' });
    const declined = applyOffer(offered, {
      type: 'offer.closed',
      offerId: 'o1',
      rideId: 'r1',
      driverId: 'd1',
      status: 'declined',
    });
    expect(declined.drivers[0]).toMatchObject({ state: 'free', offeredRideId: null });
    const accepted = applyOffer(offered, {
      type: 'offer.closed',
      offerId: 'o1',
      rideId: 'r1',
      driverId: 'd1',
      status: 'accepted',
    });
    expect(accepted.drivers[0]).toMatchObject({ state: 'busy', rideId: 'r1' });
    // a closed offer for another ride leaves the driver alone
    expect(
      applyOffer(offered, {
        type: 'offer.closed',
        offerId: 'o2',
        rideId: 'r2',
        driverId: 'd1',
        status: 'expired',
      }),
    ).toBe(offered);
  });

  it('polls slowly while the stream is up and fast while it is down', () => {
    expect(pollInterval('open', 30_000, 5000)).toBe(30_000);
    expect(pollInterval('down', 30_000, 5000)).toBe(5000);
    expect(pollInterval('connecting', 30_000, 5000)).toBe(5000);
  });

  it('refreshes appeals, complaints and trips on their events', () => {
    expect(staleKeys({ type: 'driver.appeal', appealId: 'a', driverId: 'd1' })).toContainEqual([
      'appeals',
    ]);
    expect(
      staleKeys({ type: 'complaint.updated', complaintId: 'c1', rideId: 'r1', status: 'open' }),
    ).toEqual([['complaints'], ['complaint', 'c1']]);
    expect(
      staleKeys({ type: 'intercity.updated', tripId: 't1', bookingId: null, status: 'x' }),
    ).toEqual([['intercity']]);
    expect(
      staleKeys({ type: 'offer.new', offerId: 'o', rideId: 'r1', driverId: 'd', expiresAt: 'x' }),
    ).not.toContainEqual(['live']);
  });
});

describe('server-side paging and filters', () => {
  it('builds the ride filters and the next cursor', () => {
    expect(
      ridesQuery({
        status: 'all',
        q: '90',
        driverId: 'd1',
        class: 'comfort',
        from: '2026-09-01',
        to: '',
      }),
    ).toBe('status=all&q=90&driverId=d1&class=comfort&from=2026-09-01');
    const page = Array.from({ length: 3 }, (_, i) => ({ id: `r${i}` }));
    expect(nextCursorOf(page, 3)).toBe('r2');
    expect(nextCursorOf(page, 200)).toBeUndefined();
  });
});

describe('licence, documents, money rules', () => {
  it('reads the reasons of a refused approval', () => {
    expect(
      approvalProblems({
        message: 'x',
        issues: [
          { path: 'licenceCard', message: 'Litsenziya kartochkasini tekshiring' },
          { path: 'documents', message: 'Hujjatlar yetishmaydi' },
          { path: 'documents', message: 'Hujjatlar yetishmaydi' },
        ],
      }),
    ).toEqual(['Litsenziya kartochkasini tekshiring', 'Hujjatlar yetishmaydi']);
    expect(approvalProblems(null)).toEqual([]);
  });

  it('tells pictures from PDFs by the upload type first', () => {
    expect(isImageFile('application/pdf', 'https://s3/x.jpg?sig')).toBe(false);
    expect(isImageFile('image/webp', 'https://s3/x?sig')).toBe(true);
    expect(isImageFile(null, 'https://s3/doc.pdf?X-Amz=1')).toBe(false);
    expect(isImageFile(null, null)).toBe(false);
  });

  it('checks ledger entries before they are sent', () => {
    expect(entryProblems('topup', 20_000, '', 0)).toEqual({});
    expect(entryProblems('adjustment', 500, '', 0)).toHaveProperty('note');
    expect(entryProblems('payout', 60_000, 'Click 123', 50_000).amount).toMatch(/50 000/);
    expect(entryProblems('payout', 50_000, '', 50_000)).toHaveProperty('note');
    expect(entryProblems('payout', 50_000, 'Humo *1234', 50_000)).toEqual({});
  });
});

describe('intercity', () => {
  it('prices bookings and route prices like the API', () => {
    const prices = { rear: 70_000, front: 80_000 };
    expect(bookingPrice(1, false, prices)).toBe(70_000);
    expect(bookingPrice(2, true, prices)).toBe(150_000);
    expect(routePriceProblems(70_000, 80_000)).toEqual({ rear: undefined, front: undefined });
    expect(routePriceProblems(80_000, 70_000).front).toMatch(/arzon/);
    expect(routePriceProblems(null, 500).rear).toBeTruthy();
    expect(routePriceProblems(null, 500).front).toMatch(/1 000/);
    expect(seatChoices(2)).toEqual([1, 2]);
    expect(seatChoices(7)).toEqual([1, 2, 3, 4]);
    expect(seatChoices(0)).toEqual([]);
    expect(isOpenTrip('boarding') && !isOpenTrip('departed')).toBe(true);
    expect(isLiveBooking('boarded') && !isLiveBooking('no_show')).toBe(true);
  });
});

describe('support and operations', () => {
  it('offers the fitting resolutions first', () => {
    expect(resolutionsFor('lost_item')[0]).toBe('item_returned');
    expect(resolutionsFor('safety').slice(0, 2)).toEqual(['driver_warned', 'driver_blocked']);
    expect(new Set(resolutionsFor('other')).size).toBe(6);
  });

  it('links outbox events to what they are about', () => {
    expect(eventLink({ payload: { rideId: 'r1', driverId: 'd1' } })).toEqual({
      to: '/rides/r1',
      label: 'safar',
    });
    expect(eventLink({ payload: { tripId: 't1' } })?.to).toBe('/intercity/t1');
    expect(eventLink({ payload: {} })).toBeNull();
  });

  it('validates the receipt settings like the API', () => {
    const ok = {
      city_item_name: 'Taksi xizmati',
      intercity_item_name: 'Shaharlararo',
      mxik_code: '10112001001000000',
      package_code: '1500',
      vat_percent: 0,
    };
    expect(fiscalProblems(ok)).toEqual({});
    expect(fiscalProblems({ ...ok, mxik_code: '123' })).toHaveProperty('mxik_code');
    expect(fiscalProblems({ ...ok, vat_percent: Number.NaN })).toHaveProperty('vat_percent');
    expect(isPlaceholder({ ...ok, mxik_code: '00000000000000000' })).toBe(true);
    expect(isPlaceholder(ok)).toBe(false);
  });
});

describe('rides for later', () => {
  it('takes Tashkent wall-clock times 30 minutes to 24 hours ahead', () => {
    const now = Date.parse('2026-09-26T07:00:00.000Z'); // 12:00 in Tashkent
    expect(tashkentLocalToIso('2026-09-26T13:30')).toBe('2026-09-26T08:30:00.000Z');
    expect(isoToTashkentLocal(now)).toBe('2026-09-26T12:00');
    expect(scheduleProblem('2026-09-26T13:00', now)).toBeNull();
    expect(scheduleProblem('2026-09-26T12:20', now)).toMatch(/30/);
    expect(scheduleProblem('2026-09-27T13:00', now)).toMatch(/24/);
    expect(scheduleProblem('', now)).toMatch(/kiriting/);
  });
});
