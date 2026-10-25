// Pinyin + answer-checking helpers. Works in the browser (window.Pinyin) and in Node (module.exports) for tests.
(function(root){
'use strict';
const MARK={a:'āáǎà',e:'ēéěè',i:'īíǐì',o:'ōóǒò',u:'ūúǔù','ü':'ǖǘǚǜ'};
const MARKED=/[āáǎàēéěèīíǐìōóǒòūúǔùǖǘǚǜ]/;
const TONE_OF={};for(const k in MARK)[...MARK[k]].forEach((c,i)=>TONE_OF[c]=i+1);
function addMark(syl,t){
  if(!(t>=1&&t<=4))return syl;
  let i=syl.search(/[ae]/);
  if(i<0&&/ou/.test(syl))i=syl.indexOf('o');
  if(i<0){const m=[...syl.matchAll(/[aeiouü]/g)];if(!m.length)return syl;i=m[m.length-1].index}
  return syl.slice(0,i)+MARK[syl[i]][t-1]+syl.slice(i+1);
}
// "ni3 hao3" / "nu:3" / "lv4" -> "nǐ hǎo" / "nǚ" / "lǜ".  Text without digits is returned lower-cased with ü fixed.
function toMarks(s){
  s=String(s||'').normalize('NFC').toLowerCase().replace(/u:/g,'ü').replace(/v/g,'ü');
  return s.replace(/([a-zü]+)([0-5])/g,(m,syl,t)=>addMark(syl,+t)).normalize('NFC');
}
const hasToneInfo=s=>MARKED.test(String(s).normalize('NFC'))||/[a-zü:v]\s*[1-4]/i.test(String(s));
// letters only, tones removed: "Nǐ hǎo!" -> "nihao"; ü->u so lü/lu/lv all match
function toneless(s){
  return String(s||'').normalize('NFC').toLowerCase().replace(/u:/g,'u').replace(/v/g,'u').replace(/ü|ǖ|ǘ|ǚ|ǜ/g,'u')
    .normalize('NFD').replace(/[\u0300-\u036f]/g,'').replace(/[^a-z]/g,'');
}
// Marked form used for exact-tone comparison. Also folds the standard tone-sandhi spellings (bú, yí/yì -> bù, yī) so either is accepted.
function marked(s){
  const t=toMarks(s).replace(/[^a-zāáǎàēéěèīíǐìōóǒòūúǔùǖǘǚǜü]/g,'');
  return t.replace(/bú/g,'bù').replace(/y[íì](?!n)/g,'yī');
}
const HAN=/[\u3400-\u9fff]/;
const hanOnly=s=>String(s||'').replace(/[^\u3400-\u9fff]/g,'');
function lev(a,b){const m=a.length,n=b.length;let p=Array.from({length:n+1},(_,j)=>j);for(let i=1;i<=m;i++){const q=[i];for(let j=1;j<=n;j++)q[j]=Math.min(p[j]+1,q[j-1]+1,p[j-1]+(a[i-1]===b[j-1]?0:1));p=q}return p[n]}
// answers: [{zh:'你好', py:'nǐ hǎo'}...]   (py may contain "a / b" alternatives)
// returns {kind, ...}: ok (exact: hanzi, or pinyin with right tones), ok-notones (pinyin typed without tones),
//   tone (right letters, wrong/mixed tones), close (small typo), no
function checkAnswer(input,answers){
  const raw=String(input||'').trim();if(!raw)return {kind:'empty'};
  const alts=[];answers.forEach(a=>{const zhs=String(a.zh||'').split(/[\/；;]/);const pys=String(a.py||'').split(/[\/；;]/);
    zhs.forEach((z,i)=>{const zz=hanOnly(z);if(zz||pys[i]||pys[0])alts.push({zh:zz,py:(pys[i]!==undefined?pys[i]:pys[0])||''})});pys.forEach(p=>{if(p.trim())alts.push({zh:'',py:p})})});
  if(HAN.test(raw)){
    const v=hanOnly(raw);
    if(alts.some(a=>a.zh&&a.zh===v))return {kind:'ok',mode:'hanzi'};
    const d=Math.min(...alts.filter(a=>a.zh).map(a=>lev(v,a.zh)),99);
    const L=Math.max(...alts.map(a=>a.zh.length),0);
    return {kind:d<=1&&L>=3?'close':'no',mode:'hanzi'};
  }
  const pys=alts.map(a=>a.py).filter(p=>toneless(p));
  if(!pys.length)return {kind:'no',mode:'pinyin'};
  const inT=toneless(raw),withTones=hasToneInfo(raw),inM=marked(raw);
  if(pys.some(p=>marked(p)===inM&&withTones))return {kind:'ok',mode:'pinyin'};
  if(pys.some(p=>toneless(p)===inT)){
    return {kind:withTones?'tone':'ok-notones',mode:'pinyin'};
  }
  const d=Math.min(...pys.map(p=>lev(inT,toneless(p))));
  const L=Math.max(...pys.map(p=>toneless(p).length));
  return {kind:d<=1&&L>=4?'close':'no',mode:'pinyin'};
}
root.Pinyin={addMark,toMarks,toneless,marked,hasToneInfo,checkAnswer,lev,hanOnly,HAN,TONE_OF};
if(typeof module!=='undefined'&&module.exports)module.exports=root.Pinyin;
})(typeof window!=='undefined'?window:globalThis);
