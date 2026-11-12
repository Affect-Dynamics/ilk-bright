import fs from 'node:fs/promises';
import path from 'node:path';
import {parseArgs} from 'node:util';
import {pipeline} from 'node:stream/promises';
import {Readable} from 'node:stream';
import {createWriteStream} from 'node:fs';
import {pathToFileURL} from 'node:url';

export function validateRows(rows,config,expected) {
  if (!Array.isArray(rows)||!rows.length||(expected!==undefined&&rows.length!==expected)) throw Error(`Unexpected ${config} row count: ${rows?.length}; expected ${expected??'nonempty'}`);
  const ids=new Set();
  for(const r of rows) {
    if(r.id==null||(config==='documents'?typeof r.content!=='string':typeof r.query!=='string'||!Array.isArray(r.gold_ids)||!Array.isArray(r.excluded_ids)))throw Error(`Invalid ${config} row`);
    const id=String(r.id); if(ids.has(id))throw Error(`Duplicate ${config} ID ${id}`);ids.add(id);
  }
}
export async function bulk(task,dir,{revision='main',fetcher=fetch,decode,log=console.log}={}) {
  if(!/^[a-z_]+$/.test(task)||!/^[-a-zA-Z0-9_.]+$/.test(revision))throw Error('Invalid task/revision');
  await fs.mkdir(dir,{recursive:true});
  if(!decode){const {asyncBufferFromFile,parquetReadObjects}=await import('hyparquet'); const {compressors}=await import('hyparquet-compressors'); decode=async p=>parquetReadObjects({file:await asyncBufferFromFile(p),compressors});}
  for(const config of ['documents','examples']){
    const output=path.join(dir,`${task}-${config}.jsonl`), raw=path.join(dir,`${task}-${config}.parquet`);
    const exists=async p=>fs.access(p).then(()=>true,()=>false);
    if(await exists(output)){log(`Using existing ${output}`);continue;}
    if(!await exists(raw)){
      const url=`https://huggingface.co/datasets/xlangai/BRIGHT/resolve/${revision}/${config}/${task}-00000-of-00001.parquet`;
      log(`Downloading ${url}`);
      const r=await fetcher(url,{signal:AbortSignal.timeout(300000)});
      if(!r.ok)throw Error(`HF ${r.status} for ${config}/${task}. Retry-After: ${r.headers.get('retry-after')??'not provided'}. Download the file in a browser if needed, save as ${raw}, then rerun.`);
      const tmp=raw+'.part'; await pipeline(Readable.fromWeb(r.body),createWriteStream(tmp));await fs.rename(tmp,raw);
    }
    const rows=await decode(raw);validateRows(rows,config,task==='biology'&&config==='documents'?57359:undefined);
    const tmp=output+'.bulk.tmp';await fs.writeFile(tmp,rows.map(r=>JSON.stringify(r,(_,v)=>typeof v==='bigint'?String(v):v)).join('\n')+'\n');await fs.rename(tmp,output);log(`Cached ${rows.length} ${config}: ${output}`);
  }
}
if(process.argv[1]&&import.meta.url===pathToFileURL(path.resolve(process.argv[1])).href){const {values:v}=parseArgs({options:{task:{type:'string',default:'biology'},cache:{type:'string',default:'data'},revision:{type:'string',default:'main'}}});bulk(v.task,v.cache,{revision:v.revision}).catch(e=>{console.error(e.message);process.exitCode=1;});}
