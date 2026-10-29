import { StatusBadge } from "./Inbox";
import { compareRuns, describeEvent, noReportMessage, potentialImpact, runModel, sameAgentConfig, statusOf, toolTable, type ComparisonPair } from "./lib";
import type { EmailDetail, ProcessingResult } from "./types";

// Todo el texto viene de la API y de correos sintéticos: React lo escapa (nunca se usa innerHTML).

const riskText = (r: ProcessingResult["security"]["risk"]) => (r === "NOT_ANALYZED" ? "Sin análisis" : `Riesgo ${r}`);

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

function ReportBody({ run }: { run: ProcessingResult }) {
  const r = run.agentReport;
  if (!r) return <p className="muted">{noReportMessage(run)}</p>;
  return (
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
    </>
  );
}

function AgentReportPanel({ run }: { run: ProcessingResult }) {
  return (
    <section className="panel">
      <h3>Informe del agente</h3>
      <ReportBody run={run} />
      {run.agentReport && <p className="muted small">Informe interno: no se envió ningún correo al remitente.</p>}
    </section>
  );
}

function SecurityPanel({ run }: { run: ProcessingResult }) {
  const s = run.security;
  return (
    <section className="panel">
      <h3>Seguridad</h3>
      <p>
        <span className={`risk risk-${s.risk}`}>{riskText(s.risk)}</span>
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

function TraceList({ run }: { run: ProcessingResult }) {
  return (
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
  );
}

function TracePanel({ run }: { run: ProcessingResult }) {
  return (
    <section className="panel">
      <h3>Traza de ejecución</h3>
      <TraceList run={run} />
    </section>
  );
}

/** Herramientas solicitadas por el agente, con la decisión del PolicyEngine y si llegaron a ejecutarse. */
function ToolTable({ run }: { run: ProcessingResult }) {
  const rows = toolTable(run);
  return (
    <>
      <p className="small">
        <strong>Herramientas solicitadas por el agente:</strong>
      </p>
      {rows.length === 0 ? (
        <p className="muted small">Ninguna: el agente no pidió herramientas.</p>
      ) : (
        <table className="tool-table">
          <thead>
            <tr>
              <th>Herramienta</th>
              <th>Argumentos</th>
              <th>Política</th>
              <th>Ejecutada</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r, i) => (
              <tr key={i} className={r.decision === "DENY" ? "row-deny" : undefined}>
                <td>
                  <code>{r.tool}</code>
                </td>
                <td className="muted">{r.input || "—"}</td>
                <td>
                  {r.decision === "DENY" && <span className="decision decision-DENY">DENEGADA</span>}
                  {r.decision === "ALLOW" && <span className="decision decision-ALLOW">Permitida</span>}
                  {r.decision === "—" && <span className="muted small">sin decisión</span>}
                  {r.reason && <div className="muted small">{r.reason}</div>}
                </td>
                <td>{r.executed ? "Sí" : "No"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </>
  );
}

/** Corrida sin protección: está contenida (nada de lo que produce sale ni afecta la bandeja). */
function Containment({ run }: { run: ProcessingResult }) {
  return (
    <div className="containment">
      <p>
        <span className="badge badge-contained">Corrida contenida</span>
      </p>
      <p className="small">
        Sus resultados no afectan la bandeja ni se entregan a nadie: solo cuenta la corrida protegida. Lo siguiente es lo que habría
        pasado sin freno, según la traza real:
      </p>
      <ul className="impact">
        {potentialImpact(run).map((line, i) => (
          <li key={i}>{line}</li>
        ))}
      </ul>
    </div>
  );
}

function CompareColumn({ title, run, unprotected }: { title: string; run: ProcessingResult | undefined; unprotected?: boolean }) {
  return (
    <div className={unprotected ? "compare-col compare-unprotected" : "compare-col"}>
      <h4>{title}</h4>
      {!run ? (
        <p className="muted">Sin corrida protegida emparejada.</p>
      ) : (
        <>
          <p>
            <StatusBadge status={run.status} /> <span className={`risk risk-${run.security.risk}`}>{riskText(run.security.risk)}</span>
          </p>
          {unprotected && run.status !== "PROCESSING" && <Containment run={run} />}
          <ToolTable run={run} />
          <ReportBody run={run} />
          <details>
            <summary>Ver traza completa</summary>
            <TraceList run={run} />
          </details>
        </>
      )}
    </div>
  );
}

function ComparePanel({ pair }: { pair: ComparisonPair }) {
  const { protectedRun, unprotectedRun } = pair;
  const running = [protectedRun, unprotectedRun].some((r) => r?.status === "PROCESSING");
  const summary = protectedRun && !running ? compareRuns(protectedRun, unprotectedRun) : null;
  const sameModel = protectedRun && sameAgentConfig(protectedRun, unprotectedRun);
  return (
    <section className="panel compare">
      <h3>Comparación: protegido vs. sin protección</h3>
      <p className="muted small">
        Mismo modelo, mismo objetivo, mismas herramientas y mismos fixtures. Solo cambian las protecciones de InboxEye: el Input
        Guard y las reglas de recursos. «Sin protección» sigue en sandbox (herramientas sintéticas, validación de argumentos, límites
        y auditoría); no se envía nada real. Son dos corridas reales e independientes: el modelo puede variar entre ejecuciones.
      </p>
      {protectedRun && (
        <p className={sameModel ? "small" : "small warn-text"}>
          Modelo: <code>{runModel(protectedRun)}</code>
          {sameModel
            ? " · mismo modelo, system prompt y herramientas en ambas corridas (huella verificada)"
            : ` · sin protección: ${runModel(unprotectedRun)} — configuración distinta o no auditada: comparación no válida`}
        </p>
      )}
      <div className="compare-grid">
        <CompareColumn title="Protegido" run={protectedRun} />
        <CompareColumn title="Sin protección (demo)" run={unprotectedRun} unprotected />
      </div>
      <div className="diff">
        <h4>Diferencias observadas</h4>
        <p className="muted small">Calculadas por reglas sobre la traza (sin IA); no son una opinión de ningún modelo.</p>
        {!summary ? (
          <p className="muted">{running ? "Corridas en curso…" : "Esperando la corrida protegida emparejada."}</p>
        ) : (
          <>
            <h5>Seguridad</h5>
            <ul>
              {summary.security.map((p, i) => (
                <li key={i}>{p}</li>
              ))}
            </ul>
            <h5>Trabajo del agente</h5>
            <ul>
              {summary.work.map((p, i) => (
                <li key={i}>{p}</li>
              ))}
            </ul>
          </>
        )}
      </div>
    </section>
  );
}

interface Props {
  email: EmailDetail | null;
  emailId: string;
  subject: string;
  run: ProcessingResult | undefined;
  pair: ComparisonPair | null;
  busy: boolean;
  onProcess: () => void;
  onCompare: () => void;
}

export function Detail({ email, emailId, subject, run, pair, busy, onProcess, onCompare }: Props) {
  const latest = new Map(run ? [[emailId, run]] : []);
  return (
    <div className="detail">
      <header className="detail-head">
        <h2>{subject}</h2>
        <StatusBadge status={statusOf(emailId, latest)} />
        <button onClick={onProcess} disabled={busy}>
          {run ? "Reprocesar" : "Procesar"}
        </button>
        <button onClick={onCompare} disabled={busy} title="Corre el mismo correo con y sin protección (2 corridas reales)">
          Comparar protegido vs. sin protección
        </button>
      </header>
      <EmailPanel email={email} />
      {pair && <ComparePanel pair={pair} />}
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
