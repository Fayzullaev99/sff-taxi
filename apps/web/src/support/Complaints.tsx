import { useMutation, useQueryClient } from '@tanstack/react-query';
import { CircleCheck, PackageSearch, Send } from 'lucide-react';
import { useMemo, useState } from 'react';
import { Link, useSearchParams } from 'react-router';
import { api, errorText } from '../api/client';
import { type ComplaintFilters, useComplaint, useComplaints } from '../api/queries';
import { type Complaint, COMPLAINT_TYPES, type ComplaintResolution } from '../api/types';
import {
  ago,
  COMPLAINT_STATUS,
  COMPLAINT_TONE,
  COMPLAINT_TYPE,
  dateTime,
  RESOLUTIONS,
} from '../lib/format';
import { formatPhone } from '../lib/phone';
import { resolutionsFor } from '../lib/ops';
import { Badge, Button, Field, PageHeader, Segmented } from '../ui/controls';
import { Empty, ErrorBox, Loading, useConfirm, useToast } from '../ui/feedback';
import { LoadMore } from '../ui/LoadMore';
import { Modal } from '../ui/Modal';

type StatusTab = ComplaintFilters['status'];

function ComplaintDetail({ id }: { id: string }) {
  const complaint = useComplaint(id);
  const queryClient = useQueryClient();
  const toast = useToast();
  const confirm = useConfirm();
  const [reply, setReply] = useState('');
  const [resolution, setResolution] = useState<ComplaintResolution | ''>('');
  const [note, setNote] = useState('');
  const [resolveTouched, setResolveTouched] = useState(false);

  const done = (updated: Complaint) => {
    queryClient.setQueryData(['complaint', id], updated);
    void queryClient.invalidateQueries({ queryKey: ['complaints'] });
  };
  const send = useMutation({
    mutationFn: () =>
      api<Complaint>(`/v1/admin/complaints/${id}/messages`, {
        method: 'POST',
        body: { text: reply.trim() },
      }),
    onSuccess: (updated) => {
      done(updated);
      setReply('');
      toast('Javob yuborildi: yo‘lovchi ilovada ko‘radi');
    },
  });
  const resolve = useMutation({
    mutationFn: () =>
      api<Complaint>(`/v1/admin/complaints/${id}/resolve`, {
        method: 'POST',
        body: { resolution, note: note.trim() || null },
      }),
    onSuccess: (updated) => {
      done(updated);
      toast(`#${updated.rideNumber} murojaati yopildi`);
    },
  });

  if (complaint.isPending) return <Loading />;
  if (complaint.error) {
    return <ErrorBox error={complaint.error} onRetry={() => void complaint.refetch()} />;
  }
  const c = complaint.data;
  const closed = c.status === 'resolved';
  const sendReply = () => {
    if (reply.trim() && !send.isPending) send.mutate();
  };

  return (
    <div className="complaint-detail">
      <div className="ride-head-main">
        <Badge tone={COMPLAINT_TONE[c.status]}>{COMPLAINT_STATUS[c.status]}</Badge>
        <Badge tone={c.type === 'lost_item' ? 'brand' : c.type === 'safety' ? 'red' : 'neutral'}>
          {COMPLAINT_TYPE[c.type] ?? c.typeLabel}
        </Badge>
        <span className="muted small">
          {dateTime(c.createdAt)} · {ago(c.createdAt)}
        </span>
      </div>
      <p className="small">
        Safar <Link to={`/rides/${c.rideId}`}>#{c.rideNumber}</Link>
        {c.driverId && (
          <>
            {' · '}
            <Link to={`/drivers/${c.driverId}`}>haydovchi profili</Link>
          </>
        )}
      </p>
      <ol className="thread">
        <li className="msg msg-rider">
          <span className="msg-meta">Yo‘lovchi · {dateTime(c.createdAt)}</span>
          <p>{c.text}</p>
        </li>
        {c.messages.map((m) => (
          <li key={m.id} className={`msg msg-${m.authorRole}`}>
            <span className="msg-meta">
              {m.authorRole === 'admin' ? 'Operator' : 'Yo‘lovchi'} · {dateTime(m.at)}
            </span>
            <p>{m.text}</p>
          </li>
        ))}
      </ol>

      {closed ? (
        <div className="alert alert-ok">
          <CircleCheck size={16} aria-hidden />
          <span>
            Yopilgan {dateTime(c.resolvedAt)}:{' '}
            <strong>{c.resolution ? RESOLUTIONS[c.resolution] : '—'}</strong>
            {c.resolutionNote && ` — ${c.resolutionNote}`}
          </span>
        </div>
      ) : (
        <>
          <Field
            label="Yo‘lovchiga javob"
            hint="Ctrl+Enter — yuborish"
            error={send.error ? errorText(send.error) : null}
          >
            {(p) => (
              <textarea
                {...p}
                value={reply}
                maxLength={2000}
                placeholder="Masalan: haydovchi bilan bog‘landik, telefoningiz ertaga ofisda bo‘ladi"
                onChange={(e) => setReply(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
                    e.preventDefault();
                    sendReply();
                  }
                }}
              />
            )}
          </Field>
          <Button
            size="sm"
            variant="primary"
            icon={<Send size={14} />}
            loading={send.isPending}
            disabled={!reply.trim()}
            onClick={sendReply}
          >
            Javob yuborish
          </Button>

          <h3 className="subhead">Yopish</h3>
          <div className="grid-2">
            <Field label="Natija" error={resolveTouched && !resolution ? 'Natijani tanlang' : null}>
              {(p) => (
                <select
                  {...p}
                  value={resolution}
                  onChange={(e) => setResolution(e.target.value as ComplaintResolution)}
                >
                  <option value="">Tanlang…</option>
                  {resolutionsFor(c.type).map((r) => (
                    <option key={r} value={r}>
                      {RESOLUTIONS[r]}
                    </option>
                  ))}
                </select>
              )}
            </Field>
            <Field label="Izoh (yo‘lovchi ko‘radi, ixtiyoriy)">
              {(p) => (
                <input
                  {...p}
                  value={note}
                  maxLength={1000}
                  onChange={(e) => setNote(e.target.value)}
                />
              )}
            </Field>
          </div>
          {resolve.error && <ErrorBox error={resolve.error} />}
          <Button
            size="sm"
            icon={<CircleCheck size={14} />}
            loading={resolve.isPending}
            onClick={() => {
              setResolveTouched(true);
              if (!resolution) return;
              void confirm({
                title: 'Murojaatni yopish',
                text: `Natija: ${RESOLUTIONS[resolution]}. Yopilgandan keyin javob yozib bo‘lmaydi.`,
                confirm: 'Yopish',
              }).then((ok) => ok && resolve.mutate());
            }}
          >
            Murojaatni yopish
          </Button>
        </>
      )}
    </div>
  );
}

/**
 * Riders' complaints about rides, lost items included (7 days after the ride): the thread
 * with the rider, a reply (the rider sees it in the app), and closing with an outcome.
 */
export default function Complaints() {
  const [params, setParams] = useSearchParams();
  const status = (params.get('status') as StatusTab | null) ?? 'unresolved';
  const type = params.get('type') ?? '';
  const openId = params.get('id');
  const complaints = useComplaints({ status, type }, 60_000);
  const rows = useMemo(
    () => complaints.data?.pages.flatMap((p) => p.items) ?? [],
    [complaints.data],
  );
  const set = (key: string, value: string | null) => {
    const next = new URLSearchParams(params);
    if (value) next.set(key, value);
    else next.delete(key);
    setParams(next, { replace: true });
  };

  return (
    <div>
      <PageHeader
        title="Shikoyatlar"
        subtitle="Yo‘lovchilar murojaatlari: yo‘qolgan narsalar, haydovchi, narx, xavfsizlik"
        actions={
          <Button
            size="sm"
            variant={type === 'lost_item' ? 'primary' : 'outline'}
            icon={<PackageSearch size={15} />}
            aria-pressed={type === 'lost_item'}
            onClick={() => set('type', type === 'lost_item' ? null : 'lost_item')}
          >
            Yo‘qolgan narsalar
          </Button>
        }
      />
      <div className="filters">
        <Segmented
          label="Holat"
          value={status}
          onChange={(v) => set('status', v)}
          options={[
            { value: 'unresolved', label: 'Yopilmagan' },
            { value: 'open', label: COMPLAINT_STATUS.open },
            { value: 'in_progress', label: COMPLAINT_STATUS.in_progress },
            { value: 'resolved', label: COMPLAINT_STATUS.resolved },
          ]}
        />
        <label className="sr-only" htmlFor="complaint-type">
          Turi
        </label>
        <select id="complaint-type" value={type} onChange={(e) => set('type', e.target.value)}>
          <option value="">Barcha turlar</option>
          {COMPLAINT_TYPES.map((t) => (
            <option key={t} value={t}>
              {COMPLAINT_TYPE[t]}
            </option>
          ))}
        </select>
      </div>
      {complaints.error ? (
        <ErrorBox error={complaints.error} onRetry={() => void complaints.refetch()} />
      ) : complaints.isPending ? (
        <Loading />
      ) : !rows.length ? (
        <Empty title={status === 'resolved' ? 'Yopilgan murojaat yo‘q' : 'Ochiq murojaat yo‘q'}>
          Yo‘lovchilar ilovadan safar bo‘yicha murojaat yuboradi.
        </Empty>
      ) : (
        <div className="card table-card">
          <table className="table">
            <thead>
              <tr>
                <th>Vaqt</th>
                <th>Turi</th>
                <th>Murojaat</th>
                <th>Safar</th>
                <th>Holat</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((c) => (
                <tr
                  key={c.id}
                  className={`row-link${c.id === openId ? ' is-selected' : ''}`}
                  onClick={() => set('id', c.id)}
                >
                  <td className="nowrap">
                    {dateTime(c.createdAt)}
                    <div className="muted small">{ago(c.updatedAt)}</div>
                  </td>
                  <td>
                    <Badge
                      tone={
                        c.type === 'lost_item' ? 'brand' : c.type === 'safety' ? 'red' : 'neutral'
                      }
                    >
                      {COMPLAINT_TYPE[c.type] ?? c.typeLabel}
                    </Badge>
                  </td>
                  <td className="cell-text">
                    <button
                      type="button"
                      className="link-btn clamp-2"
                      onClick={(e) => {
                        e.stopPropagation();
                        set('id', c.id);
                      }}
                    >
                      {c.text}
                    </button>
                    <div className="muted small">{formatPhone(c.riderPhone)}</div>
                  </td>
                  <td>
                    <Link to={`/rides/${c.rideId}`} onClick={(e) => e.stopPropagation()}>
                      #{c.rideNumber}
                    </Link>
                  </td>
                  <td>
                    <Badge tone={COMPLAINT_TONE[c.status]}>{COMPLAINT_STATUS[c.status]}</Badge>
                    {c.resolution && <div className="muted small">{RESOLUTIONS[c.resolution]}</div>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          <LoadMore
            shown={rows.length}
            hasMore={complaints.hasNextPage}
            loading={complaints.isFetchingNextPage}
            onMore={() => void complaints.fetchNextPage()}
          />
        </div>
      )}
      <Modal
        open={openId !== null}
        onClose={() => set('id', null)}
        variant="drawer"
        size="lg"
        title="Murojaat"
      >
        {openId && <ComplaintDetail key={openId} id={openId} />}
      </Modal>
    </div>
  );
}
