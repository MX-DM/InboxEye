import { useState, type CSSProperties } from "react";
import { Icon, type IconName } from "./Icons";
import { StatusBadge } from "./Inbox";
import {
  categoryLabel,
  compareRuns,
  describeEvent,
  eventTech,
  noReportMessage,
  outcomeLabel,
  outcomeTone,
  pipelineStages,
  potentialImpact,
  runModel,
  sameAgentConfig,
  signalChips,
  statusOf,
  toolTable,
  traceLevel,
  type ComparisonPair,
  type Stage,
  type StageState,
} from "./lib";
import type { EmailDetail, ProcessingResult } from "./types";

// Todo el texto viene de la API y de correos sintéticos: React lo escapa (nunca se usa innerHTML).

const riskText = (r: ProcessingResult["security"]["risk"]) => (r === "NOT_ANALYZED" ? "Sin análisis" : `Riesgo ${r}`);
const delay = (i: number) => ({ "--i": i }) as CSSProperties;

// ---------- Correo ----------

function EmailPanel({ email }: { email: EmailDetail | null }) {
  if (!email)
    return (
      <section className="panel">
        <p className="muted">Cargando correo…</p>
      </section>
    );
  return (
    <section className="panel email-panel">
      <header className="email-head">
        <p className="email-from">
          <Icon name="mail" size={16} />
          <strong>Correo recibido</strong> de {email.from}
        </p>
        <span className="tag tag-warn" title="El agente solo recibe el ID. El texto le llega únicamente si pasa por el Input Guard.">
          <Icon name="shield-off" size={13} />
          Contenido externo no confiable
        </span>
      </header>
      <blockquote className="email-body">{email.body}</blockquote>
    </section>
  );
}

// ---------- Informe y seguridad ----------

function ReportBody({ run }: { run: ProcessingResult }) {
  const r = run.agentReport;
  if (!r) return <p className="muted">{noReportMessage(run)}</p>;
  return (
    <div className="report">
      <div className="chips">
        <span className="chip">{categoryLabel(r.category)}</span>
        <span className={`chip chip-${outcomeTone(r.outcome)}`}>{outcomeLabel(r.outcome)}</span>
      </div>
      <p className="report-summary">{r.summary}</p>
      {r.findings.length > 0 && (
        <ul className="findings">
          {r.findings.map((f, i) => (
            <li key={i}>
              <Icon name="check" size={14} />
              <span>{f}</span>
            </li>
          ))}
        </ul>
      )}
      <div className="next-step">
        <span className="next-step-title">Siguiente paso sugerido</span>
        {r.suggestedNextStep}
      </div>
    </div>
  );
}

function AgentReportPanel({ run }: { run: ProcessingResult }) {
  return (
    <section className="panel report-hero" aria-label="Informe del agente">
      <header className="panel-head">
        <h3>
          <Icon name="report" size={17} />
          Informe del agente
        </h3>
      </header>
      <ReportBody run={run} />
      {run.agentReport && <p className="hint">Informe interno: no se envió ningún correo al remitente.</p>}
    </section>
  );
}

const RISK_LEVELS = ["LOW", "MEDIUM", "HIGH"] as const;

function SecurityPanel({ run }: { run: ProcessingResult }) {
  const s = run.security;
  const chips = signalChips(s.signals);
  const analyzed = s.risk !== "NOT_ANALYZED";
  return (
    <section className="panel">
      <header className="panel-head">
        <h3>
          <Icon name="shield" size={17} />
          Seguridad
        </h3>
        <span className={`risk-badge risk-${s.risk}`}>{riskText(s.risk)}</span>
      </header>
      {analyzed ? (
        <div className="meter" aria-hidden="true">
          {RISK_LEVELS.map((lvl) => (
            <span key={lvl} className={`meter-seg${s.risk === lvl ? ` on on-${lvl}` : ""}`} />
          ))}
        </div>
      ) : null}
      {s.reason && <p className="guard-reason">{s.reason}</p>}
      {chips.length > 0 && (
        <div className="chips">
          {chips.map((c, i) => (
            <span key={i} className={`chip chip-${c.source}`} title={c.source === "regla" ? "Regla estática" : "Señal del clasificador"}>
              {c.text}
            </span>
          ))}
        </div>
      )}
      <p className="stat-line">
        <Icon name={s.deniedActions > 0 ? "ban" : "check"} size={15} />
        {s.deniedActions === 0 ? "Ninguna acción denegada" : `${s.deniedActions} ${s.deniedActions === 1 ? "acción denegada" : "acciones denegadas"} por la política`}
      </p>
      <p className="hint">Un riesgo bajo no es un certificado de seguridad: el clasificador puede equivocarse.</p>
    </section>
  );
}

// ---------- Traza de ejecución (línea de tiempo) ----------

const LABEL_ICON: Record<string, IconName> = {
  Inicio: "play",
  Agente: "agent",
  Política: "policy",
  Tool: "tool",
  "Input Guard": "shield",
  Entrega: "mail",
  Informe: "report",
  Fin: "flag",
};

function Timeline({ run, showTech }: { run: ProcessingResult; showTech: boolean }) {
  return (
    <ol className="timeline">
      {run.events.map((e, i) => {
        const line = describeEvent(e);
        const level = traceLevel(e);
        // Contenido retenido = violeta; Input Guard apagado = gris punteado; el rojo queda para denegaciones de la política.
        const guardOrDelivery = line.label === "Input Guard" || line.label === "Entrega";
        const tone =
          line.label === "Input Guard" && e.detail?.enabled === false
            ? "off"
            : guardOrDelivery && (line.tone === "deny" || line.tone === "warn")
              ? "hold"
              : line.tone;
        return (
          <li key={i} className={`tl-node tl-${tone} tl-level-${level}`}>
            <span className="tl-dot">
              <Icon name={LABEL_ICON[line.label] ?? "minus"} size={13} />
            </span>
            <div className="tl-body">
              <div className="tl-title">
                <span className="tl-actor">{line.label}</span>
                {line.text}
              </div>
              {showTech && (
                <dl className="tl-tech">
                  {eventTech(e).map(([k, v], j) => (
                    <div key={j}>
                      <dt>{k}</dt>
                      <dd>{v}</dd>
                    </div>
                  ))}
                </dl>
              )}
            </div>
          </li>
        );
      })}
    </ol>
  );
}

function TracePanel({ traces }: { traces: { title: string; run: ProcessingResult }[] }) {
  const [tech, setTech] = useState(false);
  return (
    <section className="panel">
      <header className="panel-head">
        <h3>
          <Icon name="clock" size={17} />
          Traza de ejecución
        </h3>
        <label className="switch">
          <input type="checkbox" checked={tech} onChange={(e) => setTech(e.target.checked)} />
          Detalle técnico
        </label>
      </header>
      <div className={traces.length > 1 ? "trace-cols" : undefined}>
        {traces.map((t) => (
          <div key={t.title}>
            {traces.length > 1 && <h4 className="col-title">{t.title}</h4>}
            <Timeline run={t.run} showTech={tech} />
          </div>
        ))}
      </div>
    </section>
  );
}

// ---------- Herramientas solicitadas ----------

function ToolTable({ run }: { run: ProcessingResult }) {
  const rows = toolTable(run);
  if (rows.length === 0) return <p className="muted small">El agente no pidió herramientas.</p>;
  return (
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
            <td className="muted">{r.input || "sin ids"}</td>
            <td>
              {r.decision === "DENY" && <span className="decision decision-DENY">Denegada</span>}
              {r.decision === "ALLOW" && <span className="decision decision-ALLOW">Permitida</span>}
              {r.decision === "—" && <span className="muted small">sin decisión</span>}
              {r.reason && <div className="muted small">{r.reason}</div>}
            </td>
            <td>{r.executed ? "Sí" : "No"}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

// ---------- Recorrido por etapas ----------

const STATE_ICON: Record<StageState, IconName> = {
  ok: "check",
  deny: "ban",
  hold: "shield",
  warn: "flag",
  off: "eye-off",
  idle: "minus",
  fail: "x",
};

function StageCell({ stage }: { stage: Stage | undefined }) {
  if (!stage)
    return (
      <div className="stage-cell stage-idle">
        <span className="muted small">Sin corrida emparejada</span>
      </div>
    );
  return (
    <div className={`stage-cell stage-${stage.state}`}>
      <span className="stage-icon">
        <Icon name={STATE_ICON[stage.state]} size={16} />
      </span>
      <div>
        <div className="stage-headline">{stage.headline}</div>
        {stage.detail && <div className="stage-detail">{stage.detail}</div>}
      </div>
    </div>
  );
}

function Pipeline({ run }: { run: ProcessingResult }) {
  return (
    <section className="panel">
      <header className="panel-head">
        <h3>
          <Icon name="policy" size={17} />
          Recorrido del correo
        </h3>
      </header>
      <div className="stages stages-single">
        {pipelineStages(run).map((s) => (
          <div className="stage-row" key={s.key}>
            <div className="stage-label">{s.label}</div>
            <StageCell stage={s} />
          </div>
        ))}
      </div>
    </section>
  );
}

// ---------- Comparador (pieza principal) ----------

/** Corrida sin protección: está contenida (nada de lo que produce sale ni afecta la bandeja). */
function Containment({ run }: { run: ProcessingResult }) {
  return (
    <div className="containment">
      <p className="containment-title">
        <Icon name="shield" size={15} />
        Corrida contenida
      </p>
      <p className="small">
        Sus resultados no afectan la bandeja ni se entregan a nadie: solo cuenta la corrida protegida. Esto es lo que habría
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

function Comparison({ pair }: { pair: ComparisonPair }) {
  const { protectedRun: p, unprotectedRun: u } = pair;
  const running = [p, u].some((r) => r?.status === "PROCESSING");
  const ps = p ? pipelineStages(p) : [];
  const us = pipelineStages(u);
  const summary = p && !running ? compareRuns(p, u) : null;
  const sameConfig = p ? sameAgentConfig(p, u) : false;

  return (
    <section className="panel hero" aria-labelledby="cmp-title">
      <header className="hero-head">
        <div>
          <h3 id="cmp-title">Protegido frente a sin protección</h3>
          <p className="hero-sub">El mismo correo, procesado dos veces por el mismo agente. Solo cambian las protecciones de InboxEye.</p>
        </div>
        {p && (
          <p className={`config-note ${sameConfig ? "config-ok" : "config-bad"}`}>
            <Icon name={sameConfig ? "check" : "x"} size={14} />
            {sameConfig ? (
              <>
                Mismo modelo <code>{runModel(p)}</code>, mismo prompt y mismas herramientas (huella verificada)
              </>
            ) : (
              <>Configuración distinta o no auditada: comparación no válida</>
            )}
          </p>
        )}
      </header>

      <div className="lanes">
        <div className="lane-head lane-label" />
        <div className="lane-head lane-protected">
          <Icon name="shield" size={18} />
          Protegido
          <span>Input Guard y Policy Engine activos</span>
        </div>
        <div className="lane-head lane-unprotected">
          <Icon name="shield-off" size={18} />
          Sin protección
          <span>Sin Input Guard ni reglas de recursos</span>
        </div>
        {us.map((s, i) => {
          const differs = !!ps[i] && ps[i]!.state !== s.state;
          return (
            <div className={`stage-row stage-row-cmp${differs ? " differs" : ""}`} style={delay(i)} key={s.key}>
              <div className="stage-label">
                {s.label}
                {differs && <span className="diff-flag">difiere</span>}
              </div>
              <StageCell stage={ps[i]} />
              <StageCell stage={s} />
            </div>
          );
        })}
      </div>

      <div className="cmp-summary">
        {!summary ? (
          <p className="muted">{running ? "Corridas en curso…" : "Esperando la corrida protegida emparejada."}</p>
        ) : (
          <>
            <div className="callout callout-security">
              <h4>Qué cambió en seguridad</h4>
              <ul>
                {summary.security.map((t, i) => (
                  <li key={i}>{t}</li>
                ))}
              </ul>
            </div>
            <div className="callout">
              <h4>Qué cambió en el trabajo del agente</h4>
              <ul>
                {summary.work.map((t, i) => (
                  <li key={i}>{t}</li>
                ))}
              </ul>
            </div>
          </>
        )}
      </div>
      <p className="hint">
        Calculado por reglas sobre la traza, sin ningún modelo. Son dos corridas reales e independientes: el modelo puede variar entre
        ejecuciones y una sola comparación no permite generalizar.
      </p>

      <div className="cmp-cols">
        <div>
          <h4 className="col-title">Herramientas del agente protegido</h4>
          {p ? <ToolTable run={p} /> : <p className="muted small">Sin corrida protegida emparejada.</p>}
        </div>
        <div>
          <h4 className="col-title">Herramientas del agente sin protección</h4>
          <ToolTable run={u} />
        </div>
      </div>

      {u.status !== "PROCESSING" && <Containment run={u} />}

      <details className="more">
        <summary>Informe del agente sin protección</summary>
        <ReportBody run={u} />
      </details>
    </section>
  );
}

// ---------- Vista del correo ----------

interface Props {
  email: EmailDetail | null;
  emailId: string;
  subject: string;
  from: string;
  run: ProcessingResult | undefined;
  pair: ComparisonPair | null;
  busy: boolean;
  onProcess: () => void;
  onCompare: () => void;
}

export function Detail({ email, emailId, subject, from, run, pair, busy, onProcess, onCompare }: Props) {
  const latest = new Map(run ? [[emailId, run]] : []);
  const traces = pair
    ? [
        ...(pair.protectedRun ? [{ title: "Protegido", run: pair.protectedRun }] : []),
        { title: "Sin protección", run: pair.unprotectedRun },
      ]
    : run
      ? [{ title: "Protegido", run }]
      : [];

  return (
    <div className="detail">
      <header className="case-head">
        <div className="case-title">
          <h2>{subject}</h2>
          <p className="case-from">{from}</p>
        </div>
        <StatusBadge status={statusOf(emailId, latest)} />
        <div className="case-actions">
          <button className="btn" onClick={onProcess} disabled={busy}>
            <Icon name="play" size={15} />
            {run ? "Reprocesar" : "Procesar"}
          </button>
          <button
            className="btn btn-accent"
            onClick={onCompare}
            disabled={busy}
            title="Corre el mismo correo con y sin protección (2 corridas reales)"
          >
            <Icon name="compare" size={15} />
            Comparar protegido y sin protección
          </button>
        </div>
      </header>

      <EmailPanel email={email} />

      {pair ? <Comparison pair={pair} /> : run ? <Pipeline run={run} /> : null}

      {run ? (
        <>
          <AgentReportPanel run={run} />
          <SecurityPanel run={run} />
        </>
      ) : (
        !pair && (
          <section className="panel empty">
            <Icon name="shield" size={28} />
            <p>Todavía no se procesó este correo.</p>
            <p className="muted small">Procesalo para ver qué pidió el agente y qué decidió InboxEye, o compará los dos modos.</p>
          </section>
        )
      )}

      {traces.length > 0 && <TracePanel traces={traces} />}
    </div>
  );
}
