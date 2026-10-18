import { terminationProviders } from "./organization-termination-providers";
import { runTermination, removalHash, assertRemovable } from "./organization-termination";
import type { TelephonyDisablePreview } from "../../../../packages/types/src/telephony";
import {portaoneResources,pendingResources} from './resource-views';
import type {TelephonyProvider,TelephonyResourceView} from '../../../../packages/types/src/telephony-resources';
import type { Pool, PoolClient } from "pg";
import type { PlatformRow } from "../../../../packages/types/src/platform-admin";
import type {
  TelephonyIntegrations,
  TelephonyStatus,
} from "../../../../packages/types/src/telephony";
import type { Organization } from "./model";
import type { Store } from "./store";
import type { PortaoneCustomerTemplate } from "./organization-template";
import { PostgresIntegrationVault } from "./integration-vault";
import { PortaoneClient } from "./portaone";
import { NetsapiensClient } from "./netsapiens";
import {
  newPortaoneCustomerInfo,
  provisionPortaoneOrganization,
} from "./portaone-provisioning";
import {
  defaultNetsapiensOptions,
  provisionNetsapiensOrganization,
} from "./netsapiens-provisioning";
import { editableContactSchema } from "./contact-update";

export interface TelephonyService {
  enabledOrganizationIds(): Promise<string[]>;
  resources(id:string,provider:TelephonyProvider,section:string):Promise<TelephonyResourceView>;
  status(id: string): Promise<TelephonyStatus>;
  enable(record: PlatformRow, actorId: string): Promise<TelephonyStatus>;
  previewDisable(record: PlatformRow): Promise<TelephonyDisablePreview>;
  disable(record: PlatformRow, actorId: string, previewHash: string): Promise<TelephonyStatus>;
  integrations(): Promise<TelephonyIntegrations>;
  test(provider: "portaone" | "netsapiens"): Promise<void>;
  configure(
    provider: "portaone" | "netsapiens",
    input: unknown,
    actorId: string,
  ): Promise<void>;
  captureTemplate(actorId: string): Promise<void>;
  close(): Promise<void>;
}
export const disabledTelephony: TelephonyStatus = {
  configured: false,
  enabled: false,
  state: "disabled",
  portaoneCustomerId: null,
  netsapiensDomain: null,
  portaoneStep: null,
  netsapiensStep: null,
  aliasCount: 0,
  attendantReady: false,
  message: null,
};
const conflict = (message: string) =>
  Object.assign(Error(message), { statusCode: 409 });
export function postgresTelephony(pool: Pool): TelephonyService {
  const vault = new PostgresIntegrationVault(pool),
    po = new PortaoneClient(vault),
    ns = new NetsapiensClient(vault);
  const tasks = new Set<Promise<void>>();
  let closing = false,
    starting = 0;
  const integrations = async (): Promise<TelephonyIntegrations> => {
    const p = await po.status(),
      n = await ns.status();
    return {
      available: true,
      portaone: p.configured,
      netsapiens: n.configured,
      template: !!(await vault.get("template")),
      portaoneLogin: p.login,
      netsapiensClientId: n.clientId,
      netsapiensUsername: n.username,
      netsapiensExpiresAt: n.expiresAt,
      netsapiensError: n.error,
    };
  };
  const configured = async () => {
    const s = await integrations();
    return s.portaone && s.netsapiens && s.template;
  };
  const read = async (id: string, db: Pool | PoolClient = pool) =>
    (
      await db.query(
        "SELECT data,state FROM telephony.organizations WHERE organization_id=$1",
        [id],
      )
    ).rows[0] as
      | { data: Organization; state: "running" | "failed" | "complete" }
      | undefined;
  const publicStatus = (
    row: Awaited<ReturnType<typeof read>>,
    ready: boolean,
  ): TelephonyStatus =>
    row
      ? {
          configured: ready,
          enabled: !(row.data.termination?.status === "complete"),
          state: row.data.termination?.status === "complete" ? "disabled" : row.state,
          operation: row.data.disabling || row.data.termination ? "disable" : "enable",
          operationStep: row.data.termination?.step ?? null,
          completedSteps: row.data.termination?.completed ?? [],
          portaoneCustomerId: row.data.portaoneId,
          netsapiensDomain: row.data.netsapiensDomain,
          portaoneStep: row.data.portaoneProvisioning?.step ?? null,
          netsapiensStep: row.data.netsapiensProvisioning?.step ?? null,
          aliasCount: row.data.portaoneProvisioning?.aliases.length ?? 0,
          attendantReady:
            row.data.netsapiensProvisioning?.announcement?.complete ?? false,
          message:
            row.state === "failed"
              ? row.data.termination?.error ?? "Provisioning needs attention. Resume to reconcile saved progress; unresolved provider responses require review."
              : null,
        }
      : { ...disabledTelephony, configured: ready };
  const audit = async (
    db: Pool | PoolClient,
    id: string | null,
    actor: string,
    event: string,
  ) => {
    await db.query(
      "INSERT INTO telephony.audit(organization_id,actor_id,event) VALUES($1,$2,$3)",
      [id, actor, event],
    );
  };
  const removalProviders = terminationProviders(po.call.bind(po), ns);
  const scopedStore = (id: string, db: Pool | PoolClient): Store => ({
    organizations: async () => {const row = await read(id, db); return row ? [row.data] : [];},
    portaoneCustomerTemplate: async () => (await vault.get("template")) as PortaoneCustomerTemplate,
    addOrganization: async data => {
      if(data.id !== id) throw Error("Organization scope mismatch");
      await db.query("UPDATE telephony.organizations SET data=$2,updated_at=now() WHERE organization_id=$1", [id,data]);
    },
  });
  const removalPreview = async (id: string, db: Pool | PoolClient = pool): Promise<TelephonyDisablePreview> => {
    const row = await read(id, db);
    if(!row) throw conflict("Telephony is not enabled.");
    if(row.data.termination?.status === "complete") throw conflict("Telephony is already disabled.");
    if(row.state === "running") throw conflict("Wait for the current operation to finish or resume it first.");
    assertRemovable(row.data);
    await removalProviders.inspect(row.data);
    return {action:"terminate",previewHash:removalHash(row.data),description:"This will terminate and then delete the PortaOne customer, then delete the NetSapiens domain and its PBX data. The Platform organization remains.",steps:["Terminate PortaOne customer","Delete PortaOne customer","Delete NetSapiens domain","Verify both systems"]};
  };
  return {
    async enabledOrganizationIds() {
      const rows=await pool.query("SELECT organization_id FROM telephony.organizations WHERE COALESCE(data->'termination'->>'status','') <> 'complete'");
      return rows.rows.map((row:{organization_id:string})=>row.organization_id);
    },
    async previewDisable(record) {
      const id=record.organization_id??record.id,db=await pool.connect();let locked=false;
      try {
        locked=(await db.query("SELECT pg_try_advisory_lock(hashtextextended($1,180026)) AS acquired",[id])).rows[0].acquired;
        if(!locked)throw conflict("A telephony operation is already running.");
        const row=await read(id,db);
        if(row?.state === "running" && row.data.disabling)await db.query("UPDATE telephony.organizations SET state='failed' WHERE organization_id=$1",[id]);
        return await removalPreview(id,db);
      } finally {
        try{if(locked)await db.query("SELECT pg_advisory_unlock(hashtextextended($1,180026))",[id]);db.release();}catch{db.release(true);}
      }
    },
    async disable(record, actor, previewHash) {
      if(closing || starting + tasks.size >= 4) throw conflict("Telephony operations are busy. Try again shortly.");
      starting++;
      const id = record.organization_id ?? record.id;
      let client: PoolClient | undefined, locked = false, handedOff = false;
      const unlock = async () => {
        if(!client) return;
        try {if(locked) await client.query("SELECT pg_advisory_unlock(hashtextextended($1,180026))",[id]);client.release();}
        catch {client.release(true);}
      };
      try {
        if(!(await configured())) throw conflict("Configure both providers before disabling telephony.");
        client = await pool.connect();
        locked = (await client.query("SELECT pg_try_advisory_lock(hashtextextended($1,180026)) AS acquired",[id])).rows[0].acquired;
        if(!locked) throw conflict("A telephony operation is already running.");
        const previous = await read(id,client);
        if(previous?.state === "running" && previous.data.disabling) {
          await client.query("UPDATE telephony.organizations SET state='failed' WHERE organization_id=$1",[id]);
        }
        const preview = await removalPreview(id,client);
        if(preview.previewHash !== previewHash) throw conflict("Provider resources changed. Review the disable confirmation again.");
        const store = scopedStore(id,client);
        const current = (await read(id,client))!.data;
        await client.query("BEGIN");
        try {
          await client.query("UPDATE telephony.organizations SET data=$2,state='running',updated_at=now() WHERE organization_id=$1",[id,{...current,disabling:true}]);
          await audit(client,id,actor,"disable_telephony");await client.query("COMMIT");
        } catch(e) {await client.query("ROLLBACK");throw e;}
        const db = client;
        const run = async () => {
          try {
            const result = await runTermination(store,id,actor,removalProviders);
            if(result.termination?.status !== "complete") throw Error("Disable needs attention");
            await db.query("UPDATE telephony.organizations SET state='complete',updated_at=now() WHERE organization_id=$1",[id]);
            await audit(db,id,actor,"telephony_disabled");
          } catch {
            await db.query("UPDATE telephony.organizations SET state='failed',updated_at=now() WHERE organization_id=$1",[id]);
            await audit(db,id,actor,"telephony_disable_failed");
          } finally {await unlock();}
        };
        handedOff = true;
        const task = run().catch(() => {console.warn("Telephony disable interrupted; resume required");});
        tasks.add(task);void task.finally(() => tasks.delete(task));
        return publicStatus({data:{...current,disabling:true},state:"running"},true);
      } finally {starting--;if(!handedOff) await unlock();}
    },
    async resources(id,provider,section){
      const saved=await read(id);
      if(!saved || saved.data.termination?.status === "complete")throw Object.assign(Error('Telephony is not enabled'),{statusCode:404});
      if(provider==='portaone')return saved.data.portaoneId?portaoneResources(id,saved.data.portaoneId,section,po.call.bind(po)):pendingResources('PortaOne');
      return saved.data.netsapiensDomain?ns.resources(saved.data.netsapiensDomain,section):pendingResources('NetSapiens');
    },
    integrations,
    async test(provider) {
      if (provider === "portaone") await po.test();
      else await ns.refresh(true);
    },
    async configure(provider, input, actor) {
      await (provider === "portaone"
        ? po.configure(input)
        : ns.configure(input));
      await audit(pool, null, actor, `configure_${provider}`);
    },
    async captureTemplate(actor) {
      const template = await po.captureTemplate();
      await vault.put("template", template);
      await audit(pool, null, actor, "capture_template");
    },
    async status(id) {
      const result = publicStatus(await read(id), await configured());
      if (result.state === "running") {
        const client = await pool.connect();
        let acquired = false;
        try {
          acquired = (
            await client.query(
              "SELECT pg_try_advisory_lock(hashtextextended($1,180026)) AS acquired",
              [id],
            )
          ).rows[0].acquired;
          if (acquired) {
            result.state = "interrupted";
            result.message =
              "Provisioning was interrupted. Resume to verify saved progress.";
          }
        } finally {
          try {
            if (acquired)
              await client.query(
                "SELECT pg_advisory_unlock(hashtextextended($1,180026))",
                [id],
              );
            client.release();
          } catch {
            client.release(true);
          }
        }
      }
      return result;
    },
    async enable(record, actor) {
      if (starting + tasks.size >= 4)
        throw conflict("Telephony provisioning is busy. Try again shortly.");
      starting++;
      try {
        if (closing) throw conflict("Server is restarting.");
        if (!(await configured()))
          throw conflict("Configure both providers and the template first.");
        if (record.status !== "active")
          throw conflict("Only active organizations can enable telephony.");
        const id = record.organization_id ?? record.id;
        const client = await pool.connect();
        let handedOff = false,
          locked = false;
        const unlock = async () => {
          try {
            if (locked)
              await client.query(
                "SELECT pg_advisory_unlock(hashtextextended($1,180026))",
                [id],
              );
            client.release();
          } catch {
            client.release(true);
          }
        };
        try {
          locked = (
            await client.query(
              "SELECT pg_try_advisory_lock(hashtextextended($1,180026)) AS acquired",
              [id],
            )
          ).rows[0].acquired;
          if (!locked) throw conflict("Provisioning is already running.");
          const previous = await read(id, client);
          const removed = previous?.data.termination?.status === "complete";
          if(previous && !removed && (previous.data.disabling || previous.data.termination)) throw conflict("Finish disabling telephony before enabling it again.");
          if (previous?.state === "complete" && !removed)
            return publicStatus(previous, true);
          const template = (await vault.get(
            "template",
          )) as PortaoneCustomerTemplate;
          const org: Organization = (removed ? undefined : previous?.data) ?? {
            id,
            name: record.name,
            createdAt: new Date().toISOString(),
            portaoneId: null,
            netsapiensDomain: null,
            contact: editableContactSchema.parse({
              companyName: record.name,
              firstName: "",
              lastName: "",
              contactPerson: "",
              phone: record.phones?.[0] ?? "",
              email: record.email ?? "",
              country: record.country ?? "",
              addressLine1: record.street ?? "",
              addressLine2: "",
              city: record.city ?? "",
              state: record.state ?? "",
              postalCode: record.postal_code ?? "",
            }),
          };
          if(removed && previous) org.lifecycleHistory = [...(previous.data.lifecycleHistory ?? []), {portaoneId:previous.data.portaoneId,netsapiensDomain:previous.data.netsapiensDomain,...(previous.data.termination ? {termination:previous.data.termination} : {})}];
          newPortaoneCustomerInfo(org, template);
          // Every checkpoint commits before the next external write. Never wrap the
          // full provider sequence in a transaction which could roll back its intents.
          const store: Store = {
            organizations: async () => [(await read(id, client))!.data],
            portaoneCustomerTemplate: async () => template,
            addOrganization: async (data) => {
              if (data.id !== id) throw Error("Organization scope mismatch");
              await client.query(
                "UPDATE telephony.organizations SET data=$2,updated_at=now() WHERE organization_id=$1",
                [id, data],
              );
            },
          };
          await client.query("BEGIN");
          try {
            await client.query(
              "INSERT INTO telephony.organizations(organization_id,data,state) VALUES($1,$2,'running') ON CONFLICT(organization_id) DO UPDATE SET data=EXCLUDED.data,state='running',updated_at=now()",
              [id, org],
            );
            await audit(client, id, actor, "enable_telephony");
            await client.query("COMMIT");
          } catch (e) {
            await client.query("ROLLBACK");
            throw e;
          }
          const run = async () => {
            try {
              const proof = await provisionPortaoneOrganization(
                store,
                id,
                { confirmed: true },
                po.call.bind(po),
              );
              await provisionNetsapiensOrganization(
                store,
                id,
                { confirmed: true, options: defaultNetsapiensOptions },
                ns,
                po.call.bind(po),
                proof,
              );
              await client.query("BEGIN");
              await client.query(
                "UPDATE telephony.organizations SET state='complete',updated_at=now() WHERE organization_id=$1",
                [id],
              );
              await audit(client, id, actor, "telephony_complete");
              await client.query("COMMIT");
            } catch {
              await client.query("ROLLBACK").catch(() => {});
              await client.query("BEGIN");
              await client.query(
                "UPDATE telephony.organizations SET state='failed',updated_at=now() WHERE organization_id=$1",
                [id],
              );
              await audit(client, id, actor, "telephony_failed");
              await client.query("COMMIT");
            } finally {
              await unlock();
            }
          };
          handedOff = true;
          const task = run().catch(() => {
            console.warn("Telephony provisioning interrupted; resume required");
          });
          tasks.add(task);
          void task.finally(() => tasks.delete(task));
          return publicStatus({ data: org, state: "running" }, true);
        } finally {
          if (!handedOff) await unlock();
        }
      } finally {
        starting--;
      }
    },
    async close() {
      closing = true;
      await Promise.allSettled([...tasks]);
    },
  };
}
