/**
 * Clinic sites (A6) — the buildings the practice operates out of.
 *
 * A site is never deleted, only closed. Appointments record where they happened
 * and clinic windows point at a site, so removing the row would strip the
 * address off visits that are already in the books. `active: false` takes it
 * out of new scheduling and leaves the history able to name itself.
 */
import { useCallback, useEffect, useState } from 'react';
import { MapPin, Plus } from 'lucide-react';
import {
  adminCreateLocation, adminListLocations, adminUpdateLocation,
  type Location,
} from '../../lib/api';
import {
  Alert, Badge, Button, Card, Checkbox, EmptyState, Field, Input, Modal,
  PageHeader, Spinner, Table, Td, Th,
} from '../../components/ui';
import { useToast } from '../../components/Toast';

const EMPTY_FORM = {
  name: '',
  address: '',
  city: '',
  state: '',
  zip: '',
  phone: '',
  active: true,
};

export default function AdminLocations() {
  const toast = useToast();
  const [locations, setLocations] = useState<Location[] | null>(null);
  const [error, setError] = useState('');

  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<Location | null>(null);
  const [form, setForm] = useState(EMPTY_FORM);
  const [modalError, setModalError] = useState('');
  const [busy, setBusy] = useState(false);

  const load = useCallback(() => {
    adminListLocations()
      .then((d) => {
        setLocations(d.locations);
        setError('');
      })
      .catch((err) => {
        setError((err as Error).message);
        setLocations([]);
      });
  }, []);

  useEffect(load, [load]);

  function set<K extends keyof typeof EMPTY_FORM>(key: K, value: (typeof EMPTY_FORM)[K]) {
    setForm((f) => ({ ...f, [key]: value }));
  }

  function openModal(location?: Location) {
    setModalError('');
    setEditing(location ?? null);
    setForm(
      location
        ? {
            name: location.name,
            address: location.address,
            city: location.city,
            state: location.state,
            zip: location.zip,
            phone: location.phone || '',
            active: location.active !== false,
          }
        : EMPTY_FORM
    );
    setOpen(true);
  }

  async function save() {
    const body = {
      name: form.name.trim(),
      address: form.address.trim(),
      city: form.city.trim(),
      state: form.state.trim(),
      zip: form.zip.trim(),
      phone: form.phone.trim() || null,
    };
    if (!body.name || !body.address || !body.city || !body.state || !body.zip) {
      setModalError('Name, address, city, state and ZIP are all required.');
      return;
    }
    setBusy(true);
    setModalError('');
    try {
      if (editing) {
        // Only the edit form offers the switch: a site being added is a site
        // the practice is opening.
        await adminUpdateLocation(editing.id, { ...body, active: form.active });
      } else {
        await adminCreateLocation(body);
      }
      setOpen(false);
      toast('Location saved.', 'success');
      load();
    } catch (err) {
      setModalError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div>
      <PageHeader
        title="Locations"
        subtitle="The sites this practice runs clinic at. Closing one keeps its history intact."
        actions={
          <Button variant="primary" icon={Plus} onClick={() => openModal()}>
            Add location
          </Button>
        }
      />

      {error && (
        <Alert tone="error" className="mb-4">
          {error}
        </Alert>
      )}

      <Card className="p-0 sm:p-0">
        {!locations && !error && <Spinner label="Loading locations…" />}

        {locations && locations.length === 0 && (
          <EmptyState
            icon={MapPin}
            title="No locations yet"
            action={
              <Button variant="primary" icon={Plus} onClick={() => openModal()}>
                Add location
              </Button>
            }
          >
            Every clinic window is held at a site, so a physician cannot be scheduled until at
            least one exists.
          </EmptyState>
        )}

        {locations && locations.length > 0 && (
          <Table>
            <thead>
              <tr>
                <Th>Site</Th>
                <Th>Address</Th>
                <Th>Phone</Th>
                <Th>Status</Th>
                <Th align="right">Actions</Th>
              </tr>
            </thead>
            <tbody>
              {locations.map((l) => (
                <tr key={l.id}>
                  <Td className="font-semibold text-slate-900">{l.name}</Td>
                  <Td className="text-slate-500">
                    <span className="block">{l.address}</span>
                    <span className="block text-xs">
                      {l.city}, {l.state} {l.zip}
                    </span>
                  </Td>
                  <Td className="text-slate-500">{l.phone || '—'}</Td>
                  <Td>
                    {l.active === false ? (
                      <Badge tone="red">Closed</Badge>
                    ) : (
                      <Badge tone="green">Open</Badge>
                    )}
                  </Td>
                  <Td align="right">
                    <Button size="sm" onClick={() => openModal(l)}>
                      Edit
                    </Button>
                  </Td>
                </tr>
              ))}
            </tbody>
          </Table>
        )}
      </Card>

      <Modal
        open={open}
        title={editing ? `Edit ${editing.name}` : 'Add location'}
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

        <Field label="Site name" htmlFor="loc-name" required>
          <Input
            id="loc-name"
            placeholder="Midtown Clinic"
            value={form.name}
            onChange={(e) => set('name', e.target.value)}
          />
        </Field>

        <Field label="Street address" htmlFor="loc-address" required>
          <Input
            id="loc-address"
            placeholder="500 5th Ave"
            value={form.address}
            onChange={(e) => set('address', e.target.value)}
          />
        </Field>

        <div className="grid gap-x-4 sm:grid-cols-[1fr_6rem_8rem]">
          <Field label="City" htmlFor="loc-city" required>
            <Input id="loc-city" value={form.city} onChange={(e) => set('city', e.target.value)} />
          </Field>
          <Field label="State" htmlFor="loc-state" required>
            <Input
              id="loc-state"
              placeholder="NY"
              value={form.state}
              onChange={(e) => set('state', e.target.value)}
            />
          </Field>
          <Field label="ZIP" htmlFor="loc-zip" required>
            <Input
              id="loc-zip"
              inputMode="numeric"
              placeholder="10018"
              value={form.zip}
              onChange={(e) => set('zip', e.target.value)}
            />
          </Field>
        </div>

        <Field
          label="Phone"
          htmlFor="loc-phone"
          hint="The number patients call for this site."
          className={editing ? 'mb-4' : 'mb-0'}
        >
          <Input
            id="loc-phone"
            type="tel"
            value={form.phone}
            onChange={(e) => set('phone', e.target.value)}
          />
        </Field>

        {editing && (
          <Checkbox
            label="Open for scheduling"
            hint="Closing a site hides it from patient search and stops new clinic windows being held there. Past appointments keep the address."
            checked={form.active}
            onChange={(e) => set('active', e.target.checked)}
          />
        )}
      </Modal>
    </div>
  );
}
