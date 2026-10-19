import {numberWorkflowMessage} from './customer-language';
import { useEffect, useRef, useState } from "react";
import { visibleInterval } from "./visible-poll";
import { useBuyRequest } from "./number-purchase-api";
import { CoverageCombobox } from "./CoverageCombobox";
import type { AssignmentDestination } from "./NumberAssignmentDrawer";
import type { AssignmentView } from "./models/number-assignment-model";
import { displayNumber } from "./models/number-purchase-model";

export function NumberBulkAssignmentDialog({
  numbers,
  destinations,
  onClose,
  onUpdated,
}: {
  numbers: string[];
  destinations: AssignmentDestination[];
  onClose: () => void;
  onUpdated: () => void;
}) {
  const buyRequest = useBuyRequest();
  const dialog = useRef<HTMLDialogElement>(null),
    callback = useRef(onUpdated);
  callback.current = onUpdated;
  const [organizationId, setOrganizationId] = useState(""),
    [current, setCurrent] = useState<AssignmentView[]>([]),
    [sending, setSending] = useState(false),
    [error, setError] = useState("");
  const active = sending || current.some((a) => a.active),
    complete = current.filter((a) => a.status === "complete").length,
    done = complete === numbers.length,
    started = current.length > 0;
  useEffect(() => {
    dialog.current?.showModal();
  }, []);
  const ids = current.map((a) => a.id).join(",");
  useEffect(() => {
    if (!current.some((a) => a.active)) return;
    let mounted = true,
      inFlight = false;
    const poll = async () => {
      if (inFlight) return;
      inFlight = true;
      try {
        const data = await buyRequest<{ assignments: AssignmentView[] }>(
          "/assignments",
        );
        const next = current.map(
          (a) => data.assignments.find((n) => n.id === a.id) ?? a,
        );
        if (mounted) {
          setCurrent(next);
          setError("");
          if (!next.some((a) => a.active)) callback.current();
        }
      } catch (e) {
        if (mounted) setError((e as Error).message);
      } finally {
        inFlight = false;
      }
    };
    const timer = visibleInterval(() => void poll(), 1500);
    void poll();
    return () => {
      mounted = false;
      clearInterval(timer);
    };
  }, [ids, current.some((a) => a.active)]);
  async function submit() {
    setSending(true);
    setError("");
    try {
      const result = await buyRequest<{ assignments: AssignmentView[] }>(
        "/assignments/assign",
        {
          method: "POST",
          body: JSON.stringify({ numbers, organizationId, confirmed: true }),
        },
      );
      setCurrent(result.assignments);
      callback.current();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setSending(false);
    }
  }
  return (
    <dialog
      ref={dialog}
      className="tn-confirm tn-bulk-assignment"
      aria-labelledby="tn-bulk-assignment-title"
      onCancel={(e) => {
        if (sending) e.preventDefault();
      }}
      onClose={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="tn-confirm-body">
        <h2 id="tn-bulk-assignment-title">
          {started
            ? `${complete} of ${numbers.length} assigned`
            : `Assign ${numbers.length} ${numbers.length === 1 ? "number" : "numbers"}`}
        </h2>
        {started ? (
          <p className="subtitle">
            {destinations.find((d) => d.id === organizationId)?.label}
          </p>
        ) : (
          <CoverageCombobox
            label="Organization"
            value={organizationId}
            onChange={setOrganizationId}
            options={destinations.map((d) => ({ value: d.id, label: d.label }))}
            placeholder="Select an organization"
            searchPlaceholder="Search organizations…"
            empty="No telephony-enabled organizations available."
          />
        )}
        {!started && (
          <p className="tn-help">
            Add these numbers to the organization’s phone system.
          </p>
        )}
        <ul className="tn-return-results" aria-live="polite">
          {numbers.map((number) => {
            const a = current.find((a) => a.number === number);
            return (
              <li key={number}>
                <div>
                  <strong>{displayNumber(number)}</strong>
                  {a && (
                    <span>
                      {a.status === "complete"
                        ? "Assigned"
                        : a.active
                          ? a.step === "checking"
                            ? "Queued / checking"
                            : "Assigning…"
                          : "Needs attention"}
                    </span>
                  )}
                </div>
                {a && (
                  <small>
                    Activation: {a.portaone} · Phone system: {a.netsapiens}
                  </small>
                )}
                {a?.error && <p className="error">{numberWorkflowMessage(a.error)}</p>}
              </li>
            );
          })}
        </ul>
        {error && (
          <p className="error" role="alert">
            {numberWorkflowMessage(error)}
          </p>
        )}
        {active && (
          <p className="tn-help" role="status">
            The batch continues processing if you close this window.
          </p>
        )}
        {done && (
          <p className="notice" role="status">
            All selected numbers are assigned.
          </p>
        )}
      </div>
      <div className="tn-confirm-footer">
        <button
          className="secondary"
          disabled={sending}
          onClick={() => dialog.current?.close()}
        >
          {started ? "Close" : "Cancel"}
        </button>
        {!done && (
          <button
            className="primary"
            disabled={active || !organizationId}
            onClick={() => void submit()}
          >
            {active
              ? "Assigning…"
              : started
                ? "Resume remaining"
                : `Assign ${numbers.length} ${numbers.length === 1 ? "number" : "numbers"}`}
          </button>
        )}
      </div>
    </dialog>
  );
}
