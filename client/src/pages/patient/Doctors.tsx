/**
 * Find a doctor, and ask for a time.
 *
 * Three filters, because those are the three questions a patient actually has:
 * who, what for, and where. Location is the newest of them and the one that
 * changes the answer most — a physician the patient cannot travel to is not a
 * result worth returning.
 *
 * The booking flow says "request" throughout on purpose. Submitting this form
 * creates a `pending` appointment that clinic staff approve; telling the patient
 * their slot is reserved would be a promise this system does not make.
 */
import { useCallback, useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { CalendarPlus, Info, MapPin, Search } from 'lucide-react';
import {
  bookAppointment, formatDate, formatTime, getAvailability, listDoctors,
  listLocations, listSpecialties, todayStr,
  type Doctor, type Location, type Slot, type Specialty,
} from '../../lib/api';
import {
  Alert, Avatar, Button, Card, EmptyState, Field, FilterBar, Input, Modal,
  PageHeader, Select, SlotButton, Spinner, Textarea,
} from '../../components/ui';
import { useToast } from '../../components/Toast';

/**
 * A day's slots, split by the site they are held at. A physician can run a
 * morning clinic in Midtown and an afternoon one in Brooklyn, so a flat grid of
 * times would let a patient pick an hour without knowing which borough it is in.
 */
function groupByLocation(slots: Slot[]): { id: number; name: string; times: Slot[] }[] {
  const groups: { id: number; name: string; times: Slot[] }[] = [];
  for (const s of slots) {
    const found = groups.find((g) => g.id === s.location_id);
    if (found) found.times.push(s);
    else groups.push({ id: s.location_id, name: s.location_name, times: [s] });
  }
  return groups;
}

export default function Doctors() {
  const navigate = useNavigate();
  const toast = useToast();

  const [specialties, setSpecialties] = useState<Specialty[]>([]);
  const [locations, setLocations] = useState<Location[]>([]);
  const [q, setQ] = useState('');
  const [specialty, setSpecialty] = useState('');
  const [location, setLocation] = useState('');
  const [doctors, setDoctors] = useState<Doctor[] | null>(null);
  const [error, setError] = useState('');

  // Request modal
  const [selected, setSelected] = useState<Doctor | null>(null);
  const [date, setDate] = useState('');
  const [slots, setSlots] = useState<Slot[] | null>(null);
  const [slot, setSlot] = useState<Slot | null>(null);
  const [reason, setReason] = useState('');
  const [modalError, setModalError] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    listSpecialties()
      .then((d) => setSpecialties(d.specialties))
      .catch(() => {
        /* The filter degrades to "all specialties" rather than blocking search. */
      });
    listLocations()
      .then((d) => setLocations(d.locations))
      .catch(() => {});
  }, []);

  const search = useCallback(async () => {
    try {
      const d = await listDoctors({ q: q.trim(), specialty, location });
      setDoctors(d.doctors);
      setError('');
    } catch (err) {
      setError((err as Error).message);
      setDoctors([]);
    }
  }, [q, specialty, location]);

  // Debounced: typing a surname should not fire a request per keystroke.
  useEffect(() => {
    setDoctors(null);
    const timer = window.setTimeout(search, 250);
    return () => window.clearTimeout(timer);
  }, [search]);

  function openRequest(doctor: Doctor) {
    setSelected(doctor);
    setDate('');
    setSlots(null);
    setSlot(null);
    setReason('');
    setModalError('');
  }

  async function loadSlots(doctorId: number, newDate: string) {
    setDate(newDate);
    setSlot(null);
    setSlots(null);
    if (!newDate) return;
    try {
      const d = await getAvailability(doctorId, newDate);
      setSlots(d.slots);
    } catch (err) {
      setModalError((err as Error).message);
      setSlots([]);
    }
  }

  async function submitRequest() {
    if (!selected || !slot) return;
    setBusy(true);
    setModalError('');
    try {
      await bookAppointment({
        doctor_id: selected.id,
        appt_date: date,
        appt_time: slot.time,
        reason: reason.trim() || undefined,
      });
      setSelected(null);
      toast('Request submitted — the clinic will confirm your time.', 'success');
      navigate('/app/appointments');
    } catch (err) {
      // Most often a 409: someone booked that slot between the availability
      // call and this one. Re-reading the day is the only honest recovery.
      setModalError((err as Error).message);
      loadSlots(selected.id, date);
    } finally {
      setBusy(false);
    }
  }

  const groups = slots ? groupByLocation(slots) : [];

  return (
    <>
      <PageHeader
        title="Find a doctor"
        subtitle="Search by name, specialty or clinic site, then ask for a time that suits you."
      />

      <Card className="mb-6">
        <FilterBar>
          <Field label="Search by name" htmlFor="q" className="mb-0">
            <Input
              id="q"
              placeholder="e.g. Osei"
              value={q}
              onChange={(e) => setQ(e.target.value)}
            />
          </Field>
          <Field label="Specialty" htmlFor="specialty" className="mb-0">
            <Select
              id="specialty"
              value={specialty}
              onChange={(e) => setSpecialty(e.target.value)}
            >
              <option value="">All specialties</option>
              {specialties.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Location" htmlFor="location" className="mb-0">
            <Select id="location" value={location} onChange={(e) => setLocation(e.target.value)}>
              <option value="">All locations</option>
              {locations.map((l) => (
                <option key={l.id} value={l.id}>
                  {l.name}
                </option>
              ))}
            </Select>
          </Field>
        </FilterBar>
      </Card>

      {error && (
        <Alert tone="error" className="mb-6">
          {error}
        </Alert>
      )}
      {!doctors && !error && <Spinner label="Searching physicians…" />}
      {doctors && doctors.length === 0 && !error && (
        <Card>
          <EmptyState icon={Search} title="No physicians match your search">
            Try a different specialty, or clear the location filter to see every site.
          </EmptyState>
        </Card>
      )}

      {doctors && doctors.length > 0 && (
        <div className="grid gap-4 lg:grid-cols-2">
          {doctors.map((d) => (
            <Card key={d.id} className="flex flex-col">
              <div className="flex items-start gap-3">
                <Avatar name={d.full_name} src={d.photo_url} />
                <div className="min-w-0">
                  <p className="truncate font-semibold text-slate-900">{d.full_name}</p>
                  <p className="truncate text-sm text-slate-500">
                    {d.specialty_name || 'General practice'}
                    {d.room ? ` · Room ${d.room}` : ''}
                  </p>
                </div>
              </div>

              {d.bio && <p className="mt-3 text-sm leading-relaxed text-slate-600">{d.bio}</p>}

              <div className="mt-3">
                <p className="mb-1.5 text-[0.7rem] font-bold uppercase tracking-wider text-slate-500">
                  Practises at
                </p>
                {d.locations.length === 0 ? (
                  <p className="text-sm text-slate-500">No clinic times published yet.</p>
                ) : (
                  <div className="flex flex-wrap gap-1.5">
                    {d.locations.map((l) => (
                      <span
                        key={l.id}
                        className="inline-flex items-center gap-1 rounded-lg bg-slate-100 px-2 py-1 text-xs font-medium text-slate-600"
                      >
                        <MapPin className="h-3.5 w-3.5 text-slate-400" aria-hidden="true" />
                        {l.name}
                        <span className="text-slate-400">{l.city}</span>
                      </span>
                    ))}
                  </div>
                )}
              </div>

              <div className="mt-4 pt-1">
                <Button variant="primary" size="sm" icon={CalendarPlus} onClick={() => openRequest(d)}>
                  Request appointment
                </Button>
              </div>
            </Card>
          ))}
        </div>
      )}

      <Modal
        open={!!selected}
        title="Request an appointment"
        onClose={() => setSelected(null)}
        footer={
          <>
            <Button onClick={() => setSelected(null)}>Cancel</Button>
            <Button
              variant="primary"
              id="m-confirm"
              disabled={!slot}
              loading={busy}
              onClick={submitRequest}
            >
              {busy ? 'Sending…' : 'Send request'}
            </Button>
          </>
        }
      >
        {selected && (
          <>
            {modalError && (
              <Alert tone="error" className="mb-4">
                {modalError}
              </Alert>
            )}

            <div className="mb-4 flex items-center gap-3">
              <Avatar name={selected.full_name} src={selected.photo_url} />
              <div className="min-w-0">
                <p className="truncate font-semibold text-slate-900">{selected.full_name}</p>
                <p className="truncate text-sm text-slate-500">
                  {selected.specialty_name || 'General practice'}
                </p>
              </div>
            </div>

            <Alert tone="info" icon={Info} className="mb-4">
              Choosing a time sends a request. The clinic confirms it, usually the same working
              day, and you'll see it change to <strong>Confirmed</strong> in My Appointments.
            </Alert>

            <Field label="Choose a date" htmlFor="m-date">
              <Input
                type="date"
                id="m-date"
                min={todayStr()}
                value={date}
                onChange={(e) => loadSlots(selected.id, e.target.value)}
              />
            </Field>

            <Field label="Available times">
              {!date && <p className="text-sm text-slate-500">Pick a date to see open times.</p>}
              {date && slots === null && <Spinner label="Checking availability…" />}
              {date && slots && slots.length === 0 && (
                <p className="text-sm text-slate-500">
                  No open times on this date. {selected.full_name} may not hold clinic that day, or
                  it may be fully booked — try another.
                </p>
              )}
              {groups.map((g) => (
                <div key={g.id} className="mb-3 last:mb-0">
                  {/* The site is a heading rather than a caption on each pill:
                      the patient chooses a building first, then an hour in it. */}
                  <p className="mb-1.5 flex items-center gap-1 text-xs font-semibold text-slate-600">
                    <MapPin className="h-3.5 w-3.5 text-slate-400" aria-hidden="true" />
                    {g.name}
                  </p>
                  <div className="flex flex-wrap gap-2">
                    {g.times.map((s) => (
                      <SlotButton
                        key={`${s.location_id}-${s.time}`}
                        selected={slot?.time === s.time && slot?.location_id === s.location_id}
                        onClick={() => setSlot(s)}
                      >
                        {formatTime(s.time)}
                      </SlotButton>
                    ))}
                  </div>
                </div>
              ))}

              {/* Reads back the whole choice — day, hour and building — because
                  the pills alone only show the hour. */}
              {slot && (
                <p className="mt-3 text-sm text-slate-600">
                  Requesting <strong>{formatTime(slot.time)}</strong> on{' '}
                  <strong>{formatDate(date)}</strong> at <strong>{slot.location_name}</strong>.
                </p>
              )}
            </Field>

            <Field
              label="Reason for visit (optional)"
              htmlFor="m-reason"
              hint="Helps the clinic put you with the right person for long enough."
              className="mb-0"
            >
              <Textarea
                id="m-reason"
                placeholder="Briefly describe your symptoms or reason"
                value={reason}
                onChange={(e) => setReason(e.target.value)}
              />
            </Field>
          </>
        )}
      </Modal>
    </>
  );
}
