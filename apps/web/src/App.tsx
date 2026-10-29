import { useCallback, useEffect, useMemo, useState } from "react";
import { fetchEmail, fetchEmails, fetchRun, fetchRuns, startRun } from "./api";
import { Detail } from "./Detail";
import { Inbox } from "./Inbox";
import { comparisonPair, countByStatus, latestRunByEmail, STATUS_LABEL, statusOf } from "./lib";
import type { EmailDetail, EmailSummary, ProcessingResult, UiStatus } from "./types";

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const MAX_WAIT_MS = 120_000;

export default function App() {
  const [emails, setEmails] = useState<EmailSummary[]>([]);
  const [runs, setRuns] = useState<ProcessingResult[]>([]);
  const [viewedId, setViewedId] = useState<string | null>(null);
  const [detail, setDetail] = useState<EmailDetail | null>(null);
  const [checked, setChecked] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const refreshRuns = useCallback(async () => {
    try {
      setRuns(await fetchRuns());
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "error de red");
    }
  }, []);

  useEffect(() => {
    fetchEmails()
      .then((list) => {
        setEmails(list);
        setViewedId((cur) => cur ?? list[0]?.id ?? null);
      })
      .catch(() => setError("No se pudo cargar la bandeja. ¿Está levantada la API en el puerto 3001?"));
    void refreshRuns();
  }, [refreshRuns]);

  // Polling simple (sin websockets) mientras haya corridas en curso.
  const active = runs.some((r) => r.status === "PROCESSING");
  useEffect(() => {
    if (!active) return;
    const t = setInterval(() => void refreshRuns(), 1000);
    return () => clearInterval(t);
  }, [active, refreshRuns]);

  useEffect(() => {
    if (!viewedId) return;
    let cancelled = false; // evita que una respuesta tardía pise el detalle de otro correo
    setDetail(null);
    fetchEmail(viewedId)
      .then((d) => !cancelled && setDetail(d))
      .catch(() => !cancelled && setError("No se pudo cargar el correo."));
    return () => {
      cancelled = true;
    };
  }, [viewedId]);

  const latest = useMemo(() => latestRunByEmail(runs), [runs]);
  const counts = useMemo(() => countByStatus(emails.map((e) => e.id), latest), [emails, latest]);

  const waitRun = useCallback(async (runId: string, label: string) => {
    const deadline = Date.now() + MAX_WAIT_MS;
    for (;;) {
      const run = await fetchRun(runId);
      if (run.status !== "PROCESSING") return;
      if (Date.now() > deadline) throw new Error(`La corrida de ${label} tardó demasiado.`);
      await sleep(800);
    }
  }, []);

  // Secuencial a propósito: de a un correo por vez, para controlar el consumo de la API.
  const process = useCallback(
    async (ids: string[]) => {
      setBusy(true);
      setError(null);
      try {
        for (const id of ids) {
          const runId = await startRun(id);
          await refreshRuns();
          await waitRun(runId, id);
          await refreshRuns();
        }
      } catch (e) {
        setError(e instanceof Error ? e.message : "error al procesar");
      } finally {
        setBusy(false);
        await refreshRuns();
      }
    },
    [refreshRuns, waitRun],
  );

  // Comparación: dos corridas reales e independientes del mismo correo (protegida y sin protección).
  const compare = useCallback(
    async (id: string) => {
      setBusy(true);
      setError(null);
      try {
        const [protectedId, unprotectedId] = await Promise.all([startRun(id, "PROTECTED"), startRun(id, "UNPROTECTED_DEMO")]);
        await refreshRuns();
        await Promise.all([waitRun(protectedId, id), waitRun(unprotectedId, id)]);
      } catch (e) {
        setError(e instanceof Error ? e.message : "error al comparar");
      } finally {
        setBusy(false);
        await refreshRuns();
      }
    },
    [refreshRuns, waitRun],
  );

  const pendingIds = emails.filter((e) => statusOf(e.id, latest) === "PENDING").map((e) => e.id);
  const processSelected = () => void process(emails.filter((e) => checked.has(e.id)).map((e) => e.id));
  const toggle = (id: string) =>
    setChecked((cur) => {
      const next = new Set(cur);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  const viewed = emails.find((e) => e.id === viewedId);
  const order: UiStatus[] = ["PENDING", "PROCESSING", "PROCESSED", "NEEDS_REVIEW", "QUARANTINED", "FAILED"];

  return (
    <div className="app">
      <header className="topbar">
        <h1>InboxEye</h1>
        <span className="tagline">Harness de seguridad para agentes de correo · demo local con datos sintéticos (NovaShop)</span>
        <div className="counters">
          {order.map((s) => (
            <span key={s} className={`badge badge-${s}`}>
              {STATUS_LABEL[s]}: {counts[s]}
            </span>
          ))}
        </div>
      </header>
      {error && <div className="error" role="alert">{error}</div>}
      <main className="layout">
        <Inbox
          emails={emails}
          latest={latest}
          viewedId={viewedId}
          checked={checked}
          busy={busy}
          pendingCount={pendingIds.length}
          onView={setViewedId}
          onToggle={toggle}
          onToggleAll={(all) => setChecked(all ? new Set(emails.map((e) => e.id)) : new Set())}
          onProcessSelected={processSelected}
          onProcessPending={() => void process(pendingIds)}
        />
        {viewed ? (
          <Detail
            email={detail}
            emailId={viewed.id}
            subject={viewed.subject}
            run={latest.get(viewed.id)}
            pair={comparisonPair(runs, viewed.id)}
            busy={busy}
            onProcess={() => void process([viewed.id])}
            onCompare={() => void compare(viewed.id)}
          />
        ) : (
          <p className="muted">Elegí un correo de la bandeja.</p>
        )}
      </main>
    </div>
  );
}
