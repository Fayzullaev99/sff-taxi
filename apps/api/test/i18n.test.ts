import type { INestApplication } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Database } from '../src/core/db/database.js';
import type { ConsoleSmsProvider } from '../src/core/sms/console.provider.js';
import { SMS_PROVIDER } from '../src/core/sms/sms.provider.js';
import { quickReplies, quickReplyText } from '../src/lib/chat.js';
import { intercitySms } from '../src/modules/notifications/intercity-messages.js';
import { push, sms } from '../src/modules/notifications/messages.js';
import { Notifier } from '../src/modules/notifications/notifier.js';
import { api, createDriver, createTestApp, GULISTON, MID, signIn, uniquePhone } from './helpers.js';

/**
 * Russian for the apps: `Accept-Language: ru` makes every message of a request Russian,
 * the language is remembered on the account (users.locale) for SMS and push sent later,
 * and the operator panel (Accept-Language: uz, or no header) stays Uzbek.
 */
describe('languages', () => {
  let app: INestApplication;

  beforeAll(async () => {
    app = await createTestApp();
  });
  afterAll(async () => {
    await app?.close();
  });

  const smsText = (phone: string) => app.get<ConsoleSmsProvider>(SMS_PROVIDER).lastTo(phone)?.text;

  it('sends the sign-in code in the language of the app', async () => {
    const http = api(app);
    const ru = uniquePhone();
    await http.post('/v1/auth/code').set('Accept-Language', 'ru').send({ phone: ru }).expect(202);
    expect(smsText(ru)).toMatch(/код подтверждения \d{6}/);
    const uz = uniquePhone();
    await http.post('/v1/auth/code').send({ phone: uz }).expect(202);
    expect(smsText(uz)).toMatch(/tasdiqlash kodi \d{6}/);
  });

  it('answers errors in the language asked for, Uzbek by default', async () => {
    const rider = await signIn(app);
    const http = api(app, rider.accessToken);
    const missing = `/v1/rides/${randomUUID()}`;
    const ru = await http.get(missing).set('Accept-Language', 'ru-RU,ru;q=0.9').expect(404);
    expect(ru.body.message).toBe('Заказ не найден');
    expect(ru.body.statusCode).toBe(404);
    const uz = await http.get(missing).set('Accept-Language', 'uz').expect(404);
    expect(uz.body.message).toBe('Buyurtma topilmadi');
    const none = await http.get(missing).set('Accept-Language', 'en-US').expect(404);
    expect(none.body.message).toBe('Buyurtma topilmadi');
    // Nest's own defaults are said in the language too
    const anonymous = await api(app).get('/v1/me').set('Accept-Language', 'ru').expect(401);
    expect(anonymous.body.message).toBe('Войдите в систему');
    expect((await api(app).get('/v1/me').expect(401)).body.message).toBe('Tizimga kiring');
  });

  it('translates validation issues, templates with values included', async () => {
    const rider = await signIn(app);
    const http = api(app, rider.accessToken);
    const empty = await http.patch('/v1/me').set('Accept-Language', 'ru').send({}).expect(400);
    expect(empty.body.message).toBe('Данные заполнены неверно');
    expect(empty.body.issues[0].message).toBe('Нечего изменять');
    const long = await http
      .patch('/v1/me')
      .set('Accept-Language', 'ru')
      .send({ fullName: 'x'.repeat(101) })
      .expect(400);
    expect(long.body.issues[0].message).toBe('Максимум символов: 100');
    // a schema's own message with a value in it is matched by shape
    const stops = await http
      .post('/v1/rides/quote')
      .set('Accept-Language', 'ru')
      .send({ pickup: GULISTON, dropoff: MID, stops: [MID, MID, MID], options: [] })
      .expect(400);
    expect(stops.body.issues[0].message).toBe('Остановок не может быть больше 2');
    // a msg() message keeps its Uzbek key and renders the Russian template with the values
    const soon = new Date(Date.now() + 5 * 60_000).toISOString();
    const quote = await http
      .post('/v1/rides/quote')
      .set('Accept-Language', 'ru')
      .send({ pickup: GULISTON, dropoff: MID, options: [], scheduledFor: soon })
      .expect(400);
    expect(quote.body.message).toBe('Предзаказ оформляется от 30 минут до 24 часов заранее');
    expect(quote.body.key).toBe('Oldindan buyurtma {0} daqiqadan {1} soatgacha oldin beriladi');
  });

  it('remembers the app language on the account and lets the app set it', async () => {
    const phone = uniquePhone();
    const http = api(app);
    await http.post('/v1/auth/code').set('Accept-Language', 'ru').send({ phone }).expect(202);
    const code = smsText(phone)!.match(/\d{6}/)![0];
    const signed = await http
      .post('/v1/auth/verify')
      .set('Accept-Language', 'ru')
      .send({ phone, code, client: 'rider' })
      .expect(200);
    const rider = api(app, signed.body.accessToken);
    // a new account starts in the sign-in language
    expect((await rider.get('/v1/me').set('Accept-Language', 'ru').expect(200)).body.locale).toBe(
      'ru',
    );
    expect(await app.get(Notifier).localeOfPhone(phone)).toBe('ru');
    // the header on any request keeps it current
    await rider.get('/v1/me').set('Accept-Language', 'uz').expect(200);
    expect(await app.get(Notifier).localeOfPhone(phone)).toBe('uz');
    // the profile setting too
    const updated = await rider.patch('/v1/me').set('Accept-Language', 'uz').send({ locale: 'ru' });
    expect(updated.status).toBe(200);
    expect(updated.body.locale).toBe('ru');
    expect(await app.get(Notifier).localeOfPhone(phone)).toBe('ru');
    // without a header (an older app) the saved language is used
    const missing = await rider.get(`/v1/rides/${randomUUID()}`).expect(404);
    expect(missing.body.message).toBe('Заказ не найден');
    expect(await app.get(Notifier).localeOfPhone(uniquePhone())).toBe('uz');
  });

  it('gives the apps their labels in the language: classes, reasons, quick replies', async () => {
    const rider = await signIn(app);
    const quote = await api(app, rider.accessToken)
      .post('/v1/rides/quote')
      .set('Accept-Language', 'ru')
      .send({ pickup: GULISTON, dropoff: MID, options: [] })
      .expect(200);
    const economy = quote.body.classes.find((c: { id: string }) => c.id === 'economy');
    expect(economy.label).toBe('Эконом');
    expect(economy.description).toBe('Недорого и быстро: обычный седан');
    const driver = await createDriver(app, { online: false });
    const config = await driver.http
      .get('/v1/driver/config')
      .set('Accept-Language', 'ru')
      .expect(200);
    expect(config.body.classes.map((c: { label: string }) => c.label)).toEqual([
      'Эконом',
      'Комфорт',
      'Минивэн',
      'Бизнес',
    ]);
    expect(config.body.classes[1].rules).toBe('Не старше 5 лет, с кондиционером');
    expect(config.body.declineReasons.too_far).toBe('Слишком далеко');
    expect(config.body.cancelReasons.rider_no_show).toBe('Пассажир не вышел');
    const uzConfig = await driver.http.get('/v1/driver/config').set('Accept-Language', 'uz');
    expect(uzConfig.body.classes[0].label).toBe('Ekonom');
    expect(quickReplies('rider', 'ru').map((q) => q.text)).toContain('Где вы?');
    expect(quickReplyText('driver', 'arrived', 'ru')).toBe('Я на месте');
    expect(quickReplyText('driver', 'arrived')).toBe('Yetib keldim');
  });

  it('writes SMS and push in the recipient’s language', async () => {
    // the colour is a code (or older text): named in the recipient's language
    const car = { colour: 'white', make: 'Chevrolet', model: 'Cobalt', plate: '20 A 123 BC' };
    expect(sms.driverAssigned('ru', 12, car, 4, '+998901234567')).toBe(
      'SFF Taxi #12: белый Chevrolet Cobalt, 20 A 123 BC, ~4 мин. Водитель: +998901234567',
    );
    expect(sms.driverArrived('ru', 12, { ...car, colour: 'oq' })).toContain('белый Chevrolet');
    expect(push.driverArrived('ru', { ...car, colour: 'pushti' }).body).toContain(
      'pushti Chevrolet',
    );
    expect(sms.driverAssigned('uz', 12, car, 4, '+998901234567')).toBe(
      'SFF Taxi #12: oq Chevrolet Cobalt, 20 A 123 BC, ~4 daqiqada. Haydovchi: +998901234567',
    );
    // a system cancellation reason is translated; an operator's free text stays
    expect(sms.cancelled('ru', 7, 'Haydovchi topilmadi')).toBe(
      'SFF Taxi #7: заказ отменён (Водитель не найден).',
    );
    expect(push.cancelledForRider('ru', 'Mijoz iltimosiga ko‘ra').body).toBe(
      'Mijoz iltimosiga ko‘ra',
    );
    expect(push.cancelledForRider('ru', null).body).toBe('Свободных машин не нашлось');
    const trip = {
      number: 3,
      from: 'Guliston',
      to: 'Toshkent',
      departureAt: new Date('2026-10-20T03:30:00Z'),
      meetingPoint: 'Vokzal',
    };
    expect(intercitySms.boarding('ru', 9, trip)).toBe('SFF Taxi бронь #9: водитель ждёт, Vokzal.');
    expect(intercitySms.booked('ru', 9, trip, 2, 140000, '+998900000002', 'Cobalt')).toContain(
      'мест: 2, 140 000 сум',
    );
    const notifier = app.get(Notifier);
    const db = app.get(Database).kysely;
    const rider = await signIn(app);
    const { id } = await db
      .selectFrom('users')
      .select('id')
      .where('phone', '=', rider.phone)
      .executeTakeFirstOrThrow();
    expect(await notifier.localeOfUser(id)).toBe('uz');
    await api(app, rider.accessToken).get('/v1/me').set('Accept-Language', 'ru').expect(200);
    expect(await notifier.localeOfUser(id)).toBe('ru');
  });
});
