import { StatusBadge } from "./Inbox";
import { describeEvent, noReportMessage, statusOf } from "./lib";
import type { EmailDetail, ProcessingResult } from "./types";

// Todo el texto viene de la API y de correos sintéticos: React lo escapa (nunca se usa innerHTML).

function EmailPanel({ email }: { email: EmailDetail | null }) {
  if (!email) return <section className="panel"><p className="muted">Cargando correo…</p></section>;
  return (
    <section className="panel">
      <h3>Correo</h3>
      <dl className="meta">
        <dt>De</dt>
        <dd>{email.from}</dd>
        <dt>Asunto</dt>
        <dd>{email.subject}</dd>
      </dl>
      <pre className="email-body">{email.body}</pre>
      <p className="muted small">Contenido externo no confiable (solo lectura). El agente no lo recibe hasta que pasa por el Input Guard.</p>
    </section>
  );
}

function AgentReportPanel({ run }: { run: ProcessingResult }) {
  const r = run.agentReport;
  return (
    <section className="panel">
      <h3>Informe del agente</h3>
      {!r ? (
        <p className="muted">{noReportMessage(run)}</p>
      ) : (
        <>
          <p className="tags">
            <span className="chip">{r.category}</span>
            <span className="chip">{r.outcome}</span>
          </p>
          <p>{r.summary}</p>
          {r.findings.length > 0 && (
            <ul className="findings">
              {r.findings.map((f, i) => (
                <li key={i}>{f}</li>
              ))}
            </ul>
          )}
          <p>
            <strong>Siguiente paso sugerido:</strong> {r.suggestedNextStep}
          </p>
          <p className="muted small">Informe interno: no se envió ningún correo al remitente.</p>
        </>
      )}
    </section>
  );
}

function SecurityPanel({ run }: { run: ProcessingResult }) {
  const s = run.security;
  return (
    <section className="panel">
      <h3>Seguridad</h3>
      <p>
        <span className={`risk risk-${s.risk}`}>{s.risk === "NOT_ANALYZED" ? "Sin análisis" : `Riesgo ${s.risk}`}</span>
        {s.deniedActions > 0 && <span className="risk risk-HIGH">Acciones denegadas: {s.deniedActions}</span>}
      </p>
      {s.reason && <p>{s.reason}</p>}
      {s.signals.length > 0 && (
        <p className="tags">
          {s.signals.map((sig, i) => (
            <span className="chip" key={i}>
              {sig}
            </span>
          ))}
        </p>
      )}
      <p className="muted small">Un riesgo LOW no es un certificado de seguridad: el clasificador puede equivocarse.</p>
    </section>
  );
}

function TracePanel({ run }: { run: ProcessingResult }) {
  return (
    <section className="panel">
      <h3>Traza de ejecución</h3>
      <ol className="trace">
        {run.events.map((e, i) => {
          const line = describeEvent(e);
          return (
            <li key={i} className={`trace-${line.tone}`}>
              <span className="trace-time">{new Date(e.ts).toLocaleTimeString()}</span>
              <span className="trace-label">{line.label}</span>
              <span>{line.text}</span>
            </li>
          );
        })}
      </ol>
    </section>
  );
}

interface Props {
  email: EmailDetail | null;
  emailId: string;
  subject: string;
  run: ProcessingResult | undefined;
  busy: boolean;
  onProcess: () => void;
}

export function Detail({ email, emailId, subject, run, busy, onProcess }: Props) {
  const latest = new Map(run ? [[emailId, run]] : []);
  return (
    <div className="detail">
      <header className="detail-head">
        <h2>{subject}</h2>
        <StatusBadge status={statusOf(emailId, latest)} />
        <button onClick={onProcess} disabled={busy}>
          {run ? "Reprocesar" : "Procesar"}
        </button>
      </header>
      <EmailPanel email={email} />
      {run ? (
        <>
          <AgentReportPanel run={run} />
          <SecurityPanel run={run} />
          <TracePanel run={run} />
        </>
      ) : (
        <section className="panel">
          <p className="muted">Todavía no se procesó este correo.</p>
        </section>
      )}
    </div>
  );
}
