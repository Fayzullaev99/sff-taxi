import { Star, X } from 'lucide-react';
import { useMemo } from 'react';
import { Link, useSearchParams } from 'react-router';
import { type RatingFilters, useRatings } from '../api/queries';
import { dateTime } from '../lib/format';
import { formatPhone } from '../lib/phone';
import { Badge, Button, PageHeader, Segmented } from '../ui/controls';
import { Empty, ErrorBox, Loading } from '../ui/feedback';
import { LoadMore } from '../ui/LoadMore';

function Stars({ n }: { n: number }) {
  return (
    <span className={`stars${n <= 2 ? ' is-low' : ''}`} aria-label={`${n} yulduz`}>
      {Array.from({ length: 5 }, (_, i) => (
        <Star key={i} size={13} aria-hidden fill={i < n ? 'currentColor' : 'none'} />
      ))}
    </span>
  );
}

/**
 * Ratings both ways, newest first: riders rating drivers (feeds the priority score) and
 * drivers rating riders; filter to the low ones to follow up.
 */
export default function Ratings() {
  const [params, setParams] = useSearchParams();
  const of = (params.get('of') as RatingFilters['of'] | null) ?? 'driver';
  const maxStars = params.get('maxStars') ? Number(params.get('maxStars')) : null;
  const subjectId = params.get('subjectId') ?? undefined;
  const ratings = useRatings({ of, maxStars, subjectId });
  const rows = useMemo(() => ratings.data?.pages.flatMap((p) => p.items) ?? [], [ratings.data]);
  const set = (key: string, value: string | null) => {
    const next = new URLSearchParams(params);
    if (value) next.set(key, value);
    else next.delete(key);
    setParams(next, { replace: true });
  };

  return (
    <div>
      <PageHeader
        title="Baholar"
        subtitle="Yo‘lovchilar haydovchilarga va haydovchilar yo‘lovchilarga qo‘ygan baholar"
      />
      <div className="filters">
        <Segmented
          label="Kimning bahosi"
          value={of}
          onChange={(v) => set('of', v)}
          options={[
            { value: 'driver', label: 'Haydovchilar' },
            { value: 'rider', label: 'Yo‘lovchilar' },
            { value: '', label: 'Hammasi' },
          ]}
        />
        <label className="sr-only" htmlFor="max-stars">
          Yulduzlar
        </label>
        <select
          id="max-stars"
          value={maxStars ?? ''}
          onChange={(e) => set('maxStars', e.target.value || null)}
        >
          <option value="">Barcha baholar</option>
          <option value="3">3 va past</option>
          <option value="2">2 va past</option>
          <option value="1">Faqat 1</option>
        </select>
        {subjectId && (
          <Button
            size="sm"
            variant="ghost"
            icon={<X size={14} />}
            onClick={() => set('subjectId', null)}
          >
            Bitta kishining baholari — tozalash
          </Button>
        )}
      </div>
      {ratings.error ? (
        <ErrorBox error={ratings.error} onRetry={() => void ratings.refetch()} />
      ) : ratings.isPending ? (
        <Loading />
      ) : !rows.length ? (
        <Empty title="Baho topilmadi">Filtrlarni o‘zgartiring.</Empty>
      ) : (
        <div className="card table-card">
          <table className="table">
            <thead>
              <tr>
                <th>Vaqt</th>
                <th>Baho</th>
                <th>Kimga</th>
                <th>Kimdan</th>
                <th>Izoh</th>
                <th>Safar</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.id}>
                  <td className="nowrap">{dateTime(r.createdAt)}</td>
                  <td>
                    <Stars n={r.stars} />
                  </td>
                  <td>
                    {r.authorRole === 'rider' ? (
                      <Link to={`/drivers/${r.subjectId}`}>{r.subjectName ?? 'Haydovchi'}</Link>
                    ) : (
                      (r.subjectName ?? 'Yo‘lovchi')
                    )}
                    <div className="muted small">
                      {r.authorRole === 'rider' ? 'haydovchi' : 'yo‘lovchi'} ·{' '}
                      {formatPhone(r.subjectPhone)}
                    </div>
                  </td>
                  <td>{r.authorName ?? (r.authorRole === 'rider' ? 'Yo‘lovchi' : 'Haydovchi')}</td>
                  <td className="cell-text">
                    {r.tags.map((t) => (
                      <Badge key={t}>{t}</Badge>
                    ))}
                    {r.comment && <div className="small">{r.comment}</div>}
                    {!r.tags.length && !r.comment && <span className="muted">—</span>}
                  </td>
                  <td>
                    <Link to={`/rides/${r.rideId}`}>#{r.rideNumber}</Link>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          <LoadMore
            shown={rows.length}
            hasMore={ratings.hasNextPage}
            loading={ratings.isFetchingNextPage}
            onMore={() => void ratings.fetchNextPage()}
          />
        </div>
      )}
    </div>
  );
}
