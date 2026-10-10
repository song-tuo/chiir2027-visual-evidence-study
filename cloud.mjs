// Only a public API key enters the webpage. The per-session token never enters exports.
export class CloudStore {
  constructor(config,kind,onStatus){this.config=config;this.kind=kind;this.onStatus=onStatus;this.key=`chiir-cloud-token-v2:${kind}`;this.pending=null;this.busy=false;this.timer=null;this.confirmed=null;this.stopped=false;}
  credential(){
    let token=localStorage.getItem(this.key);
    if(!token){token=Array.from(crypto.getRandomValues(new Uint8Array(32)),x=>x.toString(16).padStart(2,'0')).join('');localStorage.setItem(this.key,token);}
    return token;
  }
  async rpc(name,args){
    const response=await fetch(this.config.url+'/rest/v1/rpc/'+name,{method:'POST',headers:{'apikey':this.config.publishableKey,'Content-Type':'application/json'},body:JSON.stringify(args),signal:AbortSignal.timeout(15000)});
    const body=await response.json();
    if(!response.ok){const e=Error(body.message||'Cloud save failed');e.status=response.status;throw e;}
    return body;
  }
  async start(experience,platformId){return this.rpc('chiir_start_session',{p_token:this.credential(),p_kind:this.kind,p_experience:experience,p_consent:'chiir-consent-02',p_platform_id:platformId});}
  async resume(){const token=localStorage.getItem(this.key);return token?this.rpc('chiir_resume_session',{p_token:token}):null;}
  queue(record,immediate=false){
    this.pending=structuredClone(record);this.onStatus({state:'pending',record});
    clearTimeout(this.timer);this.timer=setTimeout(()=>this.flush(),immediate?0:350);
  }
  async flush(){
    if(this.busy||!this.pending||this.stopped)return;
    this.busy=true;const record=this.pending;this.pending=null;
    try{
      const result=await this.rpc('chiir_save_record',{p_token:this.credential(),p_record:record});
      if(result.revision!==record.cloudRevision||result.rows!==record.rows.length)throw Error('record conflict');
      this.confirmed={...result,sessionId:record.sessionId};this.onStatus({state:'saved',...this.confirmed});
    }catch(error){
      if(!this.pending||this.pending.cloudRevision<record.cloudRevision)this.pending=record;
      const conflict=/conflict|regression|changed|mismatch|invalid/.test(error.message);
      if(conflict)this.stopped=true;
      this.onStatus({state:conflict?'conflict':'offline',error:error.message});
    }finally{
      this.busy=false;
      if(this.pending&&!this.stopped){clearTimeout(this.timer);this.timer=setTimeout(()=>this.flush(),this.confirmed?.revision===record.cloudRevision?50:5000);}
    }
  }
}
