import fs from 'node:fs';
import path from 'node:path';
const tasks=['biology','earth_science','economics','pony','psychology','robotics','stackoverflow','sustainable_living','aops','leetcode','theoremqa_theorems','theoremqa_questions'];
const counts=[103,116,103,112,101,101,117,108,111,142,76,194];
const arms=['bm25_100','bm25_200','lexical','capability','both','allocation_90_10'];
const root=path.resolve(process.argv[2]||'suite-blind'),out=path.resolve(process.argv[3]||'official-scores');
const stats={tasks:{},macro:{},queries:0,posts:0,questions:0};
for(const [i,task] of tasks.entries()){
 const name=task+'-isolation-report.json';
 const file=[path.join(root,task,name),...(task==='economics'?[path.join(root,'economics-isolation-report(2).json')]:[]),path.join(root,name)].find(f=>fs.existsSync(f));
 if(!file)throw Error('Missing '+name);
 const r=JSON.parse(fs.readFileSync(file,'utf8'));
 if(r.config.task!==task||!r.config.blind||r.config.offline||r.results.length!==counts[i]||new Set(r.results.map(x=>x.id)).size!==counts[i])throw Error('Invalid report '+task);
 stats.queries+=r.results.length;stats.posts+=r.results.reduce((s,x)=>s+x.posts,0);stats.questions+=r.results.reduce((s,x)=>s+x.questions,0);
 stats.tasks[task]={};
 for(const arm of arms){
  const scores=Object.create(null);let sum=0;
  for(const x of r.results){const a=x.arms[arm],ids=a.rankedIds;if(!Array.isArray(ids)||!ids.length||ids.length>100||new Set(ids).size!==ids.length||!Number.isFinite(a.metrics.ndcg10))throw Error('Invalid ranking '+task+' '+x.id+' '+arm);scores[x.id]=Object.fromEntries(ids.map((id,j)=>[id,ids.length-j]));sum+=a.metrics.ndcg10;}
  stats.tasks[task][arm]=sum/r.results.length*100;
  if(arm==='lexical'||arm==='allocation_90_10'){const dir=path.join(out,arm,`${task}_bm25_long_False`);fs.mkdirSync(dir,{recursive:true});fs.writeFileSync(path.join(dir,'score.json'),JSON.stringify(scores));}
 }
}
for(const arm of arms)stats.macro[arm]=tasks.reduce((s,t)=>s+stats.tasks[t][arm],0)/tasks.length;
fs.writeFileSync(path.join(out,'local-baseline.json'),JSON.stringify(stats,null,2));console.log(JSON.stringify(stats,null,2));
