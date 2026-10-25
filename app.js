'use strict';
// 汉语 Hànyǔ — pastel Chinese flashcards for English speakers. All data stays in this browser (localStorage).
const KEY='hanyu-state-v1',SAFEKEY='hanyu-safe',BOOT='hanyu-boot',SEEDKEY='hanyu-seeded',VER='v2',MIN=60e3,DAY=864e5;
const PRAC_IV=[10*MIN,1*DAY,2*DAY,4*DAY]; // practiced: short intervals
const LEARNED_IV0=14*DAY,LEARNED_MAX=120*DAY; // learned: long, doubling
const PY=window.Pinyin,GR=window.HANYU_GRAMMAR||{groups:[],points:[]},STARTER=window.HANYU_STARTER||[];
const GPT={};GR.points.forEach(p=>GPT[p.id]=p);
let S=null,sess=null,tab='learn',shown=60;
const $=id=>document.getElementById(id);
const today=()=>new Date().toLocaleDateString('en-CA');
let saveT=null;function saveNow(){clearTimeout(saveT);saveT=null;try{localStorage.setItem(KEY,JSON.stringify(S))}catch(e){console.warn('save failed',e);try{toast('⚠️ Could not save — export a backup')}catch(_){}}}
function save(){if(!saveT)saveT=setTimeout(saveNow,300)} // debounced
addEventListener('pagehide',()=>saveT&&saveNow());document.addEventListener('visibilitychange',()=>{if(document.hidden&&saveT)saveNow()});
const SAFE=/[?&]safe=1/.test(location.search)||localStorage.getItem(SAFEKEY)==='1';if(SAFE)document.documentElement.classList.add('safe');
const CAN_SPEAK=typeof window.speechSynthesis!=='undefined'&&typeof window.SpeechSynthesisUtterance!=='undefined';if(!CAN_SPEAK)document.documentElement.classList.add('nosay');
function blank(){return {v:1,app:'hanyu',goal:20,sessN:20,streak:0,lastDay:null,doneDay:today(),doneCount:0,cards:{},pyMode:'always',seeded:true,onboarded:true,removed:[],nextOrd:0}}
function valid(d){return d&&typeof d==='object'&&d.cards&&typeof d.cards==='object'&&!Array.isArray(d.cards)}
// Normalise saved data (also used for imported backups). Never throws away progress except records that are not Chinese cards.
function normalize(d){if(!valid(d))throw new Error('Saved data is not in the expected format');
  const had=Object.keys(d.cards).length;
  if(!d.seeded)d.onboarded=true; // data from before auto-seeding: never re-seed, no onboarding banner
  d.seeded=true;d.removed=Array.isArray(d.removed)?d.removed:[];d.nextOrd=+d.nextOrd||0;
  d.goal=+d.goal||20;d.sessN=+d.sessN||20;d.streak=+d.streak||0;d.doneCount=+d.doneCount||0;d.pyMode=d.pyMode==='after'?'after':'always';
  for(const k in d.cards){const c=d.cards[k];if(!c||!c.zh){delete d.cards[k];continue}if(!['learn','practiced','learned'].includes(c.s))c.s='learn';c.lv=Math.max(0,Math.min(+c.lv||0,10));c.due=+c.due||0;c.en=c.en||'';c.py=c.py||'';c.id=c.id||k;if(typeof c.o!=='number'){const i=SIDX[c.zh];c.o=i!==undefined?i:1000+d.nextOrd++}}
  if(had&&!Object.keys(d.cards).length)throw new Error('This file is not a Chinese Cards backup');
  return d}
async function load(){const raw=localStorage.getItem(KEY);if(!raw)return;S=normalize(JSON.parse(raw))}
// Box rule: box 0/unseen -> learn, boxes 1-4 -> practiced, 5+ -> learned
const boxSec=b=>!b?'learn':(b<=4?'practiced':'learned');
function parseDelim(t,dl){const rows=[];let r=[],f='',q=false;for(let i=0;i<t.length;i++){const ch=t[i];
  if(q){if(ch=='"'){if(t[i+1]=='"'){f+='"';i++}else q=false}else f+=ch}
  else if(ch=='"')q=true;else if(ch==dl){r.push(f);f=''}else if(ch=='\n'||ch=='\r'){if(ch=='\r'&&t[i+1]=='\n')i++;r.push(f);rows.push(r);r=[];f=''}else f+=ch}
  if(f||r.length){r.push(f);rows.push(r)}return rows.filter(x=>x.some(v=>v.trim()))}
const hid=s=>{let h=0;for(const c of s)h=(h*31+c.codePointAt(0))>>>0;return 'w'+h.toString(36)};
const norm=s=>String(s||'').normalize('NFC').replace(/\s+/g,'').trim();
const wkey=(zh,py)=>norm(zh)+'|'+PY.toneless(String(py||'').split('/')[0]);
const fixPy=s=>{s=String(s||'').trim();return /[a-zA-Zü]\s*[1-5]/.test(s)?PY.toMarks(s):s};
const SIDX={};STARTER.forEach((w,i)=>{if(SIDX[w.zh]===undefined)SIDX[w.zh]=i});
const pyAlts=p=>String(p||'').split('/').map(x=>PY.toneless(x)).filter(Boolean);
const samePy=(a,b)=>{const x=pyAlts(a),y=pyAlts(b);return !x.length||!y.length||x.some(v=>y.includes(v))};
const HDR={zh:['hanzi','chinese','zh','character','characters','simplified','word','front','汉字'],py:['pinyin','py','pronunciation','拼音'],en:['english','en','meaning','definition','translation','back'],
  ex:['example','sentence','ex','example_sentence','例句'],exPy:['example_pinyin','examplepinyin','ex_pinyin','sentence_pinyin'],exEn:['example_english','example_en','ex_english','sentence_english','example_translation','sentence_translation']};
function mkWord(o){let ex=String(o.ex||'').trim(),exPy=String(o.exPy||'').trim(),exEn=String(o.exEn||'').trim();
  if(ex.includes('|')){const p=ex.split('|').map(x=>x.trim());ex=p[0];if(p.length>=3){exPy=exPy||p[1];exEn=exEn||p[2]}else exEn=exEn||p[1]||''}
  const zh=String(o.zh||'').trim(),py=fixPy(o.py),en=String(o.en||'').trim();if(!zh||!en)return null;
  return {id:hid(wkey(zh,py)),zh,py,en,ex,exPy:fixPy(exPy),exEn,s:o.s||'learn',o:typeof o.o==='number'?o.o:undefined}}
// Accepts: progress backup {v,cards:{}}, a list of words (array or {words:[]}) or CSV/TSV: hanzi,pinyin,english,example,example_pinyin,example_english
function parseWords(text,name){text=text.replace(/^\uFEFF/,'');
  if(/^\s*[\[{]/.test(text)&&!/\.csv$/i.test(name)){const d=JSON.parse(text);
    if(d&&d.cards&&!Array.isArray(d.cards))return {progress:d};
    const arr=Array.isArray(d)?d:(d.words||d.cards||[]);
    return {words:arr.map(w=>mkWord({zh:w.hanzi||w.zh||w.chinese||w.front,py:w.pinyin||w.py,en:w.english||w.en||w.meaning||w.back,ex:w.example||w.ex||w.sentence,exPy:w.example_pinyin||w.exPy||w.examplePinyin,exEn:w.example_english||w.exEn||w.exampleEnglish,s:w.s||boxSec(w.srs&&w.srs.box)})).filter(Boolean)}}
  const first=text.split(/\r?\n/,1)[0],dl=first.includes('\t')&&!first.includes(',')?'\t':(first.includes(';')&&!first.includes(',')?';':',');
  const rows=parseDelim(text,dl);if(!rows.length)return {words:[]};
  const h=rows[0].map(x=>x.trim().toLowerCase().replace(/[\s-]+/g,'_')),idx={};let header=false;
  for(const k in HDR){idx[k]=h.findIndex(x=>HDR[k].includes(x));if(idx[k]>=0)header=true}
  if(header)rows.shift();
  else{ // no header: hanzi,pinyin,english,example,... — or hanzi,english when the 2nd column isn't pinyin
    const latin=s=>/^[a-zA-Zāáǎàēéěèīíǐìōóǒòūúǔùǖǘǚǜü0-9:'’\s\/-]+$/.test((s||'').trim())&&/[āáǎàēéěèīíǐìōóǒòūúǔùǖǘǚǜ0-9]|^[a-z\s'’]+$/i.test((s||'').trim());
    const looksPy=rows.slice(0,5).filter(r=>r[2]!==undefined&&latin(r[1])).length>=Math.min(2,rows.length)||rows.slice(0,5).every(r=>r.length>=3&&latin(r[1]));
    Object.assign(idx,looksPy?{zh:0,py:1,en:2,ex:3,exPy:4,exEn:5}:{zh:0,en:1,ex:2,exEn:3,py:-1,exPy:-1})}
  if(idx.zh<0)idx.zh=0;const seen=new Set(),words=[];
  rows.forEach(r=>{const g=i=>i>=0?(r[i]||'').trim():'';const w=mkWord({zh:g(idx.zh),py:g(idx.py),en:g(idx.en),ex:g(idx.ex),exPy:g(idx.exPy),exEn:g(idx.exEn)});if(!w||seen.has(w.id))return;seen.add(w.id);words.push(w)});
  return {words}}
// opts.starter: bundled deck (skips words the user removed unless opts.force; refreshes text of untouched starter cards). Never changes progress.
function mergeWords(words,opts={}){const now=Date.now();if(!S)S=blank();const byZh={};for(const id in S.cards){const c=S.cards[id];(byZh[norm(c.zh)]=byZh[norm(c.zh)]||[]).push(id)}
  const rem=new Set(S.removed||[]);let added=0,updated=0,skipped=0;
  words.forEach(w=>{const k=wkey(w.zh,w.py);let id=S.cards[w.id]?w.id:null;
    if(!id){const cand=byZh[norm(w.zh)]||[];id=cand.find(i=>samePy(S.cards[i].py,w.py))||null}
    if(id){const c=S.cards[id];let ch=false;
      if(opts.starter&&!c.user&&c.en===w.en){for(const f of ['py','ex','exPy','exEn']){if(w[f]&&c[f]!==w[f]){c[f]=w[f];ch=true}}}
      else for(const f of ['py','ex','exPy','exEn']){if(!c[f]&&w[f]){c[f]=w[f];ch=true}}
      if(typeof w.o==='number'&&opts.starter&&c.o!==w.o){c.o=w.o}
      if(ch)updated++;return}
    if(opts.starter&&!opts.force&&rem.has(k)){skipped++;return}
    rem.delete(k);
    added++;S.cards[w.id]={id:w.id,zh:w.zh,py:w.py,en:w.en,ex:w.ex,exPy:w.exPy,exEn:w.exEn,s:w.s,lv:w.s==='practiced'?1:0,due:w.s==='learned'?now+LEARNED_IV0:now,seen:0,ok:0,miss:0,o:typeof w.o==='number'?w.o:1000+(S.nextOrd++)};
    (byZh[norm(w.zh)]=byZh[norm(w.zh)]||[]).push(w.id)});
  S.removed=[...rem];saveNow();return {added,updated,skipped}}
function importText(text,name){const r=parseWords(text,name);
  if(r.progress){S=normalize(r.progress);ensureGram();saveNow();return 'progress'}
  if(!r.words.length)throw new Error('no words');return mergeWords(r.words)}
function loadStarter(opts){return mergeWords(STARTER.map((w,i)=>mkWord({zh:w.zh,py:w.py,en:w.en,ex:w.ex,exPy:w.exPy,exEn:w.exEn,o:i})).filter(Boolean),{starter:true,force:!!(opts&&opts.force)})}
// Built-in grammar: content ships with the app, only per-point progress is stored (S.gram).
function ensureGram(){if(!S)return;S.gram=S.gram||{};GR.points.forEach(p=>{if(!S.gram[p.id])S.gram[p.id]={id:p.id,s:'learn',lv:0,due:Date.now(),seen:0,ok:0,miss:0}})}
function rollDay(){if(S.doneDay!==today()){S.doneDay=today();S.doneCount=0;save()}}
const cards=()=>Object.values(S.cards);
// Build a session queue. Practiced words get priority (short intervals), learned words only when due (long intervals) plus a spot-check.
function buildQueue(n,now=Date.now()){
  const all=cards(),sh=a=>a.sort(()=>Math.random()-.5);
  const prac=all.filter(c=>c.s==='practiced'&&c.due<=now).sort((a,b)=>a.due-b.due);
  const lrn=all.filter(c=>c.s==='learned'&&c.due<=now).sort((a,b)=>a.due-b.due);
  const neu=all.filter(c=>c.s==='learn').sort((a,b)=>((b.miss>0)-(a.miss>0))||((a.o||0)-(b.o||0))); // new words: missed ones first, then most-common-first order
  const q=[],take=(arr,k)=>{while(k-->0&&arr.length&&q.length<n)q.push(arr.shift())};
  take(prac,Math.ceil(n*.6));take(lrn,Math.ceil(n*.2));
  if(!q.some(c=>c.s==='learned')){const ex=sh(all.filter(c=>c.s==='learned'));take(ex,1)} // retention spot-check
  take(neu,n);take(prac,n);take(lrn,n);
  return sh(q);
}
function grade(c,g,now=Date.now()){
  c.seen++;
  if(g===0){c.miss++;c.s='learn';c.lv=0;c.due=now}
  else if(g===1){if(c.s==='learned'){c.s='practiced';c.lv=1}else{c.s='practiced';c.lv=Math.max(0,Math.min(c.lv,1))}c.due=now+PRAC_IV[c.lv]}
  else{c.ok++;
    if(c.s==='learn'){c.s='practiced';c.lv=1;c.due=now+PRAC_IV[1]}
    else if(c.s==='practiced'){if(c.lv>=3){c.s='learned';c.lv=0;c.due=now+LEARNED_IV0}else{c.lv++;c.due=now+PRAC_IV[c.lv]}}
    else{c.lv++;c.due=now+Math.min(LEARNED_MAX,LEARNED_IV0*2**c.lv)}}
  c.last=now;
}
function move(id,s){const c=S.cards[id];c.s=s;c.lv=s==='practiced'?1:0;c.due=Date.now()+(s==='learned'?LEARNED_IV0:0);save()}
// UI
function show(v){document.querySelectorAll('.view').forEach(e=>e.classList.toggle('on',e.id==='v-'+v));document.querySelectorAll('nav button').forEach(b=>b.classList.toggle('on',b.dataset.v===v));
  if(v==='home')renderHome();if(v==='words')renderWords();if(v==='gram')renderGram();if(v==='study'&&!sess)startSession()}
const EMO={learn:'🌱',practiced:'🌼',learned:'🌈'};const NAMES={learn:'Words to learn',practiced:'Words practiced',learned:'Words learned'};
function applyPy(){document.body.classList.toggle('hide-py',S&&S.pyMode==='after')}
const verText=()=>'Offline-ready · '+cards().length+' words · '+GR.points.length+' grammar points · '+VER;
function renderOnboard(){const el=$('onboard');el.hidden=!!S.onboarded;if(!S.onboarded)$('onbTxt').textContent=`Your deck is loaded: ${cards().length} beginner words (most common first) and ${GR.points.length} grammar points (easiest first). Grammar is mixed into every practice session, so there is nothing to set up — just tap Practice.`}
function renderHome(){renderOnboard();rollDay();checkStreak();const cnt={learn:0,practiced:0,learned:0},now=Date.now();let due=0;
  cards().forEach(c=>{cnt[c.s]++;if(c.s!=='learn'&&c.due<=now)due++});
  $('tiles').innerHTML=Object.keys(cnt).map(k=>`<button class="tile ${k}" data-s="${k}"><span class="em">${EMO[k]}</span><span class="n">${cnt[k]}</span>${NAMES[k]}</button>`).join('');
  document.querySelectorAll('.tile').forEach(t=>t.onclick=()=>{tab=t.dataset.s;show('words')});
  const p=Math.min(100,S.doneCount/S.goal*100);$('ringc').setAttribute('stroke-dasharray',p+' 100');$('ringt').textContent=Math.round(p)+'%';
  $('goaltxt').textContent=`${S.doneCount} / ${S.goal} today`;$('duetxt').textContent=`${due} due for review`;$('streak').textContent='🔥 '+S.streak;try{renderGame()}catch(e){console.warn(e)}}
function settings(){S.types=S.types||{flash:true,pick:true,type:true};S.mix=S.mix||'50,25,25';return S}
// ---- answers & sentences
const firstVariant=s=>String(s||'').split(/[\/；;]/)[0].replace(/[…~～\.]/g,'').replace(/\(.*?\)|（.*?）/g,'').trim();
const answers=c=>[{zh:c.zh,py:c.py}];
// A card can be shown as a fill-in-the-blank when its example sentence contains the word exactly.
function sentOf(c){const w=firstVariant(c.zh);if(!c.ex||!w||!c.ex.includes(w))return null;return {zh:c.ex,blank:w,py:c.exPy,en:c.exEn}}
function pickType(c){const t=settings().types,m=S.mix.split(',').map(Number);let opts=[['flash',m[0]],['pick',m[1]],['type',m[2]]].filter(([k])=>t[k]&&(k!=='pick'||(cards().length>=3&&sentOf(c)))&&(k!=='type'||true));
  if(!opts.length)return 'flash';let r=Math.random()*opts.reduce((s,o)=>s+o[1],0);for(const [k,w] of opts){if((r-=w)<0)return k}return opts[0][0]}
function gramQueue(n,now=Date.now()){ensureGram();const order=GR.points.map(p=>p.id),all=order.map(id=>S.gram[id]).filter(Boolean);
  const prac=all.filter(x=>x.s==='practiced'&&x.due<=now).sort((a,b)=>a.due-b.due),lrn=all.filter(x=>x.s==='learned'&&x.due<=now),neu=all.filter(x=>x.s==='learn');
  const q=[],take=(arr,k)=>{while(k-->0&&arr.length&&q.length<n)q.push(arr.shift())};take(prac,Math.ceil(n*.6));take(lrn,Math.ceil(n*.2));take(neu,n);take(prac,n);take(lrn,n);return q}
const gType=()=>['choose','fill','reorder','build'][Math.random()*4|0];
function startSession(mode){const n=S.sessN,none=!cards().length,gm=mode==='gram'||none?n:Math.round(n*(S.gmix==null?20:S.gmix)/100);
  const gq=gramQueue(gm).map(x=>({g:x.id,t:gType()})),wq=mode==='gram'||none?[]:buildQueue(n-gq.length).map(c=>({c,t:pickType(c)}));
  const q=wq.slice();gq.forEach((it,i)=>q.splice(Math.floor((i+1)*q.length/(gq.length+1))+i,0,it));
  if(!q.length){sess=null;toast('Nothing to practice yet — load or add some words 🌱');return show('home')}
  sess={q,i:0,mode};sess.total=q.length;showCard()}
const cur=()=>sess&&sess.q[sess.i]&&(sess.q[sess.i].c||(sess.q[sess.i].g&&S.gram[sess.q[sess.i].g]));
const exHTML=c=>c.ex?`${esc(c.ex)}${c.exPy?`<span class="pyl">${esc(c.exPy)}</span>`:''}${c.exEn?`<span class="enl">${esc(c.exEn)}</span>`:''}`:'';
function showCard(){const it=sess.q[sess.i],c=it&&it.c;$('card').classList.remove('flip');sess.done=false;
  const t=it?(it.g?'gram':it.t):'flash';$('card').hidden=t!=='flash';$('gradeRow').hidden=t!=='flash';$('pickBox').hidden=t!=='pick';$('typeBox').hidden=t!=='type';$('gramBox').hidden=t!=='gram';$('qNext').hidden=true;
  if(t==='gram'){$('pbar').style.width=(sess.i/sess.q.length*100)+'%';return showGram(it)}
  if(!c){celebrate('🎉 All done! 太棒了!');sess=null;return show('home')}
  $('fzh').textContent=$('bzh').textContent=c.zh;$('fpy').textContent=$('bpy').textContent=c.py;$('ben').textContent=c.en;$('bex').innerHTML=exHTML(c);
  $('tag').textContent=NAMES[c.s];$('tag').className='tag '+c.s;$('pbar').style.width=(sess.i/sess.q.length*100)+'%';if(t==='pick')showPick(c);if(t==='type')showType(c)}
function answer(g){if(!sess)return;const c=cur();if(!c)return;const cd=$('card');cd.classList.remove('wig','bnc','pop');void cd.offsetWidth;cd.classList.add(['wig','pop','bnc'][g]);record(c,g);sess.i++;showCard()}
function record(c,g,item){grade(c,g);
  if(g===0)sess.q.splice(Math.min(sess.q.length,sess.i+4),0,item&&item.g?{g:item.g,t:gType()}:{c,t:'flash'});if(item&&item.g){G().gtotal=(G().gtotal||0)+1} // missed: see again soon in this session
  rollDay();S.doneCount++;
  if(S.doneCount>=S.goal&&S.lastDay!==today()){const y=new Date(Date.now()-DAY).toLocaleDateString('en-CA');S.streak=S.lastDay===y?S.streak+1:(S.lastDay===today()?S.streak:1);S.lastDay=today();$('streak').textContent='🔥 '+S.streak;celebrate('🔥 Daily goal! Streak '+S.streak)}
  else if(g===2&&c.s==='learned'&&c.lv===0)celebrate('🌟 Learned: '+(c.zh||(GPT[c.id]||{}).pattern),false);
  reward(g);save()}
function renderWords(){document.querySelectorAll('#wtabs button').forEach(b=>b.classList.toggle('on',b.dataset.s===tab));
  const q=$('q').value.trim().toLowerCase(),f=s=>PY.toneless(s);
  const list=cards().filter(c=>c.s===tab&&(!q||c.zh.includes(q)||c.en.toLowerCase().includes(q)||(f(q)&&f(c.py).includes(f(q)))));
  $('wlist').innerHTML=(list.length?`<p class="muted">${list.length} words</p>`:`<div class="empty"><span class="e">${q?'🔍':EMO[tab]}</span><b>${q?'Nothing found!':'Nothing here yet!'}</b><br>${q?'Try another search ✨':(Object.keys(S.cards).length?'Practice a bit and words will bloom here 🌸':'Add words in More, or load the starter HSK 1 deck 🌸')}</div>`)+list.slice(0,shown).map(c=>`<div class="row"><div><b class="rz">${esc(c.zh)}</b> <small class="rp pyh">${esc(c.py)}</small><small>${esc(c.en)}</small></div><button class="say" style="position:static" data-say="${esc(c.zh)}">🔊</button><button class="say del" style="position:static" data-del="${c.id}" aria-label="Remove word">🗑</button><select data-id="${c.id}">${Object.keys(NAMES).map(k=>`<option value="${k}"${k===c.s?' selected':''}>${k==='learn'?'To learn':k[0].toUpperCase()+k.slice(1)}</option>`).join('')}</select></div>`).join('');
  $('more').style.display=list.length>shown?'':'none';
  $('wlist').querySelectorAll('select').forEach(s=>s.onchange=()=>{move(s.dataset.id,s.value);toast('Moved ✓');renderWords()});
  $('wlist').querySelectorAll('.row div').forEach(d=>d.onclick=()=>d.parentNode.classList.toggle('peek'));
  $('wlist').querySelectorAll('[data-say]').forEach(b=>b.onclick=()=>speak(b.dataset.say));
  $('wlist').querySelectorAll('[data-del]').forEach(b=>b.onclick=()=>removeWord(b.dataset.del))}
function removeWord(id){const c=S.cards[id];if(!c)return;if(!confirm('Remove “'+c.zh+'” and its progress? (It won’t come back unless you choose “Load starter words again”.)'))return;S.removed=S.removed||[];const k=wkey(c.zh,c.py);if(!S.removed.includes(k))S.removed.push(k);delete S.cards[id];saveNow();toast('Removed');renderWords()}
const esc=s=>String(s==null?'':s).replace(/[&<>"]/g,m=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[m]));
function speak(t){if(!CAN_SPEAK)return toast('Audio isn’t available on this device');try{const u=new SpeechSynthesisUtterance(String(t).replace(/[\[\]\s]/g,''));u.lang='zh-CN';const vs=speechSynthesis.getVoices(),v=vs.find(v=>/^zh[-_]CN/i.test(v.lang))||vs.find(v=>/^zh/i.test(v.lang));if(v)u.voice=v;u.rate=.8;speechSynthesis.cancel();speechSynthesis.speak(u)}catch(e){toast('No Chinese voice found')}}
function toast(m){const t=$('toast');t.textContent=m;t.classList.add('on');clearTimeout(t._h);t._h=setTimeout(()=>t.classList.remove('on'),1300)}
function celebrate(m,big=true){toast(m);confetti(big?160:50)}
function confetti(n){if(SAFE)return;const cv=$('cf');if(cv._busy)return;cv.style.display='block';const x=cv.getContext('2d');cv.width=innerWidth;cv.height=innerHeight;const cols=['#ffb7b0','#ffd78a','#a8e6cf','#ffe3c9','#fff1a8','#ff8e72'];
  const P=Array.from({length:n},()=>({x:cv.width/2,y:cv.height/3,vx:(Math.random()-.5)*14,vy:-Math.random()*12-3,c:cols[Math.random()*6|0],r:Math.random()*6+3,a:Math.random()*6}));let f=0;
  (function st(){x.clearRect(0,0,cv.width,cv.height);P.forEach(p=>{p.x+=p.vx;p.y+=p.vy;p.vy+=.4;p.a+=.2;x.fillStyle=p.c;x.save();x.translate(p.x,p.y);x.rotate(p.a);x.fillRect(-p.r/2,-p.r/2,p.r,p.r*1.6);x.restore()});if(++f<90)requestAnimationFrame(st);else{x.clearRect(0,0,cv.width,cv.height);cv.width=cv.height=0;cv.style.display='none'}})()}

// ---- Rewards & daily habit
const STICKERS=['🥟','🍜','🧧','🏮','🐼','🎋','🍵','🥢','🐉','🌸','🍡','🥮','🧋','🐲','🎎','🎏','🍊','🐯','🌙','🍚','🦋','🍑','🐠','🐓'];
const dayKey=d=>d.toLocaleDateString('en-CA');const addDays=(k,n)=>{const d=new Date(k+'T12:00:00');d.setDate(d.getDate()+n);return dayKey(d)};
const dayDiff=(a,b)=>Math.round((new Date(b+'T12:00:00')-new Date(a+'T12:00:00'))/DAY);
const BADGES=[['s3','🔥 3-day streak',g=>S.streak>=3],['s7','🔥 7 days',g=>S.streak>=7],['s14','🔥 14 days',g=>S.streak>=14],['s30','🏆 30 days',g=>S.streak>=30],['s50','👑 50 days',g=>S.streak>=50],['s100','💎 100 days',g=>S.streak>=100],
 ['w10','🌱 10 learned',g=>nLearned()>=10],['w100','🌳 100 learned',g=>nLearned()>=100],['w500','🌲 500 learned',g=>nLearned()>=500],
 ['a100','✍️ 100 answers',g=>g.total>=100],['a1000','📚 1,000 answers',g=>g.total>=1000],['c10','⚡ 10 combo',g=>g.best>=10],['c25','🌟 25 combo',g=>g.best>=25],['gr25','📐 25 grammar answers',g=>(g.gtotal||0)>=25],['gr250','📐 250 grammar answers',g=>(g.gtotal||0)>=250],['gl10','📐 10 patterns learned',g=>S.gram&&Object.values(S.gram).filter(x=>x.s==='learned').length>=10],['l5','🎓 Level 5',g=>level(g.xp).n>=5],['l10','🎓 Level 10',g=>level(g.xp).n>=10]];
const nLearned=()=>cards().filter(c=>c.s==='learned').length;
function G(){S.g=S.g||{xp:0,days:{},freezes:0,badges:[],combo:0,best:0,total:0,sound:false};return S.g}
function level(xp){let n=1,need=100,acc=0;while(xp>=acc+need){acc+=need;n++;need=100+n*50}return {n,into:xp-acc,need}}
// On open: missed days use streak freezes if available, otherwise the streak resets (progress is never deleted).
function checkStreak(){const g=G(),t=today();if(!S.lastDay||S.lastDay>=addDays(t,-1))return 0;const missed=dayDiff(S.lastDay,t)-1;
  if(missed<=g.freezes){for(let i=1;i<=missed;i++)g.days[addDays(S.lastDay,i)]={frozen:1};g.freezes-=missed;S.lastDay=addDays(t,-1);save();toast('🧊 Streak freeze used ×'+missed);return 0}
  if(S.streak>0){g.lostStreak=S.streak;S.streak=0;save()}return missed}
const SAD=['I missed you! 你去哪儿了? 🥺','Your panda is hungry for new words… 🎋','Yesterday was so quiet without you 😢','Feed me a few words? 🥟'];
const HAPPY=['太棒了! You did it 🏮','Look at you go! 加油! 💪','Your garden is blooming 🌸','Daily goal done — 真棒! 🎉'];
const pick=a=>a[Math.floor(Math.random()*a.length)];
function mood(){const g=G(),t=today(),d=g.days[t]||{};if(d.met)return 'happy';if(g.lostStreak&&!d.n)return 'sad';const yest=g.days[addDays(t,-1)];if(S.lastDay&&!yest&&!d.n)return 'sad';return d.n?'ok':'idle'}
function renderGame(){const g=G(),m=mood(),em={happy:'🏮',ok:'🐼',idle:'🥟',sad:'🐼'}[m];
  $('mEm').textContent=em;$('mEm').className='mem '+(m==='sad'?'sad':m==='happy'?'happy':'');$('sMasc').textContent=em;
  $('mMsg').textContent=m==='sad'?(g.lostStreak?`Oh no, your ${g.lostStreak}-day streak is gone… ${pick(SAD)}`:pick(SAD)):m==='happy'?pick(HAPPY):m==='ok'?'Keep going, you’re doing great! 继续加油! 🐼':'A few words today? 今天学几个字吧 🎋';
  $('flame').style.fontSize=(26+Math.min(S.streak,60)*0.7)+'px';$('flame').style.filter=S.streak?'none':'grayscale(1)';
  $('streakTxt').textContent=`${S.streak}-day streak`;$('freezeTxt').textContent=`🧊 ${g.freezes}/2 freezes`+(S.streak?'':' · start one today!');
  const L=level(g.xp);$('lvlTxt').textContent=`Level ${L.n} · ${g.xp} XP`;$('xpbar').style.width=(L.into/L.need*100)+'%';$('xpTxt').textContent=`${L.need-L.into} XP to level ${L.n+1}`;
  const t=today(),first=Object.keys(g.days).filter(k=>g.days[k].n||g.days[k].met).sort()[0]||t;let html='';const start=addDays(t,-(28+(new Date(t+'T12:00:00').getDay()+6)%7));
  for(let i=0;i<35;i++){const k=addDays(start,i),d=g.days[k]||{};let cls='',txt=+k.slice(8);
    if(k>t)cls='fut';else if(d.met){cls='met';txt=d.sticker}else if(d.frozen){cls='frz';txt='🧊'}else if(k<t&&k>=first)cls='miss';if(k===t)cls+=' today';html+=`<div class="${cls}" title="${k}">${txt}</div>`}
  $('cal').innerHTML=html;$('badges').innerHTML=BADGES.map(([id,name])=>`<span class="${g.badges.includes(id)?'':'lock'}">${name}</span>`).join('');
  $('moreRound').hidden=!(S.doneCount>=S.goal&&g.showMore)}
function checkBadges(){const g=G();BADGES.forEach(([id,name,f])=>{if(!g.badges.includes(id)&&f(g)){g.badges.push(id);setTimeout(()=>celebrate('🏅 Badge: '+name),900)}})}
let actx=null;function beep(ok){const g=G();if(!g.sound)return;try{if(navigator.vibrate)navigator.vibrate(ok?20:[30,40,30]);actx=actx||new (window.AudioContext||window.webkitAudioContext)();const o=actx.createOscillator(),v=actx.createGain();o.type='sine';o.frequency.value=ok?880:220;v.gain.value=.08;o.connect(v);v.connect(actx.destination);o.start();if(ok)o.frequency.setValueAtTime(1320,actx.currentTime+.08);o.stop(actx.currentTime+.18)}catch(e){}}
function reward(g){const G_=G(),t=today();G_.total++;const d=G_.days[t]=G_.days[t]||{};d.n=(d.n||0)+1;
  if(g===2){G_.combo++;G_.best=Math.max(G_.best,G_.combo)}else G_.combo=0;
  const mult=G_.combo>=10?3:G_.combo>=5?2:G_.combo>=3?1.5:1,xp=Math.round([1,5,10][g]*mult),before=level(G_.xp).n;G_.xp+=xp;
  $('combo').textContent=G_.combo>=3?`⚡ ${G_.combo} combo ×${mult}`:'';const xg=$('xpGain');xg.textContent='+'+xp+' XP';xg.classList.add('on');clearTimeout(xg._t);xg._t=setTimeout(()=>xg.classList.remove('on'),700);
  const sm=$('sMasc');sm.classList.remove('j','s');void sm.offsetWidth;sm.classList.add(g===2?'j':'s');sm.textContent=g===2?'🏮':g===1?'🐼':'🍂';beep(g>0);
  if(level(G_.xp).n>before)setTimeout(()=>celebrate('🎓 Level '+level(G_.xp).n+'!'),500);
  if(G_.combo===5||G_.combo===10||G_.combo===25)toast('⚡ '+G_.combo+' in a row!');
  if(S.doneCount>=S.goal&&!d.met){d.met=1;d.sticker=STICKERS[(dayDiff('2026-01-01',t)%STICKERS.length+STICKERS.length)%STICKERS.length];G_.lostStreak=0;G_.showMore=1;
    if(S.streak>0&&S.streak%7===0&&G_.freezes<2){G_.freezes++;setTimeout(()=>toast('🧊 Earned a streak freeze!'),1800)}
    setTimeout(()=>toast('Sticker of the day: '+d.sticker),1400)}
  checkBadges()}

// ---- Grammar exercises (built-in content; sentences are written with spaces between words and [brackets] around the target)
const brk=s=>[...s.matchAll(/\[(.*?)\]/g)].map(m=>m[1]);const nosp=s=>s.replace(/\s+/g,'');
const wordsOf=s=>s.split(/\s+/).filter(Boolean).map(w=>w.replace(/[\[\]]/g,''));
const hlZh=s=>esc(nosp(s)).replace(/\[(.*?)\]/g,'<b class="hl">$1</b>');
function gReveal(p,it,ok,extra){
  return `${extra||''}<div class="gpat">${esc(p.pattern)}</div><small>${esc(p.explain)}</small><br><span class="hanline">${hlZh(it.zh)}</span> <button class="say" data-say="${esc(nosp(it.zh).replace(/[\[\]]/g,''))}">🔊</button><br><small class="py sm">${esc(it.py)}</small><br><small>${esc(it.en)}</small>`}
function gFinish(g,html,cls){const it=sess.q[sess.i],r=$('gRev');r.className='reveal '+cls;r.innerHTML=html;r.hidden=false;finishQ('gramBox',g,it)}
function showGram(item){const p=GPT[item.g],it=p.items[Math.random()*p.items.length|0],b=brk(it.zh);sess.gi={p,it};
  ['gOpts','gFill','gReo','gBuild','gSelf','gRev'].forEach(id=>$(id).hidden=true);$('gPat').textContent='';$('gPrompt').textContent='';$('gSent').textContent='';
  let t=item.t;const toks=wordsOf(it.zh);if(t==='reorder'&&(toks.length<3||toks.length>10))t='choose';
  $('gLab').textContent={choose:'📐 Pick the right word / pattern',fill:'📐 Fill the gap',reorder:'📐 Put the words in order',build:'📐 Build a sentence'}[t];sess.gt=t;
  const gap='<span class="gap">&nbsp;?&nbsp;</span>';
  if(t==='choose'){const ds=it.d||p.distractors,parts=ds.map(d=>d.split(/\s*…\s*/)),full=parts.every(x=>x.length===b.length)&&b.length>1;
    const right=full?b.join(' … '):b[0];let k=0;$('gSent').innerHTML=esc(nosp(it.zh)).replace(/\[(.*?)\]/g,(m,x)=>(full||k++===0)?gap:esc(x));$('gPrompt').textContent=it.en;
    const wrong=parts.map(x=>full?x.join(' … '):x[0]).filter((o,i,arr)=>o!==right&&arr.indexOf(o)===i).sort(()=>Math.random()-.5).slice(0,3);
    const opts=[right,...wrong].sort(()=>Math.random()-.5);
    $('gOpts').innerHTML=opts.map(o=>`<button data-o="${esc(o)}">${esc(o)}</button>`).join('');$('gOpts').hidden=false;
    $('gOpts').querySelectorAll('button').forEach(x=>x.onclick=()=>{if(sess.done)return;const ok=x.dataset.o===right;$('gOpts').querySelectorAll('button').forEach(y=>{y.disabled=true;if(y.dataset.o===right)y.classList.add('ok')});if(!ok)x.classList.add('no');
      gFinish(ok?2:0,gReveal(p,it,ok,ok?'🎉 Correct!':'💭 Not quite —'),ok?'ok':'no')})}
  else if(t==='fill'){let k=0;$('gSent').innerHTML=esc(nosp(it.zh)).replace(/\[(.*?)\]/g,(m,x)=>k++===0?gap:esc(x));$('gPrompt').textContent=it.en;$('gIn').value='';$('gIn').disabled=false;$('gCheck').hidden=false;$('gFill').hidden=false}
  else if(t==='reorder'){sess.chips=toks.map((w,i)=>({w,i}));sess.ans=[];$('gPrompt').textContent=it.en;let sh=sess.chips.slice();for(let n=0;n<5&&sh.map(x=>x.i).join()===sess.chips.map(x=>x.i).join();n++)sh.sort(()=>Math.random()-.5);sess.pool=sh;renderChips();$('gReo').hidden=false}
  else{$('gPat').textContent='Pattern: '+p.pattern;$('gPrompt').textContent='Use this pattern to say: “'+it.en+'”';$('gTxt').value='';$('gTxt').disabled=false;sess.gshown=0;$('gShow').hidden=false;$('gBuild').hidden=false}}
function renderChips(){const mk=arr=>arr.map((c,j)=>`<button data-j="${j}">${esc(c.w)}</button>`).join('');$('gChips').innerHTML=mk(sess.pool);$('gAns').innerHTML=mk(sess.ans);
  $('gChips').querySelectorAll('button').forEach(b=>b.onclick=()=>{if(sess.done)return;sess.ans.push(sess.pool.splice(+b.dataset.j,1)[0]);renderChips()});
  $('gAns').querySelectorAll('button').forEach(b=>b.onclick=()=>{if(sess.done)return;sess.pool.push(sess.ans.splice(+b.dataset.j,1)[0]);renderChips()})}
function gCheckFill(){if(sess.done)return;const {p,it}=sess.gi,want=brk(it.zh)[0],raw=$('gIn').value;if(!raw.trim())return toast('Type your answer ✏️');
  const r=PY.checkAnswer(raw,[{zh:want,py:(it.bp||[])[0]||''}]);$('gIn').disabled=true;$('gCheck').hidden=true;
  const k=(r.kind==='ok'||r.kind==='ok-notones')?'ok':(r.kind==='tone'||r.kind==='close')?'close':'no';
  gFinish({ok:2,close:1,no:0}[k],gReveal(p,it,0,{ok:'🎉 Correct!',close:'🤏 Almost!',no:'💭 Answer:'}[k]+' <b>'+esc(want)+'</b> <small class="py sm">'+esc((it.bp||[])[0]||'')+'</small>'+(r.kind==='tone'?'<br><small>Right sounds — check the tones.</small>':'')),k)}
function gCheckReo(){if(sess.done)return;if(sess.pool.length)return toast('Use all the words 🧩');const {p,it}=sess.gi,ok=sess.ans.map(c=>c.w).join('')===sess.chips.map(c=>c.w).join('');
  gFinish(ok?2:0,gReveal(p,it,ok,ok?'🎉 Correct!':'💭 The right order is:'),ok?'ok':'no')}
function gShowModel(){if(sess.done||sess.gshown)return;sess.gshown=1;const {p,it}=sess.gi;$('gShow').hidden=true;$('gTxt').disabled=true;const r=$('gRev');r.className='reveal';r.innerHTML=gReveal(p,it,0,'✍️ Model sentence:');r.hidden=false;
  r.querySelectorAll('[data-say]').forEach(x=>x.onclick=()=>speak(x.dataset.say));$('gSelf').hidden=false}
function gSelfGrade(g){if(sess.done)return;$('gSelf').hidden=true;$('gTxt').disabled=false;sess.gshown=0;const it=sess.q[sess.i];record(cur(),g,it);sess.done=true;$('qNext').hidden=false;if(g===2)confetti(30)}
const GS={learn:'To learn',practiced:'Practiced',learned:'Learned'};
function renderGram(){const el=$('gList');ensureGram();
  const cnt={learn:0,practiced:0,learned:0};Object.values(S.gram).forEach(x=>cnt[x.s]++);
  $('gSum').innerHTML=Object.keys(cnt).map(k=>`<div class="${k}">${cnt[k]}<br><small>${GS[k]}</small></div>`).join('');
  el.innerHTML=GR.groups.map(g=>{const ps=GR.points.filter(p=>p.group===g.n),c={learn:0,practiced:0,learned:0};ps.forEach(p=>c[(S.gram[p.id]||{}).s||'learn']++);
    const bar=['learned','practiced','learn'].map(k=>`<i class="${k}" style="width:${c[k]/ps.length*100}%"></i>`).join('');
    return `<details class="ggrp"><summary>${g.n}. ${esc(g.title)} <span class="muted">· ${c.learned}/${ps.length} learned</span><div class="gbar">${bar}</div></summary>`+ps.map(p=>`<div class="gpt"><div><b>${esc(p.pattern)}</b><small>${esc(p.explain)}</small><small class="py sm">${esc(nosp(p.items[0].zh).replace(/[\[\]]/g,''))} — ${esc(p.items[0].en)}</small></div><select data-g="${p.id}">${Object.keys(GS).map(k=>`<option value="${k}"${(S.gram[p.id]||{}).s===k?' selected':''}>${GS[k]}</option>`).join('')}</select></div>`).join('')+'</details>'}).join('');
  el.querySelectorAll('select').forEach(s=>s.onchange=()=>{const st=S.gram[s.dataset.g];st.s=s.value;st.lv=s.value==='practiced'?1:0;st.due=Date.now()+(s.value==='learned'?LEARNED_IV0:0);save();toast('Moved ✓');renderGram()})}
// ---- card types: fill-in-the-blank and English -> Chinese
function distractors(c){const s=sentOf(c),all=cards(),want=[...firstVariant(c.zh)].length,bad=new Set([firstVariant(c.zh)]);
  const ok=w=>w!==c&&firstVariant(w.zh)&&!bad.has(firstVariant(w.zh))&&!s.zh.includes(firstVariant(w.zh))&&!/[a-zA-Z]/.test(w.zh);
  const pool=all.filter(ok),same=pool.filter(w=>[...firstVariant(w.zh)].length===want);
  const out=[],used=new Set();for(const w of [...same.sort(()=>Math.random()-.5),...pool.sort(()=>Math.random()-.5)]){const a=firstVariant(w.zh);if(!used.has(a)){used.add(a);out.push({zh:a,py:String(w.py||'').split(/\s*\/\s*/)[0]})}if(out.length===2)break}return out}
function revealHTML(c){const s=sentOf(c)||{zh:c.ex,blank:c.zh},hl=esc(s.zh).replace(esc(s.blank),'<b class="hl">'+esc(s.blank)+'</b>');return `<span class="hanline">${hl}</span> <button class="say" data-say="${esc(s.zh)}">🔊</button>${s.py?`<br><small class="py sm">${esc(s.py)}</small>`:''}${s.en?`<br><small>${esc(s.en)}</small>`:''}<br><small>${esc(c.zh)}${c.py?' · '+esc(c.py):''} — ${esc(c.en)}</small>`}
function finishQ(box,g,item){record(cur(),g,item);sess.done=true;const b=$(box);b.classList.remove('pop','wig');void b.offsetWidth;b.classList.add(g===2?'pop':'wig');if(g===2)confetti(30);$('qNext').hidden=false;setTimeout(()=>$('qNext').scrollIntoView({block:'center',behavior:SAFE?'auto':'smooth'}),60);
  document.querySelectorAll('#'+box+' [data-say]').forEach(x=>x.onclick=()=>speak(x.dataset.say))}
function showPick(c){const s=sentOf(c);$('pSent').innerHTML=esc(s.zh).replace(esc(s.blank),'<span class="gap">&nbsp;?&nbsp;</span>');$('pTr').textContent=s.en?'“'+s.en+'”':'💡 The missing word means: '+c.en;$('pRev').hidden=true;
  const right={zh:s.blank,py:String(c.py||'').split(/\s*\/\s*/)[0]},opts=[right,...distractors(c)].sort(()=>Math.random()-.5);
  $('pOpts').innerHTML=opts.map(o=>`<button data-o="${esc(o.zh)}">${esc(o.zh)}${o.py?`<small class="pyh">${esc(o.py)}</small>`:''}</button>`).join('');
  $('pOpts').querySelectorAll('button').forEach(b=>b.onclick=()=>{if(sess.done)return;const ok=b.dataset.o===s.blank;
    $('pOpts').querySelectorAll('button').forEach(x=>{x.disabled=true;if(x.dataset.o===s.blank)x.classList.add('ok')});if(!ok)b.classList.add('no');
    const r=$('pRev');r.className='reveal '+(ok?'ok':'no');r.innerHTML=(ok?'🎉 Correct! ':'💭 Not quite — ')+'<br>'+revealHTML(c);r.hidden=false;finishQ('pickBox',ok?2:0)})}
function showType(c){sess.hint=false;$('tEn').textContent=c.en;$('tIn').value='';$('tIn').disabled=false;$('tIn').placeholder='汉字 or pinyin (nǐ hǎo / ni3hao3 / nihao)';$('tRev').hidden=true;$('tCheck').hidden=false;$('tHint').disabled=$('tShow').disabled=false;setTimeout(()=>{try{$('tIn').focus()}catch(e){}},50)}
function typeResult(kind,detail){const c=cur(),r=$('tRev');$('tIn').disabled=true;$('tCheck').hidden=true;$('tHint').disabled=$('tShow').disabled=true;
  const g=(kind==='ok'||kind==='ok-notones')?(sess.hint?1:2):(kind==='close'||kind==='tone')?1:0;
  const msg={ok:sess.hint?'👍 Correct (with a hint)':'🎉 Correct!','ok-notones':sess.hint?'👍 Correct (with a hint) — now with tones:':'🎉 Correct! (tones for next time:)',tone:'🤏 Right sounds — check the tones:',close:'🤏 Almost! Check the spelling:',no:'💭 The answer is:',shown:'👀 The answer is:'}[kind];
  r.className='reveal '+((kind==='ok'||kind==='ok-notones')?'ok':(kind==='close'||kind==='tone')?'close':'no');
  r.innerHTML=`${msg}<br><b class="hl hanline">${esc(c.zh)}</b> <button class="say" data-say="${esc(firstVariant(c.zh)||c.zh)}">🔊</button>${c.py?`<br><span class="py">${esc(c.py)}</span>`:''}`+(c.ex?`<br><small>${esc(c.ex)}${c.exPy?'<br>'+esc(c.exPy):''}${c.exEn?'<br>'+esc(c.exEn):''}</small>`:'');r.hidden=false;finishQ('typeBox',g)}
function checkType(){if(sess.done)return;const raw=$('tIn').value;if(!raw.trim())return toast('Type your answer ✏️');
  const r=PY.checkAnswer(raw,answers(cur()));typeResult(r.kind==='empty'?'no':r.kind)}
function init(){if(inited)return renderHome();inited=true;ensureGram();applyPy();show('home');
  $('tCheck').onclick=checkType;$('gCheck').onclick=gCheckFill;$('gIn').addEventListener('keydown',e=>{if(e.key==='Enter')gCheckFill()});$('gReoCheck').onclick=gCheckReo;
  $('gUndo').onclick=()=>{if(!sess.done&&sess.ans.length){sess.pool.push(sess.ans.pop());renderChips()}};$('gShow').onclick=gShowModel;document.querySelectorAll('#gSelf button').forEach(b=>b.onclick=()=>gSelfGrade(+b.dataset.sg));
  $('gStart').onclick=()=>{startSession('gram');show('study')};$('gmixSel').value=S.gmix==null?20:S.gmix;$('gmixSel').onchange=e=>{S.gmix=+e.target.value;save()};$('tIn').addEventListener('keydown',e=>{if(e.key==='Enter')checkType()});
  $('tHint').onclick=()=>{if(sess.done)return;sess.hint=true;const c=cur(),z=firstVariant(c.zh)||c.zh,n=[...z].length;$('tIn').placeholder=`${n} character${n>1?'s':''}, starts with ${[...z][0]}…`;toast(`💡 ${n} character${n>1?'s':''} · starts with “${[...z][0]}”`)};
  $('tShow').onclick=()=>{if(!sess.done)typeResult('shown')};$('qNext').onclick=()=>{sess.i++;showCard()};
  settings();$('tyFlash').checked=S.types.flash;$('tyPick').checked=S.types.pick;$('tyType').checked=S.types.type;$('mixSel').value=S.mix;$('pySel').value=S.pyMode==='after'?'after':'always';
  $('pySel').onchange=e=>{S.pyMode=e.target.value;applyPy();save()};
  [['tyFlash','flash'],['tyPick','pick'],['tyType','type']].forEach(([id,k])=>$(id).onchange=e=>{S.types[k]=e.target.checked;if(!S.types.flash&&!S.types.pick&&!S.types.type){S.types.flash=true;$('tyFlash').checked=true}save()});
  $('mixSel').onchange=e=>{S.mix=e.target.value;save()};
  document.querySelectorAll('nav button').forEach(b=>b.onclick=()=>show(b.dataset.v));
  $('startBtn').onclick=()=>{if(S.g)S.g.showMore=0;sess=null;show('study')};$('quitBtn').onclick=()=>{sess=null;show('home')};
  $('card').onclick=e=>{if(e.target.classList.contains('say'))return;$('card').classList.toggle('flip')};
  $('say1').onclick=$('say2').onclick=()=>cur()&&speak(firstVariant(cur().zh)||cur().zh);
  document.querySelectorAll('.grade button[data-g]').forEach(b=>b.onclick=()=>answer(+b.dataset.g));
  let sx,sy;const cd=$('card');cd.addEventListener('touchstart',e=>{sx=e.touches[0].clientX;sy=e.touches[0].clientY},{passive:true});
  cd.addEventListener('touchend',e=>{const dx=e.changedTouches[0].clientX-sx,dy=e.changedTouches[0].clientY-sy;if(Math.abs(dx)>70&&Math.abs(dx)>Math.abs(dy))answer(dx>0?2:0);else if(dy<-70)answer(1)});
  document.querySelectorAll('#wtabs button').forEach(b=>b.onclick=()=>{tab=b.dataset.s;shown=60;renderWords()});
  $('q').oninput=()=>{shown=60;renderWords()};$('more').onclick=()=>{shown+=100;renderWords()};
  $('addBtn').onclick=()=>{const zh=$('nzh').value.trim(),en=$('nen').value.trim();if(!zh||!en)return toast('Need hanzi + meaning');const py=fixPy($('npy').value),id='u'+Date.now().toString(36);
    S.removed=(S.removed||[]).filter(k=>k!==wkey(zh,py));S.cards[id]={id,zh,py,en,ex:$('nex').value.trim(),s:'learn',lv:0,due:Date.now(),seen:0,ok:0,miss:0,user:1,o:Math.min(0,...cards().map(c=>c.o||0))-1};save();$('nzh').value=$('npy').value=$('nen').value=$('nex').value='';celebrate('➕ Added: '+zh,false);$('ver').textContent=verText()};
  if(![...$('goalSel').options].some(o=>o.value==S.goal))$('goalSel').add(new Option(S.goal+' (custom)',S.goal),$('goalSel').options.length-1);$('goalSel').value=S.goal;$('sndToggle').checked=G().sound;$('sndToggle').onchange=e=>{G().sound=e.target.checked;save();beep(true)};$('sessSel').value=S.sessN;$('goalSel').onchange=e=>{let v=e.target.value;if(v==='custom'){v=parseInt(prompt('Daily goal (cards per day):',S.goal),10);if(!(v>0&&v<=1000)){e.target.value=S.goal;return}if(![...e.target.options].some(o=>o.value==v))e.target.add(new Option(v+' (custom)',v),e.target.options.length-1);e.target.value=v}S.goal=+v;save()};
  $('moreBtn').onclick=()=>{G().showMore=0;sess=null;show('study')};$('sessSel').onchange=e=>{S.sessN=+e.target.value;save()};
  $('expBtn').onclick=()=>{const b=new Blob([JSON.stringify(S)],{type:'application/json'}),a=document.createElement('a');a.href=URL.createObjectURL(b);a.download='hanyu-backup-'+today()+'.json';a.click()};
  $('impBtn').onclick=()=>$('impFile').click();
  $('impFile').onchange=e=>{e.target.files[0]&&handleFile(e.target.files[0],false);e.target.value=''};
  $('starterBtn2').onclick=()=>{if(!confirm('Add any starter words that are missing (including ones you removed)? Words you already have and all progress stay untouched.'))return;const r=loadStarter({force:true});toast(r.added?`🎒 +${r.added} starter words`:'Your deck already has every starter word ✓');if(r.added)confetti(80);$('ver').textContent=verText()};
  $('ver').textContent=verText();$('onbOk').onclick=()=>{S.onboarded=true;save();renderOnboard()};
  renderHome();
}
function welcome(){document.body.classList.add('welcome');$('v-welcome').classList.add('on')}
function leaveWelcome(){document.body.classList.remove('welcome');$('v-welcome').classList.remove('on');init()}
async function handleFile(file,fromWelcome){try{if(!fromWelcome&&S&&Object.keys(S.cards).length&&/^\s*\{\s*"v"/.test((await file.slice(0,40).text()))&&!confirm('This is a progress backup and will REPLACE your current progress. Continue?'))return;const r=importText(await file.text(),file.name);toast(r==='progress'?'Progress restored ✓':(`🌸 +${r.added} new · ${r.updated} updated`));confetti(120);
  if(fromWelcome)leaveWelcome();else{applyPy();show('home')}}catch(e){toast('Hmm, that file didn\'t work 🙈')}}
let inited=false;
// Crash-loop guard: if the last start never reached "stable", switch to safe mode next time and offer recovery.
let bootN=+(localStorage.getItem(BOOT)||0);
if(bootN>=3&&!SAFE){localStorage.setItem(SAFEKEY,'1');location.replace(location.pathname+'?safe=1');}
localStorage.setItem(BOOT,String(bootN+1));setTimeout(()=>localStorage.setItem(BOOT,'0'),1500);
function recovery(err){document.body.classList.add('welcome');document.querySelectorAll('.view').forEach(v=>v.classList.remove('on'));$('v-recover').classList.add('on');
  $('recErr').textContent=String(err&&err.message||err);
  $('recExport').onclick=()=>{const raw=localStorage.getItem(KEY)||'',b=new Blob([raw],{type:'application/json'}),a=document.createElement('a');a.href=URL.createObjectURL(b);a.download='hanyu-rescue-'+today()+'.json';document.body.appendChild(a);a.click()};
  $('recSafe').onclick=()=>{localStorage.setItem(SAFEKEY,'1');location.replace(location.pathname+'?safe=1')};
  $('recReset').onclick=()=>{if(confirm('Erase all progress on this phone? Export first if unsure.')){localStorage.removeItem(KEY);localStorage.setItem(BOOT,'0');location.replace(location.pathname)}}}
function boot(){try{
  $('seedFile').onchange=e=>{e.target.files[0]&&handleFile(e.target.files[0],true);e.target.value=''};$('seedBtn').onclick=()=>$('seedFile').click();
  $('starterBtn').onclick=()=>{try{const r=loadStarter({force:true});leaveWelcome();toast(`🎒 ${r.added} starter words loaded`);confetti(100)}catch(e){console.error(e);toast('Hmm, that didn\'t work 🙈')}};
  $('emptyBtn').onclick=()=>{S=blank();saveNow();leaveWelcome();show('more')};
  $('safeToggle').checked=SAFE;$('safeToggle').onchange=e=>{localStorage.setItem(SAFEKEY,e.target.checked?'1':'0');location.replace(location.pathname+(e.target.checked?'?safe=1':''))};
  if(S){localStorage.setItem(SEEDKEY,'1');init()}
  else if(localStorage.getItem(SEEDKEY)!=='1'){ // first launch ever on this phone: ready-to-use beginner deck, seeded exactly once
    S=blank();S.onboarded=false;loadStarter();S.seeded=true;localStorage.setItem(SEEDKEY,'1');saveNow();init()}
  else welcome() // data was reset or removed after the first launch: never re-seed silently
  }catch(e){console.error(e);recovery(e)}}
load().then(boot,e=>{console.error(e);recovery(e)});
if('serviceWorker' in navigator)navigator.serviceWorker.register('sw.js').then(r=>r.update()).catch(()=>{});
window.__app={VER,wkey,removeWord,get sess(){return sess},showCard,startSession,gramQueue,checkStreak,level,renderHome,saveNow,mergeWords,parseWords,importText,loadStarter,pickType,sentOf,buildQueue,grade,checkType,get S(){return S},PRAC_IV,LEARNED_IV0,GR,STARTER};
