import { useState } from 'react';
import FormField from '../FormField';
import { inputClass } from '../../utils/formStyles';
import { toDateInput } from '../../utils/dateHelper';

const btn = 'px-4 py-2 rounded text-sm cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed';

/**
 * Panel buat invoice dari surat jalan (1 atau gabungan): tanggal (>= tanggal surat jalan terakhir),
 * jatuh tempo (kosong = termin customer), catatan. onConfirm({ date, dueDate, note }).
 */
export default function DeliveryInvoicePanel({ title, description, minDate, busy, onConfirm, onClose }) {
  const [date, setDate] = useState(toDateInput());
  const [dueDate, setDueDate] = useState('');
  const [note, setNote] = useState('');
  return (
    <section className="mb-4 rounded-lg border border-primary bg-surface p-4 max-w-3xl space-y-3">
      <div>
        <h3 className="font-semibold text-fg">{title}</h3>
        {description && <p className="text-sm text-muted">{description}</p>}
      </div>
      <div className="grid gap-3 sm:grid-cols-3">
        <FormField label="Invoice date" htmlFor="inv-date" required>
          <input id="inv-date" type="date" min={minDate ? toDateInput(minDate) : undefined} max={toDateInput()} value={date}
            onChange={(e) => setDate(e.target.value)} className={inputClass} />
        </FormField>
        <FormField label="Due date" htmlFor="inv-due" hint="Kosong = tanggal + termin customer">
          <input id="inv-due" type="date" min={date} value={dueDate} onChange={(e) => setDueDate(e.target.value)} className={inputClass} />
        </FormField>
        <FormField label="Note" htmlFor="inv-note">
          <input id="inv-note" value={note} maxLength={500} placeholder="Default: no. SO & surat jalan" onChange={(e) => setNote(e.target.value)} className={inputClass} />
        </FormField>
      </div>
      <div className="flex gap-2">
        <button type="button" disabled={busy || !date} onClick={() => onConfirm({ date, dueDate: dueDate || null, note })}
          className={`${btn} bg-primary hover:bg-primary-hover text-primary-fg`}>
          <i className="fa fa-file-invoice-dollar"></i> Create invoice
        </button>
        <button type="button" disabled={busy} onClick={onClose} className={`${btn} border border-line hover:bg-subtle`}>Close</button>
      </div>
    </section>
  );
}
