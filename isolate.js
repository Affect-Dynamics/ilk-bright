import fs from 'node:fs/promises';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {parseArgs} from 'node:util';
import {fileURLToPath} from 'node:url';
import {performance} from 'node:perf_hooks';
import {TASKS,indexDocs,rank,queryTerms,metrics,makeJev,rerank} from './bright.js';
import {CAPABILITIES,discoverCapabilities,capabilityRank,enhancedDocs,codeTokens,protectedMerge} from './capabilities.js';
export const ARMS=['bm25_100','bm25_200','lexical','capability','both','allocation_90_10'];
const ids=rs=>rs.map(r=>r.id);
const unique=rs=>[...new Map(rs.map(r=>[r.id,r])).values()];
const digest=x=>createHash('sha256').update(JSON.stringify(x)).digest('hex');
const mean=xs=>xs.reduce((a,b)=>a+b,0)/xs.length;
export function allocate90_10(base,lexical,capability,extended,budget=200){
 const slots=Math.max(0,budget-base.length),capSlots=Math.round(slots*.1);
 const reserved=protectedMerge(base,[capability],capSlots);
 const filled=protectedMerge(reserved,[lexical],slots-capSlots);
 const backfilled=protectedMerge(filled,[lexical,capability,extended],Math.max(0,budget-filled.length));
 return {rows:backfilled,fallback:backfilled.length-filled.length,capabilitySeats:reserved.length-base.length,lexicalSeats:filled.length-reserved.length};
}
export function generatePools(idx,ex,q,excluded,probs,{baseSize=100,budget=200}={}){
 const extended=rank(idx,queryTerms(q),excluded,budget),base=extended.slice(0,baseSize);
 const lexical=rank(ex,new Map([...new Set(codeTokens(q))].map(t=>[t,1])),excluded,budget);
 const cap=capabilityRank(ex,probs,excluded,budget);
 const pools={bm25_100:base,bm25_200:extended},fallback={bm25_100:0,bm25_200:0};
 for(const [name,channels] of [['lexical',[lexical]],['capability',[cap]],['both',[cap,lexical]]]){
  const raw=protectedMerge(base,channels,budget-baseSize);
  pools[name]=protectedMerge(raw,[extended],Math.max(0,budget-raw.length));fallback[name]=pools[name].length-raw.length;
 }
 const allocation=allocate90_10(base,lexical,cap,extended,budget);
 pools.allocation_90_10=allocation.rows;fallback.allocation_90_10=allocation.fallback;
 return {pools,channels:{lexical,capability:cap},fallback,allocation:{capabilitySeats:allocation.capabilitySeats,lexicalSeats:allocation.lexicalSeats}};
}
export function candidateStats(rows,gold,base){const g=new Set(gold.map(String)),hits=rows.filter(r=>g.has(r.id)),baseline=new Set(ids(base));return {size:rows.length,goldHits:hits.length,recall:g.size?hits.length/g.size:0,oracle:metrics(hits,gold).ndcg10,addedGold:hits.filter(r=>!baseline.has(r.id)).length,rescued:!base.some(r=>g.has(r.id))&&hits.length>0};}
export function uniqueContribution(channels,base,gold){const g=new Set(gold.map(String)),b=new Set(ids(base)),l=new Set(ids(channels.lexical)),c=new Set(ids(channels.capability));const only=(a,other)=>[...a].filter(id=>g.has(id)&&!b.has(id)&&!other.has(id));return {lexicalOnly:only(l,c),capabilityOnly:only(c,l),shared:[...l].filter(id=>g.has(id)&&!b.has(id)&&c.has(id)),lexicalRescue:!base.some(r=>g.has(r.id))&&[...l].some(id=>g.has(id))&&! [...c].some(id=>g.has(id)),capabilityRescue:!base.some(r=>g.has(r.id))&&[...c].some(id=>g.has(id))&&! [...l].some(id=>g.has(id))};}
export async function runQuery(idx,ex,e,jev,{probs,batch=10,offline=false,baseSize=100,budget=200,blind=false}={}){
 const start=performance.now(),log=[],q=e.query,excluded=e.excluded_ids||[];
 if(!probs){if(offline)throw Error('Offline mode requires saved capability probabilities');probs=await discoverCapabilities(q,jev,log);}
 if(!CAPABILITIES.every(([id])=>Number.isFinite(probs[id])&&probs[id]>=0&&probs[id]<=1))throw Error('Incomplete capability probabilities');
 const {pools,channels,fallback,allocation}=generatePools(idx,ex,q,excluded,probs,{baseSize,budget});
 const union=unique(ARMS.flatMap(a=>pools[a])).sort((a,b)=>a.id<b.id?-1:a.id>b.id?1:0);
 let judged=new Map();
 if(!offline){
  if(blind){const aliases=new Map(union.map((r,i)=>[r.id,'doc_'+String(i).padStart(6,'0')])),reverse=new Map([...aliases].map(([a,b])=>[b,a]));const view={byId:new Map(union.map(r=>[aliases.get(r.id),idx.byId.get(r.id)]))};const rr=await rerank(view,q,union.map(r=>({...r,id:aliases.get(r.id)})),jev,log,batch);judged=new Map(rr.map(r=>[reverse.get(r.id),r.jev]));}
  else{const rr=await rerank(idx,q,union,jev,log,batch);judged=new Map(rr.map(r=>[r.id,r.jev]));}
 }
 // Gold is accessed only after candidate selection and judgments are complete.
 const gold=e.gold_ids;const arms={};for(const name of ARMS){const rows=pools[name];const stats=candidateStats(rows,gold,pools.bm25_100);const ranked=offline?null:rows.map((r,i)=>({...r,prior:i,jev:judged.get(r.id)})).sort((a,b)=>b.jev-a.jev||a.prior-b.prior).slice(0,100);arms[name]={...stats,fallback:fallback[name],candidateIds:ids(rows),metrics:ranked?metrics(ranked,gold):null,rankedIds:ranked?ids(ranked):null};}
 return {id:String(e.id),query:q,gold,probs,arms,allocation,channels:Object.fromEntries(Object.entries(channels).map(([k,v])=>[k,ids(v)])),unique:uniqueContribution(channels,pools.bm25_100,gold),unionSize:union.length,judgments:Object.fromEntries(judged),posts:log.length,questions:log.reduce((n,r)=>n+r.count,0),ms:performance.now()-start,audit:log};
}
export function summarize(rows){const arms={};for(const a of ARMS){const r=rows.map(x=>x.arms[a]);arms[a]={meanCandidates:mean(r.map(x=>x.size)),recall:mean(r.map(x=>x.recall)),oracle:mean(r.map(x=>x.oracle)),addedGold:r.reduce((n,x)=>n+x.addedGold,0),rescued:r.filter(x=>x.rescued).length,empty:r.filter(x=>!x.goldHits).length,fallback:r.reduce((n,x)=>n+x.fallback,0),ndcg10:r[0].metrics?mean(r.map(x=>x.metrics.ndcg10)):null,recall100:r[0].metrics?mean(r.map(x=>x.metrics.recall100)):null,mrr100:r[0].metrics?mean(r.map(x=>x.metrics.mrr100)):null};}return {queries:rows.length,arms,unique:{lexicalOnly:rows.reduce((n,r)=>n+r.unique.lexicalOnly.length,0),capabilityOnly:rows.reduce((n,r)=>n+r.unique.capabilityOnly.length,0),shared:rows.reduce((n,r)=>n+r.unique.shared.length,0),lexicalRescue:rows.filter(r=>r.unique.lexicalRescue).length,capabilityRescue:rows.filter(r=>r.unique.capabilityRescue).length},posts:rows.reduce((n,r)=>n+r.posts,0),questions:rows.reduce((n,r)=>n+r.questions,0),meanMs:mean(rows.map(r=>r.ms)),meanUnion:mean(rows.map(r=>r.unionSize))};}
async function read(file){const s=await fs.readFile(file,'utf8');return s.trimStart().startsWith('[')?JSON.parse(s):s.trim().split(/\r?\n/).filter(Boolean).map(JSON.parse);}
async function atomic(file,obj){await fs.writeFile(file+'.tmp',JSON.stringify(obj,null,2));await fs.rename(file+'.tmp',file);}
async function main(){const {values:v}=parseArgs({options:{task:{type:'string',default:'economics'},cache:{type:'string',default:'data'},out:{type:'string',default:'isolation'},offset:{type:'string',default:'0'},limit:{type:'string'},batch:{type:'string',default:'10'},replay:{type:'string',multiple:true},offline:{type:'boolean'},resume:{type:'boolean'},blind:{type:'boolean'},audit:{type:'boolean'}},strict:true});
 if(!TASKS.includes(v.task))throw Error('Invalid task');const offset=Number(v.offset),limit=v.limit===undefined?Infinity:Number(v.limit),batch=Number(v.batch);if(!Number.isInteger(offset)||offset<0||!(limit===Infinity||Number.isInteger(limit)&&limit>0)||!Number.isInteger(batch)||batch<1||batch>20)throw Error('Invalid numeric options');
 const docs=await read(path.join(v.cache,v.task+'-documents.jsonl')),examples=await read(path.join(v.cache,v.task+'-examples.jsonl')),selected=examples.slice(offset,offset+limit);if(!selected.length)throw Error('No queries');const replay=new Map();for(const file of v.replay||[]){const report=JSON.parse(await fs.readFile(file,'utf8'));if(report.task!==v.task||report.documents!==docs.length)throw Error('Replay task/corpus size mismatch');for(const r of report.results){if(replay.has(String(r.id)))throw Error('Duplicate replay query '+r.id);replay.set(String(r.id),r);}}
 const config={task:v.task,corpusHash:digest(docs),queryHash:digest(selected),replayHash:digest([...replay].map(([id,r])=>[id,r.discovery])),batch,offline:!!v.offline,blind:!!v.blind,model:process.env.JEV_MODEL||'jev-latest',base:process.env.JEV_BASE||'https://api.typesafe.ai/v1/systemone',audit:!!v.audit,version:'0.4.1'};
 for(const e of selected){const r=replay.get(String(e.id));if(r&&(r.query!==e.query||JSON.stringify(r.gold)!==JSON.stringify(e.gold_ids)))throw Error('Replay query mismatch '+e.id);if(v.offline&&!r?.discovery)throw Error('Missing replay probabilities '+e.id);}
 await fs.mkdir(v.out,{recursive:true});const file=path.join(v.out,v.task+'-isolation-report.json'),summaryFile=path.join(v.out,v.task+'-isolation-summary.json');let rows=[];if(v.resume){const saved=JSON.parse(await fs.readFile(file,'utf8'));if(digest(saved.config)!==digest(config))throw Error('Resume configuration mismatch');rows=saved.results;if(rows.length>selected.length||rows.some((r,i)=>r.id!==String(selected[i].id)))throw Error('Resume query mismatch');}else{try{await fs.access(file);throw Error('Output exists; use --resume or a new --out');}catch(e){if(e.code!=='ENOENT')throw e;}}
 const idx=indexDocs(docs),enhanced=indexDocs(v.blind?docs.map(d=>({...d,content:codeTokens(d.content).join(' ')})):enhancedDocs(docs));
 const jev=makeJev({audit:v.audit});console.log('Indexed',docs.length,'documents; resuming',rows.length,'of',selected.length);
 for(const e of selected.slice(rows.length)){try{const r=await runQuery(idx,enhanced,e,jev,{probs:replay.get(String(e.id))?.discovery,batch,offline:!!v.offline,blind:!!v.blind});rows.push(r);await atomic(file,{config,results:rows});await atomic(summaryFile,{config,...summarize(rows)});console.log(JSON.stringify({id:r.id,posts:r.posts,union:r.unionSize,arms:Object.fromEntries(ARMS.map(a=>[a,{recall:r.arms[a].recall,oracle:r.arms[a].oracle,ndcg10:r.arms[a].metrics?.ndcg10,fallback:r.arms[a].fallback}]))}));}catch(e2){throw Error('Query '+e.id+': '+e2.message);}}
 await atomic(summaryFile,{config,...summarize(rows)});console.log(summarize(rows));}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url))main().catch(e=>{console.error(e.message);process.exitCode=1;});
