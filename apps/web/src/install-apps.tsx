import {useEffect,useState} from "react";
import {z} from "zod";
import {Icon} from "./ui.js";
import {refreshWhileVisible} from "./refresh-visible.js";
const releaseSchema=z.object({
  version:z.string().regex(/^\d+\.\d+\.\d+$/),
  url:z.string().url().startsWith("https://github.com/atemnorod01/logisticall-platform/releases/download/"),
  sizeBytes:z.number().positive(),
  minimumMacOS:z.string(),
  notarized:z.boolean(),
});
type Release=z.infer<typeof releaseSchema>;
export function InstallApps(){
  const [release,setRelease]=useState<Release|null>(null),[error,setError]=useState(false);
  useEffect(()=>{
    let live=true;let pending=false;
    const controller=new AbortController();
    const refresh=async()=>{
      if(pending)return;pending=true;
      try{
        const response=await fetch("/desktop-release.json",{cache:"no-store",signal:controller.signal});
        if(!response.ok)throw Error("Release unavailable");
        const result=releaseSchema.parse(await response.json());
        if(live){setRelease(result);setError(false);}
      }catch{if(live)setError(true);}finally{pending=false;}
    };
    void refresh();const stop=refreshWhileVisible(()=>{void refresh();});
    return()=>{live=false;controller.abort();stop();};
  },[]);
  return <div className="lc-install-apps">
    <article className="lc-install-card">
      <div className="lc-install-title"><Icon name="devices"/><div><h2>Logisticall 2 for Mac</h2><p className="sub">Voice calls, messages and incoming call alerts on your desktop.</p></div></div>
      <div className="lc-install-release" aria-live="polite">
        {release?<><strong>Version {release.version}</strong><span>macOS {release.minimumMacOS}+ · Apple silicon &amp; Intel · {Math.round(release.sizeBytes/1024/1024)} MB</span></>:<span>{error?"Download information is temporarily unavailable. Please reopen this page to retry.":"Checking the latest release…"}</span>}
      </div>
      {release&&<a className="button primary" href={release.url}><Icon name="download"/>Download for Mac · v{release.version}</a>}
      {error&&release&&<p role="status" className="sub">Could not check for a newer release. Showing the last available download.</p>}
      {release&&!release.notarized&&<p className="lc-install-note"><strong>Test build — not notarized by Apple.</strong> macOS may block its first launch. A standard installation on another Mac requires an Apple-signed, notarized release.</p>}
      <h3>Install on your Mac</h3>
      <ol><li>Quit any older Logisticall 2 app.</li><li>Open the downloaded installer and drag Logisticall 2 into Applications.</li><li>Eject the installer, open Logisticall 2 from Applications, and sign in.</li></ol>
      <p className="sub">Use one installed copy to avoid opening an older version. Allow microphone access when prompted for voice calls.</p>
    </article>
    <article className="lc-install-card lc-install-future"><h2>Windows</h2><p className="sub">Coming later. For now, use LogistiCall in your browser.</p></article>
  </div>;
}
