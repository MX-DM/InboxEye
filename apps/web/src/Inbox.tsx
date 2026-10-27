import { STATUS_LABEL, statusOf } from "./lib";
import type { EmailSummary, ProcessingResult } from "./types";

export function StatusBadge({ status }: { status: keyof typeof STATUS_LABEL }) {
  return <span className={`badge badge-${status}`}>{STATUS_LABEL[status]}</span>;
}

interface Props {
  emails: EmailSummary[];
  latest: Map<string, ProcessingResult>;
  viewedId: string | null;
  checked: Set<string>;
  busy: boolean;
  onView: (id: string) => void;
  onToggle: (id: string) => void;
  onToggleAll: (all: boolean) => void;
  onProcessSelected: () => void;
}

export function Inbox({ emails, latest, viewedId, checked, busy, onView, onToggle, onToggleAll, onProcessSelected }: Props) {
  const allChecked = emails.length > 0 && emails.every((e) => checked.has(e.id));
  return (
    <section className="panel inbox">
      <div className="inbox-head">
        <label className="check-all">
          <input type="checkbox" checked={allChecked} onChange={(e) => onToggleAll(e.target.checked)} disabled={busy} />
          Todos
        </label>
        <button className="primary" onClick={onProcessSelected} disabled={busy || checked.size === 0}>
          {busy ? "Procesando…" : `Procesar seleccionados (${checked.size})`}
        </button>
      </div>
      <ul className="email-list">
        {emails.map((e) => (
          <li key={e.id} className={e.id === viewedId ? "email-row active" : "email-row"}>
            <input
              type="checkbox"
              aria-label={`Seleccionar ${e.subject}`}
              checked={checked.has(e.id)}
              onChange={() => onToggle(e.id)}
              disabled={busy}
            />
            <button className="email-main" onClick={() => onView(e.id)}>
              <span className="email-subject">{e.subject}</span>
              <span className="email-from">{e.from}</span>
            </button>
            <StatusBadge status={statusOf(e.id, latest)} />
          </li>
        ))}
      </ul>
    </section>
  );
}
