import { Search } from 'lucide-react';
import { useMemo, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router';
import { useDrivers } from '../api/queries';
import type { DriverStatus, LicenceStatus } from '../api/types';
import {
  ago,
  CLASSES,
  date,
  DRIVER_STATUS,
  DRIVER_STATUS_TONE,
  LICENCE_TONE,
  rating,
  som,
} from '../lib/format';
import { formatPhone } from '../lib/phone';
import { useDebounced } from '../map/places';
import { Badge, PageHeader, Segmented } from '../ui/controls';
import { Empty, ErrorBox, Loading } from '../ui/feedback';

type Tab = DriverStatus | 'all';

const LICENCE_SHORT: Record<LicenceStatus, string> = {
  unverified: 'Tekshirilmagan',
  valid: 'Tasdiqlangan',
  invalid: 'Yaroqsiz',
};
const TABS: { value: Tab; label: string }[] = [
  { value: 'pending', label: 'Tekshiruv navbati' },
  { value: 'active', label: 'Faol' },
  { value: 'blocked', label: 'Bloklangan' },
  { value: 'rejected', label: 'Rad etilgan' },
  { value: 'all', label: 'Hammasi' },
];

/**
 * Drivers by status. "Tekshiruv navbati" is the verification queue, oldest application
 * first; the others are newest first as the API sends them.
 */
export default function DriversList() {
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();
  const tab = (params.get('status') as Tab | null) ?? 'pending';
  const [q, setQ] = useState('');
  const query = useDebounced(q.trim(), 300);
  const drivers = useDrivers(tab, query);
  const pending = useDrivers('pending');

  const rows = useMemo(() => {
    const list = drivers.data ?? [];
    return tab === 'pending' ? [...list].reverse() : list;
  }, [drivers.data, tab]);

  return (
    <div>
      <PageHeader
        title="Haydovchilar"
        subtitle="Arizalarni tekshirish (Vazirlar Mahkamasining 200-qarori talablari), bloklash, balans"
      />
      <div className="filters">
        <Segmented
          label="Holat"
          value={tab}
          onChange={(v) => setParams({ status: v }, { replace: true })}
          options={TABS.map((t) => ({
            value: t.value,
            label:
              t.value === 'pending' && pending.data?.length
                ? `${t.label} (${pending.data.length})`
                : t.label,
          }))}
        />
        <div className="search">
          <Search size={16} aria-hidden />
          <input
            type="search"
            aria-label="Ism, telefon yoki davlat raqami"
            placeholder="Ism, telefon yoki davlat raqami"
            value={q}
            maxLength={50}
            onChange={(e) => setQ(e.target.value)}
          />
        </div>
      </div>
      {drivers.error ? (
        <ErrorBox error={drivers.error} onRetry={() => void drivers.refetch()} />
      ) : drivers.isPending ? (
        <Loading />
      ) : !rows.length ? (
        <Empty title={tab === 'pending' ? 'Navbat bo‘sh' : 'Haydovchi topilmadi'}>
          {tab === 'pending'
            ? 'Yangi arizalar kelganda shu yerda paydo bo‘ladi.'
            : 'Qidiruvni o‘zgartiring.'}
        </Empty>
      ) : (
        <div className="card table-card">
          <table className="table">
            <thead>
              <tr>
                <th>Haydovchi</th>
                <th>Avtomobil</th>
                <th>Holat</th>
                <th>Litsenziya</th>
                <th>Liniyada</th>
                <th className="num">Reyting</th>
                <th className="num">Ustuvorlik</th>
                <th className="num">Balans</th>
                <th>{tab === 'pending' ? 'Ariza' : 'Ro‘yxatdan o‘tgan'}</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((d) => (
                <tr key={d.id} className="row-link" onClick={() => navigate(`/drivers/${d.id}`)}>
                  <td>
                    <Link to={`/drivers/${d.id}`} onClick={(e) => e.stopPropagation()}>
                      <strong>{d.fullName}</strong>
                    </Link>
                    <div className="muted small">{formatPhone(d.phone)}</div>
                  </td>
                  <td>
                    {d.make ? (
                      <>
                        {d.make} {d.model}
                        <div className="small">
                          <span className="plate">{d.plateFormatted}</span>{' '}
                          {d.class && <span className="muted">{CLASSES[d.class]}</span>}
                        </div>
                      </>
                    ) : (
                      <span className="muted">—</span>
                    )}
                  </td>
                  <td>
                    <Badge tone={DRIVER_STATUS_TONE[d.status]}>{DRIVER_STATUS[d.status]}</Badge>
                    {d.statusReason && <div className="muted small clamp-2">{d.statusReason}</div>}
                  </td>
                  <td>
                    <Badge tone={LICENCE_TONE[d.licenceStatus]}>
                      {LICENCE_SHORT[d.licenceStatus]}
                    </Badge>
                  </td>
                  <td>
                    {d.isOnline ? (
                      <>
                        <Badge tone="green">Onlayn</Badge>
                        <div className="muted small">
                          {d.locatedAt ? `GPS ${ago(d.locatedAt)}` : 'GPS yo‘q'}
                        </div>
                      </>
                    ) : (
                      <span className="muted">—</span>
                    )}
                  </td>
                  <td className="num">
                    {rating(d.rating)} ★<div className="muted small">{d.ridesCompleted} safar</div>
                  </td>
                  <td className="num">{d.priority}</td>
                  <td className={`num${d.balance < 0 ? ' negative' : ''}`}>
                    {som(d.balance)}
                    {(d.cardOwed ?? 0) > 0 && (
                      <div
                        className="muted small"
                        title="Karta safarlari puli: haydovchiga o‘tkazilishi kerak"
                      >
                        karta puli {som(d.cardOwed!)}
                      </div>
                    )}
                  </td>
                  <td className="nowrap">
                    {date(d.createdAt)}
                    {tab === 'pending' && <div className="muted small">{ago(d.createdAt)}</div>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
