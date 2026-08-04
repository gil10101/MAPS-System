/**
 * The refill queue — the one approval workflow that genuinely belongs to a
 * physician rather than to clinic staff.
 *
 * The filter defaults to `pending` because that is the work; approved and
 * denied are kept reachable because a decision made last week is exactly what
 * a doctor needs when the same patient asks again, and a queue that forgets its
 * own history forces them to open charts to reconstruct it.
 *
 * Approving dispenses one refill (the server increments `refills_used` in the
 * same transaction). Denying requires a note and prompts the patient to book a
 * follow-up — a refusal with no route forward is how someone quietly stops
 * taking their medication.
 */
import { useCallback, useEffect, useState } from 'react';
import { AlertCircle, Pill } from 'lucide-react';
import {
  decideRefillRequest, formatStamp, listRefillRequests,
  type RefillRequest, type RefillStatus,
} from '../../lib/api';
import {
  Alert, Badge, Button, Card, EmptyState, Field, Modal, PageHeader, Spinner,
  Table, Tabs, Td, Textarea, Th, type TabItem,
} from '../../components/ui';
import { useToast } from '../../components/Toast';

const STATUS_TABS: TabItem[] = [
  { id: 'pending', label: 'Waiting on you' },
  { id: 'approved', label: 'Approved' },
  { id: 'denied', label: 'Denied' },
];

const EMPTY_COPY: Record<RefillStatus, { title: string; body: string }> = {
  pending: {
    title: 'No refill requests waiting',
    body: 'Requests from patients on medications you prescribed land here.',
  },
  approved: {
    title: 'Nothing approved yet',
    body: 'Refills you authorize are kept here as a record of the decision.',
  },
  denied: {
    title: 'Nothing denied yet',
    body: 'Requests you turn down are kept here along with the note the patient was sent.',
  },
};

export default function DoctorRefills() {
  const toast = useToast();
  const [status, setStatus] = useState<RefillStatus>('pending');
  const [requests, setRequests] = useState<RefillRequest[] | null>(null);
  const [error, setError] = useState('');
  const [denying, setDenying] = useState<RefillRequest | null>(null);
  const [denyNote, setDenyNote] = useState('');
  const [busy, setBusy] = useState(false);

  const load = useCallback(() => {
    setRequests(null);
    setError('');
    listRefillRequests(status)
      .then((d) => setRequests(d.requests))
      .catch((err) => {
        setError((err as Error).message);
        setRequests([]);
      });
  }, [status]);

  useEffect(load, [load]);

  async function decide(r: RefillRequest, decision: 'approved' | 'denied', note?: string) {
    setBusy(true);
    try {
      await decideRefillRequest(r.id, decision, note);
      toast(
        decision === 'approved'
          ? `Refill approved for ${r.patient_name}.`
          : `Request denied — ${r.patient_name} will be prompted to book a follow-up.`,
        'success'
      );
      setDenying(null);
      setDenyNote('');
      load();
    } catch (err) {
      toast((err as Error).message, 'error');
    } finally {
      setBusy(false);
    }
  }

  const isQueue = status === 'pending';

  return (
    <>
      <PageHeader
        title="Refill requests"
        subtitle="Patients asking to refill medications you prescribed. Approving dispenses one refill."
      />

      <Tabs
        tabs={STATUS_TABS}
        active={status}
        onChange={(next) => setStatus(next as RefillStatus)}
      />

      {error && (
        <Alert tone="error" icon={AlertCircle} className="mb-4">
          {error}
        </Alert>
      )}

      <Card className="p-0 sm:p-0">
        {!requests && !error && <Spinner label="Loading requests…" />}

        {requests && requests.length === 0 && (
          <EmptyState icon={Pill} title={EMPTY_COPY[status].title}>
            {EMPTY_COPY[status].body}
          </EmptyState>
        )}

        {requests && requests.length > 0 && (
          <Table>
            <thead>
              <tr>
                <Th>Patient</Th>
                <Th>Medication</Th>
                <Th>Refills used</Th>
                <Th>Requested</Th>
                <Th>Patient note</Th>
                {isQueue ? <Th align="right">Decision</Th> : <Th>Your decision</Th>}
              </tr>
            </thead>
            <tbody>
              {requests.map((r) => (
                <tr key={r.id}>
                  <Td>
                    <div className="font-semibold text-slate-900">{r.patient_name}</div>
                    <div className="text-xs text-slate-500">{r.patient_email}</div>
                  </Td>
                  <Td>
                    <span className="font-semibold">{r.medication}</span> {r.dosage}
                    <div className="text-xs text-slate-500">{r.frequency}</div>
                  </Td>
                  <Td className="whitespace-nowrap">
                    {r.refills_used}/{r.refills_allowed}
                    {(r.refills_used ?? 0) >= (r.refills_allowed ?? 0) && (
                      <div className="mt-1">
                        <Badge tone="amber">Over allowance</Badge>
                      </div>
                    )}
                  </Td>
                  <Td className="whitespace-nowrap text-slate-600">
                    {formatStamp(r.created_at)}
                  </Td>
                  <Td className="text-slate-600">{r.note || '—'}</Td>
                  {isQueue ? (
                    <Td align="right">
                      <div className="flex flex-wrap justify-end gap-2">
                        <Button
                          variant="primary"
                          size="sm"
                          disabled={busy}
                          onClick={() => decide(r, 'approved')}
                        >
                          Approve
                        </Button>
                        <Button
                          variant="danger"
                          size="sm"
                          disabled={busy}
                          onClick={() => {
                            setDenying(r);
                            setDenyNote('');
                          }}
                        >
                          Deny
                        </Button>
                      </div>
                    </Td>
                  ) : (
                    <Td>
                      <Badge tone={r.status === 'approved' ? 'green' : 'red'}>
                        {r.status === 'approved' ? 'Approved' : 'Denied'}
                      </Badge>
                      {r.decided_at && (
                        <div className="mt-1 text-xs text-slate-500">
                          {formatStamp(r.decided_at)}
                        </div>
                      )}
                      {r.decision_note && (
                        <div className="mt-1 max-w-xs text-xs text-slate-600">
                          {r.decision_note}
                        </div>
                      )}
                    </Td>
                  )}
                </tr>
              ))}
            </tbody>
          </Table>
        )}
      </Card>

      <Modal
        open={!!denying}
        title="Deny refill request"
        onClose={() => setDenying(null)}
        footer={
          <>
            <Button onClick={() => setDenying(null)}>Go back</Button>
            <Button
              variant="danger"
              loading={busy}
              disabled={!denyNote.trim()}
              onClick={() => denying && decide(denying, 'denied', denyNote.trim())}
            >
              Deny with note
            </Button>
          </>
        }
      >
        {denying && (
          <>
            <p className="mb-4 text-sm text-slate-600">
              {denying.medication} {denying.dosage} for {denying.patient_name}. Denying closes the
              request and sends them your note, and MediSync prompts them to book a follow-up visit
              so the medication can be reviewed.
            </p>
            <Field
              label="Note to patient"
              htmlFor="deny-note"
              required
              hint="Say what you need before you can authorize more — this is the only explanation they get."
              className="mb-0"
            >
              <Textarea
                id="deny-note"
                rows={3}
                placeholder="e.g. It's been a year since your last review — book a follow-up and we'll renew this at the visit."
                value={denyNote}
                onChange={(e) => setDenyNote(e.target.value)}
              />
            </Field>
          </>
        )}
      </Modal>
    </>
  );
}
