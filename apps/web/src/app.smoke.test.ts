/**
 * Mounts the whole panel against a mocked API and visits every screen, so a runtime error
 * in any page (bad hook order, undefined access) fails the build; then drives the operator's
 * main flows (manual assignment, cancellation, phone order, verification, settings) and
 * checks the requests they send.
 */
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { MemoryRouter } from 'react-router';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { sessionStore } from './api/client';
import type {
  AdminCity,
  AdminDriver,
  AdminRide,
  AdminRideItem,
  AdminTrip,
  Candidate,
  CargoRules,
  Complaint,
  CustomerLookup,
  DriverAppeal,
  DriverListItem,
  DriverPayout,
  FiscalReceipt,
  FiscalRules,
  IntercityPoint,
  LiveBoard,
  OutboxEvent,
  PaymentIntent,
  PoolRules,
  Quote,
  Rating,
  Refund,
  RouteFare,
  SosEvent,
  TaxReport,
  TripBooking,
} from './api/types';
import { App } from './App';
import { DEFAULT_TARIFF } from './lib/tariff';
import { FeedbackProvider } from './ui/feedback';

const R1 = '01a0de48-0000-7000-8000-000000000001';
const R2 = '01a0de48-0000-7000-8000-000000000002';
const R3 = '01a0de48-0000-7000-8000-000000000003';
const R4 = '01a0de48-0000-7000-8000-000000000004';
const R5 = '01a0de48-0000-7000-8000-000000000005';
const R6 = '01a0de48-0000-7000-8000-000000000006';
const R7 = '01a0de48-0000-7000-8000-000000000007';
const R8 = '01a0de48-0000-7000-8000-000000000008';
const T2 = '01a0de48-5555-7000-8000-000000000002';
const T3 = '01a0de48-5555-7000-8000-000000000003';
const RF1 = '01a0de48-aaaa-7000-8000-000000000001';
const RF2 = '01a0de48-aaaa-7000-8000-000000000002';
const D1 = '01a0de48-1111-7000-8000-000000000001';
const D2 = '01a0de48-1111-7000-8000-000000000002';
const D3 = '01a0de48-1111-7000-8000-000000000003';
const S1 = '01a0de48-2222-7000-8000-000000000001';
const C1 = '01a0de48-3333-7000-8000-000000000001';
const C2 = '01a0de48-3333-7000-8000-000000000002';
const U1 = '01a0de48-4444-7000-8000-000000000001';
const T1 = '01a0de48-5555-7000-8000-000000000001';
const B1 = '01a0de48-5555-7000-8000-000000000011';
const P1 = '01a0de48-6666-7000-8000-000000000001';
const CP1 = '01a0de48-7777-7000-8000-000000000001';
const AP1 = '01a0de48-8888-7000-8000-000000000001';
const OB1 = '01a0de48-9999-7000-8000-000000000031';

const now = Date.now();
const iso = (minutesAgo: number) => new Date(now - minutesAgo * 60_000).toISOString();

const place = (
  lat: number,
  lng: number,
  address: string | null,
  landmark: string | null = null,
) => ({
  lat,
  lng,
  address,
  landmark,
});

function rideItem(over: Partial<AdminRideItem>): AdminRideItem {
  return {
    id: R1,
    number: 1001,
    status: 'searching',
    channel: 'app',
    kind: 'city',
    class: 'economy',
    cityId: C1,
    pickup: place(40.4905, 68.7801, 'Navoiy ko‘chasi 12', '5-maktab yonida'),
    dropoff: place(40.5021, 68.7702, 'Markaziy bozor'),
    options: [],
    comment: null,
    distanceM: 3100,
    durationS: 480,
    fare: {
      quoted: 7000,
      waiting: 0,
      total: null,
      cancellationFee: 0,
      breakdown: {
        kind: 'city',
        rideClass: 'economy',
        distanceM: 3100,
        insideM: 3100,
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
    requestedAt: iso(6),
    assignedAt: null,
    arrivedAt: null,
    startedAt: null,
    completedAt: null,
    cancelledAt: null,
    scheduledFor: null,
    riderPhone: '+998901112233',
    riderName: 'Dilnoza',
    driverId: null,
    dispatchStage: 'operator',
    attentionAt: iso(2),
    ...over,
  };
}

const vehicle = {
  make: 'Chevrolet',
  model: 'Cobalt',
  colour: 'Oq',
  plate: '20A123BC',
  plateFormatted: '20 A 123 BC',
  class: 'economy' as const,
};

// a ride nobody took (operator needed), one on its way, one done (for the history lookup)
const waiting = rideItem({});
const assigned = rideItem({
  id: R2,
  number: 1002,
  status: 'driver_assigned',
  channel: 'phone',
  driverId: D1,
  vehicle,
  attentionAt: null,
  dispatchStage: 'direct',
  riderPhone: '+998907778899',
  riderName: null,
});
const done = rideItem({
  id: R3,
  number: 990,
  status: 'completed',
  driverId: D1,
  vehicle,
  attentionAt: null,
  riderPhone: '+998901234567',
  riderName: 'Karim aka',
  pickup: place(40.4911, 68.7812, 'Mustaqillik 5', 'Dorixona oldida'),
  dropoff: place(40.4822, 68.7913, 'Temir yo‘l vokzali'),
  requestedAt: iso(60 * 30),
});

const live: LiveBoard = {
  drivers: [
    {
      id: D1,
      name: 'Aziz Karimov',
      lat: 40.495,
      lng: 68.776,
      heading: 90,
      locatedAt: iso(0.2),
      onlineSince: iso(90),
      plate: '20A123BC',
      class: 'economy',
      rideId: R2,
      rideStatus: 'driver_assigned',
      offeredRideId: null,
      state: 'busy',
    },
    {
      id: D2,
      name: 'Bobur Toshev',
      lat: 40.49,
      lng: 68.79,
      heading: null,
      locatedAt: iso(0.5),
      onlineSince: iso(30),
      plate: '20B456CD',
      class: 'comfort',
      rideId: null,
      rideStatus: null,
      offeredRideId: null,
      state: 'free',
    },
    {
      id: D3,
      name: 'Sardor Ali',
      lat: null,
      lng: null,
      heading: null,
      locatedAt: null,
      onlineSince: iso(5),
      plate: '20C789EF',
      class: 'economy',
      rideId: null,
      rideStatus: null,
      offeredRideId: R1,
      state: 'offered',
    },
  ],
  rides: [assigned, waiting],
};

const rideDetail: AdminRide = {
  ...waiting,
  rider: { id: 'u1', name: 'Dilnoza', phone: '+998901112233', rating: 4.8, noShows: 1 },
  driver: null,
  createdBy: 'u1',
  dispatch: { stage: 'operator', directOffers: 3, broadcastAt: iso(4), attentionAt: iso(2) },
  earnings: null,
  offers: [
    {
      id: 'o1',
      driverId: D3,
      driverName: 'Sardor Ali',
      kind: 'direct',
      status: 'declined',
      etaS: 240,
      distanceM: 1500,
      score: 88,
      createdAt: iso(5),
      expiresAt: iso(4.7),
      respondedAt: iso(4.8),
      declineReason: 'too_far',
      declineReasonLabel: 'Juda uzoq',
    },
    {
      id: 'o2',
      driverId: D2,
      driverName: 'Bobur Toshev',
      kind: 'broadcast',
      status: 'expired',
      etaS: 420,
      distanceM: 2600,
      score: 91,
      createdAt: iso(4),
      expiresAt: iso(3.5),
      respondedAt: null,
    },
  ],
  events: [
    {
      id: 'e1',
      type: 'requested',
      actor: 'rider',
      data: { channel: 'app', class: 'economy', fare: 7000 },
      at: iso(6),
    },
    {
      id: 'e2',
      type: 'offered',
      actor: 'system',
      data: { driverId: D3, kind: 'direct', etaS: 240, score: 88 },
      at: iso(5),
    },
    {
      id: 'e3',
      type: 'offer_declined',
      actor: 'driver',
      data: { offerId: 'o1', kind: 'direct', reason: 'too_far' },
      at: iso(4.8),
      reasonLabel: 'Juda uzoq',
    },
    { id: 'e4', type: 'broadcast', actor: 'system', data: { drivers: 1 }, at: iso(4) },
    { id: 'e5', type: 'attention', actor: 'system', data: { reason: 'no_driver' }, at: iso(2) },
  ],
};

const assignedDetail: AdminRide = {
  ...rideDetail,
  status: 'driver_assigned',
  driver: {
    id: D2,
    name: 'Bobur Toshev',
    phone: '+998935554433',
    rating: 4.9,
    ridesCompleted: 120,
    location: { lat: 40.49, lng: 68.79, heading: null, at: iso(0.1) },
  },
  vehicle,
  events: [
    ...rideDetail.events,
    {
      id: 'e6',
      type: 'assigned',
      actor: 'operator',
      data: { driverId: D2, manual: true },
      at: iso(0),
    },
  ],
};

const cancelledDetail: AdminRide = {
  ...rideDetail,
  status: 'cancelled',
  cancelledBy: 'operator',
  cancelReason: 'Takroriy buyurtma',
};

// a cash ride cancelled with a fee the rider still owes; the driver gave it up first
const owedDetail: AdminRide = {
  ...rideDetail,
  id: R4,
  number: 980,
  status: 'cancelled',
  cancelledBy: 'rider',
  cancelReason: 'Rejam o‘zgardi',
  dispatch: { ...rideDetail.dispatch, attentionAt: null },
  fare: { ...rideDetail.fare, cancellationFee: 3000, cancellationFeeStatus: 'owed', owedFee: 0 },
  owedFees: {
    own: {
      amount: 3000,
      status: 'owed',
      collectingRideId: null,
      waivedBy: null,
      waiveNote: null,
    },
    collects: [],
  },
  events: [
    ...rideDetail.events,
    {
      id: 'e7',
      type: 'driver_released',
      actor: 'driver',
      data: { driverId: D3, reason: 'Avtomobil nosoz', reasonCode: 'car_problem' },
      at: iso(1),
      reasonLabel: 'Avtomobil nosoz',
    },
  ],
};

// a scheduled ride that will collect the owed fee of #980 on top of its fare
const collectingDetail: AdminRide = {
  ...rideDetail,
  id: R5,
  number: 1020,
  status: 'scheduled',
  scheduledFor: new Date(now + 3 * 3600_000).toISOString(),
  dispatch: { ...rideDetail.dispatch, attentionAt: null },
  fare: { ...rideDetail.fare, owedFee: 3000 },
  offers: [],
  owedFees: { own: null, collects: [{ rideId: R4, number: 980, amount: 3000, status: 'owed' }] },
};

const waivedDetail = (): AdminRide => ({
  ...owedDetail,
  fare: { ...owedDetail.fare, cancellationFeeStatus: 'waived' },
  owedFees: {
    own: { ...owedDetail.owedFees!.own!, status: 'waived', waiveNote: 'Haydovchi kechikdi' },
    collects: [],
  },
});

const reasonLabels = {
  decline: { too_far: 'Juda uzoq', destination: 'Bu tomonga bormayman' },
  driverCancel: { car_problem: 'Avtomobil nosoz', rider_no_show: 'Yo‘lovchi chiqmadi' },
  release: { reassigned: 'Operator boshqa haydovchiga berdi' },
};

const candidates: Candidate[] = [
  {
    driverId: D2,
    name: 'Bobur Toshev',
    position: { lat: 40.49, lng: 68.79 },
    straightM: 900,
    etaS: 180,
    distanceM: 1200,
    score: 91,
  },
];

const quote: Quote = {
  quoteId: 'q1',
  expiresAt: new Date(now + 10 * 60_000).toISOString(),
  city: {
    id: C1,
    slug: 'guliston',
    name: 'Guliston',
    nameUz: 'Guliston',
    nameRu: 'Гулистан',
    center: { lat: 40.496, lng: 68.776 },
    bbox: { minLat: 40.47, maxLat: 40.52, minLng: 68.74, maxLng: 68.81 },
    isActive: true,
    upcoming: false,
  },
  kind: 'city',
  distanceM: 2400,
  durationS: 360,
  routeSource: 'estimate',
  options: ['child_seat'],
  fares: {
    economy: { ...rideDetail.fare.breakdown, options: { child_seat: 2000 }, total: 9000 },
    comfort: {
      ...rideDetail.fare.breakdown,
      rideClass: 'comfort',
      base: 8800,
      options: { child_seat: 2000 },
      total: 10_800,
    },
  },
  paymentMethods: ['cash'],
  waiting: { free_minutes: 2, per_minute: 500 },
  cancellationFee: 3000,
};

const created: AdminRide = {
  ...rideDetail,
  id: '01a0de48-0000-7000-8000-000000000009',
  number: 1010,
  channel: 'phone',
  fare: { ...rideDetail.fare, quoted: 10_800 },
  class: 'comfort',
};

const driverItem = (over: Partial<DriverListItem>): DriverListItem => ({
  id: D1,
  fullName: 'Aziz Karimov',
  phone: '+998901234000',
  status: 'active',
  statusReason: null,
  isOnline: true,
  createdAt: iso(60 * 24 * 30),
  plate: '20A123BC',
  plateFormatted: '20 A 123 BC',
  make: 'Chevrolet',
  model: 'Cobalt',
  class: 'economy',
  lat: 40.495,
  lng: 68.776,
  locatedAt: iso(0.2),
  ridesCompleted: 120,
  licenceStatus: 'valid',
  balance: 35_000,
  cardOwed: 30_000,
  rating: 4.9,
  priority: 94,
  ...over,
});
const pendingDriver = driverItem({
  id: D3,
  fullName: 'Sardor Ali',
  status: 'pending',
  isOnline: false,
  createdAt: iso(60 * 5),
  licenceStatus: 'unverified',
  balance: 0,
  cardOwed: 0,
  ridesCompleted: 0,
});

const driverDetail: AdminDriver = {
  id: D3,
  fullName: 'Sardor Ali',
  phone: '+998901234001',
  birthDate: '1992-04-10',
  pinfl: '31004920123456',
  licence: { number: 'AF1234567', categories: ['B', 'C'], issuedOn: '2012-06-01' },
  licenceCard: {
    number: 'LK-20-000123',
    expiresOn: '2026-10-10',
    verification: 'unverified',
    checkedAt: null,
  },
  status: 'pending',
  statusReason: null,
  approvedAt: null,
  isOnline: false,
  onlineSince: null,
  location: null,
  vehicle: {
    make: 'Chevrolet',
    model: 'Nexia 3',
    colour: 'Kulrang',
    plate: '20C789EF',
    plateFormatted: '20 C 789 EF',
    year: 2019,
    seats: 4,
    class: 'economy',
    features: ['ac'],
  },
  documents: [
    {
      kind: 'licence_card',
      url: 'https://files.example/lc.jpg',
      expiresOn: '2026-10-10',
      uploadedAt: iso(300),
    },
    {
      kind: 'passport',
      uploadId: U1,
      url: 'https://files.example/passport.pdf',
      expiresOn: null,
      uploadedAt: iso(300),
    },
  ],
  missingDocuments: [
    'driver_licence',
    'vehicle_registration',
    'insurance',
    'vehicle_photo',
    'selfie',
  ],
  priority: { score: 91, acceptance: 0.8, reliability: 1, rating: 0.95, stars: 4.8 },
  stats: {
    offersReceived: 1,
    offersAccepted: 0,
    ridesCompleted: 0,
    ridesCancelled: 0,
    ratingCount: 0,
  },
  createdAt: iso(300),
  history: [
    { from: 'rejected', to: 'pending', reason: 'Ariza qayta yuborildi', actorId: D3, at: iso(300) },
  ],
  licenceChecks: [],
  balance: -4500,
};

const activeDetail: AdminDriver = {
  ...driverDetail,
  id: D1,
  fullName: 'Aziz Karimov',
  status: 'active',
  approvedAt: iso(60 * 24 * 20),
  licenceCard: {
    number: 'LK-20-000100',
    expiresOn: '2027-06-01',
    verification: 'valid',
    checkedAt: iso(60 * 24 * 20),
  },
  licenceChecks: [
    {
      source: 'manual',
      licenceCardNumber: 'LK-20-000100',
      result: 'valid',
      expiresOn: null,
      note: 'Reyestrda bor, 2027 gacha',
      checkedBy: 'op1',
      at: iso(60 * 24 * 20),
    },
  ],
  missingDocuments: [],
  gender: 'female',
  genderVerified: false,
  womenRidersOnly: false,
  pool: {
    enabled: true,
    extraPassengers: 1,
    destination: { lat: 40.27, lng: 68.82, address: 'Yangiyer avtovokzali' },
    destinationSetAt: iso(10),
    seats: { occupied: 1, capacity: 3, front: 1, rear: 0, free: 2 },
  },
  balance: 35_000,
  cardMoney: {
    credited: 80_000,
    paidOut: 50_000,
    owed: 30_000,
    payableNow: 30_000,
    lastPayoutAt: iso(60 * 24 * 3),
  },
};

const payouts: DriverPayout[] = [
  {
    driverId: D1,
    fullName: 'Aziz Karimov',
    phone: '+998901234000',
    status: 'active',
    balance: 25_000,
    credited: 80_000,
    paidOut: 50_000,
    owed: 30_000,
    payableNow: 25_000,
    lastPayoutAt: iso(60 * 24 * 3),
  },
];

const ledger = {
  items: [
    { id: 'l2', kind: 'tax', amount: -70, rideId: R3, note: null, createdAt: iso(60) },
    {
      id: 'l1',
      kind: 'topup',
      amount: 20_000,
      rideId: null,
      note: 'Ofisda naqd',
      createdAt: iso(600),
    },
  ],
  nextCursor: null,
};

const sos: SosEvent[] = [
  {
    id: S1,
    rideId: R2,
    rideNumber: 1002,
    rideStatus: 'in_progress',
    driverId: D1,
    role: 'rider',
    phone: '+998907778899',
    lat: 40.49,
    lng: 68.78,
    note: 'Haydovchi tez haydayapti',
    createdAt: iso(1),
    resolvedAt: null,
    resolutionNote: null,
  },
];

const taxReport: TaxReport = {
  period: '2026-08',
  drivers: [
    {
      driverId: D1,
      fullName: 'Aziz Karimov',
      pinfl: '31004920123457',
      rides: 42,
      base: 420_000,
      amount: 4200,
      remitted: false,
    },
  ],
  totals: { rides: 42, base: 420_000, amount: 4200 },
};

// a small square around central Guliston
const boundary: [number, number][][] = [
  [
    [68.74, 40.47],
    [68.81, 40.47],
    [68.81, 40.52],
    [68.74, 40.52],
    [68.74, 40.47],
  ],
];
const adminCities: AdminCity[] = [
  {
    id: C1,
    slug: 'guliston',
    nameUz: 'Guliston',
    nameRu: 'Гулистан',
    center: { lat: 40.496, lng: 68.776 },
    boundary,
    bbox: { minLat: 40.47, maxLat: 40.52, minLng: 68.74, maxLng: 68.81 },
    timezone: 'Asia/Tashkent',
    isActive: true,
    sort: 0,
    tariff: null,
  },
  {
    id: C2,
    slug: 'yangiyer',
    nameUz: 'Yangiyer',
    nameRu: 'Янгиер',
    center: { lat: 40.27, lng: 68.82 },
    boundary: [boundary[0]!.map(([x, y]) => [x, y - 0.22] as [number, number])],
    bbox: { minLat: 40.25, maxLat: 40.3, minLng: 68.74, maxLng: 68.81 },
    timezone: 'Asia/Tashkent',
    isActive: false,
    sort: 10,
    tariff: { ...DEFAULT_TARIFF, cancellation_fee: 4000 },
  },
];

const dispatchRules = {
  offer_timeout_seconds: 15,
  direct_offers: 3,
  search_radius_m: 5000,
  candidates: 10,
  broadcast_radius_m: 3000,
  broadcast_timeout_seconds: 30,
  search_timeout_seconds: 600,
  location_max_age_seconds: 120,
  tie_window_seconds: 60,
  no_show_after_minutes: 5,
};
const billingRules = {
  promo_until: '2026-12-31',
  commission_percent: 5,
  daily_cap: 10_000,
  weekly_cap: 55_000,
  intercity_commission_percent: 5,
  intercity_trip_cap: 10_000,
  tax_percent: 1,
  pass_day_price: 9000,
  pass_week_price: 50_000,
  min_balance: -10_000,
};

// Callers ---------------------------------------------------------------------------------

const lookup = (phone: string): CustomerLookup => {
  if (phone === '+998901234567') {
    return {
      found: true,
      phone,
      user: {
        id: 'u2',
        name: 'Karim aka',
        status: 'active',
        rating: 4.9,
        noShows: 0,
        since: iso(60 * 24 * 90),
      },
      openRide: null,
      recentRides: [done],
      recentPlaces: [done.pickup, done.dropoff],
      savedPlaces: [],
    };
  }
  if (phone === '+998901112233') {
    return {
      found: true,
      phone,
      user: {
        id: 'u1',
        name: 'Dilnoza',
        status: 'active',
        rating: 4.8,
        noShows: 1,
        since: iso(60 * 24 * 10),
      },
      openRide: rideDetail,
      recentRides: [waiting],
      recentPlaces: [],
      savedPlaces: [],
    };
  }
  if (phone === '+998935551122') {
    // a ride on its way, one for later, and a cancellation fee still owed
    return {
      found: true,
      phone,
      user: {
        id: 'u4',
        name: 'Gulnora',
        status: 'active',
        rating: 4.7,
        noShows: 0,
        since: iso(60 * 24 * 40),
      },
      openRide: rideDetail,
      recentRides: [
        rideItem({
          id: R5,
          number: 1020,
          status: 'scheduled',
          scheduledFor: collectingDetail.scheduledFor,
          attentionAt: null,
        }),
        done,
      ],
      recentPlaces: [],
      savedPlaces: [],
      owedFee: {
        amount: 3000,
        collectedWith: 'cash',
        label: 'Oldingi bekor qilingan safar uchun to‘lov',
        rides: [{ rideId: R4, number: 980, amount: 3000, cancelledAt: iso(60 * 24) }],
      },
    };
  }
  return { found: false, phone };
};

// Intercity ---------------------------------------------------------------------------------

const points: IntercityPoint[] = [
  {
    id: 'p1',
    slug: 'guliston',
    nameUz: 'Guliston',
    nameRu: 'Гулистан',
    lat: 40.49,
    lng: 68.78,
    meetingPoint: 'Guliston avtovokzali',
  },
  {
    id: 'p2',
    slug: 'toshkent',
    nameUz: 'Toshkent',
    nameRu: 'Ташкент',
    lat: 41.3,
    lng: 69.24,
    meetingPoint: 'Olmazor',
  },
];

const tripBooking: TripBooking = {
  id: B1,
  number: 77,
  tripId: T1,
  status: 'booked',
  channel: 'app',
  seats: 2,
  front: false,
  price: 140_000,
  pickupNote: 'Bozor oldida',
  cancelledBy: null,
  cancelReason: null,
  cancellationFee: 0,
  createdAt: iso(120),
  boardedAt: null,
  completedAt: null,
  cancelledAt: null,
  riderId: 'u3',
  riderName: 'Nodira',
  riderPhone: '+998935550011',
  commission: null,
  tax: null,
};

const trip: AdminTrip = {
  id: T1,
  number: 501,
  status: 'scheduled',
  from: points[0]!,
  to: points[1]!,
  departureAt: new Date(now + 3 * 3600_000).toISOString(),
  meetingPoint: 'Guliston avtovokzali',
  comment: 'Yukxona bo‘sh',
  class: 'economy',
  distanceM: 118_000,
  seats: { total: 4, free: 2, frontOffered: true, frontFree: true },
  price: { rear: 70_000, front: 80_000 },
  driver: {
    id: D1,
    name: 'Aziz Karimov',
    phone: '+998901234000',
    rating: 4.9,
    ridesCompleted: 120,
    photoUrl: null,
  },
  vehicle: {
    make: 'Chevrolet',
    model: 'Cobalt',
    colour: 'Oq',
    class: 'economy',
    photoUrl: null,
    plate: '20A123BC',
    plateFormatted: '20 A 123 BC',
  },
  referenceRear: 70_000,
  cancelledBy: null,
  cancelReason: null,
  boardingAt: null,
  departedAt: null,
  arrivedAt: null,
  cancelledAt: null,
  bookings: [tripBooking],
};

const routeFare = {
  from: points[0]!,
  to: points[1]!,
  class: 'economy' as const,
  distanceM: 118_000,
  durationS: 5400,
  source: 'route' as const,
  reference: { rear: 70_000, front: 80_000 },
  band: { min: 59_500, max: 80_500 },
};

// Money, support, operations ---------------------------------------------------------------

const refunds: Refund[] = [
  {
    id: 'P2',
    amount: 28_000,
    provider: 'payme',
    paidAt: iso(300),
    refundRequestedAt: iso(30),
    purpose: 'booking',
    rideId: null,
    rideNumber: null,
    bookingId: B1,
    bookingNumber: 77,
    riderPhone: '+998935550011',
    cancelReason: 'Qatnov bekor qilindi',
  },
  {
    id: P1,
    amount: 12_000,
    provider: 'click',
    paidAt: iso(90),
    refundRequestedAt: iso(80),
    rideId: R3,
    rideNumber: 990,
    riderPhone: '+998901234567',
    cancelReason: 'Haydovchi topilmadi',
  },
];

const complaint: Complaint = {
  id: CP1,
  rideId: R3,
  rideNumber: 990,
  riderId: 'u2',
  driverId: D1,
  type: 'lost_item',
  typeLabel: 'Mashinada narsa qoldi',
  status: 'open',
  text: 'Orqa o‘rindiqda telefonim qoldi',
  resolution: null,
  resolutionNote: null,
  resolvedBy: null,
  resolvedAt: null,
  createdAt: iso(40),
  messages: [{ id: 'm1', authorRole: 'rider', text: 'Qora Samsung', at: iso(35) }],
};

const appeal: DriverAppeal = {
  id: AP1,
  driverId: D2,
  fullName: 'Bobur Toshev',
  phone: '+998935554433',
  driverStatus: 'blocked',
  statusReason: 'Shikoyatlar',
  statusAt: 'blocked',
  text: 'Iltimos, qayta ko‘rib chiqing, xato tushunmovchilik bo‘ldi',
  status: 'open',
  resolution: null,
  resolvedBy: null,
  resolvedAt: null,
  createdAt: iso(200),
};

const ratingRow: Rating = {
  id: 'g1',
  rideId: R3,
  rideNumber: 990,
  authorRole: 'rider',
  authorId: 'u2',
  authorName: 'Karim aka',
  subjectId: D1,
  subjectName: 'Aziz Karimov',
  subjectPhone: '+998901234000',
  stars: 2,
  tags: ['Qo‘pol'],
  comment: 'Telefonda gaplashib haydadi',
  createdAt: iso(50),
};

const receipt: FiscalReceipt = {
  id: 'fr1',
  rideId: R3,
  bookingId: null,
  provider: 'none',
  status: 'skipped',
  amount: 7000,
  receiptId: null,
  url: null,
  attempts: 1,
  lastError: null,
  payload: {
    receiptNumber: `R-${R3}`,
    kind: 'ride',
    orderNumber: 990,
    items: [
      { name: 'Taksi xizmati', mxik: '00000000000000000', packageCode: '0000000', price: 700_000 },
    ],
  },
  createdAt: iso(55),
  sentAt: null,
};

const pendingReceipt: FiscalReceipt = {
  ...receipt,
  id: 'fr2',
  status: 'pending',
  provider: 'ofd',
  attempts: 3,
  lastError: 'OFD: 503 Service Unavailable',
  payload: {
    ...receipt.payload,
    receiptNumber: 'R-pending',
    orderNumber: 991,
    receivedCash: 700_000,
  },
};

const intents: PaymentIntent[] = [
  {
    id: 'pi1',
    purpose: 'ride',
    status: 'refund_pending',
    amount: 12_000,
    provider: 'click',
    rideId: R3,
    rideNumber: 990,
    driverId: null,
    driverName: null,
    userId: 'u2',
    phone: '+998901234567',
    expiresAt: iso(80),
    paidAt: iso(90),
    refundRequestedAt: iso(80),
    refundedAt: null,
    refundReference: null,
    createdAt: iso(95),
  },
  {
    id: 'pi2',
    purpose: 'topup',
    status: 'paid',
    amount: 50_000,
    provider: 'payme',
    rideId: null,
    rideNumber: null,
    driverId: D1,
    driverName: 'Aziz Karimov',
    userId: D1,
    phone: '+998901234000',
    expiresAt: iso(100),
    paidAt: iso(108),
    refundRequestedAt: null,
    refundedAt: null,
    refundReference: null,
    createdAt: iso(110),
  },
];

const intentSummary = [
  { purpose: 'ride', status: 'paid', count: 14, amount: 168_000 },
  { purpose: 'ride', status: 'refund_pending', count: 1, amount: 12_000 },
  { purpose: 'ride', status: 'expired', count: 3, amount: 30_000 },
  { purpose: 'topup', status: 'paid', count: 2, amount: 90_000 },
  { purpose: 'booking', status: 'paid', count: 3, amount: 42_000 },
];

const fiscalRules: FiscalRules = {
  city_item_name: 'Taksi xizmati (yo‘lovchi tashish)',
  intercity_item_name: 'Shaharlararo yo‘lovchi tashish (o‘rindiq)',
  cargo_item_name: 'Yuk tashish xizmati',
  delivery_item_name: 'Yetkazib berish xizmati (posilka)',
  mxik_code: '00000000000000000',
  package_code: '0000000',
  vat_percent: 0,
};

const intercityRules = {
  price_band_percent: 15,
  publish_max_days_ahead: 7,
  publish_min_minutes_ahead: 15,
  free_cancel_minutes: 60,
  late_cancel_fee_percent: 30,
  boarding_opens_minutes: 60,
  along_route_max_km: 15,
};

const outboxEvent: OutboxEvent = {
  id: OB1,
  topic: 'fiscal.receipt_due',
  payload: { rideId: R3 },
  attempts: 10,
  maxAttempts: 10,
  lastError: 'OFD: 503 Service Unavailable',
  nextAttemptAt: iso(-5),
  createdAt: iso(300),
};

/** A page of the ride list: 200 rides, so the list offers the next one. */
const fullPage = Array.from({ length: 200 }, (_, i) =>
  rideItem({
    id: `01a0de48-0000-7000-8000-${String(1000 + i).padStart(12, '0')}`,
    number: 5000 - i,
    status: 'completed',
    class: 'comfort',
    attentionAt: null,
  }),
);

// Wave 4: fixed route prices, shared-ride rules, deposits, a shared women-only ride -----------

const routeFares: RouteFare[] = [
  {
    id: RF1,
    class: 'economy',
    seatPrice: 10_000,
    carPrice: null,
    isActive: true,
    updatedAt: iso(600),
    from: { slug: 'yangiyer', name: 'Yangiyer', lat: 40.27, lng: 68.82 },
    to: { slug: 'guliston', name: 'Guliston', lat: 40.49, lng: 68.78 },
  },
  {
    id: RF2,
    class: 'comfort',
    seatPrice: 70_000,
    carPrice: 260_000,
    isActive: false,
    updatedAt: iso(900),
    from: { slug: 'guliston', name: 'Guliston', lat: 40.49, lng: 68.78 },
    to: { slug: 'toshkent', name: 'Toshkent', lat: 41.3, lng: 69.24 },
  },
];

const poolRules: PoolRules = {
  enabled: true,
  discount_percent: 15,
  full_discount_share_percent: 50,
  max_detour_seconds_city: 360,
  max_detour_seconds_intercity: 900,
  max_detour_percent: 50,
  max_pickup_eta_seconds: 900,
  search_radius_m: 8000,
  pool_preference_seconds: 90,
  max_riders: 3,
};

const bookingRules = { deposit_percent: 20, deposit_min: 5000, payment_minutes: 15 };

/** Two people sharing Aziz's car with another rider, a woman driver asked, a deposit paid. */
const pooledDetail: AdminRide = {
  ...rideDetail,
  id: R6,
  number: 1006,
  status: 'in_progress',
  dispatch: { ...rideDetail.dispatch, attentionAt: null },
  passengers: 2,
  shareable: true,
  womenOnly: true,
  fareMode: 'car',
  pool: { id: 'pl1', sharedM: 20_000 },
  hasStartPin: true,
  fare: {
    ...rideDetail.fare,
    quoted: 100_000,
    poolDiscount: 15_000,
    pays: 85_000,
    deposit: 20_000,
  },
  events: [
    ...rideDetail.events,
    {
      id: 'e9',
      type: 'pool_joined',
      actor: 'system',
      data: { otherRideId: R2, sharedM: 20_000, discount: 15_000, pays: 85_000 },
      at: iso(1),
    },
    {
      id: 'e10',
      type: 'pool_left',
      actor: 'system',
      data: { sharedM: 0, discount: 0, pays: 100_000 },
      at: iso(0.5),
    },
  ],
};

/** Aziz carries two riders sharing the car: the API lists him once per ride. */
const pooledRide = rideItem({
  id: R6,
  number: 1006,
  status: 'in_progress',
  driverId: D1,
  vehicle,
  attentionAt: null,
  dispatchStage: 'direct',
  passengers: 2,
  shareable: true,
  pool: { id: 'pl1', sharedM: 20_000 },
});
const pooledLive: LiveBoard = {
  // Bobur drives a cargo van
  drivers: [
    // (a fresh fix: an earlier test's positions batch dropped his older one)
    ...live.drivers.map((d) =>
      d.id === D2 ? { ...d, cargoClass: 'cargo_s' as const, locatedAt: iso(0) } : d,
    ),
    { ...live.drivers[0]!, rideId: R6, rideStatus: 'in_progress' },
  ],
  rides: [{ ...assigned, shareable: true, pool: { id: 'pl1', sharedM: 0 } }, pooledRide, waiting],
};

// Cargo and delivery, deposits, the trip board's new bookings ----------------------------------

const cargoRules: CargoRules = {
  enabled: true,
  classes: {
    cargo_s: {
      base: 35_000,
      included_km: 10,
      included_minutes: 20,
      per_km: 1500,
      intercity_per_km: 1500,
      per_minute: 300,
      max_payload_kg: 700,
    },
    cargo_m: {
      base: 56_000,
      included_km: 10,
      included_minutes: 20,
      per_km: 2400,
      intercity_per_km: 2400,
      per_minute: 400,
      max_payload_kg: 1500,
    },
  },
  loader_price: 30_000,
  max_loaders: 2,
  night: { percent: 20, from: '23:00', to: '06:00' },
  intercity_from_km: 20,
  delivery: { enabled: true, percent: 100, max_weight_kg: 10 },
};

/** A Gazel with two loaders moving a fridge, the customer in the cab. */
const cargoDetail: AdminRide = {
  ...rideDetail,
  id: R7,
  number: 1007,
  status: 'driver_assigned',
  service: 'cargo',
  class: 'cargo_m',
  cargo: { loaders: 2, riderRides: true, description: 'Muzlatgich', weightKg: 120 },
  delivery: null,
};

/** A parcel for later, held until its card deposit is paid. */
const deliveryDetail: AdminRide = {
  ...rideDetail,
  id: R8,
  number: 1008,
  status: 'awaiting_payment',
  scheduledFor: iso(-120),
  service: 'delivery',
  cargo: null,
  delivery: {
    parcel: { description: 'Hujjatlar papkasi', weightKg: 1 },
    recipientName: 'Olim',
    recipientPhone: '+998907654321',
  },
  fare: { ...rideDetail.fare, quoted: 20_000, deposit: 5000, pays: 20_000 },
};

/** A small cargo van (Damas) with its payload from the inspection. */
const cargoDriverDetail: AdminDriver = {
  ...activeDetail,
  id: D2,
  fullName: 'Bobur Toshev',
  vehicle: {
    ...activeDetail.vehicle!,
    make: 'Chevrolet',
    model: 'Damas',
    service: 'cargo',
    body: 'van',
    payloadKg: 700,
    grossKg: 1300,
    cargoClass: 'cargo_s',
  },
};

const tripTown = (slug: string, nameUz: string) => ({ id: slug, slug, nameUz, nameRu: nameUz });

/** A trip with a paid deposit, one waiting for it (a seat along the way) and one expired. */
const depositTrip: AdminTrip = {
  ...trip,
  id: T2,
  number: 502,
  bookings: [
    { ...tripBooking, depositAmount: 28_000, payCash: 112_000 },
    {
      ...tripBooking,
      id: 'b3',
      number: 79,
      status: 'awaiting_payment',
      seats: 1,
      price: 56_000,
      depositAmount: 12_000,
      payCash: 44_000,
      pickupNote: null,
      alongTheWay: true,
      pickup: tripTown('yangiyer', 'Yangiyer'),
      dropoff: tripTown('toshkent', 'Toshkent'),
    },
    {
      ...tripBooking,
      id: 'b4',
      number: 80,
      status: 'cancelled',
      cancelledBy: 'system',
      cancelledAt: iso(10),
      depositAmount: 28_000,
      payCash: 112_000,
    },
  ],
};

/** A Tashkent trip passing the caller's towns: the seat priced for their part. */
const alongTrip = {
  ...trip,
  id: T3,
  number: 503,
  from: { ...points[0]!, id: 'p0', slug: 'sirdaryo', nameUz: 'Sirdaryo' },
  alongTheWay: true,
  pickup: points[0]!,
  dropoff: points[1]!,
  share: 0.8,
  price: { rear: 56_000, front: 64_000 },
  fullPrice: { rear: 70_000, front: 80_000 },
};

type Init = RequestInit | undefined;
type Mock = unknown | ((init: Init, path: string) => unknown);
const method = (init: Init) => init?.method ?? 'GET';
const body = (init: Init) => (init?.body ? JSON.parse(init.body as string) : null);

/** Per-test overrides of what an endpoint answers. */
const state = {
  rideAfterAction: null as AdminRide | null,
  /** POST admin/rides: 201 for a new ride, 200 when the request id was seen. */
  orderStatus: 201,
  /** POST admin/drivers/:id/approve refuses with the API's 422. */
  refuseApproval: false,
  scheduledPhoneOrders: false,
  /** The last quote was for later: the order made with it is a scheduled ride. */
  quotedFor: null as string | null,
  /** POST admin/rides/:id/fee/waive was called: the ride reads waived. */
  feeWaived: false,
  /** An API without admin/settings/booking (another branch lands it). */
  bookingMissing: false,
  /** The live board carries a shared car (listed once per ride, as the API does). */
  pooledLive: false,
};

/** A mock answer with another status than 200/201. */
const withStatus = (status: number, body: unknown) => ({ __status: status, body });

const query = (path: string) => new URLSearchParams(path.split('?')[1]);

const routes: [RegExp, Mock][] = [
  [
    /^\/v1\/me$/,
    { id: 'op1', phone: '+998900000001', fullName: 'Malika', isAdmin: true, driver: null },
  ],
  [/^\/v1\/auth\/code$/, { expiresInSeconds: 300, resendAfterSeconds: 60 }],
  [
    /^\/v1\/auth\/verify$/,
    { accessToken: 'a2', accessTokenExpiresIn: 900, refreshToken: 'r2', isNewUser: false },
  ],
  [/^\/v1\/stream\/ticket$/, { ticket: 'x'.repeat(32), expiresInSeconds: 60 }],
  [
    /^\/v1\/config$/,
    () => ({
      support: { phone: null, telegram: null, officeAddress: null },
      features: {
        cardPayments: true,
        uploads: true,
        intercity: true,
        scheduledRides: true,
        scheduledPhoneOrders: state.scheduledPhoneOrders,
      },
      cardProviders: ['payme', 'click'],
    }),
  ],
  [
    /^\/v1\/uploads\/[^/]+$/,
    {
      id: U1,
      purpose: 'document',
      contentType: 'application/pdf',
      sizeBytes: 2_400_000,
      status: 'ready',
      url: 'https://s3.example/documents/passport?X-Amz-Signature=fresh',
      createdAt: iso(300),
    },
  ],
  [
    /^\/v1\/geo\/config$/,
    {
      provider: 'osm',
      yandex: null,
      osm: { tileUrl: 'https://tile.example/{z}/{x}/{y}.png', attribution: '© OSM', maxZoom: 19 },
      geocoder: 'nominatim',
      defaultCenter: { lat: 40.496, lng: 68.776 },
      defaultZoom: 13,
      cities: adminCities.map((c) => ({
        ...quote.city,
        id: c.id,
        name: c.nameUz,
        isActive: c.isActive,
        boundary: c.boundary,
      })),
    },
  ],
  [
    /^\/v1\/geo\/search$/,
    [
      {
        title: 'Navoiy ko‘chasi 20',
        subtitle: 'Guliston',
        street: 'Navoiy',
        house: '20',
        district: null,
        locality: 'Guliston',
        lat: 40.4931,
        lng: 68.7822,
        kind: 'house',
        cityId: C1,
        serviceable: true,
      },
    ],
  ],
  [/^\/v1\/geo\/reverse$/, { address: null, city: null, serviceable: true }],
  [/^\/v1\/admin\/dispatch\/live$/, () => (state.pooledLive ? pooledLive : live)],
  [/^\/v1\/admin\/dispatch\/rides\/[^/]+\/candidates$/, candidates],
  [
    /^\/v1\/admin\/rides\/quote$/,
    (init: Init) => {
      state.quotedFor = (body(init).scheduledFor as string | undefined) ?? null;
      // operators' quotes carry no owed line (the caller lookup does)
      return { ...quote, scheduledFor: state.quotedFor, owedFee: null };
    },
  ],
  [/^\/v1\/admin\/reasons$/, reasonLabels],
  [
    /^\/v1\/admin\/rides\/[^/]+\/fee\/waive$/,
    () => {
      state.feeWaived = true;
      return waivedDetail();
    },
  ],
  [/^\/v1\/admin\/customers\/lookup$/, (init: Init) => lookup(body(init).phone)],
  [/^\/v1\/admin\/rides\/[^/]+\/assign$/, () => (state.rideAfterAction = assignedDetail)],
  [/^\/v1\/admin\/rides\/[^/]+\/cancel$/, () => (state.rideAfterAction = cancelledDetail)],
  [
    /^\/v1\/admin\/rides\/[^/]+$/,
    (_init: Init, path: string) =>
      path.includes(R4)
        ? state.feeWaived
          ? waivedDetail()
          : owedDetail
        : path.includes(R5)
          ? collectingDetail
          : path.includes(R6)
            ? pooledDetail
            : path.includes(R7)
              ? cargoDetail
              : path.includes(R8)
                ? deliveryDetail
                : (state.rideAfterAction ?? rideDetail),
  ],
  [
    /^\/v1\/admin\/rides$/,
    (init: Init, path: string) => {
      if (method(init) === 'POST') {
        return withStatus(
          state.orderStatus,
          state.quotedFor
            ? { ...created, status: 'scheduled', scheduledFor: state.quotedFor }
            : created,
        );
      }
      const q = query(path);
      if (q.get('class') === 'comfort') return q.get('cursor') ? [done] : fullPage;
      const status = q.get('status');
      const text = q.get('q');
      const all = [waiting, assigned, done];
      return all.filter(
        (r) =>
          (status === 'all' ||
            (status === 'open'
              ? r.status !== 'completed' && r.status !== 'cancelled'
              : r.status === status)) &&
          (!text || r.riderPhone.includes(text) || String(r.number) === text) &&
          (!q.get('driverId') || r.driverId === q.get('driverId')),
      );
    },
  ],
  [/^\/v1\/admin\/drivers\/appeals\/[^/]+\/resolve$/, { ...appeal, status: 'resolved' }],
  [
    /^\/v1\/admin\/drivers\/appeals$/,
    (_init: Init, path: string) => (query(path).get('status') === 'resolved' ? [] : [appeal]),
  ],
  [
    /^\/v1\/admin\/drivers\/[^/]+\/approve$/,
    () =>
      state.refuseApproval
        ? withStatus(422, {
            statusCode: 422,
            message: 'Litsenziya kartochkasini Transport vazirligi reyestrida tekshiring',
            issues: [
              {
                path: 'licenceCard',
                message: 'Litsenziya kartochkasini Transport vazirligi reyestrida tekshiring',
              },
              { path: 'documents', message: 'Hujjatlar yetishmaydi: selfie' },
            ],
          })
        : { ...driverDetail, status: 'active' },
  ],
  [/^\/v1\/admin\/drivers\/[^/]+\/(reject|block|unblock)$/, { ...driverDetail, status: 'active' }],
  [
    /^\/v1\/admin\/drivers\/[^/]+\/licence$/,
    {
      ...driverDetail,
      licenceCard: { ...driverDetail.licenceCard, verification: 'valid', checkedAt: iso(0) },
    },
  ],
  [/^\/v1\/admin\/drivers\/payouts$/, payouts],
  [
    /^\/v1\/admin\/drivers\/[^/]+\/gender$/,
    (init: Init) => ({ ...activeDetail, gender: body(init).gender, genderVerified: true }),
  ],
  [/^\/v1\/admin\/drivers\/[^/]+\/rides$/, [done]],
  [/^\/v1\/admin\/drivers\/[^/]+\/vehicle$/, driverDetail],
  [
    /^\/v1\/admin\/drivers\/[^/]+$/,
    (_init: Init, path: string) =>
      path.includes(D1) ? activeDetail : path.includes(D2) ? cargoDriverDetail : driverDetail,
  ],
  [
    /^\/v1\/admin\/drivers$/,
    (_init: Init, path: string) => {
      const status = query(path).get('status');
      const all = [
        pendingDriver,
        driverItem({}),
        driverItem({
          id: D2,
          fullName: 'Bobur Toshev',
          status: 'blocked',
          statusReason: 'Shikoyatlar',
          isOnline: false,
          balance: -2000,
        }),
      ];
      return status ? all.filter((d) => d.status === status) : all;
    },
  ],
  [
    /^\/v1\/admin\/billing\/drivers\/[^/]+\/ledger$/,
    (init: Init) =>
      method(init) === 'POST' ? { balance: 15_500, minBalance: -10_000, canWork: true } : ledger,
  ],
  [/^\/v1\/admin\/billing\/taxes\/remit$/, { period: '2026-08', rows: 42 }],
  [/^\/v1\/admin\/billing\/taxes$/, taxReport],
  [/^\/v1\/admin\/payments\/refunds$/, refunds],
  [/^\/v1\/admin\/payments\/intents\/summary$/, intentSummary],
  [
    /^\/v1\/admin\/payments\/intents$/,
    (_init: Init, path: string) => {
      const q = query(path);
      return {
        items: intents.filter(
          (i) =>
            (!q.get('purpose') || i.purpose === q.get('purpose')) &&
            (!q.get('phone') || i.phone === q.get('phone')),
        ),
        nextCursor: null,
      };
    },
  ],
  [/^\/v1\/admin\/payments\/[^/]+\/refunded$/, { id: P1, status: 'refunded' }],
  [/^\/v1\/intercity\/points$/, points],
  [/^\/v1\/intercity\/fares$/, routeFare],
  [/^\/v1\/admin\/intercity\/search$/, [trip, alongTrip]],
  [/^\/v1\/admin\/intercity\/trips\/[^/]+\/bookings$/, { ...tripBooking, id: 'b2', number: 78 }],
  [
    /^\/v1\/admin\/intercity\/trips\/[^/]+\/cancel$/,
    { ...trip, status: 'cancelled', cancelledBy: 'operator', cancelReason: 'Mashina buzildi' },
  ],
  [
    /^\/v1\/admin\/intercity\/trips\/[^/]+$/,
    (_init: Init, path: string) => (path.includes(T2) ? depositTrip : trip),
  ],
  [/^\/v1\/admin\/intercity\/trips$/, [trip]],
  [/^\/v1\/admin\/intercity\/bookings\/[^/]+\/cancel$/, { ...tripBooking, status: 'cancelled' }],
  [
    /^\/v1\/admin\/intercity\/fares$/,
    (init: Init) =>
      method(init) === 'PUT'
        ? routeFare
        : [{ from: 'guliston', to: 'toshkent', rear: 70_000, front: 80_000, updatedAt: iso(600) }],
  ],
  [/^\/v1\/admin\/complaints\/[^/]+\/messages$/, complaint],
  [/^\/v1\/admin\/complaints\/[^/]+\/resolve$/, { ...complaint, status: 'resolved' }],
  [/^\/v1\/admin\/complaints\/[^/]+$/, complaint],
  [
    /^\/v1\/admin\/complaints$/,
    (_init: Init, path: string) => ({
      items:
        query(path).get('status') === 'resolved'
          ? []
          : [{ ...complaint, riderPhone: '+998901234567', updatedAt: iso(35) }],
      nextCursor: null,
    }),
  ],
  [/^\/v1\/admin\/ratings$/, { items: [ratingRow], nextCursor: null }],
  [/^\/v1\/admin\/fiscal\/receipts\/resend$/, { queued: 1 }],
  [
    /^\/v1\/admin\/fiscal\/receipts\/[^/]+\/retry$/,
    { ...pendingReceipt, attempts: 0, lastError: null },
  ],
  [
    /^\/v1\/admin\/fiscal\/receipts\/(?!resend)[^/]+$/,
    (_init: Init, path: string) => (path.endsWith('fr2') ? pendingReceipt : receipt),
  ],
  [/^\/v1\/admin\/fiscal\/receipts$/, [receipt, pendingReceipt]],
  [/^\/v1\/admin\/outbox\/[^/]+\/retry$/, { id: OB1, topic: outboxEvent.topic, attempts: 0 }],
  [
    /^\/v1\/admin\/outbox$/,
    (_init: Init, path: string) => (query(path).get('state') === 'failing' ? [] : [outboxEvent]),
  ],
  [/^\/v1\/admin\/sos\/[^/]+\/resolve$/, { id: S1, resolved: true }],
  [/^\/v1\/admin\/sos$/, sos],
  [
    /^\/v1\/admin\/settings\/tariff$/,
    (init: Init) => (method(init) === 'PUT' ? body(init) : DEFAULT_TARIFF),
  ],
  [
    /^\/v1\/admin\/settings\/dispatch$/,
    (init: Init) => (method(init) === 'PUT' ? body(init) : dispatchRules),
  ],
  [
    /^\/v1\/admin\/settings\/billing$/,
    (init: Init) => (method(init) === 'PUT' ? body(init) : billingRules),
  ],
  [
    /^\/v1\/admin\/settings\/intercity$/,
    (init: Init) => (method(init) === 'PUT' ? body(init) : intercityRules),
  ],
  [
    /^\/v1\/admin\/settings\/fiscal$/,
    (init: Init) => (method(init) === 'PUT' ? body(init) : fiscalRules),
  ],
  [/^\/v1\/admin\/geo\/cities\/[^/]+$/, (init: Init) => ({ ...adminCities[1]!, ...body(init) })],
  [/^\/v1\/admin\/geo\/cities$/, adminCities],
  [
    /^\/v1\/admin\/settings\/cargo$/,
    (init: Init) => (method(init) === 'PUT' ? body(init) : cargoRules),
  ],
  [
    /^\/v1\/admin\/settings\/pool$/,
    (init: Init) => (method(init) === 'PUT' ? body(init) : poolRules),
  ],
  [
    /^\/v1\/admin\/settings\/booking$/,
    (init: Init) =>
      state.bookingMissing
        ? withStatus(404, { statusCode: 404, message: 'Cannot GET /v1/admin/settings/booking' })
        : method(init) === 'PUT'
          ? body(init)
          : bookingRules,
  ],
  // DELETE answers 204 in the API; the mock sends an empty 200
  [/^\/v1\/admin\/routes\/[^/]+$/, null],
  // PUT answers the whole list
  [/^\/v1\/admin\/routes$/, routeFares],
];

const unmatched: string[] = [];
/** Every request the panel made: path, method and JSON body. */
const calls: { path: string; method: string; body: unknown }[] = [];
const streams: { onmessage: ((m: { data: string }) => void) | null }[] = [];

beforeAll(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string, init?: RequestInit) => {
      const path = url.replace(/^https?:\/\/[^/]+/, '');
      const pathOnly = path.split('?')[0]!;
      calls.push({ path, method: method(init), body: body(init) });
      const hit = routes.find(([re]) => re.test(pathOnly));
      if (!hit) unmatched.push(path);
      const data = hit ? (typeof hit[1] === 'function' ? hit[1](init, path) : hit[1]) : null;
      const custom = data as { __status?: number; body?: unknown } | null;
      const status = !hit ? 404 : (custom?.__status ?? 200);
      const payload = !hit ? { message: 'not mocked' } : custom?.__status ? custom.body : data;
      return new Response(JSON.stringify(payload), {
        status,
        headers: { 'Content-Type': 'application/json' },
      });
    }),
  );
  vi.stubGlobal(
    'EventSource',
    class {
      onmessage: ((m: { data: string }) => void) | null = null;
      onerror = null;
      constructor() {
        streams.push(this);
      }
      close() {}
    },
  );
  // jsdom has <dialog> but not always its modal methods
  const proto = HTMLDialogElement.prototype as unknown as Record<string, unknown>;
  proto.showModal ??= function (this: HTMLDialogElement) {
    this.setAttribute('open', '');
  };
  proto.close ??= function (this: HTMLDialogElement) {
    this.removeAttribute('open');
  };
  vi.stubGlobal('crypto', {
    ...globalThis.crypto,
    randomUUID: () => '01a0de48-9999-4000-8000-000000000001',
  });
  sessionStore.set({ accessToken: 'a', refreshToken: 'r' });
});

let root: Root | null = null;
let container: HTMLDivElement | null = null;

afterEach(() => {
  act(() => root?.unmount());
  container?.remove();
  state.rideAfterAction = null;
  state.orderStatus = 201;
  state.refuseApproval = false;
  state.scheduledPhoneOrders = false;
  state.quotedFor = null;
  state.feeWaived = false;
  state.bookingMissing = false;
  state.pooledLive = false;
});

async function render(path: string): Promise<string> {
  container = document.createElement('div');
  document.body.append(container);
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  root = createRoot(container);
  await act(async () => {
    root!.render(
      createElement(
        QueryClientProvider,
        { client },
        createElement(
          MemoryRouter,
          { initialEntries: [path] },
          createElement(FeedbackProvider, null, createElement(App)),
        ),
      ),
    );
  });
  // let queries and lazy pages settle: no spinner and the same text a few rounds in a row
  let last = '';
  let stable = 0;
  for (let i = 0; i < 160 && stable < 4; i++) {
    await act(() => new Promise((r) => setTimeout(r, 25)));
    const text = document.body.textContent ?? '';
    const busy = document.querySelector('.spin') !== null;
    stable = i >= 8 && !busy && text === last ? stable + 1 : 0;
    last = text;
  }
  return document.body.textContent ?? '';
}

async function settle(rounds = 20) {
  for (let i = 0; i < rounds; i++) {
    await act(() => new Promise((r) => setTimeout(r, 25)));
  }
}

/** Types into an input the way React notices (the native value setter + an input event). */
async function typeInto(input: HTMLInputElement | HTMLTextAreaElement, value: string) {
  const proto =
    input instanceof HTMLTextAreaElement
      ? HTMLTextAreaElement.prototype
      : HTMLInputElement.prototype;
  const setter = Object.getOwnPropertyDescriptor(proto, 'value')!.set!;
  await act(async () => {
    setter.call(input, value);
    input.dispatchEvent(new Event('input', { bubbles: true }));
  });
}

/** The last button, link or label (checkboxes) whose text contains `text`. */
function button(text: string): HTMLElement {
  const all = [...document.querySelectorAll<HTMLElement>('button, a, label')].filter((b) =>
    (b.textContent ?? '').includes(text),
  );
  const hit = all[all.length - 1];
  if (!hit) throw new Error(`no button "${text}"`);
  return hit;
}

async function click(el: HTMLElement) {
  await act(async () => {
    el.click();
  });
}

const posted = (path: string | RegExp, verb = 'POST') =>
  calls.filter(
    (c) => c.method === verb && (typeof path === 'string' ? c.path === path : path.test(c.path)),
  );

describe('panel smoke', () => {
  const pages: [string, string[]][] = [
    [
      '/dispatch',
      [
        'Jonli xarita',
        'Dispetcher paneli',
        'Bo‘sh',
        'Operator kerak',
        '#1001',
        'Haydovchi yo‘q',
        '#1002',
        'Navoiy ko‘chasi 12 (5-maktab yonida)',
        'Diqqat:',
        '1 ta ochiq SOS',
        '1 ta buyurtmaga haydovchi topilmadi',
        '1 ta haydovchining joylashuvi noma’lum',
      ],
    ],
    [
      `/dispatch?ride=${R1}`,
      [
        'Buyurtma #1001',
        'Operator kerak',
        'Bo‘sh haydovchilar',
        'Bobur Toshev',
        'eng yaqin',
        '3 daq',
        'Sardor Ali',
        'Rad etdi',
        'Javob bermadi',
        'Operator e’tibori so‘raldi',
        'avtomatik qidiruv haydovchi topmadi',
        'Sardor Ali, to‘g‘ridan-to‘g‘ri, yetib kelish 4 daq',
        'Juda uzoq',
      ],
    ],
    [
      `/rides/${R4}`,
      [
        'Bekor qilish to‘lovlari',
        'Shu safar uchun: 3 000 so‘m',
        'qarz (keyingi naqd safarda olinadi)',
        'Kechirish',
        'Sardor Ali, Avtomobil nosoz',
      ],
    ],
    [
      `/rides/${R5}`,
      ['Keyinroqqa buyurtma', 'oldingi safarlar qarzini', '#980', 'Oldingi safarlar qarzi (naqd)'],
    ],
    [
      '/phone-order',
      [
        'Telefon buyurtma',
        'Olib ketish joyi (A)',
        'Borish manzili (B)',
        'Ikkala manzil belgilangach',
      ],
    ],
    ['/rides', ['Safarlar', '#1001', '#1002', 'Dilnoza', 'Aziz Karimov']],
    ['/rides?status=completed', ['#990', 'Karim aka']],
    [`/rides/${R1}`, ['Buyurtma #1001', 'Tarix', 'Takliflar (2)']],
    ['/drivers', ['Haydovchilar', 'Tekshiruv navbati (1)', 'Sardor Ali', 'Tekshiruvda']],
    ['/drivers?status=blocked', ['Bobur Toshev', 'Shikoyatlar']],
    [
      `/drivers/${D3}`,
      [
        'Sardor Ali',
        'Tekshiruv ro‘yxati',
        'Barcha hujjatlar yuklangan',
        'Yetishmaydi: Haydovchilik guvohnomasi',
        'Litsenziya kartochkasi muddati tugayapti',
        'Asl faylni ochish',
        '−4 500 so‘m',
        'Ofisda naqd',
        'Soliq (1%)',
        'Ariza qayta yuborildi',
        '20 C 789 EF',
      ],
    ],
    ['/sos', ['SOS', '#1002', 'Haydovchi tez haydayapti', '112', 'Yopish']],
    [
      '/taxes',
      [
        'Soliq hisoboti',
        'Aziz Karimov',
        '31004920123457',
        '4 200',
        'To‘lanmagan',
        'To‘lov topshiriqnomasi raqami',
      ],
    ],
    [
      '/tariffs',
      ['Tariflar', 'masofa oraliqlari', 'Kalkulyator', 'O‘z tarifi bor shaharlar: Yangiyer'],
    ],
    [
      '/settings',
      [
        'Dispetcherlik',
        'Taklifga javob vaqti',
        'Hisob-kitob',
        'Komissiyasiz aksiya',
        'Ruxsat etilgan qarz',
      ],
    ],
    ['/cities', ['Shaharlar', 'Guliston', 'Yangiyer', 'Tez orada', 'O‘ziniki']],
    ['/rides?status=all', ['#1001', '#990', 'Barcha holatlar']],
    [
      `/drivers/${D1}`,
      [
        'Aziz Karimov',
        'Reyestrda tasdiqlangan',
        'Reyestrda bor, 2027 gacha',
        'Safarlari',
        '#990',
        'Pul o‘tkazish',
        'Karta safarlari puli',
        'Qarzimiz',
        '50 000 so‘m',
      ],
    ],
    [
      '/drivers?status=active',
      [
        'Aziz Karimov',
        'Tasdiqlangan',
        '4,9 ★',
        '120 safar',
        '94',
        '35 000 so‘m',
        'karta puli 30 000 so‘m',
        'GPS hozirgina',
      ],
    ],
    [
      '/intercity',
      ['Shaharlararo', '#501', 'Guliston → Toshkent', 'Aziz Karimov', '2 / 4 bo‘sh', '1 ta bron'],
    ],
    ['/intercity?tab=book', ['Mijoz uchun bron', 'Yukxona bo‘sh', 'Bron qilish', 'Uchrashuv']],
    [
      '/intercity?tab=fares',
      ['Yo‘nalish narxi', 'Guliston → Toshkent', '70 000 so‘m', 'haydovchi oralig‘i'],
    ],
    [
      `/intercity/${T1}`,
      ['#501: Guliston → Toshkent', 'Nodira', 'Bozor oldida', 'Bron qilingan', 'Mijoz uchun bron'],
    ],
    [
      '/payments',
      [
        'To‘lovlar',
        'Qaytarishlar (2)',
        '#990',
        '12 000 so‘m',
        'Click',
        'Qaytarildi',
        'bron #77 (depozit)',
        '28 000 so‘m',
      ],
    ],
    [
      '/payments?tab=payouts',
      ['Haydovchilarga to‘lov', 'Aziz Karimov', '80 000 so‘m', '30 000 so‘m', 'balans 25 000 so‘m'],
    ],
    [
      '/payments?tab=intents',
      [
        'Karta to‘lovlari',
        '168 000 so‘m',
        '14 ta to‘langan',
        'Qaytarilishi kerak',
        'safar #990',
        'Aziz Karimov',
        'Payme',
      ],
    ],
    [
      `/payments?tab=topups&driver=${D1}`,
      ['Aziz Karimov: balans', 'Naqd to‘ldirish', 'Ofisda naqd'],
    ],
    [
      '/complaints',
      ['Shikoyatlar', 'Orqa o‘rindiqda telefonim qoldi', 'Mashinada narsa qoldi', 'Yangi'],
    ],
    [`/complaints?id=${CP1}`, ['Qora Samsung', 'Javob yuborish', 'Murojaatni yopish']],
    [
      '/appeals',
      ['Haydovchilar murojaatlari', 'Bobur Toshev', 'xato tushunmovchilik', 'Shikoyatlar'],
    ],
    ['/ratings', ['Baholar', 'Aziz Karimov', 'Telefonda gaplashib haydadi', '#990']],
    [
      '/fiscal',
      [
        'Fiskal cheklar',
        'Saqlangan (yuborilmagan)',
        '7 000 so‘m',
        'Saqlanganlarni yuborish',
        'Qayta yuborish',
        'Batafsil',
      ],
    ],
    [
      '/fiscal?receipt=fr2',
      ['Chek R-pending', 'Oxirgi xato: OFD: 503', 'safar #991', 'Taksi xizmati', 'Naqd'],
    ],
    ['/fiscal?tab=settings', ['MXIK (IKPU) kodi', 'MXIK kodi hali nollardan iborat']],
    ['/outbox', ['Bajarilmagan amallar', 'Fiskal chek', 'OFD: 503 Service Unavailable', '10 / 10']],
    ['/settings?x=1', ['Shaharlararo qatnovlar', 'Haydovchi narx oralig‘i']],
    [
      '/routes',
      [
        'Yo‘nalish narxlari',
        'Masalan Yangiyer → Guliston o‘rindiq 10 000 so‘m',
        'Yangiyer → Guliston',
        '10 000 so‘m',
        '260 000 so‘m',
        'To‘xtatilgan',
        'Ikki tomonga',
      ],
    ],
    [
      '/settings?pool=1',
      [
        'Hamroh bilan (shared ride)',
        'To‘liq chegirma uchun umumiy qism',
        '85 000 so‘m',
        '34 000 so‘m',
        '119 000 so‘m',
        'Oldindan bron depoziti',
        '12 000 so‘m depozit',
      ],
    ],
    [
      `/rides/${R6}`,
      [
        'Hamroh',
        'Ayol haydovchi',
        '2 kishi (1 old, 1 orqa)',
        'Hamroh chegirmasi',
        '−15 000 so‘m',
        'Yo‘lovchi to‘laydi85 000 so‘m',
        'Depozit (kartadan oldindan)',
        'naqd qoladi 65 000 so‘m',
        'birga 20,0 km',
        'Boshlash kodi',
        'kodni faqat yo‘lovchi ko‘radi',
        'Hamroh: mashinaga yo‘lovchi qo‘shildi',
        'boshqa yo‘lovchi qo‘shildi, birga 20,0 km, chegirma 15 000 so‘m, to‘laydi 85 000 so‘m',
        'Hamroh: yo‘lovchi chiqdi',
        'shu safar umumiy mashinadan chiqdi',
      ],
    ],
    [
      `/drivers/${D1}?pool=1`,
      [
        'Jinsi va hamroh bilan',
        'Ayol · arizada, tasdiqlanmagan',
        'Jinsni tasdiqlash (pasport bo‘yicha)',
        'Boshqa yo‘lovchi oladi',
        'Yangiyer avtovokzali',
        '1/3 band',
      ],
    ],
    [
      '/settings?cargo=1',
      [
        'Yuk tashish va yetkazish',
        'Kichik yuk (Damas/Labo)',
        'Yetkazish (posilka)',
        // 15 km, one loader, by day: 35 000 + 5 km × 1 500 + 30 000
        '72 500 so‘m',
        'Yo‘l ustidagi shaharlar',
      ],
    ],
    [
      `/rides/${R7}`,
      [
        'Yuk',
        'O‘rta yuk (Gazel/Porter)',
        'Yukchilar',
        '2 kishi',
        '~120 kg',
        'kabinada birga',
        'Muzlatgich',
      ],
    ],
    [
      `/rides/${R8}`,
      [
        'Yetkazish',
        'Depozit kutilmoqda',
        'Depozit (5 000 so‘m) kartadan to‘lanishi kutilmoqda',
        'Posilka',
        'Qabul qiluvchi: Olim',
        'Hujjatlar papkasi · ~1 kg',
      ],
    ],
    [
      `/drivers/${D2}`,
      [
        'Bobur Toshev',
        'Yuk mashinasi · Yuk S (≤ 800 kg)',
        'Furgon',
        '700 kg yuk',
        'Faqat o‘z sinfidagi yuk buyurtmalarini oladi',
      ],
    ],
    [
      `/intercity/${T2}`,
      [
        'Depozit kutilmoqda',
        'depozit 28 000 so‘m · naqd 112 000 so‘m',
        '112 000 so‘m naqd',
        '+ 28 000 so‘m depozit (karta)',
        '1 ta bron (joylar ushlab turiladi)',
        'Yo‘l ustida',
        'Yangiyer → Toshkent',
        'tizim (depozit vaqtida to‘lanmadi)',
      ],
    ],
    ['/payments?tab=intents&x=1', ['Bron depoziti', '42 000 so‘m']],
    ['/fiscal?tab=settings&x=1', ['Yuk tashish nomi', 'Yetkazish (posilka) nomi']],
    ['/account', ['Hisob', 'Ismingiz']],
    ['/nowhere', ['Jonli xarita']],
  ];

  for (const [path, texts] of pages) {
    it(`renders ${path}`, async () => {
      const text = await render(path);
      for (const t of texts) expect(text).toContain(t);
    });
  }

  it('assigns a waiting ride to the nearest free driver by hand', async () => {
    calls.length = 0;
    await render(`/dispatch?ride=${R1}`);
    await click(button('Tayinlash'));
    await settle(4);
    expect(document.body.textContent).toContain('Bobur Toshevga beriladi');
    // the confirmation dialog's button
    await click(button('Tayinlash'));
    await settle();
    expect(posted(`/v1/admin/rides/${R1}/assign`).map((c) => c.body)).toEqual([{ driverId: D2 }]);
    expect(document.body.textContent).toContain('operator tayinladi');
  });

  it('cancels a ride with a reason', async () => {
    calls.length = 0;
    await render(`/rides/${R1}`);
    await click(button('Bekor qilish'));
    await settle(4);
    // no reason yet: refused locally
    await click(button('Bekor qilish'));
    await settle(4);
    expect(document.body.textContent).toContain('Sababni yozing');
    expect(posted(/\/cancel$/)).toHaveLength(0);
    await click(button('Takroriy buyurtma'));
    await click(button('Bekor qilish'));
    await settle();
    expect(posted(`/v1/admin/rides/${R1}/cancel`).map((c) => c.body)).toEqual([
      { reason: 'Takroriy buyurtma' },
    ]);
  });

  it('takes a phone order from a returning caller end to end', async () => {
    calls.length = 0;
    await render('/phone-order');
    await typeInto(document.querySelector<HTMLInputElement>('input[type="tel"]')!, '90 123 45 67');
    await settle();
    const text = document.body.textContent ?? '';
    expect(text).toContain('Doimiy mijoz: 1 ta safar');
    expect(text).toContain('Mustaqillik 5 (Dorixona oldida)');
    expect(document.querySelector<HTMLInputElement>('input[autocomplete="off"]')!.value).toBe(
      'Karim aka',
    );

    // past places: the first as pickup (A), the second as destination (B)
    const places = [...document.querySelectorAll<HTMLElement>('.known-place')];
    await click([...places[0]!.querySelectorAll('button')].find((b) => b.textContent === 'A')!);
    await click([...places[1]!.querySelectorAll('button')].find((b) => b.textContent === 'B')!);
    await click(button('Bolalar o‘rindig‘i'));
    await click(button('Komfort'));
    await settle(30);
    expect(document.body.textContent).toContain('10 800 so‘m');
    const quoteCall = posted('/v1/admin/rides/quote').at(-1)!.body as Record<string, unknown>;
    expect(quoteCall.options).toEqual(['child_seat']);

    await click(button('2 kishi'));
    expect(document.body.textContent).toContain('2 kishi (1 old, 1 orqa)');
    await typeInto(document.querySelector<HTMLTextAreaElement>('textarea')!, 'Darvoza oldida');
    await click(button('Buyurtma berish ·'));
    await settle();
    const order = posted('/v1/admin/rides').at(-1)!.body as Record<string, unknown>;
    expect(order).toMatchObject({
      riderPhone: '+998901234567',
      riderName: 'Karim aka',
      class: 'comfort',
      options: ['child_seat'],
      comment: 'Darvoza oldida',
      passengers: 2,
      clientRequestId: '01a0de48-9999-4000-8000-000000000001',
      quoteId: 'q1',
      pickup: { lat: 40.4911, lng: 68.7812, address: 'Mustaqillik 5', landmark: 'Dorixona oldida' },
      dropoff: { address: 'Temir yo‘l vokzali' },
    });
    expect(document.body.textContent).toContain('#1010 buyurtma qabul qilindi');
  });

  it('refuses a new order while the caller has an open ride', async () => {
    calls.length = 0;
    await render('/phone-order');
    await typeInto(document.querySelector<HTMLInputElement>('input[type="tel"]')!, '+998901112233');
    await settle();
    expect(document.body.textContent).toContain('Tugallanmagan buyurtma bor: #1001');
  });

  it('approves an application after the checklist', async () => {
    calls.length = 0;
    await render(`/drivers/${D3}`);
    await click(button('Tasdiqlash'));
    await settle(4);
    expect(document.body.textContent).toContain('Server tasdiqlashni rad etadi');
    await click(button('Tasdiqlash'));
    await settle();
    expect(posted(`/v1/admin/drivers/${D3}/approve`).map((c) => c.body)).toEqual([
      { reason: null },
    ]);
  });

  it('blocks a driver only with a reason', async () => {
    calls.length = 0;
    await render(`/drivers/${D3}`);
    await click(button('Bloklash'));
    await settle(4);
    await click(button('Bloklash'));
    await settle(4);
    expect(posted(/\/block$/)).toHaveLength(0);
    await typeInto(
      document.querySelector<HTMLTextAreaElement>('dialog textarea')!,
      'Yo‘lovchilar shikoyati',
    );
    await click(button('Bloklash'));
    await settle();
    expect(posted(`/v1/admin/drivers/${D3}/block`).map((c) => c.body)).toEqual([
      { reason: 'Yo‘lovchilar shikoyati' },
    ]);
  });

  it('records a cash top-up on the driver’s balance', async () => {
    calls.length = 0;
    await render(`/drivers/${D3}`);
    const money = document.querySelector<HTMLInputElement>(
      '.ledger-form input[inputmode="numeric"]',
    )!;
    await typeInto(money, '20000');
    await click(button('Yozish'));
    await settle(4);
    await click(button('Yozish'));
    await settle();
    expect(posted(`/v1/admin/billing/drivers/${D3}/ledger`).map((c) => c.body)).toEqual([
      { kind: 'topup', amount: 20000, note: null },
    ]);
  });

  it('edits the tariff with a live calculator and saves it', async () => {
    calls.length = 0;
    await render('/tariffs');
    // 3.5 km in the city with the launch tariff (the night add-on may be on: it is shown apart)
    expect(document.body.textContent).toContain('Masofa narxi7 000 so‘m');
    const firstPrice = document.querySelector<HTMLInputElement>(
      'input[aria-label="1-oraliq narxi"]',
    )!;
    await typeInto(firstPrice, '6000');
    const secondPrice = document.querySelector<HTMLInputElement>(
      'input[aria-label="2-oraliq narxi"]',
    )!;
    await typeInto(secondPrice, '8000');
    await settle(4);
    expect(document.body.textContent).toContain('Masofa narxi8 000 so‘m');
    await click(button('Saqlash'));
    await settle(4);
    await click(button('Saqlash'));
    await settle();
    const put = posted('/v1/admin/settings/tariff', 'PUT').at(-1)!.body as typeof DEFAULT_TARIFF;
    expect(put.classes.economy.bands.slice(0, 2)).toEqual([
      { up_to_m: 2000, price: 6000 },
      { up_to_m: 4000, price: 8000 },
    ]);
  });

  it('refuses a tariff whose bands shrink', async () => {
    calls.length = 0;
    await render('/tariffs');
    const km = document.querySelector<HTMLInputElement>(
      'input[aria-label="2-oraliq chegarasi, km"]',
    )!;
    await typeInto(km, '1');
    await settle(4);
    expect(document.body.textContent).toContain('o‘sib borishi');
    await click(button('Saqlash'));
    await settle(4);
    expect(posted('/v1/admin/settings/tariff', 'PUT')).toHaveLength(0);
  });

  it('saves dispatch parameters and checks the radii', async () => {
    calls.length = 0;
    await render('/settings');
    const form = document.querySelector<HTMLElement>('.settings-form')!;
    await typeInto(form.querySelector('input')!, '20');
    await click([...form.querySelectorAll('button')].find((b) => b.textContent === 'Saqlash')!);
    await settle(4);
    await click(button('Saqlash'));
    await settle();
    const put = posted('/v1/admin/settings/dispatch', 'PUT').at(-1)!.body as typeof dispatchRules;
    expect(put).toEqual({ ...dispatchRules, offer_timeout_seconds: 20 });
  });

  it('turns a city on after confirmation', async () => {
    calls.length = 0;
    await render('/cities');
    const toggles = [...document.querySelectorAll<HTMLInputElement>('input[role="switch"]')];
    await click(toggles[1]!);
    await settle(4);
    await click(button('Ishga tushirish'));
    await settle();
    expect(posted(`/v1/admin/geo/cities/${C2}`, 'PATCH').map((c) => c.body)).toEqual([
      { isActive: true },
    ]);
  });

  it('closes an SOS with a note and records the tax remittance', async () => {
    calls.length = 0;
    await render('/sos');
    await click(button('Yopish'));
    await settle(4);
    await typeInto(
      document.querySelector<HTMLTextAreaElement>('dialog textarea')!,
      'Yo‘lovchi bilan gaplashildi',
    );
    await click(button('Yopish'));
    await settle();
    expect(posted(`/v1/admin/sos/${S1}/resolve`).map((c) => c.body)).toEqual([
      { note: 'Yo‘lovchi bilan gaplashildi' },
    ]);
    act(() => root?.unmount());
    container?.remove();

    await render('/taxes');
    await typeInto(
      document.querySelector<HTMLInputElement>('input[placeholder^="Masalan"]')!,
      'PT-2026-09-015',
    );
    await click(button('To‘langan deb belgilash'));
    await settle(4);
    await click(button('Belgilash'));
    await settle();
    expect(posted('/v1/admin/billing/taxes/remit').map((c) => c.body)).toEqual([
      { period: expect.stringMatching(/^\d{4}-\d{2}$/), reference: 'PT-2026-09-015' },
    ]);
  });

  it('refetches the live board when the stream says a ride changed', async () => {
    calls.length = 0;
    streams.length = 0;
    await render('/dispatch');
    const before = calls.filter((c) => c.path === '/v1/admin/dispatch/live').length;
    const stream = streams.at(-1)!;
    await act(async () => {
      stream.onmessage?.({
        data: JSON.stringify({ type: 'ride.updated', rideId: R2, status: 'driver_arrived' }),
      });
    });
    await settle(6);
    expect(calls.filter((c) => c.path === '/v1/admin/dispatch/live').length).toBeGreaterThan(
      before,
    );
  });

  it('signs an operator in with an SMS code and opens the live map', async () => {
    calls.length = 0;
    sessionStore.set(null);
    try {
      await render('/dispatch');
      expect(document.body.textContent).toContain('Kod olish');
      await typeInto(
        document.querySelector<HTMLInputElement>('input[type="tel"]')!,
        '90 000 00 01',
      );
      await click(button('Kod olish'));
      await settle(6);
      await typeInto(document.querySelector<HTMLInputElement>('.code-input')!, '111111');
      await settle(40);
      expect(posted('/v1/auth/verify').map((c) => c.body)).toEqual([
        { phone: '+998900000001', code: '111111', client: 'admin' },
      ]);
      expect(document.body.textContent).toContain('Jonli xarita');
      expect(document.body.textContent).not.toContain('Kod olish');
    } finally {
      sessionStore.set({ accessToken: 'a', refreshToken: 'r' });
    }
  });

  it('records the licence registry check before approval', async () => {
    calls.length = 0;
    await render(`/drivers/${D3}`);
    expect(document.body.textContent).toContain('Reyestrda tekshirilmagan');
    await click(button('Reyestr natijasini yozish'));
    await settle(4);
    // the note must say where it was checked
    await click(button('Tasdiqlangan deb yozish'));
    await settle(4);
    expect(posted(`/v1/admin/drivers/${D3}/licence`)).toHaveLength(0);
    const note = document.querySelector<HTMLTextAreaElement>('dialog textarea')!;
    await typeInto(note, 'Transport vazirligi reyestri: LK-20-000123 amal qiladi');
    await click(button('Tasdiqlangan deb yozish'));
    await settle();
    expect(posted(`/v1/admin/drivers/${D3}/licence`).map((c) => c.body)).toEqual([
      {
        result: 'valid',
        note: 'Transport vazirligi reyestri: LK-20-000123 amal qiladi',
        expiresOn: null,
      },
    ]);
    expect(document.body.textContent).toContain('Reyestrda tasdiqlangan');
  });

  it('shows why the API refused an approval (422)', async () => {
    state.refuseApproval = true;
    await render(`/drivers/${D3}`);
    await click(button('Tasdiqlash'));
    await settle(4);
    await click(button('Tasdiqlash'));
    await settle();
    const text = document.body.textContent ?? '';
    expect(text).toContain('Server tasdiqlamadi');
    expect(text).toContain('Litsenziya kartochkasini Transport vazirligi reyestrida tekshiring');
    expect(text).toContain('Hujjatlar yetishmaydi: selfie');
  });

  it('opens an uploaded document through a fresh read URL', async () => {
    calls.length = 0;
    await render(`/drivers/${D3}`);
    expect(calls.some((c) => c.path === `/v1/uploads/${U1}`)).toBe(true);
    // the last tile is the passport, an upload
    await click(button('Asl faylni ochish'));
    await settle();
    const frame = document.querySelector<HTMLIFrameElement>('dialog iframe');
    expect(frame?.src).toBe('https://s3.example/documents/passport?X-Amz-Signature=fresh');
    expect(document.body.textContent).toContain('2,3 MB');
  });

  it('opens the existing ride when an order request is repeated (200)', async () => {
    state.orderStatus = 200;
    calls.length = 0;
    await render('/phone-order');
    await typeInto(document.querySelector<HTMLInputElement>('input[type="tel"]')!, '90 123 45 67');
    await settle();
    const places = [...document.querySelectorAll<HTMLElement>('.known-place')];
    await click([...places[0]!.querySelectorAll('button')].find((b) => b.textContent === 'A')!);
    await click([...places[1]!.querySelectorAll('button')].find((b) => b.textContent === 'B')!);
    await settle(30);
    await click(button('Buyurtma berish ·'));
    await settle();
    expect(posted('/v1/admin/rides')).toHaveLength(1);
    expect(document.body.textContent).toContain('Bu so‘rov avval yuborilgan edi');
    // the caller lookup is one POST (again after the order), not three ride searches
    const lookups = posted('/v1/admin/customers/lookup').map((c) => c.body);
    expect(lookups[0]).toEqual({ phone: '+998901234567' });
    expect(lookups.length).toBeLessThanOrEqual(2);
    expect(calls.filter((c) => c.path.startsWith('/v1/admin/rides?'))).toHaveLength(0);
  });

  it('orders a ride for later when the server allows it', async () => {
    state.scheduledPhoneOrders = true;
    calls.length = 0;
    await render('/phone-order');
    await typeInto(document.querySelector<HTMLInputElement>('input[type="tel"]')!, '90 123 45 67');
    await settle();
    const places = [...document.querySelectorAll<HTMLElement>('.known-place')];
    await click([...places[0]!.querySelectorAll('button')].find((b) => b.textContent === 'A')!);
    await click([...places[1]!.querySelectorAll('button')].find((b) => b.textContent === 'B')!);
    await click(button('Keyinroqqa'));
    await settle(30);
    const when = document.querySelector<HTMLInputElement>('input[type="datetime-local"]')!;
    expect(when.value).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/);
    const quoted = posted('/v1/admin/rides/quote').at(-1)!.body as { scheduledFor?: string };
    expect(Date.parse(quoted.scheduledFor!) - Date.now()).toBeGreaterThan(30 * 60_000);
    await click(button('Buyurtma berish ·'));
    await settle();
    const order = posted('/v1/admin/rides').at(-1)!.body as Record<string, unknown>;
    // the quote carries the time: the order only names it
    expect(order.scheduledFor).toBeUndefined();
    expect(order.quoteId).toBe('q1');
    const text = document.body.textContent ?? '';
    expect(text).toContain('#1010 buyurtma qabul qilindi');
    expect(text).toContain('Keyinroqqa:');
    expect(text).not.toContain('Buyurtma keyinroqqa emas');
  });

  it('keeps the for-later option off while the server does not support it', async () => {
    await render('/phone-order');
    await click(button('Keyinroqqa'));
    await settle(4);
    expect(document.querySelector('input[type="datetime-local"]')).toBeNull();
    expect(document.body.textContent).toContain('hali yoqilmagan');
  });

  it('filters rides on the server and loads the next page', async () => {
    calls.length = 0;
    await render('/rides?status=all');
    const classSelect = document.querySelector<HTMLSelectElement>('#ride-class')!;
    await act(async () => {
      classSelect.value = 'comfort';
      classSelect.dispatchEvent(new Event('change', { bubbles: true }));
    });
    await settle(30);
    const listCalls = calls.filter((c) => c.path.startsWith('/v1/admin/rides?'));
    expect(listCalls.map((c) => c.path)).toContain('/v1/admin/rides?status=all&class=comfort');
    expect(document.body.textContent).toContain('200 ta ko‘rsatildi');
    await click(button('Ko‘proq yuklash'));
    await settle(30);
    expect(calls.map((c) => c.path)).toContain(
      `/v1/admin/rides?status=all&class=comfort&cursor=${fullPage.at(-1)!.id}`,
    );
    expect(document.body.textContent).toContain('201 ta ko‘rsatildi');
  });

  it('moves cars and shows offers from the stream without polling', async () => {
    calls.length = 0;
    streams.length = 0;
    await render('/dispatch');
    const stream = streams.at(-1)!;
    const send = async (event: unknown) => {
      await act(async () => {
        stream.onmessage?.({ data: JSON.stringify(event) });
      });
      await settle(6);
    };
    await send({ type: 'ready' });
    const before = calls.filter((c) => c.path === '/v1/admin/dispatch/live').length;
    await send({
      type: 'drivers.positions',
      drivers: [{ id: D2, lat: 40.5, lng: 68.8, heading: 10, at: iso(0), busy: false }],
    });
    await send({ type: 'offer.new', offerId: 'o9', rideId: R1, driverId: D2, expiresAt: iso(-1) });
    expect(document.body.textContent).toContain('Taklif ko‘rmoqda 2');
    // known drivers and offers are applied in place: no refetch of the board
    expect(calls.filter((c) => c.path === '/v1/admin/dispatch/live').length).toBe(before);
    // a driver who just came online is not on the board: fetch it
    await send({
      type: 'drivers.positions',
      drivers: [{ id: 'new-driver', lat: 40.5, lng: 68.8, heading: null, at: iso(0), busy: false }],
    });
    expect(calls.filter((c) => c.path === '/v1/admin/dispatch/live').length).toBeGreaterThan(
      before,
    );
  });

  it('books seats for a caller and cancels a booking on the trip page', async () => {
    calls.length = 0;
    await render(`/intercity/${T1}`);
    await click(button('Mijoz uchun bron'));
    await settle(4);
    await typeInto(
      document.querySelector<HTMLInputElement>('dialog input[type="tel"]')!,
      '93 555 00 22',
    );
    await click(button('Old o‘rindiq'));
    await click(button('Bron qilish ·'));
    await settle();
    expect(posted(`/v1/admin/intercity/trips/${T1}/bookings`).map((c) => c.body)).toEqual([
      {
        riderPhone: '+998935550022',
        riderName: null,
        seats: 1,
        front: true,
        pickupNote: null,
        clientRequestId: '01a0de48-9999-4000-8000-000000000001',
      },
    ]);
    await click(button('Bekor qilish'));
    await settle(4);
    await click(button('Takroriy bron'));
    await click(button('Bronni bekor qilish'));
    await settle();
    expect(posted(`/v1/admin/intercity/bookings/${B1}/cancel`).map((c) => c.body)).toEqual([
      { reason: 'Takroriy bron' },
    ]);
  });

  it('sets a route price after confirmation', async () => {
    calls.length = 0;
    await render('/intercity?tab=fares');
    const [rear, front] = [
      ...document.querySelectorAll<HTMLInputElement>('.fares-layout input[inputmode="numeric"]'),
    ];
    await typeInto(rear!, '75000');
    await typeInto(front!, '70000');
    await click(button('Saqlash'));
    await settle(4);
    expect(document.body.textContent).toContain('Old o‘rindiq orqadagidan arzon bo‘lmasin');
    await typeInto(front!, '85000');
    await click(button('Saqlash'));
    await settle(4);
    await click(button('Saqlash'));
    await settle();
    expect(posted('/v1/admin/intercity/fares', 'PUT').map((c) => c.body)).toEqual([
      { from: 'guliston', to: 'toshkent', rear: 75000, front: 85000 },
    ]);
  });

  it('records a refund and a payout of card money', async () => {
    calls.length = 0;
    await render('/payments');
    await click(button('Qaytarildi'));
    await settle(4);
    await typeInto(document.querySelector<HTMLTextAreaElement>('dialog textarea')!, 'CLICK-778899');
    await click(button('Qaytarildi deb yozish'));
    await settle();
    expect(posted(`/v1/admin/payments/${P1}/refunded`).map((c) => c.body)).toEqual([
      { reference: 'CLICK-778899' },
    ]);
    act(() => root?.unmount());
    container?.remove();

    await render('/payments?tab=payouts');
    expect(document.body.textContent).toContain('hozir o‘tkazish mumkin 25 000 so‘m');
    await click(button('Pul o‘tkazish'));
    await settle(4);
    await click(button('O‘tkazildi deb yozish'));
    await settle(4);
    // the transfer reference is required
    expect(posted(`/v1/admin/billing/drivers/${D1}/ledger`)).toHaveLength(0);
    await typeInto(
      document.querySelector<HTMLInputElement>('dialog input:not([inputmode])')!,
      'Humo *4411, 0012',
    );
    await click(button('O‘tkazildi deb yozish'));
    await settle();
    expect(posted(`/v1/admin/billing/drivers/${D1}/ledger`).map((c) => c.body)).toEqual([
      // what can be paid out now: the card money owed, within the balance
      { kind: 'payout', amount: 25000, note: 'Humo *4411, 0012' },
    ]);
  });

  it('answers and closes a lost-item complaint', async () => {
    calls.length = 0;
    await render(`/complaints?id=${CP1}`);
    const reply = document.querySelector<HTMLTextAreaElement>('dialog textarea')!;
    await typeInto(reply, 'Haydovchi telefoningizni ofisga olib keladi');
    await act(async () => {
      reply.dispatchEvent(
        new KeyboardEvent('keydown', { key: 'Enter', ctrlKey: true, bubbles: true }),
      );
    });
    await settle();
    expect(posted(`/v1/admin/complaints/${CP1}/messages`).map((c) => c.body)).toEqual([
      { text: 'Haydovchi telefoningizni ofisga olib keladi' },
    ]);
    const select = document.querySelector<HTMLSelectElement>('dialog select')!;
    await act(async () => {
      select.value = 'item_returned';
      select.dispatchEvent(new Event('change', { bubbles: true }));
    });
    await click(button('Murojaatni yopish'));
    await settle(4);
    await click(button('Yopish'));
    await settle();
    expect(posted(`/v1/admin/complaints/${CP1}/resolve`).map((c) => c.body)).toEqual([
      { resolution: 'item_returned', note: null },
    ]);
  });

  it('answers a driver’s appeal', async () => {
    calls.length = 0;
    await render('/appeals');
    await click(button('Javob berish'));
    await settle(4);
    await click(button('Hujjatlarni to‘g‘rilab'));
    await click(button('Javob berish'));
    await settle();
    expect(posted(`/v1/admin/drivers/appeals/${AP1}/resolve`).map((c) => c.body)).toEqual([
      { resolution: 'Hujjatlarni to‘g‘rilab, arizani qayta yuboring' },
    ]);
  });

  it('queues kept receipts and saves the MXIK codes', async () => {
    calls.length = 0;
    await render('/fiscal');
    await click(button('Saqlanganlarni yuborish'));
    await settle(4);
    await click(button('Navbatga qo‘yish'));
    await settle();
    expect(posted('/v1/admin/fiscal/receipts/resend').map((c) => c.body)).toEqual([
      { status: 'skipped' },
    ]);
    act(() => root?.unmount());
    container?.remove();

    await render('/fiscal?tab=settings');
    const mxik = [...document.querySelectorAll<HTMLInputElement>('input.mono')][0]!;
    await typeInto(mxik, '1011200');
    await settle(2);
    expect(document.body.textContent).toContain('MXIK kodi 17 ta raqam');
    await typeInto(mxik, '10112001001000000');
    await click(button('Saqlash'));
    await settle(4);
    await click(button('Saqlash'));
    await settle();
    expect(posted('/v1/admin/settings/fiscal', 'PUT').map((c) => c.body)).toEqual([
      { ...fiscalRules, mxik_code: '10112001001000000' },
    ]);
  });

  it('retries a dead side effect', async () => {
    calls.length = 0;
    await render('/outbox');
    await click(button('Qayta urinish'));
    await settle(4);
    // the confirmation dialog's button
    await click(button('Qayta urinish'));
    await settle();
    expect(posted(`/v1/admin/outbox/${OB1}/retry`)).toHaveLength(1);
  });

  it('waives an owed cancellation fee with a note after confirmation', async () => {
    calls.length = 0;
    await render(`/rides/${R4}`);
    await click(button('Kechirish'));
    await settle(4);
    expect(document.body.textContent).toContain('3 000 so‘m to‘lamaydi');
    // a note is required
    await click(button('Kechirish'));
    await settle(4);
    expect(posted(/\/fee\/waive$/)).toHaveLength(0);
    await click(button('Haydovchi kechikdi'));
    await click(button('Kechirish'));
    await settle();
    expect(posted(`/v1/admin/rides/${R4}/fee/waive`).map((c) => c.body)).toEqual([
      { note: 'Haydovchi kechikdi' },
    ]);
    expect(document.body.textContent).toContain('kechirilgan');
  });

  it('shows a caller’s owed fee and orders for later despite an open ride', async () => {
    state.scheduledPhoneOrders = true;
    calls.length = 0;
    await render('/phone-order');
    await typeInto(document.querySelector<HTMLInputElement>('input[type="tel"]')!, '93 555 11 22');
    await settle();
    let text = document.body.textContent ?? '';
    expect(text).toContain('Bekor qilingan safar(lar) uchun qarzi: 3 000 so‘m');
    expect(text).toContain('Keyinroqqa buyurtmalari: #1020');
    expect(text).toContain('Hozirga yangi buyurtma berib bo‘lmaydi, keyinroqqa mumkin');
    // the fee can be waived right from the call
    await click(button('Kechirish'));
    await settle(4);
    expect(document.querySelector('dialog textarea')).not.toBeNull();
    await click(button('Qaytish'));
    await settle(4);

    // for later, the open ride does not block the order
    await click(button('Keyinroqqa'));
    await settle(4);
    text = document.body.textContent ?? '';
    expect(text).toContain('Keyinroqqa buyurtma berish mumkin');
    expect(text).not.toContain('Mijozda tugallanmagan buyurtma bor');
  });

  it('retries one kept receipt and opens its details', async () => {
    calls.length = 0;
    await render('/fiscal');
    await click(button('Qayta yuborish'));
    await settle(4);
    // the confirmation dialog's button
    await click(button('Qayta yuborish'));
    await settle();
    expect(posted('/v1/admin/fiscal/receipts/fr2/retry')).toHaveLength(1);
    await click(button('Batafsil'));
    await settle();
    expect(calls.some((c) => c.path === '/v1/admin/fiscal/receipts/fr2')).toBe(true);
    expect(document.querySelector('dialog')?.textContent).toContain('Chek R-pending');
  });

  it('filters card payments on the server', async () => {
    calls.length = 0;
    await render('/payments?tab=intents');
    const purpose = document.querySelector<HTMLSelectElement>('#intent-purpose')!;
    await act(async () => {
      purpose.value = 'topup';
      purpose.dispatchEvent(new Event('change', { bubbles: true }));
    });
    await settle(20);
    expect(calls.map((c) => c.path)).toContain('/v1/admin/payments/intents?purpose=topup');
    await typeInto(
      document.querySelector<HTMLInputElement>('input[aria-label="To‘lovchi telefoni"]')!,
      '90 123 40 00',
    );
    await settle(30);
    expect(calls.map((c) => c.path)).toContain(
      '/v1/admin/payments/intents?purpose=topup&phone=%2B998901234000',
    );
    expect(document.body.textContent).not.toContain('safar #990');
  });

  it('drops the markers of drivers the positions batch lists offline', async () => {
    calls.length = 0;
    streams.length = 0;
    await render('/dispatch');
    const stream = streams.at(-1)!;
    const send = async (event: unknown) => {
      await act(async () => {
        stream.onmessage?.({ data: JSON.stringify(event) });
      });
      await settle(6);
    };
    await send({ type: 'ready' });
    expect(document.body.textContent).toContain('1 ta haydovchining joylashuvi noma’lum');
    const before = calls.filter((c) => c.path === '/v1/admin/dispatch/live').length;
    await send({
      type: 'drivers.positions',
      drivers: [{ id: D1, lat: 40.5, lng: 68.8, heading: 10, at: iso(0), busy: true }],
      offline: [D2],
    });
    // Bobur went off the map; the board is refetched (he may be off shift) and he stays off
    expect(document.body.textContent).toContain('2 ta haydovchining joylashuvi noma’lum');
    expect(calls.filter((c) => c.path === '/v1/admin/dispatch/live').length).toBeGreaterThan(
      before,
    );
  });

  it('saves a route price both ways after confirmation and deletes one', async () => {
    calls.length = 0;
    await render('/routes');
    await click(button('Saqlash'));
    await settle(4);
    expect(document.body.textContent).toContain('1 000 dan 10 000 000 so‘mgacha');
    const seat = document.querySelector<HTMLInputElement>(
      '.fares-layout input[inputmode="numeric"]',
    )!;
    await typeInto(seat, '12000');
    await click(button('Saqlash'));
    await settle(4);
    await click(button('Saqlash'));
    await settle();
    expect(posted('/v1/admin/routes', 'PUT').map((c) => c.body)).toEqual([
      {
        from: 'guliston',
        to: 'toshkent',
        class: 'economy',
        seatPrice: 12000,
        carPrice: null,
        isActive: true,
        bothWays: true,
      },
    ]);
    await click(
      document.querySelector<HTMLElement>('[aria-label="Yangiyer → Guliston: o‘chirish"]')!,
    );
    await settle(4);
    await click(button('O‘chirish'));
    await settle();
    expect(posted(`/v1/admin/routes/${RF1}`, 'DELETE')).toHaveLength(1);
  });

  it('pauses a route price without changing it', async () => {
    calls.length = 0;
    await render('/routes');
    await click(
      document.querySelector<HTMLElement>('[aria-label="Yangiyer → Guliston: to‘xtatish"]')!,
    );
    await settle(4);
    await click(button('To‘xtatish'));
    await settle();
    expect(posted('/v1/admin/routes', 'PUT').map((c) => c.body)).toEqual([
      {
        from: 'yangiyer',
        to: 'guliston',
        class: 'economy',
        seatPrice: 10_000,
        carPrice: null,
        isActive: false,
        bothWays: false,
      },
    ]);
  });

  it('saves shared-ride rules in seconds and keeps at most 3 riders', async () => {
    calls.length = 0;
    await render('/settings');
    const form = [...document.querySelectorAll<HTMLElement>('.settings-form')].find((f) =>
      f.textContent?.includes('Hamroh bilan (shared ride)'),
    )!;
    const input = (text: string) => {
      const label = [...form.querySelectorAll('label')].find((l) => l.textContent === text)!;
      return document.getElementById(label.htmlFor) as HTMLInputElement;
    };
    await typeInto(input('Bir mashinada buyurtmalar'), '4');
    expect(form.textContent).toContain('2 dan 3 gacha');
    await typeInto(input('Bir mashinada buyurtmalar'), '2');
    await typeInto(input('Qo‘shimcha vaqt chegarasi, shahar'), '8');
    await typeInto(input('Chegirma'), '20');
    // the calculator follows the draft: A 80 000, B 32 000, the driver 112 000
    expect(form.textContent).toContain('112 000 so‘m');
    await click([...form.querySelectorAll('button')].find((b) => b.textContent === 'Saqlash')!);
    await settle(4);
    await click(button('Saqlash'));
    await settle();
    expect(posted('/v1/admin/settings/pool', 'PUT').at(-1)!.body).toEqual({
      ...poolRules,
      max_riders: 2,
      max_detour_seconds_city: 480,
      discount_percent: 20,
    });
  });

  it('hides the deposit section while the API has none (404)', async () => {
    state.bookingMissing = true;
    const text = await render('/settings');
    expect(text).toContain('Hamroh bilan (shared ride)');
    expect(text).not.toContain('Oldindan bron depoziti');
    expect(text).not.toContain('Cannot GET');
  });

  it('verifies a driver’s gender against the passport', async () => {
    calls.length = 0;
    await render(`/drivers/${D1}`);
    await click(button('Jinsni tasdiqlash (pasport bo‘yicha)'));
    await settle(4);
    await click(button('Erkak'));
    await click(button('Tasdiqlash'));
    await settle();
    expect(posted(`/v1/admin/drivers/${D1}/gender`).map((c) => c.body)).toEqual([
      { gender: 'male' },
    ]);
    expect(document.body.textContent).toContain('Erkak · pasport bo‘yicha tasdiqlangan');
  });

  it('shows a shared car once, with the riders it carries', async () => {
    state.pooledLive = true;
    const text = await render('/dispatch');
    expect(text).toContain('#1006');
    expect(text).toContain('Hamroh');
    // Aziz comes twice in the API's list: one car on the board
    expect(text).toContain('Buyurtmada 1');
    expect(document.querySelectorAll('.map-marker-driver-busy')).toHaveLength(1);
    const marker = document.querySelector<HTMLElement>('.map-marker-driver-busy')!;
    expect(marker.textContent).toBe('2');
    await click(marker);
    await settle(4);
    expect(document.body.textContent).toContain('Mashinada 2 ta buyurtma, 3 kishi');
    // the cargo van: a square "Y" marker; the "Yuk" filter keeps cargo cars only
    const cargo = document.querySelector<HTMLElement>('.map-marker.is-cargo')!;
    expect(cargo.textContent).toBe('Y');
    await click(button('Yuk'));
    await settle(4);
    expect(document.querySelectorAll('.map-marker-driver-busy')).toHaveLength(0);
    expect(document.querySelectorAll('.map-marker.is-cargo')).toHaveLength(1);
    // no cargo ride is open: the list is empty
    expect(document.body.textContent).toContain('Ochiq buyurtmalar (0)');
  });

  it('saves cargo prices with a live calculator', async () => {
    calls.length = 0;
    await render('/settings');
    const form = [...document.querySelectorAll<HTMLElement>('.settings-form')].find((f) =>
      f.textContent?.includes('Yuk tashish va yetkazish'),
    )!;
    const input = (text: string) => {
      const label = [...form.querySelectorAll('label')].find((l) => l.textContent === text)!;
      return document.getElementById(label.htmlFor) as HTMLInputElement;
    };
    await typeInto(input('Kichik yuk (Damas/Labo): Asosiy narx'), '40000');
    expect(form.textContent).toContain('77 500 so‘m');
    await typeInto(input('O‘rta yuk (Gazel/Porter): Eng og‘ir yuk'), '500');
    expect(form.textContent).toContain('O‘rta sinf kichigidan kam ko‘tarmaydi');
    await typeInto(input('O‘rta yuk (Gazel/Porter): Eng og‘ir yuk'), '1600');
    await click([...form.querySelectorAll('button')].find((b) => b.textContent === 'Saqlash')!);
    await settle(4);
    await click(button('Saqlash'));
    await settle();
    expect(posted('/v1/admin/settings/cargo', 'PUT').at(-1)!.body).toEqual({
      ...cargoRules,
      classes: {
        cargo_s: { ...cargoRules.classes.cargo_s, base: 40_000 },
        cargo_m: { ...cargoRules.classes.cargo_m, max_payload_kg: 1600 },
      },
    });
  });

  it('filters rides by service on the server', async () => {
    calls.length = 0;
    await render('/rides');
    const select = document.querySelector<HTMLSelectElement>('#ride-service')!;
    await act(async () => {
      select.value = 'cargo';
      select.dispatchEvent(new Event('change', { bubbles: true }));
    });
    await settle();
    expect(calls.some((c) => c.path.includes('service=cargo'))).toBe(true);
  });

  it('corrects a cargo car’s payload and class', async () => {
    calls.length = 0;
    await render(`/drivers/${D2}`);
    const payload = [...document.querySelectorAll('label')].find(
      (l) => l.textContent === 'Yuk ko‘tarish (texnik ko‘rikda)',
    )!;
    await typeInto(document.getElementById(payload.htmlFor) as HTMLInputElement, '1200');
    expect(document.body.textContent).toContain('Bu yukga mos sinf: Yuk M (≤ 1,5 t)');
    await click(button('Yuk M (≤ 1,5 t)'));
    await click(button('Saqlash'));
    await settle();
    expect(posted(`/v1/admin/drivers/${D2}/vehicle`, 'PATCH').at(-1)!.body).toMatchObject({
      payloadKg: 1200,
      cargoClass: 'cargo_m',
    });
  });

  it('books a seat along the way for the caller’s own towns', async () => {
    calls.length = 0;
    const text = await render('/intercity?tab=book');
    expect(text).toContain('Yo‘l ustida');
    expect(text).toContain('Sirdaryo → Toshkent qatnovi · yo‘lning 80%');
    expect(text).toContain('butun yo‘l 70 000 so‘m');
    await click(button('Bron qilish'));
    await settle(4);
    expect(document.body.textContent).toContain('Bron: Guliston → Toshkent');
    await typeInto(
      document.querySelector<HTMLInputElement>('dialog input[type="tel"]')!,
      '93 555 00 22',
    );
    await click(button('Bron qilish ·'));
    await settle();
    expect(posted(`/v1/admin/intercity/trips/${T3}/bookings`).at(-1)!.body).toMatchObject({
      seats: 1,
      from: 'guliston',
      to: 'toshkent',
    });
  });

  it('called only mocked endpoints', () => {
    expect(unmatched).toEqual([]);
  });
});
