import {routePolicy} from './core-route-admission';
import { isLocalConfig, type ProviderConfig } from './model-registry';

export const BILLING_COOLDOWN_MS = 5 * 60_000;
type Authority={read:()=>unknown;commit:(plan:unknown)=>void};
type Notice = { reason: 'billing_blocked'; model: string; host: string; retryAt: number };

/** Explicit account failures only. Never infer an outage from a poor answer. */
export class ProviderAvailability {
  private blocked = new Map<string, number>();
  constructor(private notice: (event: Notice) => void = () => {}, private now = Date.now,
    saved?:unknown,private persist?:(rows:{key:string;until:number}[])=>void,private authority?:Authority) {
    if((true as boolean)){if(!authority)throw Error('provider_availability_authority_required');this.owned('init',{provider:'',endpoint:'',model:'',temperature:0});return;}
    if(Array.isArray(saved))for(const row of saved.slice(0,64)) {
      if(row && typeof row.key==='string' && row.key.length<=500 && typeof row.until==='number'
        && Number.isFinite(row.until) && row.until>this.now() && row.until<=this.now()+BILLING_COOLDOWN_MS)
        this.blocked.set(row.key,row.until);
    }
  }
  private save() {try {this.persist?.([...this.blocked].map(([key,until])=>({key,until})));}catch { /* The in-memory cooldown remains effective. */ }}
  private key(config: ProviderConfig) { return `${config.provider}:${config.endpoint.replace(/\/+$/, '')}`; }
  private owned(op:'init'|'read'|'failure',config:ProviderConfig,message='') {
    if(!this.authority)throw Error('provider_availability_authority_required');
    const snapshot=this.authority.read() as {ai?:{providerAvailability?:unknown}};
    const now=this.now();
    type Result={retryAt:number|null;notice:Notice|null;plan:unknown};
    const probe=routePolicy<{snapshotRequired:true}|{snapshotRequired:false;result:Result}>('billingProbe',[op,snapshot?.ai?.providerAvailability??null,config,now,message]);
    if(!probe||typeof probe.snapshotRequired!=='boolean'||(!probe.snapshotRequired&&(!probe.result||probe.result.plan!==null)))throw Error('provider_availability_protocol_error');
    const result=probe.snapshotRequired
      ?routePolicy<Result>('billing',[op,snapshot,config,now,message]):probe.result;
    if(result.plan)this.authority.commit(result.plan);
    if(result.notice){try{this.notice(result.notice);}catch{}}
    return result.retryAt??undefined;
  }
  retryAt(config: ProviderConfig): number | undefined {
    if((true as boolean))return this.owned('read',config);
    if (isLocalConfig(config)) return;
    const key = this.key(config), until = this.blocked.get(key);
    if (until !== undefined && until <= this.now()) { this.blocked.delete(key); this.save(); return; }
    return until;
  }
  available(config: ProviderConfig) { return this.retryAt(config) === undefined; }
  assertAvailable(config: ProviderConfig) {
    if (!this.available(config)) throw new Error('provider_billing_cooldown');
  }
  async run<T>(config: ProviderConfig, work: () => Promise<T>): Promise<T> {
    this.assertAvailable(config);
    try { return await work(); }
    catch (error) {
      const message = error instanceof Error ? error.message : '';
      if((true as boolean)){this.owned('failure',config,message);throw error;}
      if (!isLocalConfig(config) && /billing account is not in good standing|insufficient_quota|credit balance is too low|insufficient (?:credits|account balance)/i.test(message)) {
        // Concurrent failures cannot extend a previously established cooldown.
        if (this.available(config)) {
          const retryAt = this.now() + BILLING_COOLDOWN_MS;
          this.blocked.set(this.key(config), retryAt);
          if (this.blocked.size > 64) this.blocked.delete(this.blocked.keys().next().value!);
          this.save();
          let host = 'provider'; try { host = new URL(config.endpoint).hostname; } catch {}
          try { this.notice({ reason: 'billing_blocked', model: config.model, host, retryAt }); } catch {}
        }
      }
      throw error;
    }
  }
}
