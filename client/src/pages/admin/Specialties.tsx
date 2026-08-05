/**
 * Specialties (B12) — the list a physician is filed under and patients filter by.
 *
 * Deleting one is refused while any physician is still listed under it. That is
 * not a technicality to hide: `doctors.specialty_id` is ON DELETE SET NULL, so
 * a permissive delete would quietly strip the specialty off those physicians
 * and drop them out of specialty search. The server answers 409 with the
 * count, and this page prints that answer rather than swallowing it.
 */
import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { ChevronRight, Plus, Tags } from 'lucide-react';
import {
  adminCreateSpecialty, adminListDoctors, api,
  type Doctor, type OkResponse, type Specialty,
} from '../../lib/api';
import {
  Alert, Avatar, Badge, Button, Card, EmptyState, Field, Input, Modal, PageHeader,
  Spinner, Table, Td, Textarea, Th,
} from '../../components/ui';
import { useToast } from '../../components/Toast';

/**
 * The admin list carries a headcount the public `Specialty` shape does not —
 * it is what tells the page whether Delete has any chance of succeeding.
 */
interface AdminSpecialty extends Specialty {
  doctor_count: number;
}

/**
 * Renaming and deleting have no named wrapper in the API client, so they go
 * through `api()` — the same authenticated helper every declared call is built
 * on — rather than a hand-rolled fetch.
 */
function listAdminSpecialties(): Promise<{ specialties: AdminSpecialty[] }> {
  return api<{ specialties: AdminSpecialty[] }>('/admin/specialties');
}

function updateSpecialty(
  id: number,
  name: string,
  description: string | null
): Promise<{ specialty: Specialty }> {
  return api<{ specialty: Specialty }>(`/admin/specialties/${id}`, {
    method: 'PUT',
    body: { name, description },
  });
}

function deleteSpecialty(id: number): Promise<OkResponse> {
  return api<OkResponse>(`/admin/specialties/${id}`, { method: 'DELETE' });
}

export default function AdminSpecialties() {
  const toast = useToast();
  const [specialties, setSpecialties] = useState<AdminSpecialty[] | null>(null);
  const [error, setError] = useState('');
  /** A refused delete, kept on the page: the message says what to do about it. */
  const [refusal, setRefusal] = useState('');

  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<AdminSpecialty | null>(null);
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [modalError, setModalError] = useState('');
  const [busy, setBusy] = useState(false);

  /**
   * The headcount answers "how many"; this answers "who".
   *
   * The roster is read from the physician directory the page already has access
   * to and filtered here rather than fetched per specialty: a practice has tens
   * of physicians, so one list serves every row and a click costs no round trip.
   */
  const [roster, setRoster] = useState<AdminSpecialty | null>(null);
  const [doctors, setDoctors] = useState<Doctor[] | null>(null);

  const load = useCallback(() => {
    listAdminSpecialties()
      .then((d) => {
        setSpecialties(d.specialties);
        setError('');
      })
      .catch((err) => {
        setError((err as Error).message);
        setSpecialties([]);
      });
  }, []);

  useEffect(load, [load]);

  // Fetched once alongside the specialties; the roster modal reads from it.
  useEffect(() => {
    adminListDoctors()
      .then((d) => setDoctors(d.doctors))
      // The count badge stays; only the click-through is withheld.
      .catch(() => setDoctors([]));
  }, []);

  /** This specialty's physicians, by surname, as the directory lists them. */
  const rosterDoctors = roster
    ? (doctors || []).filter((d) => d.specialty_id === roster.id)
    : [];

  function openModal(specialty?: AdminSpecialty) {
    setModalError('');
    setEditing(specialty ?? null);
    setName(specialty?.name || '');
    setDescription(specialty?.description || '');
    setOpen(true);
  }

  async function save() {
    if (!name.trim()) {
      setModalError('A name is required.');
      return;
    }
    setBusy(true);
    setModalError('');
    try {
      if (editing) {
        await updateSpecialty(editing.id, name.trim(), description.trim() || null);
      } else {
        await adminCreateSpecialty(name.trim(), description.trim() || undefined);
      }
      setOpen(false);
      setRefusal('');
      toast('Specialty saved.', 'success');
      load();
    } catch (err) {
      setModalError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  /**
   * The headcount is checked by the server inside the DELETE, not here: a
   * physician filed under this specialty a second ago would make a check on
   * this page's copy of the number wrong. The button always asks, and the
   * refusal is shown as written.
   */
  async function remove(s: AdminSpecialty) {
    const ok = window.confirm(
      s.doctor_count > 0
        ? `${s.name} still has ${s.doctor_count} physician${s.doctor_count === 1 ? '' : 's'} ` +
            'filed under it. Try to delete it anyway?'
        : `Delete ${s.name}?`
    );
    if (!ok) return;
    setRefusal('');
    try {
      await deleteSpecialty(s.id);
      toast('Specialty deleted.', 'success');
      load();
    } catch (err) {
      setRefusal((err as Error).message);
      load();
    }
  }

  return (
    <div>
      <PageHeader
        title="Specialties"
        subtitle="What each physician is listed under, and what patients filter the directory by."
        actions={
          <Button variant="primary" icon={Plus} onClick={() => openModal()}>
            Add specialty
          </Button>
        }
      />

      {error && (
        <Alert tone="error" className="mb-4">
          {error}
        </Alert>
      )}

      {refusal && (
        <Alert tone="warning" title="That specialty is still in use" className="mb-4">
          {refusal}
        </Alert>
      )}

      <Card className="p-0 sm:p-0">
        {!specialties && !error && <Spinner label="Loading specialties…" />}

        {specialties && specialties.length === 0 && (
          <EmptyState
            icon={Tags}
            title="No specialties yet"
            action={
              <Button variant="primary" icon={Plus} onClick={() => openModal()}>
                Add specialty
              </Button>
            }
          >
            Add the fields this practice covers — Family Medicine, Cardiology, and so on — then
            file each physician under one.
          </EmptyState>
        )}

        {specialties && specialties.length > 0 && (
          <Table>
            <thead>
              <tr>
                <Th>Specialty</Th>
                <Th>Description</Th>
                <Th align="right">Physicians</Th>
                <Th align="right">Actions</Th>
              </tr>
            </thead>
            <tbody>
              {specialties.map((s) => (
                <tr key={s.id}>
                  <Td className="font-semibold text-slate-900">{s.name}</Td>
                  <Td className="text-slate-500">{s.description || '—'}</Td>
                  <Td align="right">
                    {s.doctor_count > 0 ? (
                      <button
                        type="button"
                        onClick={() => setRoster(s)}
                        aria-label={`Show the ${s.doctor_count} physician${
                          s.doctor_count === 1 ? '' : 's'
                        } listed under ${s.name}`}
                        className="rounded-full focus:outline-none focus-visible:ring-2 focus-visible:ring-accent-600"
                      >
                        <Badge tone="blue" className="cursor-pointer hover:bg-accent-100">
                          {s.doctor_count}
                        </Badge>
                      </button>
                    ) : (
                      <span className="text-slate-400">None</span>
                    )}
                  </Td>
                  <Td align="right">
                    <div className="flex items-center justify-end gap-2">
                      <Button size="sm" onClick={() => openModal(s)}>
                        Edit
                      </Button>
                      <Button size="sm" variant="danger" onClick={() => remove(s)}>
                        Delete
                      </Button>
                    </div>
                  </Td>
                </tr>
              ))}
            </tbody>
          </Table>
        )}
      </Card>

      <Modal
        open={open}
        title={editing ? `Edit ${editing.name}` : 'Add specialty'}
        onClose={() => setOpen(false)}
        size="sm"
        footer={
          <>
            <Button onClick={() => setOpen(false)}>Cancel</Button>
            <Button variant="primary" loading={busy} onClick={save}>
              Save
            </Button>
          </>
        }
      >
        {modalError && (
          <Alert tone="error" className="mb-4">
            {modalError}
          </Alert>
        )}

        <Field label="Name" htmlFor="sp-name" required>
          <Input
            id="sp-name"
            placeholder="Family Medicine"
            value={name}
            onChange={(e) => setName(e.target.value)}
          />
        </Field>

        <Field
          label="Description"
          htmlFor="sp-description"
          hint="Shown to patients browsing the directory."
          className="mb-0"
        >
          <Textarea
            id="sp-description"
            placeholder="Everyday care for adults and children, and the first stop for most concerns."
            value={description}
            onChange={(e) => setDescription(e.target.value)}
          />
        </Field>
      </Modal>

      {/* Who is filed under a specialty, and a way through to each of them.
          The whole row is the link, not just the name: a roster is read to get
          somewhere, and a one-word target in a full-width row is a poor one. */}
      <Modal
        open={Boolean(roster)}
        title={roster ? `${roster.name} physicians` : 'Physicians'}
        onClose={() => setRoster(null)}
        size="sm"
        footer={<Button onClick={() => setRoster(null)}>Close</Button>}
      >
        {doctors === null ? (
          <Spinner />
        ) : rosterDoctors.length === 0 ? (
          <EmptyState icon={Tags} title="No physicians listed">
            Nobody is filed under this specialty yet.
          </EmptyState>
        ) : (
          <ul className="-my-1 divide-y divide-slate-100">
            {rosterDoctors.map((d) => (
              <li key={d.id}>
                <Link
                  to={`/admin/physicians/${d.id}`}
                  onClick={() => setRoster(null)}
                  className="flex items-center gap-3 rounded-lg px-2 py-2.5 hover:bg-slate-50"
                >
                  <Avatar name={d.full_name} src={d.photo_url} size="sm" />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm font-semibold text-slate-900">
                      {d.full_name}
                    </span>
                    <span className="block truncate text-xs text-slate-500">
                      {d.room ? `Room ${d.room}` : 'No room assigned'}
                      {!d.active && ' · Inactive'}
                    </span>
                  </span>
                  <ChevronRight className="h-4 w-4 flex-none text-slate-400" aria-hidden="true" />
                </Link>
              </li>
            ))}
          </ul>
        )}
      </Modal>
    </div>
  );
}
