import {CloudStore} from './cloud.mjs';
import {VERSION,TOTAL_COUNT,PRACTICE_COUNT,MAIN_COUNT,RECALL_COUNT,createSession,transition,validateSession,activeTrial,csv,holdLabels,answerLabel,CONFIDENCE_ANCHORS} from './model.mjs';
const packet=JSON.parse(document.getElementById('study-data').textContent),items=Object.fromEntries([...packet.main,...packet.practice].map(t=>[t.id,t]));
const params=new URLSearchParams(location.search),demo=params.get('demo'),localHost=['localhost','127.0.0.1','[::1]'].includes(location.hostname),preview=localHost||params.get('preview')==='1'||['B','L1','L3','recall'].includes(demo),dataKind=preview?'software-test':'study',prefix=`visual-evidence-formal-three-v1:${dataKind}:${demo||'full'}:`,app=document.getElementById('app');
const cloudConfig=JSON.parse(document.getElementById('cloud-config').textContent),cloudEnabled=!!cloudConfig.url&&(!preview||params.get('cloud-test')==='1'),cloud=cloudEnabled?new CloudStore(cloudConfig,dataKind,cloudStatus):null;
let cloudState={state:'pending'},prepareGeneration=0,pageFocused=true;
const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
let state=null,lastRaw=null,renderToken=0,storageOK=true,conflict=false,ready=false,noticeTimer;const memory=new Map();
function notify(text){clearTimeout(noticeTimer);document.getElementById('notice').textContent=text;noticeTimer=setTimeout(()=>document.getElementById('notice').textContent='',6000);}
function read(key){try{return localStorage.getItem(key)||memory.get(key)||null;}catch{storageOK=false;return memory.get(key)||null;}}
function saved(){const keys=new Set(memory.keys());try{for(let i=0;i<localStorage.length;i++){const k=localStorage.key(i);if(k.startsWith(prefix))keys.add(k);}}catch{storageOK=false;}return [...keys].flatMap(k=>{try{return [validateSession(JSON.parse(read(k)),packet)];}catch{return [];}}).sort((a,b)=>b.startedAt.localeCompare(a.startedAt));}
function save(){if(!state||conflict)return false;const key=prefix+state.sessionId,current=read(key);if(current!==null&&current!==lastRaw){conflict=true;document.getElementById('conflict').showModal();return false;}
  if(cloud&&state.cloudSession)state.cloudRevision=(state.cloudRevision||0)+1;
  const raw=JSON.stringify(state);memory.set(key,raw);try{localStorage.setItem(key,raw);storageOK=true;}catch{storageOK=false;}lastRaw=raw;try{sessionStorage.setItem(prefix+'active',state.sessionId);}catch{}storageBanner();if(cloud&&state.cloudSession)cloud.queue(state,state.phase==='complete'||state.rows.length>(cloud.confirmed?.rows||0));return true;}
function storageBanner(){const el=document.getElementById('storage-warning');if(el){el.hidden=storageOK;el.innerHTML='本机存储不可用，请勿关闭或刷新此页。<button class="text-button" id="backup-record">下载备份</button>';el.querySelector('#backup-record').onclick=()=>exportFile('json',true);}}
function act(a,redraw=true){if(!state||conflict)return false;try{state=transition(state,a);if(!save())return false;if(redraw)render();return true;}catch(e){notify(e.message);return false;}}
function allocation(){if(cloud)return packet.allocation[0];const used=new Set(saved().map(s=>s.participant)),code=params.get('p'),variant=params.get('v');if(code)return packet.allocation.find(p=>p.code===code&&!used.has(code));return packet.allocation.find(p=>(!variant||p.variant===variant)&&!used.has(p.code));}
function intro(){const a=allocation();return `<section class="simple-intro"><h1>判断 AI 有没有认对鸟</h1><p class="intro-lead">共 40 道看图题：4 道练习＋36 道正式题。请判断 AI 给出的鸟种名称是否正确；<br>不需要说出正确鸟种，也不需要逐题写理由。</p><dl class="material-guide"><div><dt>鸟种参考照片</dt><dd>右侧带标签的照片，供你了解该鸟种的部分外观。</dd></div><div><dt>模型局部图</dt><dd>部分题目还提供局部线索，可能来自其他鸟种。两块局部图相似，不等于名称正确。出现切换按钮时，按住查看另一张图，松开返回。</dd></div></dl><p class="instruction-line">每题在同一页选择<strong>正确／错误</strong>，再回答<strong>你对上述判断有多确定</strong>。不确定时，先选择目前的倾向，再给出较低的确定程度。</p><p class="study-length">正式题分 3 组，每组 12 题，组间可休息。请根据本题可见的信息独立作答，不查外部资料；练习会说明答案，正式题不公布答案。最后可回看 3 个案例，各写一句依据，也可以跳过。</p><p class="consent-info">参与自愿，可随时关闭网页退出。回答及操作记录以随机场次编号保存，用于学术研究；未完成的记录也会保留。请勿在回顾中填写个人信息。联系：<a href="mailto:songdong.design@gmail.com">songdong.design@gmail.com</a>。点击“开始作答”表示已阅读说明并同意参加。</p>${a?`<form id="start"><fieldset class="experience-question"><legend>你有没有鸟类辨识经验？</legend><div class="choices">${['no','yes'].map((v,i)=>`<label class="choice"><input type="radio" name="experience" value="${v}" required>${i?'有':'没有'}</label>`).join('')}</div></fieldset><div class="actions"><button class="primary">开始作答 →</button></div></form>`:`<p class="callout">此编号已使用或无效，请使用新的分派链接。</p>`}</section>`;}
function shell(body){
 const done=state.rows.length,max=TOTAL_COUNT,t=activeTrial(state),label=state.phase==='task'?(t.kind==='practice'?`练习 ${done+1} / ${PRACTICE_COUNT}`:`正式判断 ${done-PRACTICE_COUNT+1} / ${MAIN_COUNT} · 第 ${t.block_index} 组`):`已完成 ${done} / ${max} 个看图案例`;
 return `<div id="storage-warning" class="storage-warning" hidden></div><div class="tools"><div class="progress-wrap"><div class="progress-text">${label}</div><progress value="${done}" max="${max}" aria-label="已完成 ${done} / ${max}"></progress></div></div>${body}`;
}
function imagePanel(t,answer){const c=items[t.id],refs=packet.references[c.reference_class_id];
 const evidence=t.layout==='B'?'<section class="evidence baseline-space" aria-hidden="true"></section>':`<section class="evidence"><h2 class="image-label">模型提供的局部线索 <span>· ${t.layout==='L1'?'并排查看':'按住切换'}</span></h2>${t.layout==='L1'?`<div class="pair"><figure><img class="stimulus" src="${c.query}" width="224" height="224" alt="当前照片的局部" draggable="false"><figcaption>本题照片的局部</figcaption></figure><figure><img class="stimulus" src="${c.prototype}" width="224" height="224" alt="模型局部原型" draggable="false"><figcaption>模型使用的参考局部</figcaption></figure></div>`:`<div class="toggle-stack"><img class="stimulus" src="${c.query}" width="224" height="224" alt="当前照片的局部" draggable="false"><img class="stimulus toggle-prototype" src="${c.prototype}" width="224" height="224" alt="模型局部原型" draggable="false" aria-hidden="true"></div><div class="hold-tools"><span id="view-label" role="status" aria-live="polite">${holdLabels(t.kind,'query').current}</span><button class="secondary hold" id="hold" disabled aria-pressed="false">按住查看模型原型</button><small>也可按住空格或回车</small></div>`}<p class="evidence-foot">参考局部可能来自其他鸟种。</p></section>`;
 return `<div class="study-workspace" data-layout="${t.layout}"><div class="primary-column"><div class="primary-visuals"><section class="target-photo"><h2 class="image-label">待判断照片</h2><img class="stimulus" src="${c.context}" width="224" height="224" alt="待判断照片" draggable="false"></section>${evidence}</div>${answer}</div><aside class="reference-rail" aria-labelledby="reference-heading"><h2 id="reference-heading">鸟种参考</h2><p class="reference-name">${esc(c.name)}</p><div class="class-references">${refs.map((r,i)=>`<img class="reference-image" src="${r.src}" width="160" height="160" alt="${esc(c.name)}的类别参考照片 ${i+1}" draggable="false">`).join('')}</div><p class="reference-foot">带有该鸟种标签的照片。<br>仅展示部分外观。</p></aside></div>`;
}
function task(){const t=activeTrial(state),c=items[t.id],d=state.draft;
 const answer=`<section class="answer-panel"><div id="image-status" role="status">正在准备图片…</div><form id="answer"><fieldset id="answers" class="answer-fields" disabled><legend class="sr-only">回答本题的判断和确定程度</legend><div class="two-questions"><fieldset class="question-group"><legend><span class="question-number">1</span>AI 的识别结果正确吗？</legend><div class="decision-choices">${[0,1].map(v=>`<label class="decision-choice"><input type="radio" name="response" value="${v}" ${d.response===v?'checked':''} required><span>${v===0?'正确':'错误'}</span></label>`).join('')}</div></fieldset><fieldset class="question-group" id="confidence-question" disabled><legend><span class="question-number">2</span>你对上述判断有多确定？</legend><div class="confidence-choices">${[1,2,3,4,5,6,7].map(v=>`<label class="confidence-choice"><input type="radio" name="confidence" value="${v}" aria-label="确定程度 ${v}${v===1?'，'+CONFIDENCE_ANCHORS.min:v===7?'，'+CONFIDENCE_ANCHORS.max:''}" ${d.confidence===v?'checked':''} required><span>${v}</span></label>`).join('')}</div><div class="confidence-anchors"><span>1 · ${CONFIDENCE_ANCHORS.min}</span><span>7 · ${CONFIDENCE_ANCHORS.max}</span></div></fieldset></div><div class="answer-actions"><p id="answer-status" class="answer-status" aria-live="polite"></p><button id="submit-answer" class="primary" disabled>确认，下一题 →</button></div></fieldset></form></section>`;
 return `<div class="trial-heading"><h1>AI 识别为：<strong>${esc(c.name)}</strong></h1><p class="taxonomy">${esc(c.label)}</p></div>${imagePanel(t,answer)}`;
}
function updateAnswerState(){const status=document.getElementById('answer-status');if(!status||!state)return;const d=state.draft;document.getElementById('confidence-question').disabled=d.response===null;document.querySelectorAll('input[name=confidence]').forEach(el=>el.checked=Number(el.value)===d.confidence);document.getElementById('submit-answer').disabled=d.response===null||d.confidence===null;status.textContent=d.response===null?'先选择正确或错误。':d.confidence===null?'再选择你对这个判断的确定程度。':'两问已完成，可以提交。';}
function interlude(){
 let title,body,button='继续 →';const recall=state.phase==='recall_intro';
 if(state.phase==='practice_feedback'){
   const r=state.rows.at(-1),c=items[r.item_id];title='这道练习的参考答案';
   body=`你选择了：${esc(answerLabel(r))}。<br>按数据集标签核对，这道练习中 AI 的名称${c.practice_answer?'不正确':'正确'}。<br>请结合鸟种参考和照片判断；局部相似本身不能保证名称正确。`;
   button=state.index===PRACTICE_COUNT?'练习完成 →':'下一道练习 →';
 }else if(state.phase==='main_intro'){
   title='练习完成，开始正式判断';body='接下来共 36 道题，分 3 组，每组 12 题。部分题目提供局部图，部分只提供原照片和鸟种参考；请根据当题可见的信息判断。正式题不公布答案。';button='开始正式判断 →';
 }else if(recall){title='36 道正式判断已完成';body='接下来可以回看 3 个案例，各写一句当时的判断依据。也可以直接结束。';button='回看 3 个案例 →';
 }else{title=`已完成 ${state.index-PRACTICE_COUNT} 道正式题，可以休息一下`;body='下一组有 12 道题。页面提供的图片或查看方式会变化，请根据当题可见的信息作答。准备好后继续。';button='继续下一组 →';}
 return `<section class="card complete"><h1>${title}</h1><p>${body}</p><div class="actions">${recall?'<button class="primary" id="skip-all-recalls">结束 →</button>':''}<button class="${recall?'secondary':'primary'}" id="continue">${button}</button></div></section>`;
}
function recall(){const id=state.recallIds[state.recalls.length],t=state.schedule.find(t=>t.id===id&&t.kind==='main'),r=state.rows.find(r=>r.item_id===id&&r.trial_type==='main');const side=`<section class="card review-form"><div id="image-status" role="status">正在准备图片…</div><div class="locked-answer">原回答：${esc(answerLabel(r))}</div><fieldset id="recall-controls" disabled><label class="field">当时哪张图、哪个细节影响了你的判断？为什么？<small>也可以写缺少依据、只是猜测，或现在才注意到的线索。</small><textarea id="basis" maxlength="600">${esc(state.recallDraft.basis)}</textarea></label><label class="check"><input type="checkbox" id="cannotRecall" ${state.recallDraft.cannotRecall?'checked':''}>记不清了</label><div class="actions"><button class="primary" id="submit-recall">${state.recalls.length===RECALL_COUNT-1?'保存并完成 →':'保存，下一条 →'}</button><button class="secondary" id="skip-recall">跳过</button></div></fieldset></section>`;return `<div class="trial-heading"><h1>案例回顾 ${state.recalls.length+1} / ${RECALL_COUNT}</h1><p class="recall-prediction">AI 识别为：${esc(items[id].name)} <span>${esc(items[id].label)}</span></p></div>${imagePanel(t,side)}`;}
function complete(){if(cloud)return `<section class="card complete"><h1>40 道看图题已完成。</h1><p id="cloud-finish" role="status">正在提交记录，请稍候…</p><p>案例回顾：填写 ${state.recalls.filter(r=>!r.skipped).length} 条，跳过 ${state.recalls.filter(r=>r.skipped).length} 条。</p><div id="cloud-retry" hidden><button class="primary" id="retry-upload">重新提交</button><button class="secondary" data-export="json">下载备份记录</button></div></section>`;return `<section class="card complete"><h1>谢谢，作答已完成。</h1><p>已保存 4 道练习和 36 道正式判断。<br>案例回顾：填写 ${state.recalls.filter(r=>!r.skipped).length} 条，跳过 ${state.recalls.filter(r=>r.skipped).length} 条。</p><p>请下载完整记录并交给研究者。${preview?'当前为软件预览，记录仅用于检查页面。':''}</p><div class="download-grid"><button class="primary" data-export="json">下载完整记录</button><button class="secondary" data-export="csv">下载回答 CSV</button><button class="text-button" id="copy">无法下载？复制记录</button></div><div class="actions"><button class="text-button" id="home">返回首页</button></div></section>`;}
function render(){const token=++renderToken;ready=false;app.innerHTML=state?shell(state.phase==='task'?task():state.phase==='recall'?recall():state.phase==='complete'?complete():interlude()):`<div id="storage-warning" class="storage-warning" hidden></div>${intro()}`;storageBanner();bind();updateCloudStatus();window.scrollTo(0,0);if(state&&['task','recall'].includes(state.phase))prepare(token);}
async function prepare(token){const generation=++prepareGeneration;try{const imgs=[...app.querySelectorAll('.stimulus,.reference-image')];await Promise.all(imgs.map(i=>i.decode()));await new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)));if(token!==renderToken||generation!==prepareGeneration||conflict||!state||innerWidth<1000||document.hidden||!pageFocused)return;
  const dimensions=imgs.map(i=>{const r=i.getBoundingClientRect();return {width:r.width,height:r.height,expected:i.classList.contains('reference-image')?160:224};});if(dimensions.some(d=>d.width!==d.expected||d.height!==d.expected))throw Error('图片显示尺寸异常，请恢复浏览器默认缩放。');
  if(!act({type:'READY',viewport:`${innerWidth}x${innerHeight}@${devicePixelRatio}`,dimensions},false))return;ready=true;document.getElementById('image-status').textContent='';const controls=document.getElementById(state.phase==='task'?'answers':'recall-controls');controls.disabled=false;const hold=document.getElementById('hold');if(hold)hold.disabled=false;
  }catch(e){if(token===renderToken){document.getElementById('image-status').textContent='图片未准备完成，暂时不能作答。请刷新页面重试，已有进度会自动接续。'+(e.message||'');}}}
function showView(view){if(!ready||conflict||!state)return;const t=state.phase==='recall'?state.schedule.find(t=>t.kind==='main'&&t.id===state.recallIds[state.recalls.length]):activeTrial(state);if(t.layout!=='L3')return;
  if(state.phase==='task'&&!act({type:'VIEW',view},false))return;
  app.querySelector('.toggle-stack')?.classList.toggle('show-prototype',view==='prototype');const layers=app.querySelectorAll('.toggle-stack img');layers.forEach((im,i)=>im.setAttribute('aria-hidden',String(i===(view==='prototype'?0:1))));const labels=holdLabels(t.kind,view),b=document.getElementById('hold');if(b){b.setAttribute('aria-pressed',String(labels.pressed));b.textContent=labels.button;}const l=document.getElementById('view-label');if(l)l.textContent=labels.current;}
function interrupt(type){if(!state||!['task','recall'].includes(state.phase)||conflict)return;showView('query');ready=false;++prepareGeneration;act({type},false);const controls=document.getElementById(state.phase==='task'?'answers':'recall-controls');if(controls)controls.disabled=true;const hold=document.getElementById('hold');if(hold)hold.disabled=true;}
function goHome(){if(state&&state.phase!=='complete')interrupt('PAUSE');try{sessionStorage.removeItem(prefix+'active');}catch{}state=null;lastRaw=null;conflict=false;render();}
function download(text,name,mime){const url=URL.createObjectURL(new Blob([text],{type:mime})),a=document.createElement('a');a.href=url;a.download=name;document.body.append(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(url),30000);}
function exportFile(format,emergency=false){if(!state)return;if(!emergency&&!act({type:'EXPORT',format},false))return;const stem=`${state.dataKind==='software-test'?'TEST_ONLY_':'STUDY_'}${state.participant}_${state.sessionId}`;download(format==='csv'?csv(state.rows):JSON.stringify(state,null,2),stem+(format==='csv'?'.csv':'.json'),format==='csv'?'text/csv;charset=utf-8':'application/json;charset=utf-8');notify('已请求下载，请确认文件已保存。');}
function bind(){const on=(id,event,fn)=>document.getElementById(id)?.addEventListener(event,fn);
  on('start','submit',async e=>{e.preventDefault();const a=allocation();if(!a)return notify('该分派已使用，请继续已有记录。');const button=e.target.querySelector('button'),experience=new FormData(e.target).get('experience');button.disabled=true;button.textContent='正在准备…';try{
    if(cloud){const remote=await cloud.start(experience);await adoptRemote(remote);}
    else{const sessionId=crypto.randomUUID?.()||`s-${Date.now()}-${Math.random().toString(36).slice(2)}`;state=createSession(packet,{code:a.code,birdExperience:experience,sessionId,dataKind});state.consentVersion='chiir-consent-01';state.consentAt=new Date().toISOString();lastRaw=null;act({type:'UI_BUILD'},false);}
    render();
  }catch(err){notify(/full/.test(err.message)?'目前名额已满，请联系研究者。':/not open/.test(err.message)?'研究尚未开放，请稍后再试。':'暂时无法连接，请稍后再点击开始。');button.disabled=false;button.textContent='开始作答 →';}});
  on('answer','change',e=>{if(['response','confidence'].includes(e.target.name)&&act({type:'ANSWER',field:e.target.name,value:Number(e.target.value)},false))updateAnswerState();});
  updateAnswerState();
  on('skip-all-recalls','click',()=>act({type:'SKIP_ALL_RECALLS'}));on('skip-recall','click',()=>{if(ready)act({type:'SKIP_RECALL'});});
  on('answer','submit',e=>{e.preventDefault();if(ready)act({type:'SUBMIT'});});on('continue','click',()=>act({type:'CONTINUE'}));
  on('basis','input',e=>act({type:'RECALL',field:'basis',value:e.target.value},false));on('cannotRecall','change',e=>act({type:'RECALL',field:'cannotRecall',value:e.target.checked},false));on('submit-recall','click',()=>{if(ready)act({type:'SUBMIT_RECALL'});});
  const hold=document.getElementById('hold');if(hold){hold.addEventListener('pointerdown',e=>{if(e.button!==0)return;e.preventDefault();hold.focus();hold.setPointerCapture(e.pointerId);showView('prototype');});for(const type of ['pointerup','pointercancel','lostpointercapture','pointerleave','blur'])hold.addEventListener(type,()=>showView('query'));hold.addEventListener('keydown',e=>{if([' ','Enter'].includes(e.key)){e.preventDefault();if(!e.repeat)showView('prototype');}});hold.addEventListener('keyup',e=>{if([' ','Enter'].includes(e.key)){e.preventDefault();showView('query');}});}
  on('retry-upload','click',()=>{cloud?.flush();});on('home','click',goHome);app.querySelectorAll('[data-export]').forEach(b=>b.onclick=()=>exportFile(b.dataset.export));on('copy','click',()=>{document.getElementById('json-text').value=JSON.stringify(state,null,2);document.getElementById('copy-dialog').showModal();});
}
document.body.insertAdjacentHTML('beforeend','<dialog id="copy-dialog"><h2>完整 JSON 记录</h2><p>复制全部内容，保存为 UTF-8 .json 文件。</p><textarea id="json-text" readonly aria-label="完整 JSON 记录" style="height:40vh"></textarea><div class="actions"><button class="secondary" id="select-json">全选记录</button><button class="primary" id="close-copy">关闭</button></div></dialog><dialog id="conflict"><h2>另一页面已修改这份记录</h2><p>请先保存本页副本，关闭重复页面后再继续。</p><button class="primary" id="conflict-save">保存本页副本</button></dialog>');
document.getElementById('select-json').onclick=()=>document.getElementById('json-text').select();document.getElementById('close-copy').onclick=()=>document.getElementById('copy-dialog').close();document.getElementById('conflict-save').onclick=()=>exportFile('json',true);document.getElementById('conflict').addEventListener('cancel',e=>e.preventDefault());
window.addEventListener('storage',e=>{if(state&&e.key===prefix+state.sessionId&&e.newValue!==lastRaw){conflict=true;document.getElementById('conflict').showModal();}});
window.addEventListener('blur',()=>{pageFocused=false;interrupt('BLUR');});window.addEventListener('focus',()=>{pageFocused=true;if(state&&['task','recall'].includes(state.phase))prepare(renderToken);});
document.addEventListener('visibilitychange',()=>{if(document.hidden)interrupt('HIDDEN');else if(state&&['task','recall'].includes(state.phase))prepare(renderToken);});
let narrow=innerWidth<1000;function resize(){const next=innerWidth<1000;document.getElementById('viewport-warning').hidden=!next;document.body.classList.toggle('narrow',next);if(next&&!narrow)interrupt('RESIZE');if(!next&&narrow&&state)prepare(renderToken);narrow=next;}window.addEventListener('resize',resize);resize();initDemo();if(!state){if(cloud){try{const remote=await cloud.resume();if(remote)await adoptRemote(remote);}catch{restoreActive();notify('暂时离线，已有记录会在网络恢复后继续提交。');}}else restoreActive();}render();
window.addEventListener('online',()=>cloud?.flush());

function initDemo(){
 if(!['B','L1','L3','recall'].includes(demo))return;
 const layout=demo==='recall'?'B':demo,v=packet.variants.find(v=>v.blocks[0].layout===layout),a=packet.allocation.find(a=>a.variant===v.variant);
 let clock=Date.now()-60000;state=createSession(packet,{code:a.code,birdExperience:'no',sessionId:'DEMO_'+crypto.randomUUID(),dataKind:'software-test'},clock++);
 state=transition(state,{type:'UI_BUILD'},clock++);
 for(let guard=0;guard<120;guard++){
   if(demo==='recall'?state.phase==='recall':state.phase==='task'&&state.index===PRACTICE_COUNT)break;
   if(state.phase==='task'){state=transition(state,{type:'READY'},clock++);state=transition(state,{type:'ANSWER',field:'response',value:0},clock++);state=transition(state,{type:'ANSWER',field:'confidence',value:1},clock++);state=transition(state,{type:'SUBMIT'},clock++);}
   else state=transition(state,{type:'CONTINUE'},clock++);
 }
 state.previewSeededRows=state.rows.length;state.previewScreen=demo;lastRaw=null;save();
}

function restoreActive(){
 const requested=params.get('p'),variant=params.get('v');
 const list=saved().filter(s=>(!requested||s.participant===requested)&&(!variant||s.allocation.variant===variant));
 let activeId=null;try{activeId=sessionStorage.getItem(prefix+'active');}catch{}
 const active=list.find(s=>s.sessionId===activeId),candidate=active||list[0];
 if(!candidate||(!requested&&!active&&candidate.phase==='complete'))return;
 state=candidate;lastRaw=read(prefix+state.sessionId);conflict=false;
 act({type:'UI_BUILD'},false);act({type:'RESUME'},false);
}

function cloudStatus(status){cloudState=status;updateCloudStatus();if(status.state==='conflict'){conflict=true;document.getElementById('conflict')?.showModal();}}
function updateCloudStatus(){
 const el=document.getElementById('cloud-finish');if(!el)return;
 const confirmed=cloud?.confirmed?.complete&&cloud.confirmed.sessionId===state?.sessionId&&cloud.confirmed.revision>=state.cloudRevision;
 el.textContent=confirmed?'答案已成功提交，谢谢参与。现在可以关闭页面。':cloudState.state==='offline'?'网络暂时不可用，记录已保留在本机。请保持此页打开，恢复网络后会自动提交。':cloudState.state==='conflict'?'记录版本需要研究者核对，请先下载备份。':'正在提交记录，请稍候…';
 document.getElementById('cloud-retry').hidden=confirmed||!['offline','conflict'].includes(cloudState.state);
}
async function adoptRemote(remote){
 if(remote.dataKind!==dataKind)throw Error('session mismatch');
 const local=saved().find(s=>s.sessionId===remote.sessionId&&s.cloudSession),resuming=!!(local||remote.record);
 state=local&&local.cloudRevision>remote.revision?local:remote.record;
 if(state)validateSession(state,packet);
 else state=createSession(packet,{code:remote.participant,birdExperience:remote.experience,sessionId:remote.sessionId,dataKind});
 state.cloudSession=true;state.cloudRevision=Math.max(state.cloudRevision||0,remote.revision);state.consentVersion=remote.consentVersion;state.consentAt=remote.consentAt;
 lastRaw=read(prefix+state.sessionId);act({type:'UI_BUILD'},false);if(resuming&&state.phase!=='complete')act({type:'RESUME'},false);
}
