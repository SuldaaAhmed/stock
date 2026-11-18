'use client';

import { CheckCircle2, Download, Eye, FileText, Printer } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { urls } from '@/lib/api';
import { Button, ButtonLink } from './ui/Button';
import { Badge } from './ui/Display';
import { Modal } from './ui/Modal';

/**
 * PDF preview in an embedded viewer with Download and Print.
 * The PDF is fetched with the session cookie and shown from a blob: URL, so the viewer works even when the
 * application itself is embedded (Backend responses carry frame-ancestors 'self').
 */
export function PdfPreviewModal({ open, onClose, src, downloadHref, title }: { open: boolean; onClose: () => void; src: string; downloadHref?: string; title: string }) {
  const frameRef = useRef<HTMLIFrameElement>(null);
  const [blobUrl, setBlobUrl] = useState<string | null>(null);
  const [failed, setFailed] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    const ctrl = new AbortController();
    let url: string | null = null;
    setBlobUrl(null);
    setFailed(null);
    fetch(src, { credentials: 'include', cache: 'no-store', signal: ctrl.signal })
      .then(async (r) => {
        if (!r.ok) {
          let msg = `Could not load the document (${r.status}).`;
          try {
            const j = await r.json();
            if (j?.title) msg = j.title;
          } catch {
            /* not JSON */
          }
          throw new Error(msg);
        }
        const blob = await r.blob();
        url = URL.createObjectURL(new Blob([blob], { type: 'application/pdf' }));
        setBlobUrl(url);
      })
      .catch((e) => {
        if ((e as Error)?.name !== 'AbortError') setFailed((e as Error).message || 'Could not load the document.');
      });
    return () => {
      ctrl.abort();
      if (url) URL.revokeObjectURL(url);
    };
  }, [open, src]);

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={title}
      size="xl"
      footer={
        <>
          <Button variant="cancel" onClick={onClose}>
            Close
          </Button>
          <Button
            variant="print"
            icon={<Printer className="h-4 w-4" />}
            disabled={!blobUrl}
            onClick={() => {
              try {
                frameRef.current?.contentWindow?.print();
              } catch {
                if (blobUrl) window.open(blobUrl, '_blank');
              }
            }}
          >
            Print
          </Button>
          {downloadHref && (
            <ButtonLink href={downloadHref} download variant="save" icon={<Download className="h-4 w-4" />}>
              Download
            </ButtonLink>
          )}
        </>
      }
    >
      <div className="relative h-[70vh] overflow-hidden rounded-lg border border-slate-200 bg-slate-100 dark:border-slate-700 dark:bg-slate-900">
        {!blobUrl && !failed && <div className="absolute inset-0 flex items-center justify-center text-sm text-slate-500">Loading document…</div>}
        {failed && <div className="absolute inset-0 flex items-center justify-center p-6 text-center text-sm text-red-600">{failed}</div>}
        {blobUrl && <iframe ref={frameRef} src={blobUrl} title={title} className="h-full w-full" />}
      </div>
    </Modal>
  );
}

/** Inline receipt buttons (Preview / Download) for detail views. */
export function ReceiptButtons({ receiptId, receiptNumber, size = 'sm' }: { receiptId: string | null | undefined; receiptNumber?: string | null; size?: 'sm' | 'md' }) {
  const [preview, setPreview] = useState(false);
  if (!receiptId) return null;
  return (
    <div className="flex flex-wrap items-center gap-2">
      <Button variant="outline" size={size} icon={<Eye className="h-4 w-4" />} onClick={() => setPreview(true)}>
        Preview {receiptNumber ?? 'receipt'}
      </Button>
      <ButtonLink href={urls.receiptPdf(receiptId, 'attachment')} download variant="outline" size={size} icon={<Download className="h-4 w-4" />}>
        Download PDF
      </ButtonLink>
      <PdfPreviewModal
        open={preview}
        onClose={() => setPreview(false)}
        src={urls.receiptPdf(receiptId, 'inline')}
        downloadHref={urls.receiptPdf(receiptId, 'attachment')}
        title={`Receipt ${receiptNumber ?? ''}`}
      />
    </div>
  );
}

export interface SavedDocument {
  title: string;
  number: string;
  receiptId?: string | null;
  receiptNumber?: string | null;
  details?: React.ReactNode;
  note?: React.ReactNode;
}

/**
 * Post-save confirmation shown only after the Backend confirms success.
 * Offers the receipt PDF: Preview, Download, or Skip (Frontend §4.4–4.10, §4.13).
 */
export function SavedDocumentModal({ doc, onClose }: { doc: SavedDocument | null; onClose: () => void }) {
  const [preview, setPreview] = useState(false);
  if (!doc) return null;
  return (
    <>
      <Modal
        open={!!doc && !preview}
        onClose={onClose}
        size="sm"
        title={
          <span className="flex items-center gap-2">
            <CheckCircle2 className="h-5 w-5 text-[#16A34A]" /> {doc.title}
          </span>
        }
        footer={
          doc.receiptId ? (
            <>
              <Button variant="cancel" onClick={onClose}>
                Skip
              </Button>
              <ButtonLink href={urls.receiptPdf(doc.receiptId, 'attachment')} download variant="outline" icon={<Download className="h-4 w-4" />}>
                Download
              </ButtonLink>
              <Button variant="save" icon={<Eye className="h-4 w-4" />} onClick={() => setPreview(true)} data-autofocus>
                Preview
              </Button>
            </>
          ) : (
            <Button variant="save" onClick={onClose} data-autofocus>
              Done
            </Button>
          )
        }
      >
        <div className="space-y-4">
          <div className="rounded-xl border border-[#BBF7D0] bg-[#F0FDF4] p-4 text-center dark:border-green-900 dark:bg-green-950/40">
            <p className="text-xs font-medium uppercase tracking-wide text-[#166534] dark:text-green-300">Document number</p>
            <p className="mt-1 font-mono text-2xl font-bold text-[#166534] dark:text-green-200">{doc.number}</p>
          </div>
          {doc.details}
          {doc.receiptId ? (
            <p className="flex items-center gap-2 text-sm text-slate-600 dark:text-slate-300">
              <FileText className="h-4 w-4 text-slate-400" />
              Receipt <Badge tone="teal">{doc.receiptNumber}</Badge> is ready. Preview, download, or skip.
            </p>
          ) : (
            doc.note && <p className="text-sm text-slate-600 dark:text-slate-300">{doc.note}</p>
          )}
        </div>
      </Modal>
      {doc.receiptId && (
        <PdfPreviewModal
          open={preview}
          onClose={() => {
            setPreview(false);
            onClose();
          }}
          src={urls.receiptPdf(doc.receiptId, 'inline')}
          downloadHref={urls.receiptPdf(doc.receiptId, 'attachment')}
          title={`Receipt ${doc.receiptNumber ?? ''}`}
        />
      )}
    </>
  );
}
