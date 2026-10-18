import { createPortal } from "react-dom";
import { telephonyRequest } from "./telephony-api.js";
export { telephonyRequest } from "./telephony-api.js";
import { TelephonyResources } from "./telephony-resources.js";
import { useEffect, useRef, useState, type CSSProperties } from "react";
import { telephonyStatus, telephonyDisablePreview, type TelephonyStatus, type TelephonyDisablePreview } from "../../../packages/types/src/telephony.js";

type Flow = { enabled: boolean; stage: "confirm" | "progress" | "complete" | "failed" };
export function OrganizationTelephony({id,csrf,active,switchTarget,tab,onEnabledChange}: {
  id: string; csrf: string; active: boolean; switchTarget: HTMLElement | null; tab: string; onEnabledChange: (enabled: boolean) => void;
}) {
  const [status,setStatus] = useState<TelephonyStatus | null>(null);
  const [error,setError] = useState("");
  const [busy,setBusy] = useState(false);
  const [flow,setFlow] = useState<Flow | null>(null);
  const [preview,setPreview] = useState<TelephonyDisablePreview | null>(null);
  const [bounds,setBounds] = useState<CSSProperties>({});
  const dialog = useRef<HTMLDialogElement>(null);
  const requestVersion = useRef(0);
  const submitting = useRef(false);
  const flowOpen = flow !== null;
  useEffect(() => {
    if (!flow) onEnabledChange(status?.enabled ?? false);
  }, [status?.enabled,flow,onEnabledChange]);
  useEffect(() => {
    let stopped = false;
    const refresh = async () => {
      if(submitting.current) return;
      const version=requestVersion.current;
      try {
        const next=telephonyStatus.parse(await telephonyRequest(`organizations/${id}/telephony`,csrf));
        if(!stopped && version===requestVersion.current && !submitting.current) setStatus(next);
      } catch(e) {if(!stopped) setError((e as Error).message);}
    };
    void refresh();
    const timer=setInterval(() => {if(document.visibilityState === "visible") void refresh();},1500);
    return () => {stopped=true;clearInterval(timer);};
  },[id,csrf]);
  useEffect(() => {
    if(!flow || flow.stage !== "progress" || busy || !status) return;
    if(flow.enabled ? status.state === "complete" : status.state === "disabled") setFlow({...flow,stage:"complete"});
    else if(["failed","interrupted"].includes(status.state)) setFlow({...flow,stage:"failed"});
  },[status,flow,busy]);
  useEffect(() => {
    if(!flowOpen) return;
    const card=switchTarget?.closest(".lc-platform-editor-panel");
    const measure=() => {if(card){const rect=card.getBoundingClientRect();setBounds({left:rect.left,top:rect.top,width:rect.width,height:rect.height});}};
    measure();
    const observer=new ResizeObserver(measure);
    if(card) observer.observe(card);
    window.addEventListener("resize",measure);
    window.addEventListener("scroll",measure,true);
    dialog.current?.showModal();
    return () => {observer.disconnect();window.removeEventListener("resize",measure);window.removeEventListener("scroll",measure,true);};
  },[flowOpen,switchTarget]);
  async function review(enabled:boolean) {
    setError("");setPreview(null);
    if(status?.state === "running") {setFlow({enabled:status.operation !== "disable",stage:"progress"});return;}
    setFlow({enabled,stage:"confirm"});
    if(!enabled) {
      setBusy(true);
      try {setPreview(telephonyDisablePreview.parse(await telephonyRequest(`organizations/${id}/telephony/disable-preview`,csrf)));}
      catch(e) {setError((e as Error).message);}
      finally {setBusy(false);}
    }
  }
  async function accept() {
    if(!flow || busy || (!flow.enabled && !preview)) return;
    const enabled=flow.enabled;
    submitting.current=true;requestVersion.current++;setBusy(true);setError("");setFlow({enabled,stage:"progress"});
    try {
      setStatus(telephonyStatus.parse(await telephonyRequest(`organizations/${id}/telephony`,csrf,"POST",enabled ? {enabled:true} : {enabled:false,confirmed:true,previewHash:preview!.previewHash})));
    } catch(e) {setError((e as Error).message);setFlow({enabled,stage:"failed"});}
    finally {submitting.current=false;setBusy(false);}
  }
  const completed=flow?.stage === "complete";
  const steps=flow?.enabled ? [
    {label:"Create PortaOne customer",done:!!status?.portaoneCustomerId},
    {label:"Configure account, dialing rule and seven IP aliases",done:status?.portaoneStep === "complete"},
    {label:"Create NetSapiens domain",done:!!status?.netsapiensDomain},
    {label:"Configure auto attendant 9999",done:!!status?.attendantReady},
    {label:"Verify provisioning",done:status?.state === "complete"},
  ] : (preview?.steps ?? ["Terminate PortaOne customer","Delete PortaOne customer","Delete NetSapiens domain","Verify both systems"]).map((label,index) => ({label,done:completed || !!status?.completedSteps?.includes(["terminate","customer","domain"][index] ?? "verify")}));
  return <>
    {switchTarget && createPortal(<label className="lc-telephony-switch">
      <input type="checkbox" role="switch" aria-label="Enable telephony" checked={status?.enabled ?? false}
        disabled={!status || !status.configured || (!active && !status.enabled) || flowOpen}
        onChange={() => void review(!status?.enabled)} />
      <span>Enable telephony</span>
    </label>,switchTarget)}
    {status?.enabled && (tab === "portaone" || tab === "netsapiens") && <section className="lc-telephony-section" role="tabpanel" aria-label={tab === "portaone" ? "PortaOne" : "NetSapiens"}>
      {status.preview && <small className="lc-platform-badge">Preview · sample data</small>}
      {status.state !== "complete" && <button type="button" onClick={() => void review(status.operation !== "disable")}>View provisioning progress</button>}
      <TelephonyResources key={`${id}/${tab}`} id={id} csrf={csrf} provider={tab} />
    </section>}
    {!flow && error && <p role="alert">{error}</p>}
    {flow && <dialog ref={dialog} className="lc-telephony-flow" style={bounds} aria-labelledby={`telephony-flow-${id}`}
      onCancel={event => {event.preventDefault();if(flow.stage !== "progress" && !busy) setFlow(null);}}>
      <div className="lc-telephony-flow-content">
        <h2 id={`telephony-flow-${id}`}>{completed ? flow.enabled ? "Provisioning completed" : "Telephony disabled" : flow.stage === "progress" ? flow.enabled ? "Provisioning telephony" : "Disabling telephony" : flow.stage === "failed" ? "Operation needs attention" : flow.enabled ? "Enable telephony?" : "Disable telephony?"}</h2>
        {status?.preview && <small className="lc-platform-badge">Preview · sample data</small>}
        {flow.stage === "confirm" && <p>{flow.enabled ? "This will provision this organization in PortaOne and NetSapiens, including the seven IP aliases and auto attendant 9999." : busy ? "Checking provider resources and usage history…" : preview?.description}</p>}
        {flow.stage !== "confirm" && <div aria-live="polite">
          <ol className="lc-telephony-flow-steps">{steps.map((step,index) => <li key={`${index}-${step.label}`}><span aria-hidden="true">{step.done ? "✓" : "○"}</span>{step.label}</li>)}</ol>
          {flow.stage === "progress" && <p role="status">{status?.operationStep || (flow.enabled ? status?.netsapiensStep || status?.portaoneStep : null) || "Starting…"}</p>}
          {flow.stage === "failed" && !error && <p role="alert">{status?.message || "Saved progress is retained. Review and resume to continue."}</p>}
        </div>}
        {error && <p role="alert">{error}</p>}
        <div className="lc-telephony-flow-actions">
          {completed ? <button type="button" className="button primary" onClick={() => {setFlow(null);window.dispatchEvent(new Event("logisticall:telephony-changed"));}}>OK</button> : flow.stage === "progress" ? <span>Keep this window open while the operation completes.</span> : <>
            <button type="button" className="button" disabled={busy} onClick={() => setFlow(null)}>{flow.stage === "failed" ? "Close" : "Cancel"}</button>
            {flow.stage === "failed" || (!flow.enabled && !preview && !busy) ? <button type="button" className="button primary" onClick={() => void review(flow.enabled)}>Review and retry</button> : <button type="button" className="button primary" disabled={busy || (!flow.enabled && !preview)} onClick={() => void accept()}>Accept</button>}
          </>}
        </div>
      </div>
    </dialog>}
  </>;
}
