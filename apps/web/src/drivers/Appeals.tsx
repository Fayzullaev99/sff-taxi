import { useQueryClient } from '@tanstack/react-query';
import { MessageSquareReply } from 'lucide-react';
import { useState } from 'react';
import { Link, useSearchParams } from 'react-router';
import { api } from '../api/client';
import { useAppeals } from '../api/queries';
import type { DriverAppeal } from '../api/types';
import { ago, dateTime, DRIVER_STATUS, DRIVER_STATUS_TONE } from '../lib/format';
import { Badge, Button, PageHeader, PhoneLink, Segmented } from '../ui/controls';
import { Empty, ErrorBox, Loading, useToast } from '../ui/feedback';
import { TextDialog } from '../ui/TextDialog';

/**
 * Rejected and blocked drivers asking for a review ("transparent rules, human appeal",
 * market analysis §6.1): read the appeal next to the decision, answer it; changing the
 * decision itself (unblock, re-review) is done on the driver's page.
 */
export default function Appeals() {
  const [params, setParams] = useSearchParams();
  const status = (params.get('status') as 'open' | 'resolved' | null) ?? 'open';
  const appeals = useAppeals(status);
  const queryClient = useQueryClient();
  const toast = useToast();
  const [answering, setAnswering] = useState<DriverAppeal | null>(null);

  return (
    <div>
      <PageHeader
        title="Haydovchilar murojaatlari"
        subtitle="Rad etilgan yoki bloklangan haydovchilar qarorni qayta ko‘rib chiqishni so‘raydi"
      />
      <div className="filters">
        <Segmented
          label="Holat"
          value={status}
          onChange={(v) => setParams({ status: v }, { replace: true })}
          options={[
            { value: 'open', label: 'Javob kutmoqda' },
            { value: 'resolved', label: 'Javob berilgan' },
          ]}
        />
      </div>
      {appeals.error ? (
        <ErrorBox error={appeals.error} onRetry={() => void appeals.refetch()} />
      ) : appeals.isPending ? (
        <Loading />
      ) : !appeals.data.length ? (
        <Empty title={status === 'open' ? 'Javob kutayotgan murojaat yo‘q' : 'Murojaat yo‘q'} />
      ) : (
        <ul className="appeal-list">
          {appeals.data.map((a) => (
            <li key={a.id} className="card appeal-card">
              <div className="card-head">
                <h2>
                  <Link to={`/drivers/${a.driverId}`}>{a.fullName}</Link>
                </h2>
                <span className="muted small">
                  {dateTime(a.createdAt)} · {ago(a.createdAt)}
                </span>
              </div>
              <p className="small">
                <PhoneLink phone={a.phone} /> · murojaat paytida:{' '}
                <Badge tone={DRIVER_STATUS_TONE[a.statusAt]}>{DRIVER_STATUS[a.statusAt]}</Badge> ·
                hozir:{' '}
                <Badge tone={DRIVER_STATUS_TONE[a.driverStatus]}>
                  {DRIVER_STATUS[a.driverStatus]}
                </Badge>
              </p>
              {a.statusReason && (
                <p className="small">
                  <span className="muted">Qaror sababi:</span> {a.statusReason}
                </p>
              )}
              <blockquote className="appeal-text">{a.text}</blockquote>
              {a.status === 'resolved' ? (
                <div className="alert alert-ok">
                  <span>
                    Javob ({dateTime(a.resolvedAt)}): {a.resolution}
                  </span>
                </div>
              ) : (
                <div className="row-actions">
                  <Button
                    size="sm"
                    variant="primary"
                    icon={<MessageSquareReply size={14} />}
                    onClick={() => setAnswering(a)}
                  >
                    Javob berish
                  </Button>
                  <Link to={`/drivers/${a.driverId}`} className="btn btn-sm btn-ghost">
                    {a.driverStatus === 'blocked' ? 'Profil: blokdan chiqarish' : 'Profilni ochish'}
                  </Link>
                </div>
              )}
            </li>
          ))}
        </ul>
      )}
      {answering && (
        <TextDialog
          title={`${answering.fullName}: javob`}
          intro={
            <p className="small">
              Javob haydovchi ilovasida ko‘rinadi. Qarorni o‘zgartirish (blokdan chiqarish) —
              haydovchi sahifasida alohida.
            </p>
          }
          label="Javob"
          confirm="Javob berish"
          maxLength={1000}
          suggestions={[
            'Qaror o‘zgarishsiz qoladi: sabab yuqorida ko‘rsatilgan',
            'Hisobingiz blokdan chiqarildi, qoidalarga rioya qiling',
            'Hujjatlarni to‘g‘rilab, arizani qayta yuboring',
          ]}
          onSubmit={(resolution) =>
            api(`/v1/admin/drivers/appeals/${answering.id}/resolve`, {
              method: 'POST',
              body: { resolution },
            }).then(() => {
              void queryClient.invalidateQueries({ queryKey: ['appeals'] });
              toast(`${answering.fullName}: javob yuborildi`);
            })
          }
          onClose={() => setAnswering(null)}
        />
      )}
    </div>
  );
}
