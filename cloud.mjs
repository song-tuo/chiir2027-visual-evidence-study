// Only a public API key enters the webpage. The per-session token never enters exports.
export const TRANSPORT_REVISION='connection-01';
function transportError(code,message,status){const error=Error(message);error.code=code;if(status)error.status=status;return error;}
export function startErrorCode(error){return error.code||(/mismatch/.test(error.message)?'SESSION':'CLIENT');}
export function startErrorMessage(error){
  if(/already used/.test(error.message))return '这个回响用户ID已使用，请回到原来的浏览器继续，或联系研究者。';
  if(/full/.test(error.message))return '目前名额已满，请联系研究者。';
  if(/not open/.test(error.message))return '研究尚未开放，请稍后再试。';
  if(/mismatch/.test(error.message))return '当前浏览器已有不同的作答登记，请联系研究者核对；请勿清除浏览器记录。';
  return ({STORAGE:'浏览器不允许保存作答进度，请允许此网站使用本机存储后重试。',BROWSER:'当前浏览器缺少所需功能，请使用新版 Chrome、Edge 或 Safari 打开。',TIMEOUT:'连接数据服务超时，请稍后重试。若仍失败，请打开下方连接检查。',NETWORK:'未能连接数据服务，请打开下方连接检查，并把结果发给研究者。',RESPONSE:'数据服务返回异常，请稍后重试；若仍失败，请把下方错误编号发给研究者。',SERVER:'数据服务暂未接受请求，请把下方错误编号发给研究者。'})[error.code]||'开始作答时发生异常，请把下方错误编号发给研究者。';
}
export class CloudStore {
  constructor(config,kind,onStatus){this.config=config;this.kind=kind;this.onStatus=onStatus;this.key=`chiir-cloud-token-v2:${kind}`;this.pending=null;this.busy=false;this.timer=null;this.confirmed=null;this.stopped=false;}
  credential(){
    let token;
    try{token=localStorage.getItem(this.key);}catch{throw transportError('STORAGE','Browser storage unavailable');}
    if(!token){
      if(!globalThis.crypto?.getRandomValues)throw transportError('BROWSER','Secure random generation unavailable');
      token=Array.from(crypto.getRandomValues(new Uint8Array(32)),x=>x.toString(16).padStart(2,'0')).join('');
      try{localStorage.setItem(this.key,token);}catch{throw transportError('STORAGE','Browser storage unavailable');}
    }
    return token;
  }
  async rpc(name,args){
    if(typeof fetch!=='function'||typeof AbortController!=='function')throw transportError('BROWSER','Request API unavailable');
    const controller=new AbortController();let timedOut=false;
    const timer=setTimeout(()=>{timedOut=true;controller.abort();},15000);
    try{
      const response=await fetch(this.config.url+'/rest/v1/rpc/'+name,{method:'POST',headers:{'apikey':this.config.publishableKey,'Content-Type':'application/json'},body:JSON.stringify(args),signal:controller.signal});
      let body;
      try{body=await response.json();}catch{throw transportError(timedOut?'TIMEOUT':'RESPONSE','Data response unavailable',response.status);}
      if(!response.ok)throw transportError('SERVER',body?.message||'Cloud save failed',response.status);
      return body;
    }catch(error){if(typeof error.code==='string')throw error;throw transportError(timedOut?'TIMEOUT':'NETWORK',timedOut?'Request timed out':'Data service unreachable');}
    finally{clearTimeout(timer);}
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
