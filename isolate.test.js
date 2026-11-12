import test from 'node:test';
import assert from 'node:assert/strict';
import {indexDocs} from './bright.js';
import {CAPABILITIES,enhancedDocs} from './capabilities.js';
import {generatePools,runQuery,summarize,ARMS,candidateStats} from './isolate.js';
const probs=Object.fromEntries(CAPABILITIES.map(([id])=>[id,id==='remainder'?.99:0]));
const docs=[...Array.from({length:8},(_,i)=>({id:'base'+i,content:'prime '+ 'word '.repeat(i+1)})),{id:'gold',content:'modulo remainder divisibility'},{id:'excluded',content:'prime modulo'}];
const idx=indexDocs(docs),ex=indexDocs(enhancedDocs(docs)),e={id:'q',query:'prime',gold_ids:['gold'],excluded_ids:['excluded']};
test('equal budgets, preserved baseline, fallback and exclusions',()=>{const {pools,fallback}=generatePools(idx,ex,e.query,e.excluded_ids,probs,{baseSize:2,budget:4});for(const a of ARMS){assert.equal(pools[a].length,a==='bm25_100'?2:4);assert.deepEqual(pools[a].slice(0,2),pools.bm25_100);assert.ok(!pools[a].some(r=>r.id==='excluded'));}assert.ok(pools.capability.some(r=>r.id==='gold'));assert.equal(fallback.capability,1);});
test('matched union judged once, no gold labels in requests, rescue',async()=>{const seen=new Set();const jev=async(state,questions,log)=>{assert.ok(!('gold' in state));for(const c of state.candidates){assert.ok(!seen.has(c.id));seen.add(c.id);}log.push({count:Object.keys(questions).length});return Object.fromEntries(state.candidates.map((c,i)=>['d'+i,c.id==='gold'?.99:.1]));};const r=await runQuery(idx,ex,e,jev,{probs,baseSize:2,budget:4});assert.equal(seen.size,r.unionSize);assert.equal(r.arms.capability.metrics.ndcg10,1);assert.equal(r.arms.bm25_200.metrics.ndcg10,0);assert.equal(r.unique.capabilityRescue,true);assert.equal(summarize([r]).arms.capability.rescued,1);});
test('offline mode never calls Jev, oracle remains available',async()=>{const r=await runQuery(idx,ex,e,()=>{throw Error('unexpected call')},{probs,offline:true,baseSize:2,budget:4});assert.equal(r.posts,0);assert.equal(r.arms.capability.metrics,null);assert.equal(r.arms.capability.oracle,1);});
test('candidate recall includes relevant documents beyond rank 100',()=>{const rows=Array.from({length:200},(_,i)=>({id:String(i)}));assert.equal(candidateStats(rows,['150'],rows.slice(0,100)).recall,1);});
test('blind judgments expose aliases only',async()=>{const jev=async(state,questions,log)=>{assert.ok(state.candidates.every(c=>/^doc_\d+$/.test(c.id)));assert.ok(Object.values(questions).every(q=>!q.instructions.includes('gold')));log.push({count:Object.keys(questions).length});return Object.fromEntries(state.candidates.map((c,i)=>['d'+i,c.text.includes('modulo')?.99:.1]));};const r=await runQuery(idx,ex,e,jev,{probs,blind:true,baseSize:2,budget:4});assert.equal(r.arms.capability.rankedIds[0],'gold');});

test('frozen allocation reserves ten capability seats, deduplicates, preserves baseline',async()=>{
 const {allocate90_10}=await import('./isolate.js');
 const rows=(prefix,n)=>Array.from({length:n},(_,i)=>({id:prefix+i}));
 const base=rows('b',100),cap=rows('c',100),lex=[...base,...cap.slice(0,10),...rows('l',100)];
 const a=allocate90_10(base,lex,cap,[...base,...rows('x',100)]);
 assert.equal(a.rows.length,200);assert.equal(new Set(a.rows.map(r=>r.id)).size,200);
 assert.deepEqual(a.rows.slice(0,100),base);assert.deepEqual(a.rows.slice(100,110),cap.slice(0,10));
 assert.equal(a.capabilitySeats,10);assert.equal(a.lexicalSeats,90);assert.equal(a.fallback,0);
});
test('allocation backfills missing capability quota deterministically',async()=>{
 const {allocate90_10}=await import('./isolate.js');
 const rows=(prefix,n)=>Array.from({length:n},(_,i)=>({id:prefix+i}));
 const base=rows('b',100),lex=rows('l',100),cap=rows('c',3),extended=[...base,...rows('x',100)];
 const a=allocate90_10(base,lex,cap,extended);
 assert.equal(a.rows.length,200);assert.equal(a.capabilitySeats,3);assert.equal(a.lexicalSeats,90);assert.equal(a.fallback,7);
 assert.deepEqual(a.rows,allocate90_10(base,lex,cap,extended).rows);
});
