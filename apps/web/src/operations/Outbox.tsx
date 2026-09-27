import { useMutation, useQueryClient } from '@tanstack/react-query';
import { RotateCw } from 'lucide-react';
import { useMemo } from 'react';
import { Link, useSearchParams } from 'react-router';
import { api } from '../api/client';
import { useOutbox } from '../api/queries';
import { ago, dateTime, OUTBOX_TOPICS } from '../lib/format';
import { eventLink } from '../lib/ops';
import { Badge, Button, PageHeader, Segmented } from '../ui/controls';
import { Empty, ErrorBox, Loading, useConfirm, useToast } from '../ui/feedback';
import { LoadMore } from '../ui/LoadMore';

type State = 'dead' | 'failing';

/**
 * Side effects that did not happen (a push, an SMS, a dispatch step, a fiscal receipt):
 * dead ones the worker gave up on after 10 attempts, failing ones it is still retrying.
 * Retry one once the cause is fixed (a key replaced, a provider back up).
 */
export default function Outbox() {
  const [params, setParams] = useSearchParams();
  const state = (params.get('state') as State | null) ?? 'dead';
  const events = useOutbox(state, 30_000);
  const queryClient = useQueryClient();
  const toast = useToast();
  const confirm = useConfirm();
  const rows = useMemo(() => events.data?.pages.flat() ?? [], [events.data]);
  const retry = useMutation({
    mutationFn: (id: string) => api(`/v1/admin/outbox/${id}/retry`, { method: 'POST' }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['outbox'] });
      toast('Hodisa qayta navbatga qo‘yildi');
    },
  });

  return (
    <div>
      <PageHeader
        title="Bajarilmagan amallar"
        subtitle="Outbox: yuborilmagan SMS va bildirishnomalar, fiskal cheklar, dispetcher qadamlari"
      />
      <div className="filters">
        <Segmented
          label="Holat"
          value={state}
          onChange={(v) => setParams({ state: v }, { replace: true })}
          options={[
            { value: 'dead', label: 'To‘xtagan (10 urinish)' },
            { value: 'failing', label: 'Qayta urinilmoqda' },
          ]}
        />
      </div>
      {retry.error && <ErrorBox error={retry.error} />}
      {events.error ? (
        <ErrorBox error={events.error} onRetry={() => void events.refetch()} />
      ) : events.isPending ? (
        <Loading />
      ) : !rows.length ? (
        <Empty title={state === 'dead' ? 'To‘xtagan amal yo‘q' : 'Xato bilan turgan amal yo‘q'}>
          Hammasi bajarilgan.
        </Empty>
      ) : (
        <div className="card table-card">
          <table className="table">
            <thead>
              <tr>
                <th>Yaratilgan</th>
                <th>Amal</th>
                <th>Xato</th>
                <th>Urinish</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {rows.map((e) => {
                const link = eventLink(e);
                return (
                  <tr key={e.id}>
                    <td className="nowrap">
                      {dateTime(e.createdAt)}
                      <div className="muted small">{ago(e.createdAt)}</div>
                    </td>
                    <td>
                      <strong>{OUTBOX_TOPICS[e.topic] ?? e.topic}</strong>
                      <div className="muted small mono">{e.topic}</div>
                      {link && (
                        <Link to={link.to} className="small">
                          {link.label}
                        </Link>
                      )}
                    </td>
                    <td className="cell-text">
                      <span className="small negative clamp-2">{e.lastError ?? '—'}</span>
                      <details className="payload">
                        <summary>Ma’lumot</summary>
                        <pre>{JSON.stringify(e.payload, null, 2)}</pre>
                      </details>
                    </td>
                    <td>
                      <Badge tone={e.attempts >= e.maxAttempts ? 'red' : 'amber'}>
                        {e.attempts} / {e.maxAttempts}
                      </Badge>
                      {state === 'failing' && e.nextAttemptAt && (
                        <div className="muted small">keyingisi {dateTime(e.nextAttemptAt)}</div>
                      )}
                    </td>
                    <td className="actions">
                      <Button
                        size="sm"
                        icon={<RotateCw size={14} />}
                        loading={retry.isPending && retry.variables === e.id}
                        onClick={() =>
                          void confirm({
                            title: 'Qayta urinish',
                            text: `${OUTBOX_TOPICS[e.topic] ?? e.topic}: sababi tuzatilganiga ishonch hosil qiling. Amal darhol qayta bajariladi.`,
                            confirm: 'Qayta urinish',
                          }).then((ok) => ok && retry.mutate(e.id))
                        }
                      >
                        Qayta urinish
                      </Button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          <LoadMore
            shown={rows.length}
            hasMore={events.hasNextPage}
            loading={events.isFetchingNextPage}
            onMore={() => void events.fetchNextPage()}
          />
        </div>
      )}
    </div>
  );
}
