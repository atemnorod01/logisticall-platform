import { useEffect, useState } from "react";
import { OperationsDrawer } from "./OperationsDrawer";
import {
  useManagementRequest,
  routeLabel,
  routeState,
  type GatewaySnapshot,
  type RouteOperation,
} from "./operations-api";
export function NumberRouteDrawer({
  number,
  onClose,
  onUpdated,
}: {
  number: string;
  onClose: () => void;
  onUpdated: () => void;
}) {
  const managementRequest=useManagementRequest();
  const [snapshot, setSnapshot] = useState<GatewaySnapshot>(),
    [destination, setDestination] = useState(""),
    [review, setReview] = useState(false),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [success, setSuccess] = useState(""),
    [writes, setWrites] = useState(false),
    [loading, setLoading] = useState(true);
  async function refresh() {
    setLoading(true);
    setError("");
    setReview(false);
    try {
      const [s, h] = await Promise.all([
        managementRequest<GatewaySnapshot>("/bootstrap"),
        managementRequest<{ writes_enabled: boolean }>("/health"),
      ]);
      setSnapshot(s);
      setWrites(h.writes_enabled);
      const pending = s.did_operations.find(
        (o) => o.did === number && o.state !== "applied",
      );
      setDestination(
        pending?.destination ??
          s.config.routes.find((r) => r.did === number)?.destination ??
          "portaone",
      );
    } catch (e) {
      setError((e as Error).message);
      setSnapshot(undefined);
    } finally {
      setLoading(false);
    }
  }
  useEffect(() => {
    void refresh();
  }, [number]);
  const pending = snapshot?.did_operations.find((o) => o.state !== "applied");
  const current = snapshot?.config.routes.find(
    (r) => r.did === number,
  )?.destination;
  const blocked =
    !!pending && (pending.did !== number || pending.destination === null);
  const valid =
    destination === "portaone" ||
    snapshot?.config.jambonz.some((p) => p.id === destination);
  async function apply() {
    if (!snapshot || !valid || blocked) return;
    setBusy(true);
    setError("");
    setSuccess("");
    try {
      const result = await managementRequest<RouteOperation>("/did-apply", {
        method: "POST",
        body: JSON.stringify({
          did: number,
          destination,
          revision: snapshot.revision,
        }),
      });
      const verified = await managementRequest<GatewaySnapshot>("/bootstrap");
      setSnapshot(verified);
      onUpdated();
      setReview(false);
      if (
        result.did !== number ||
        result.destination !== destination ||
        result.state !== "applied" ||
        verified.config.routes.find((r) => r.did === number)?.destination !==
          destination ||
        routeState(verified, number) !== "Both gateways synchronized"
      )
        throw new Error(
          result.error ||
            "Routing is not yet verified on both gateways. Refresh the status before resuming.",
        );
      setSuccess(
        `Route updated to ${routeLabel(verified, destination)}. Both gateways verified.`,
      );
    } catch (e) {
      setError((e as Error).message);
      setReview(false);
      setSnapshot(undefined);
      onUpdated();
    } finally {
      setBusy(false);
    }
  }
  return (
    <OperationsDrawer
      title={`Routing · ${number}`}
      onClose={onClose}
      busy={busy}
      footer={
        <>
          <button
            className="secondary"
            disabled={busy || loading}
            onClick={() => void refresh()}
          >
            Refresh status
          </button>
          {review ? (
            <>
              <button
                className="secondary"
                disabled={busy}
                onClick={() => setReview(false)}
              >
                Back
              </button>
              <button
                className="primary"
                disabled={busy || !writes || blocked}
                onClick={() => void apply()}
              >
                {busy ? "Applying…" : "Apply to both gateways"}
              </button>
            </>
          ) : (
            <button
              className="primary"
              disabled={
                busy ||
                loading ||
                !snapshot ||
                !writes ||
                blocked ||
                !valid ||
                (!pending && destination === current)
              }
              onClick={() => setReview(true)}
            >
              {pending?.did === number ? "Review resume" : "Review change"}
            </button>
          )}
        </>
      }
    >
      {error && (
        <p className="error" role="alert">
          {error} No automatic retry was sent.
        </p>
      )}
      {success && (
        <p className="notice" role="status">
          {success}
        </p>
      )}
      {loading ? (
        <p>Loading current routing…</p>
      ) : (
        snapshot && (
          <>
            <dl className="operations-facts">
              <div>
                <dt>Organization</dt>
                <dd>{snapshot.organizations[number] || "Unassigned"}</dd>
              </div>
              <div>
                <dt>Current route</dt>
                <dd>{routeLabel(snapshot, current)}</dd>
              </div>
            </dl>
            {!writes && (
              <p className="notice">OpenSIPS writes are temporarily paused.</p>
            )}
            {blocked && (
              <p className="error">
                Finish the pending operation for {pending?.did} in the{" "}
                <a href="/opensips/did-routing">legacy OpenSIPS portal</a>{" "}
                before changing this route.
              </p>
            )}
            {pending?.did === number && (
              <p className="notice">
                A saved operation needs attention. Resuming uses its original
                destination. {pending.error}
              </p>
            )}
            {review ? (
              <div className="notice">
                <strong>
                  {routeLabel(snapshot, current)} →{" "}
                  {routeLabel(snapshot, destination)}
                </strong>
                <p>
                  Incoming calls will go to {routeLabel(snapshot, destination)}{" "}
                  first. This applies to NYC1 and NYC3 and synchronizes the
                  associated Voice platform number when required.
                </p>
              </div>
            ) : (
              <label className="operations-field">
                Route to
                <select
                  value={destination}
                  disabled={busy || !!pending}
                  onChange={(e) => {
                    setDestination(e.target.value);
                    setSuccess("");
                  }}
                >
                  <option value="portaone">PortaOne</option>
                  {snapshot.config.jambonz.map((p) => (
                    <option key={p.id} value={p.id}>
                      Voice platform · {p.name}
                    </option>
                  ))}
                </select>
                <small>Newly purchased numbers default to PortaOne.</small>
              </label>
            )}
            <div className="operations-stack">
              {Object.entries(snapshot.config.nodes).map(([name]) => (
                <div className="operations-line" key={name}>
                  <strong>{name.toUpperCase()}</strong>
                  <span>
                    {snapshot.nodes[name]?.active === "active"
                      ? snapshot.nodes[name]?.revision === snapshot.revision
                        ? "Synchronized"
                        : "Revision differs"
                      : "Unavailable"}
                  </span>
                </div>
              ))}
            </div>
          </>
        )
      )}
    </OperationsDrawer>
  );
}
