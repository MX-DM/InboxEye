import { Icon, type IconName } from "./Icons";
import { STATUS_LABEL, statusOf } from "./lib";
import type { EmailSummary, ProcessingResult, UiStatus } from "./types";

const STATUS_ICON: Record<UiStatus, IconName> = {
  PENDING: "clock",
  PROCESSING: "bolt",
  PROCESSED: "check",
  NEEDS_REVIEW: "flag",
  QUARANTINED: "shield",
  FAILED: "x",
};

/** Estado de un correo o de una corrida: ícono + texto (nunca solo color). */
export function StatusBadge({ status }: { status: UiStatus }) {
  return (
    <span className={`pill pill-${status}`}>
      <Icon name={STATUS_ICON[status]} size={13} className={status === "PROCESSING" ? "spin" : undefined} />
      {STATUS_LABEL[status]}
    </span>
  );
}

const ORDER: UiStatus[] = ["PROCESSED", "NEEDS_REVIEW", "QUARANTINED", "FAILED", "PROCESSING", "PENDING"];

/** Distribución de estados: una barra segmentada y una leyenda solo con lo que hay. */
function Distribution({ counts, total }: { counts: Record<UiStatus, number>; total: number }) {
  if (total === 0) return null;
  return (
    <div className="dist" role="img" aria-label={ORDER.filter((s) => counts[s] > 0).map((s) => `${STATUS_LABEL[s]}: ${counts[s]}`).join(", ")}>
      <div className="dist-bar">
        {ORDER.filter((s) => counts[s] > 0).map((s) => (
          <span key={s} className={`dist-seg seg-${s}`} style={{ flexGrow: counts[s] }} />
        ))}
      </div>
      <ul className="dist-legend">
        {ORDER.filter((s) => counts[s] > 0).map((s) => (
          <li key={s}>
            <span className={`dot dot-${s}`} />
            {STATUS_LABEL[s]} <strong>{counts[s]}</strong>
          </li>
        ))}
      </ul>
    </div>
  );
}

interface Props {
  emails: EmailSummary[];
  latest: Map<string, ProcessingResult>;
  counts: Record<UiStatus, number>;
  viewedId: string | null;
  checked: Set<string>;
  busy: boolean;
  pendingCount: number;
  onView: (id: string) => void;
  onToggle: (id: string) => void;
  onToggleAll: (all: boolean) => void;
  onProcessSelected: () => void;
  onProcessPending: () => void;
}

const initial = (from: string) => (from.replace(/[^a-zA-Z]/g, "")[0] ?? "?").toUpperCase();

export function Inbox({
  emails,
  latest,
  counts,
  viewedId,
  checked,
  busy,
  pendingCount,
  onView,
  onToggle,
  onToggleAll,
  onProcessSelected,
  onProcessPending,
}: Props) {
  const allChecked = emails.length > 0 && emails.every((e) => checked.has(e.id));
  return (
    <aside className="rail" aria-label="Bandeja de entrada">
      <div className="rail-head">
        <div className="rail-title">
          <h2>Bandeja</h2>
          <span className="count">{emails.length} correos</span>
        </div>
        <Distribution counts={counts} total={emails.length} />
        <div className="rail-actions">
          <button className="btn btn-primary" onClick={onProcessSelected} disabled={busy || checked.size === 0}>
            <Icon name="play" size={15} />
            {busy ? "Procesando" : `Procesar seleccionados (${checked.size})`}
          </button>
          <button
            className="btn"
            onClick={onProcessPending}
            disabled={busy || pendingCount === 0}
            title="Procesa de a uno los correos que todavía no tienen corrida"
          >
            Procesar pendientes ({pendingCount})
          </button>
        </div>
        <label className="check-all">
          <input type="checkbox" checked={allChecked} onChange={(e) => onToggleAll(e.target.checked)} disabled={busy} />
          Seleccionar todos
        </label>
      </div>
      <ul className="mail-list">
        {emails.map((e) => {
          const status = statusOf(e.id, latest);
          return (
            <li key={e.id} className={`mail-row mail-${status}${e.id === viewedId ? " is-active" : ""}`}>
              <input
                type="checkbox"
                aria-label={`Seleccionar ${e.subject}`}
                checked={checked.has(e.id)}
                onChange={() => onToggle(e.id)}
                disabled={busy}
              />
              <button className="mail-main" onClick={() => onView(e.id)} aria-current={e.id === viewedId}>
                <span className="avatar" aria-hidden="true">
                  {initial(e.from)}
                </span>
                <span className="mail-text">
                  <span className="mail-subject">{e.subject}</span>
                  <span className="mail-from">{e.from}</span>
                </span>
              </button>
              <StatusBadge status={status} />
            </li>
          );
        })}
      </ul>
    </aside>
  );
}
