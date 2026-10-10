export const VERSION='formal-three-01';
export const UI_REVISION='formal-three-huixiang-05';
export const PRACTICE_COUNT=4, BLOCK_COUNT=12, MAIN_COUNT=36, TOTAL_COUNT=40, RECALL_COUNT=3;
export const CONFIDENCE_ANCHORS={min:'完全不确定',max:'非常确定'};
export function answerLabel(r){return `${r.response===0?'正确':'错误'} · 确定程度 ${r.confidence}/7`;}
const check=(ok,message)=>{if(!ok)throw Error(message);};
// JSONB may reorder object keys. Array order remains part of the frozen protocol.
const canonicalJSON=v=>JSON.stringify(v,(_k,x)=>x&&typeof x==='object'&&!Array.isArray(x)?Object.fromEntries(Object.keys(x).sort().map(k=>[k,x[k]])):x);
const iso=n=>new Date(n).toISOString();
export function answerParts(response,confidence){check(response===0||response===1,'请选择正确或错误。');check(Number.isInteger(confidence)&&confidence>=1&&confidence<=7,'请选择 1–7 的确定程度。');return {response,confidence,error_score:response===1?7+confidence:8-confidence};}
export function holdLabels(kind,view){return {current:view==='prototype'?'当前：模型原型':'当前：照片局部',button:view==='prototype'?'正在查看模型原型 · 松开返回':'按住查看模型原型',pressed:view==='prototype'};}
export function shuffle(values,seedText){let seed=2166136261;for(const c of seedText){seed^=c.charCodeAt(0);seed=Math.imul(seed,16777619);}seed=seed>>>0||1;const out=[...values];for(let i=out.length-1;i>0;i--){seed^=seed<<13;seed^=seed>>>17;seed^=seed<<5;const j=Math.floor((seed>>>0)/4294967296*(i+1));[out[i],out[j]]=[out[j],out[i]];}return out;}
export function scheduleFor(packet,a){
  const v=packet.variants.find(v=>v.variant===a.variant),form=packet.forms[a.form];check(v&&form&&v.form===a.form,'分派无效。');
  const order=v.blocks.map(b=>b.layout).filter(l=>l!=='B');
  const practice=order.map(l=>shuffle(packet.practice.filter(p=>p.layout===l),`${packet.seed}-${a.code}-practice-${l}`));
  check(practice.every(rows=>rows.length===2&&rows.filter(r=>r.practice_answer===0).length===1&&rows.filter(r=>r.practice_answer===1).length===1),'练习分派无效。');
  const result=[];for(let i=0;i<2;i++)for(let j=0;j<2;j++)result.push({id:practice[j][i].id,layout:order[j],kind:'practice',set_id:'practice',block_index:0});
  return result.concat(v.blocks.flatMap((b,index)=>shuffle(form[b.group],`${packet.seed}-${a.code}-${b.group}`).map(id=>({id,layout:b.layout,kind:'main',set_id:b.group,block_index:index+1}))));
}
const fresh=()=>({response:null,confidence:null,readyAt:null,interrupted:false,view:'query',viewAt:null,queryMs:0,prototypeMs:0,toggles:0,firstToggleMs:null});
const freshRecall=()=>({basis:'',cannotRecall:false});
function log(s,type,now,detail={}){s.events.push({index:s.events.length+1,at:iso(now),phase:s.phase,item_id:s.phase==='recall'?s.recallIds[s.recalls.length]||'':s.schedule[s.index]?.id||'',type,...detail});s.updatedAt=iso(now);}
export function createSession(packet,{code,birdExperience,sessionId,dataKind='study'},now=Date.now()){
  check(packet.version===VERSION&&packet.counts.cases===TOTAL_COUNT&&packet.counts.main===MAIN_COUNT&&packet.counts.practice===PRACTICE_COUNT&&packet.counts.optional_recall===RECALL_COUNT,'材料版本不匹配。');check(['yes','no'].includes(birdExperience),'请选择是否有鸟类辨识经验。');check(['study','software-test'].includes(dataKind),'记录用途无效。');
  const a=packet.allocation.find(x=>x.code===code);check(a,'分派无效。');const schedule=scheduleFor(packet,a);
  const recallIds=packet.variants.find(v=>v.variant===a.variant).blocks.map(b=>shuffle(schedule.filter(t=>t.kind==='main'&&t.layout===b.layout),`${packet.seed}-${code}-recall-${b.layout}`)[0].id);
  const s={version:VERSION,materialSha:packet.material_sha,sessionId,participant:code,dataKind,allocation:{...a},profile:{birdExperience},responseFormat:'binary-plus-confidence7',timingDefinition:'available-images-ready-to-submit;whole-trial',startedAt:iso(now),updatedAt:iso(now),mainCompletedAt:null,completedAt:null,schedule,phase:'task',index:0,rows:[],draft:fresh(),recallIds,recallDraft:freshRecall(),recalls:[],events:[]};log(s,'session_started',now);return s;
}
export function activeTrial(s){return s.schedule[s.index];}
function closeView(d,now){if(d.viewAt!==null){d[d.view==='query'?'queryMs':'prototypeMs']+=Math.max(0,now-d.viewAt);d.viewAt=null;}}
function nextPhase(s){s.phase=s.index===PRACTICE_COUNT?'main_intro':s.index===TOTAL_COUNT?'recall_intro':s.index>PRACTICE_COUNT&&(s.index-PRACTICE_COUNT)%BLOCK_COUNT===0?'break':'task';}
export function transition(state,a,now=Date.now()){
  const s=structuredClone(state),t=activeTrial(s),d=s.draft;
  if(a.type==='UI_BUILD'){if(s.uiRevision!==UI_REVISION){log(s,'ui_revision',now,{from:s.uiRevision||'initial',to:UI_REVISION});s.uiRevision=UI_REVISION;}return s;}
  if(['BLUR','HIDDEN','RESUME','PAUSE','RESIZE'].includes(a.type)){if(s.phase==='task'){closeView(d,now);d.interrupted=true;d.view='query';d.viewAt=null;d.readyAt=null;}log(s,a.type.toLowerCase(),now);return s;}
  if(a.type==='EXPORT'){log(s,'export',now,{format:a.format});return s;}
  if(a.type==='READY'){check(['task','recall'].includes(s.phase),'当前无题目。');if(s.phase==='task'&&d.readyAt===null){d.readyAt=now;d.viewAt=now;}log(s,'available_images_ready_proxy',now,{viewport:a.viewport,dimensions:a.dimensions});return s;}
  if(a.type==='ANSWER'){
    check(s.phase==='task'&&d.readyAt!==null,'请等待图片准备完成。');
    if(a.field==='response'){
      check(a.value===0||a.value===1,'请选择正确或错误。');
      if(d.response!==a.value&&d.confidence!==null){d.confidence=null;log(s,'confidence_cleared_after_decision_change',now);}
      d.response=a.value;
    }else{check(a.field==='confidence'&&d.response!==null,'请先选择正确或错误。');answerParts(d.response,a.value);d.confidence=a.value;}
    log(s,a.field+'_changed',now,{value:a.value});return s;
  }
  if(a.type==='VIEW'){check(s.phase==='task'&&d.readyAt!==null&&t.layout==='L3','当前不可切换。');check(['query','prototype'].includes(a.view),'视图无效。');if(d.view===a.view)return s;closeView(d,now);d.view=a.view;d.viewAt=now;if(a.view==='prototype'){d.toggles++;if(d.firstToggleMs===null)d.firstToggleMs=Math.max(0,now-d.readyAt);}log(s,'view_changed',now,{view:a.view});return s;}
  if(a.type==='SUBMIT'){
    check(s.phase==='task'&&d.readyAt!==null,'请等待图片准备完成。');const score=answerParts(d.response,d.confidence);closeView(d,now);const valid=!d.interrupted&&now>=d.readyAt;
    s.rows.push({participant:s.participant,session_id:s.sessionId,data_kind:s.dataKind,app_version:VERSION,ui_revision:s.uiRevision||UI_REVISION,material_sha:s.materialSha,item_id:t.id,set_id:t.set_id,layout:t.layout,block_index:t.block_index,order_sequence:s.allocation.variant,form:s.allocation.form,trial_type:t.kind,position:s.index+1,...score,response_format:'binary-plus-confidence7',abstain_would:null,ready_at:iso(d.readyAt),submitted_at:iso(now),timing_interrupted:d.interrupted,response_total_ms:valid?now-d.readyAt:null,rt_decision_ms:null,rt_confidence_ms:null,rt_request_ms:null,toggle_count:t.layout==='L3'?d.toggles:0,first_toggle_ms:t.layout==='L3'&&valid?d.firstToggleMs:null,dwell_query_ms:t.layout==='L3'&&valid?d.queryMs:null,dwell_proto_ms:t.layout==='L3'&&valid?d.prototypeMs:null,interaction_window:'available-images-ready-to-submit'});
    log(s,'trial_submitted',now);s.index++;s.draft=fresh();if(s.index===TOTAL_COUNT)s.mainCompletedAt=iso(now);if(t.kind==='practice')s.phase='practice_feedback';else nextPhase(s);return s;
  }
  if(a.type==='CONTINUE'){check(['practice_feedback','main_intro','break','recall_intro'].includes(s.phase),'当前不能继续。');const from=s.phase;log(s,'continue',now);if(from==='practice_feedback')nextPhase(s);else s.phase=from==='recall_intro'?'recall':'task';return s;}
  if(a.type==='RECALL'){check(s.phase==='recall','当前不能填写回顾。');check(a.field==='basis'?typeof a.value==='string'&&a.value.length<=600:a.field==='cannotRecall'&&typeof a.value==='boolean','回顾内容无效。');s.recallDraft[a.field]=a.value;s.updatedAt=iso(now);return s;}
  if(['SUBMIT_RECALL','SKIP_RECALL','SKIP_ALL_RECALLS'].includes(a.type)){
    const all=a.type==='SKIP_ALL_RECALLS',skipped=a.type!=='SUBMIT_RECALL';check(all?s.phase==='recall_intro':s.phase==='recall','当前不能提交回顾。');if(!skipped)check(s.recallDraft.basis.trim()||s.recallDraft.cannotRecall,'请写一句依据，或选择跳过。');
    for(let i=0,n=all?RECALL_COUNT-s.recalls.length:1;i<n;i++){const id=s.recallIds[s.recalls.length];s.recalls.push({item_id:id,layout:s.rows.find(r=>r.item_id===id&&r.trial_type==='main').layout,...(skipped?freshRecall():s.recallDraft),skipped,submitted_at:iso(now)});}
    log(s,skipped?'recall_skipped':'recall_submitted',now);s.recallDraft=freshRecall();if(s.recalls.length===RECALL_COUNT){s.phase='complete';s.completedAt=iso(now);log(s,'session_completed',now);}return s;
  }
  throw Error('未知操作。');
}
export function validateSession(s,packet){
  check(s&&s.version===VERSION&&s.materialSha===packet.material_sha,'记录版本或材料不匹配。');check(typeof s.sessionId==='string'&&/^[a-zA-Z0-9_-]{8,100}$/.test(s.sessionId),'场次编号无效。');
  const a=packet.allocation.find(p=>p.code===s.participant);check(a&&canonicalJSON(a)===canonicalJSON(s.allocation),'分派记录不匹配。');
  if(s.cloudSession)check(typeof s.platformId==='string'&&/^[A-Za-z0-9_-]{1,40}$/.test(s.platformId)&&s.platformTaskId==='202610118100','平台编号无效。');
  const canonical=createSession(packet,{code:s.participant,birdExperience:s.profile?.birdExperience,sessionId:s.sessionId,dataKind:s.dataKind},0);
  check(s.responseFormat===canonical.responseFormat&&s.timingDefinition===canonical.timingDefinition,'回答或计时定义不匹配。');
  check(canonicalJSON(s.schedule)===canonicalJSON(canonical.schedule)&&canonicalJSON(s.recallIds)===canonicalJSON(canonical.recallIds),'题目或回顾分派不匹配。');
  check(Array.isArray(s.rows)&&s.index===s.rows.length&&s.index<=TOTAL_COUNT,'记录数量无效。');
  s.rows.forEach((r,i)=>{const t=s.schedule[i],score=answerParts(r.response,r.confidence);check(r.participant===s.participant&&r.session_id===s.sessionId&&r.data_kind===s.dataKind&&r.app_version===VERSION&&r.material_sha===s.materialSha&&r.item_id===t.id&&r.layout===t.layout&&r.trial_type===t.kind&&r.position===i+1&&r.set_id===t.set_id&&r.block_index===t.block_index&&r.order_sequence===a.variant&&r.form===a.form&&['formal-three-practice4-01','formal-three-practice4-02','formal-three-cloud-03','formal-three-huixiang-04',UI_REVISION].includes(r.ui_revision),'题目记录不匹配。');check(Object.entries(score).every(([k,v])=>r[k]===v)&&r.response_format==='binary-plus-confidence7'&&r.abstain_would===null,'评分不匹配。');check(typeof r.timing_interrupted==='boolean'&&['response_total_ms','first_toggle_ms','dwell_query_ms','dwell_proto_ms'].every(k=>r[k]===null||Number.isFinite(r[k])&&r[k]>=0)&&Number.isInteger(r.toggle_count)&&r.toggle_count>=0,'计时或操作记录无效。');check(r.layout==='L3'||(r.toggle_count===0&&['first_toggle_ms','dwell_query_ms','dwell_proto_ms'].every(k=>r[k]===null)),'此条件没有切换记录。');check(!r.timing_interrupted||['response_total_ms','first_toggle_ms','dwell_query_ms','dwell_proto_ms'].every(k=>r[k]===null),'中断时长无效。');check(['rt_decision_ms','rt_confidence_ms','rt_request_ms'].every(k=>r[k]===null),'本版无分段计时。');check(Number.isFinite(Date.parse(r.ready_at))&&Number.isFinite(Date.parse(r.submitted_at)),'时间无效。');});
  check(s.draft&&[null,0,1].includes(s.draft.response)&&[null,1,2,3,4,5,6,7].includes(s.draft.confidence)&&(s.draft.confidence===null||s.draft.response!==null)&&typeof s.draft.interrupted==='boolean'&&['query','prototype'].includes(s.draft.view),'草稿无效。');
  const validRecall=r=>r&&typeof r.basis==='string'&&r.basis.length<=600&&typeof r.cannotRecall==='boolean';check(Array.isArray(s.recalls)&&s.recalls.length<=RECALL_COUNT&&validRecall(s.recallDraft),'回顾无效。');
  s.recalls.forEach((r,i)=>check(validRecall(r)&&typeof r.skipped==='boolean'&&(r.skipped?(!r.basis&&!r.cannotRecall):(r.basis.trim()||r.cannotRecall))&&r.item_id===s.recallIds[i]&&r.layout===s.schedule.find(t=>t.id===r.item_id).layout,'回顾记录不匹配。'));
  const phases={task:s.index<TOTAL_COUNT,practice_feedback:s.index>=1&&s.index<=PRACTICE_COUNT,main_intro:s.index===PRACTICE_COUNT,break:s.index>PRACTICE_COUNT&&s.index<TOTAL_COUNT&&(s.index-PRACTICE_COUNT)%BLOCK_COUNT===0,recall_intro:s.index===TOTAL_COUNT&&s.recalls.length===0,recall:s.index===TOTAL_COUNT&&s.recalls.length<RECALL_COUNT,complete:s.index===TOTAL_COUNT&&s.recalls.length===RECALL_COUNT};check(phases[s.phase]&&(s.index===TOTAL_COUNT||s.recalls.length===0),'执行阶段无效。');
  check(['startedAt','updatedAt'].every(k=>Number.isFinite(Date.parse(s[k])))&&(s.index===TOTAL_COUNT?Number.isFinite(Date.parse(s.mainCompletedAt)):s.mainCompletedAt===null)&&(s.phase==='complete'?Number.isFinite(Date.parse(s.completedAt)):s.completedAt===null),'场次时间无效。');
  check(Array.isArray(s.events)&&s.events.length<100000&&s.events.every((e,i)=>e.index===i+1&&typeof e.type==='string'),'事件记录无效。');check(s.dataKind==='software-test'||!s.previewSeededRows,'演示记录不能作为研究数据。');return s;
}
export function csv(rows){const fields=[...new Set(rows.flatMap(r=>Object.keys(r)))];const cell=v=>'"'+(typeof v==='string'&&/^[\s]*[=+@-]/.test(v)?"'"+v:String(v??'')).replaceAll('"','""')+'"';return '\uFEFF'+[fields,...rows.map(r=>fields.map(k=>r[k]))].map(r=>r.map(cell).join(',')).join('\r\n')+'\r\n';}
