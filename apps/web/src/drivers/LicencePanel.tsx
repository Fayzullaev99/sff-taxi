import { useMutation, useQueryClient } from '@tanstack/react-query';
import { BadgeCheck, ShieldAlert } from 'lucide-react';
import { useState } from 'react';
import { api, errorText, fieldErrors } from '../api/client';
import type { AdminDriver } from '../api/types';
import { expiryState } from '../lib/drivers';
import { date, dateTime, LICENCE_STATUS, LICENCE_TONE, tashkentToday } from '../lib/format';
import { Badge, Button, Field, Segmented } from '../ui/controls';
import { useToast } from '../ui/feedback';
import { Modal } from '../ui/Modal';

function LicenceDialog({ driver, onClose }: { driver: AdminDriver; onClose: () => void }) {
  const queryClient = useQueryClient();
  const toast = useToast();
  const [result, setResult] = useState<'valid' | 'invalid'>('valid');
  const [note, setNote] = useState('Transport vazirligi reyestri: ');
  const [expiresOn, setExpiresOn] = useState('');
  const [touched, setTouched] = useState(false);
  const noteText = note.trim();
  const local: Record<string, string> = {};
  if (noteText.length < 3 || noteText === 'Transport vazirligi reyestri:') {
    local.note = 'Qayerda, qanday tekshirilganini yozing';
  }
  if (expiresOn && expiresOn < tashkentToday()) local.expiresOn = 'Muddat o‘tgan sana';

  const save = useMutation({
    mutationFn: () =>
      api<AdminDriver>(`/v1/admin/drivers/${driver.id}/licence`, {
        method: 'POST',
        body: { result, note: noteText, expiresOn: expiresOn || null },
      }),
    onSuccess: (updated) => {
      queryClient.setQueryData(['driver', driver.id], updated);
      void queryClient.invalidateQueries({ queryKey: ['drivers'] });
      void queryClient.invalidateQueries({ queryKey: ['live'] });
      toast(
        result === 'valid'
          ? `${driver.fullName}: litsenziya tasdiqlandi`
          : `${driver.fullName}: litsenziya tasdiqlanmadi`,
      );
      onClose();
    },
  });
  const server = fieldErrors(save.error);

  return (
    <Modal
      open
      onClose={onClose}
      title="Litsenziya kartochkasini tekshirish"
      size="sm"
      busy={save.isPending}
      footer={
        <>
          <Button variant="ghost" onClick={onClose} disabled={save.isPending}>
            Qaytish
          </Button>
          <Button
            variant={result === 'valid' ? 'primary' : 'danger'}
            loading={save.isPending}
            onClick={() => {
              setTouched(true);
              if (!Object.keys(local).length) save.mutate();
            }}
          >
            {result === 'valid' ? 'Tasdiqlangan deb yozish' : 'Yaroqsiz deb yozish'}
          </Button>
        </>
      }
    >
      <p>
        Kartochka <strong className="mono">{driver.licenceCard.number}</strong> (
        {date(driver.licenceCard.expiresOn)} gacha) ni Transport vazirligi reyestrida tekshiring va
        natijani yozing. Har bir tekshiruv tarixda saqlanadi.
      </p>
      <Segmented
        label="Natija"
        value={result}
        onChange={setResult}
        options={[
          { value: 'valid', label: 'Reyestrda bor, amal qiladi' },
          { value: 'invalid', label: 'Topilmadi / bekor qilingan' },
        ]}
      />
      {result === 'invalid' && (
        <div className="alert alert-warn">
          Haydovchi darhol liniyadan chiqariladi, takliflari qaytarib olinadi va tasdiqlab
          bo‘lmaydi.
        </div>
      )}
      <Field label="Izoh" error={(touched && local.note) || server.note}>
        {(p) => (
          <textarea
            {...p}
            value={note}
            maxLength={500}
            onChange={(e) => setNote(e.target.value)}
            autoFocus
          />
        )}
      </Field>
      <Field
        label="Reyestrdagi amal qilish muddati (ixtiyoriy)"
        hint="Reyestr boshqa sana ko‘rsatsa"
        error={(touched && local.expiresOn) || server.expiresOn}
      >
        {(p) => (
          <input
            {...p}
            type="date"
            value={expiresOn}
            onChange={(e) => setExpiresOn(e.target.value)}
          />
        )}
      </Field>
      {save.error && !Object.keys(server).length && (
        <div className="alert alert-error" role="alert">
          {errorText(save.error)}
        </div>
      )}
    </Modal>
  );
}

/**
 * The licence card and its verification (Resolution 200: only licensed carriers; the
 * registry check is manual until the Ministry's API is available). Approval and going
 * online need a card the registry confirmed.
 */
export function LicencePanel({ driver }: { driver: AdminDriver }) {
  const [open, setOpen] = useState(false);
  const card = driver.licenceCard;
  const expiry = expiryState(card.expiresOn, tashkentToday());
  return (
    <section className="card">
      <div className="card-head">
        <h2>
          {card.verification === 'valid' ? (
            <BadgeCheck size={17} aria-hidden />
          ) : (
            <ShieldAlert size={17} aria-hidden />
          )}{' '}
          Litsenziya kartochkasi
        </h2>
        <Badge tone={LICENCE_TONE[card.verification]}>{LICENCE_STATUS[card.verification]}</Badge>
      </div>
      <dl className="facts facts-2">
        <div>
          <dt>Raqami</dt>
          <dd className="mono">{card.number}</dd>
        </div>
        <div>
          <dt>Amal qiladi</dt>
          <dd>
            {date(card.expiresOn)}{' '}
            {expiry !== 'ok' && (
              <Badge tone={expiry === 'expired' ? 'red' : 'amber'}>
                {expiry === 'expired' ? 'muddati o‘tgan' : 'tugayapti'}
              </Badge>
            )}
          </dd>
        </div>
        <div>
          <dt>Oxirgi tekshiruv</dt>
          <dd>{card.checkedAt ? dateTime(card.checkedAt) : '—'}</dd>
        </div>
      </dl>
      {card.verification !== 'valid' && (
        <p className="muted small">
          {card.verification === 'invalid'
            ? 'Reyestrda tasdiqlanmagan: haydovchi liniyaga chiqolmaydi va tasdiqlab bo‘lmaydi.'
            : 'Tasdiqlashdan oldin kartochkani reyestrda tekshiring va natijani yozing.'}
        </p>
      )}
      <Button
        size="sm"
        variant={card.verification === 'valid' ? 'outline' : 'primary'}
        onClick={() => setOpen(true)}
      >
        {card.verification === 'valid' ? 'Qayta tekshirish' : 'Reyestr natijasini yozish'}
      </Button>
      {driver.licenceChecks.length > 0 && (
        <>
          <h3 className="subhead">Tekshiruvlar tarixi</h3>
          <ol className="timeline">
            {driver.licenceChecks.map((c, i) => (
              <li key={`${c.at}-${i}`}>
                <time dateTime={c.at}>{dateTime(c.at)}</time>
                <div>
                  <Badge tone={c.result === 'valid' ? 'green' : 'red'}>
                    {c.result === 'valid' ? 'Tasdiqlandi' : 'Tasdiqlanmadi'}
                  </Badge>{' '}
                  <span className="muted small">
                    {c.source === 'manual' ? 'operator' : 'Transport vazirligi API'} ·{' '}
                    <span className="mono">{c.licenceCardNumber}</span>
                    {c.expiresOn && ` · ${date(c.expiresOn)} gacha`}
                  </span>
                  {c.note && <div className="small">{c.note}</div>}
                </div>
              </li>
            ))}
          </ol>
        </>
      )}
      {open && <LicenceDialog driver={driver} onClose={() => setOpen(false)} />}
    </section>
  );
}
