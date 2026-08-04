/**
 * The physician directory, as clinic staff maintain it.
 *
 * A name is three fields — prefix, first, last — because that is how the row is
 * stored and how every list in the product is ordered. `full_name` is a
 * generated column: it is read for display and never written back, so the form
 * below has no field for it.
 *
 * Where a physician holds clinic is shown but not edited here. It is derived
 * from their weekly windows, which belong to Schedules — but "we have a
 * dermatologist" and "she is in Brooklyn on Thursdays" are the same question to
 * whoever is answering the phone, so the sites ride along in the table.
 */
import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { KeyRound, MapPin, Plus, Stethoscope } from 'lucide-react';
import {
  adminCreateDoctor, adminCreateDoctorAccount, adminDeactivateDoctor,
  adminListDoctors, adminListSpecialties, adminUpdateDoctor, listDoctors,
  type Doctor, type DoctorLocation, type Specialty,
} from '../../lib/api';
import {
  Alert, Badge, Button, Card, Checkbox, EmptyState, Field, Input, MenuItem,
  Modal, PageHeader, RowMenu, Select, Spinner, Table, Td, Textarea, Th,
} from '../../components/ui';
import { useToast } from '../../components/Toast';

/** 'Dr.' is the overwhelming default; the field exists for the exceptions. */
const EMPTY_FORM = {
  prefix: 'Dr.',
  first_name: '',
  last_name: '',
  specialty_id: '',
  room: '',
  email: '',
  phone: '',
  bio: '',
  active: true,
};

/**
 * Directory order: surname, then forename to break ties. The server already
 * sorts this way — repeating it here means the table cannot drift out of that
 * order if the list is ever assembled from more than one response.
 */
function byLastName(a: Doctor, b: Doctor): number {
  return a.last_name.localeCompare(b.last_name) || a.first_name.localeCompare(b.first_name);
}

export default function AdminDoctors() {
  const toast = useToast();
  const [specialties, setSpecialties] = useState<Specialty[]>([]);
  const [doctors, setDoctors] = useState<Doctor[] | null>(null);
  /** Clinic sites per physician id — see `load()` for where they come from. */
  const [sites, setSites] = useState<Map<number, DoctorLocation[]>>(new Map());
  const [error, setError] = useState('');

  // Add / edit modal
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<Doctor | null>(null);
  const [form, setForm] = useState(EMPTY_FORM);
  const [modalError, setModalError] = useState('');
  const [busy, setBusy] = useState(false);

  // Create-login modal
  const [loginFor, setLoginFor] = useState<Doctor | null>(null);
  const [loginEmail, setLoginEmail] = useState('');
  const [loginPassword, setLoginPassword] = useState('');
  const [loginError, setLoginError] = useState('');

  useEffect(() => {
    adminListSpecialties()
      .then((d) => setSpecialties(d.specialties))
      .catch(() => {
        /* The picker degrades to "Unassigned" rather than blocking the form. */
      });
  }, []);

  const load = useCallback(() => {
    adminListDoctors()
      .then((d) => {
        setDoctors([...d.doctors].sort(byLastName));
        setError('');
      })
      .catch((err) => {
        setError((err as Error).message);
        setDoctors([]);
      });

    // Sites are not a column on `doctors`: they are whatever a physician's
    // weekly windows point at, and the public directory is the query that
    // aggregates them. Filling the column from there costs one request instead
    // of one per row. It is decoration on this page — the table still lists
    // everyone if it fails, so the failure is swallowed rather than shown.
    listDoctors()
      .then((d) => setSites(new Map(d.doctors.map((doc) => [doc.id, doc.locations]))))
      .catch(() => {});
  }, []);

  useEffect(load, [load]);

  function set<K extends keyof typeof EMPTY_FORM>(key: K, value: (typeof EMPTY_FORM)[K]) {
    setForm((f) => ({ ...f, [key]: value }));
  }

  /** The admin payload wins when it carries sites itself; the directory fills in. */
  function sitesFor(doc: Doctor): DoctorLocation[] {
    return doc.locations?.length ? doc.locations : sites.get(doc.id) ?? [];
  }

  function openModal(doc?: Doctor) {
    setModalError('');
    setEditing(doc ?? null);
    setForm(
      doc
        ? {
            prefix: doc.prefix || 'Dr.',
            first_name: doc.first_name,
            last_name: doc.last_name,
            specialty_id: doc.specialty_id ? String(doc.specialty_id) : '',
            room: doc.room || '',
            email: doc.email || '',
            phone: doc.phone || '',
            bio: doc.bio || '',
            active: doc.active !== false,
          }
        : EMPTY_FORM
    );
    setOpen(true);
  }

  async function save() {
    if (!form.first_name.trim() || !form.last_name.trim()) {
      setModalError('First and last name are required.');
      return;
    }
    const body = {
      prefix: form.prefix.trim() || 'Dr.',
      first_name: form.first_name.trim(),
      last_name: form.last_name.trim(),
      specialty_id: form.specialty_id ? Number(form.specialty_id) : null,
      room: form.room.trim() || null,
      email: form.email.trim() || null,
      phone: form.phone.trim() || null,
      bio: form.bio.trim() || null,
    };
    setBusy(true);
    setModalError('');
    try {
      if (editing) {
        // `active` is only in the edit form: a physician being added is being
        // added to take bookings.
        await adminUpdateDoctor(editing.id, { ...body, active: form.active });
      } else {
        await adminCreateDoctor(body);
      }
      setOpen(false);
      toast('Physician saved.', 'success');
      load();
    } catch (err) {
      setModalError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  /** Soft delete: bookings stop, the appointment history the clinic reports on stays. */
  async function deactivate(doc: Doctor) {
    const ok = window.confirm(
      `Deactivate ${doc.full_name}? They stop accepting new appointments. ` +
        'Bookings already on the books are untouched.'
    );
    if (!ok) return;
    try {
      await adminDeactivateDoctor(doc.id);
      toast('Physician deactivated.', 'success');
      load();
    } catch (err) {
      toast((err as Error).message, 'error');
    }
  }

  function openLoginModal(doc: Doctor) {
    setLoginFor(doc);
    setLoginEmail(doc.email || '');
    setLoginPassword('');
    setLoginError('');
  }

  async function createLogin() {
    if (!loginFor) return;
    setBusy(true);
    setLoginError('');
    try {
      await adminCreateDoctorAccount(loginFor.id, loginEmail.trim(), loginPassword);
      toast(`Login created — ${loginFor.full_name} can now sign in.`, 'success');
      setLoginFor(null);
      load();
    } catch (err) {
      setLoginError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div>
      <PageHeader
        title="Physicians"
        subtitle="Add, edit, or deactivate providers. Clinic times are set under Schedules."
        actions={
          <Button variant="primary" icon={Plus} onClick={() => openModal()}>
            Add physician
          </Button>
        }
      />

      {error && (
        <Alert tone="error" className="mb-4">
          {error}
        </Alert>
      )}

      <Card className="p-0 sm:p-0">
        {!doctors && !error && <Spinner label="Loading the directory…" />}

        {doctors && doctors.length === 0 && (
          <EmptyState
            icon={Stethoscope}
            title="No physicians yet"
            action={
              <Button variant="primary" icon={Plus} onClick={() => openModal()}>
                Add physician
              </Button>
            }
          >
            Add the providers this practice books for. Each one needs a weekly schedule before
            patients can request a time with them.
          </EmptyState>
        )}

        {doctors && doctors.length > 0 && (
          <Table>
            <thead>
              <tr>
                <Th>Physician</Th>
                <Th>Specialty</Th>
                <Th>Clinic sites</Th>
                <Th>Contact</Th>
                <Th>Room</Th>
                <Th>Status</Th>
                <Th align="right">Actions</Th>
              </tr>
            </thead>
            <tbody>
              {doctors.map((d) => {
                const clinics = sitesFor(d);
                return (
                  <tr key={d.id}>
                    <Td>
                      <Link
                        to={`/admin/physicians/${d.id}`}
                        className="font-semibold text-accent-600 hover:underline"
                      >
                        {d.full_name}
                      </Link>
                    </Td>
                    <Td className="text-slate-500">{d.specialty_name || 'Unassigned'}</Td>
                    <Td>
                      {clinics.length > 0 ? (
                        <div className="flex flex-wrap gap-1.5">
                          {clinics.map((l) => (
                            <span
                              key={l.id}
                              className="inline-flex items-center gap-1 whitespace-nowrap rounded-lg bg-slate-100 px-2 py-1 text-xs font-medium text-slate-600"
                              title={`${l.name}, ${l.city}`}
                            >
                              <MapPin className="h-3.5 w-3.5 text-slate-400" aria-hidden="true" />
                              {l.name}
                            </span>
                          ))}
                        </div>
                      ) : d.active === false ? (
                        <span className="text-slate-400">—</span>
                      ) : (
                        <Link
                          to="/admin/schedules"
                          className="whitespace-nowrap text-sm font-semibold text-accent-600 hover:underline"
                        >
                          Set clinic times
                        </Link>
                      )}
                    </Td>
                    <Td className="text-slate-500">
                      <span className="block truncate">{d.email || '—'}</span>
                      {d.phone && <span className="block text-xs">{d.phone}</span>}
                    </Td>
                    <Td>{d.room || '—'}</Td>
                    <Td>
                      <div className="flex flex-col items-start gap-1">
                        {d.active === false ? (
                          <Badge tone="red">Inactive</Badge>
                        ) : (
                          <Badge tone="green">Active</Badge>
                        )}
                        {d.login_email ? (
                          <span className="text-xs text-slate-400">{d.login_email}</span>
                        ) : (
                          <Badge tone="amber">No portal login</Badge>
                        )}
                      </div>
                    </Td>
                    <Td align="right">
                      <div className="flex items-center justify-end gap-2">
                        <Button size="sm" onClick={() => openModal(d)}>
                          Edit
                        </Button>
                        {(!d.user_id || d.active !== false) && (
                          <RowMenu label={`More actions for ${d.full_name}`}>
                            {!d.user_id && (
                              <MenuItem icon={KeyRound} onClick={() => openLoginModal(d)}>
                                Create portal login
                              </MenuItem>
                            )}
                            {d.active !== false && (
                              <MenuItem danger onClick={() => deactivate(d)}>
                                Deactivate
                              </MenuItem>
                            )}
                          </RowMenu>
                        )}
                      </div>
                    </Td>
                  </tr>
                );
              })}
            </tbody>
          </Table>
        )}
      </Card>

      <Modal
        open={open}
        title={editing ? `Edit ${editing.full_name}` : 'Add physician'}
        onClose={() => setOpen(false)}
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

        <div className="grid gap-x-4 sm:grid-cols-[7rem_1fr_1fr]">
          <Field label="Prefix" htmlFor="d-prefix" required>
            <Input
              id="d-prefix"
              value={form.prefix}
              onChange={(e) => set('prefix', e.target.value)}
            />
          </Field>
          <Field label="First name" htmlFor="d-first" required>
            <Input
              id="d-first"
              autoComplete="off"
              value={form.first_name}
              onChange={(e) => set('first_name', e.target.value)}
            />
          </Field>
          <Field label="Last name" htmlFor="d-last" required>
            <Input
              id="d-last"
              autoComplete="off"
              value={form.last_name}
              onChange={(e) => set('last_name', e.target.value)}
            />
          </Field>
        </div>

        <div className="grid gap-x-4 sm:grid-cols-2">
          <Field label="Specialty" htmlFor="d-specialty">
            <Select
              id="d-specialty"
              value={form.specialty_id}
              onChange={(e) => set('specialty_id', e.target.value)}
            >
              <option value="">Unassigned</option>
              {specialties.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Room" htmlFor="d-room" hint="Where patients are seen on site.">
            <Input
              id="d-room"
              placeholder="A-101"
              value={form.room}
              onChange={(e) => set('room', e.target.value)}
            />
          </Field>
        </div>

        <div className="grid gap-x-4 sm:grid-cols-2">
          <Field label="Email" htmlFor="d-email">
            <Input
              id="d-email"
              type="email"
              value={form.email}
              onChange={(e) => set('email', e.target.value)}
            />
          </Field>
          <Field label="Office phone" htmlFor="d-phone">
            <Input
              id="d-phone"
              type="tel"
              value={form.phone}
              onChange={(e) => set('phone', e.target.value)}
            />
          </Field>
        </div>

        <Field
          label="Bio"
          htmlFor="d-bio"
          hint="Shown to patients in the directory."
          className={editing ? 'mb-4' : 'mb-0'}
        >
          <Textarea
            id="d-bio"
            placeholder="Short professional bio"
            value={form.bio}
            onChange={(e) => set('bio', e.target.value)}
          />
        </Field>

        {editing && (
          <Checkbox
            label="Accepting appointments"
            hint="Clearing this keeps their history and removes them from patient search."
            checked={form.active}
            onChange={(e) => set('active', e.target.checked)}
          />
        )}
      </Modal>

      <Modal
        open={!!loginFor}
        title={`Create login for ${loginFor?.full_name || ''}`}
        onClose={() => setLoginFor(null)}
        size="sm"
        footer={
          <>
            <Button onClick={() => setLoginFor(null)}>Go back</Button>
            <Button
              variant="primary"
              icon={KeyRound}
              loading={busy}
              disabled={!loginEmail.trim() || loginPassword.length < 6}
              onClick={createLogin}
            >
              Create login
            </Button>
          </>
        }
      >
        {loginError && (
          <Alert tone="error" className="mb-4">
            {loginError}
          </Alert>
        )}
        <p className="mb-4 text-sm text-slate-600">
          Gives this physician their own portal: today's schedule, patient charts, prescriptions
          and refill requests. Share the password with them securely and have them change it.
        </p>
        <Field label="Login email" htmlFor="l-email" required>
          <Input
            id="l-email"
            type="email"
            autoComplete="off"
            value={loginEmail}
            onChange={(e) => setLoginEmail(e.target.value)}
          />
        </Field>
        <Field
          label="Temporary password"
          htmlFor="l-password"
          hint="At least 6 characters."
          className="mb-0"
        >
          <Input
            id="l-password"
            type="text"
            autoComplete="off"
            value={loginPassword}
            onChange={(e) => setLoginPassword(e.target.value)}
          />
        </Field>
      </Modal>
    </div>
  );
}
