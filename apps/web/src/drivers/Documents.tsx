import { ExternalLink, FileText, ImageOff, RotateCw } from 'lucide-react';
import { useState } from 'react';
import { useUpload } from '../api/queries';
import type { DriverDocument } from '../api/types';
import { expiryState, isImageFile } from '../lib/drivers';
import { date, DOCUMENTS, fileSize } from '../lib/format';
import { Badge, Button } from '../ui/controls';
import { Empty, ErrorBox, Loading } from '../ui/feedback';
import { Modal } from '../ui/Modal';

/**
 * Where a document's file is: an upload (private bucket) is read through a fresh presigned
 * URL (GET /uploads/:id, valid 15 minutes; the one in the driver view may have expired while
 * the page stayed open); a legacy document has the URL the app sent.
 */
export function useDocumentFile(doc: DriverDocument | null) {
  const upload = useUpload(doc?.uploadId ?? null);
  if (!doc) return { url: null, contentType: null, sizeBytes: null, upload };
  if (!doc.uploadId) return { url: doc.url, contentType: null, sizeBytes: null, upload };
  return {
    url: upload.data?.url ?? doc.url,
    contentType: upload.data?.contentType ?? null,
    sizeBytes: upload.data?.sizeBytes ?? null,
    upload,
  };
}

function Thumb({ doc }: { doc: DriverDocument }) {
  const file = useDocumentFile(doc);
  const [failed, setFailed] = useState(false);
  if (doc.uploadId && file.upload.isPending) return <Loading text="" />;
  if (!file.url) return <ImageOff size={28} aria-hidden />;
  if (!isImageFile(file.contentType, file.url)) return <FileText size={32} aria-hidden />;
  if (failed) return <ImageOff size={28} aria-hidden />;
  return <img src={file.url} alt="" loading="lazy" onError={() => setFailed(true)} />;
}

export function DocumentTile({
  doc,
  today,
  onOpen,
}: {
  doc: DriverDocument;
  today: string;
  onOpen: () => void;
}) {
  const state = expiryState(doc.expiresOn, today);
  return (
    <li className="doc-tile">
      <button
        type="button"
        className="doc-preview"
        onClick={onOpen}
        aria-label={`${DOCUMENTS[doc.kind]}: ko‘rish`}
      >
        <Thumb doc={doc} />
      </button>
      <div className="doc-meta">
        <strong>{DOCUMENTS[doc.kind]}</strong>
        <span className="muted small">yuklangan {date(doc.uploadedAt)}</span>
        {doc.expiresOn && (
          <Badge tone={state === 'expired' ? 'red' : state === 'soon' ? 'amber' : 'neutral'}>
            {state === 'expired' ? 'muddati o‘tgan' : 'amal qiladi'} {date(doc.expiresOn)}
          </Badge>
        )}
        <button type="button" className="link-btn small" onClick={onOpen}>
          Asl faylni ochish
        </button>
      </div>
    </li>
  );
}

/** A document full size: pictures inline, PDFs embedded, always a link to the file. */
export function DocumentPreview({
  doc,
  onClose,
}: {
  doc: DriverDocument | null;
  onClose: () => void;
}) {
  const file = useDocumentFile(doc);
  const image = file.url ? isImageFile(file.contentType, file.url) : false;
  return (
    <Modal open={doc !== null} onClose={onClose} title={doc ? DOCUMENTS[doc.kind] : ''} size="lg">
      {doc &&
        (doc.uploadId && file.upload.isPending ? (
          <Loading text="Fayl ochilmoqda…" />
        ) : file.upload.error ? (
          <ErrorBox error={file.upload.error} onRetry={() => void file.upload.refetch()} />
        ) : !file.url ? (
          <Empty title="Fayl mavjud emas">
            Fayl omborga to‘liq yuklanmagan yoki ombor sozlanmagan. Haydovchidan qayta yuklashni
            so‘rang.
          </Empty>
        ) : (
          <div className="doc-viewer">
            {image ? (
              <img src={file.url} alt={DOCUMENTS[doc.kind]} className="doc-full" />
            ) : (
              <iframe src={file.url} title={DOCUMENTS[doc.kind]} className="doc-frame" />
            )}
            <div className="row-actions">
              <a
                href={file.url}
                target="_blank"
                rel="noreferrer noopener"
                className="btn btn-sm btn-ghost"
              >
                <ExternalLink size={14} aria-hidden /> Yangi oynada ochish
              </a>
              {doc.uploadId && (
                <Button
                  size="sm"
                  variant="ghost"
                  icon={<RotateCw size={14} />}
                  onClick={() => void file.upload.refetch()}
                >
                  Havolani yangilash
                </Button>
              )}
              <span className="muted small">
                {file.sizeBytes !== null && fileSize(file.sizeBytes)}
                {doc.uploadId && ' · havola 15 daqiqa amal qiladi'}
              </span>
            </div>
          </div>
        ))}
    </Modal>
  );
}
