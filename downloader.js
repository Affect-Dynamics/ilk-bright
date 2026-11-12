import fs from 'node:fs/promises';
import {setTimeout as sleep} from 'node:timers/promises';

const retryable = s => s===408 || s===429 || s>=500;
function retryDelay(header, attempt) {
  const seconds = header == null ? NaN : Number(header);
  const ms = Number.isFinite(seconds) ? seconds*1000 : header ? Date.parse(header)-Date.now() : NaN;
  return Math.min(120000, Math.max(1000, Number.isFinite(ms) ? ms : Math.min(60000, 2000*2**attempt)));
}
function validateRow(row, config) {
  if (!row || row.id == null || (config==='documents' ? typeof row.content!=='string' : typeof row.query!=='string')) throw Error('Invalid '+config+' row');
}
// Preserve the legacy .tmp file from v0.3. An incomplete trailing line is
// discarded so interrupted writes cannot introduce invalid JSON or skipped rows.
async function resume(tmp, config) {
  let raw;
  try { raw=await fs.readFile(tmp,'utf8'); } catch(e) { if(e.code!=='ENOENT')throw e; await fs.writeFile(tmp,''); return {offset:0,ids:new Set()}; }
  if(raw && !raw.endsWith('\n')) { const end=raw.lastIndexOf('\n')+1; raw=raw.slice(0,end); await fs.writeFile(tmp,raw); }
  const ids=new Set(); let offset=0;
  for(const line of raw.split('\n')) { if(!line.trim()) continue; const row=JSON.parse(line); validateRow(row,config); const id=String(row.id); if(ids.has(id))throw Error('Duplicate ID in partial cache: '+id); ids.add(id); offset++; }
  return {offset,ids};
}
export async function downloadRows(config,task,file,{fetcher=fetch,wait=sleep,attempts=8,log=console.log}={}) {
  const tmp=file+'.tmp', meta=tmp+'.meta.json';
  let {offset,ids}=await resume(tmp,config),total=null;
  try { const m=JSON.parse(await fs.readFile(meta,'utf8')); if(m.config!==config||m.task!==task||!Number.isInteger(m.total)||m.total<offset)throw Error('Invalid checkpoint metadata'); total=m.total; } catch(e) { if(e.code!=='ENOENT')throw e; }
  if(offset)log(`Resuming ${config} ${task} at ${offset}${total===null?'':'/'+total}`);
  while(total===null||offset<total) {
    const url=new URL('https://datasets-server.huggingface.co/rows');
    Object.entries({dataset:'xlangai/BRIGHT',config,split:task,offset:String(offset),length:'100'}).forEach(([k,v])=>url.searchParams.set(k,v));
    let data;
    for(let attempt=0;attempt<attempts;attempt++) {
      let response;
      try {
        response=await fetcher(url,{signal:AbortSignal.timeout(120000)});
        if(!response.ok){const err=Error('HF '+response.status);err.permanent=!retryable(response.status);throw err;}
        data=await response.json();break;
      } catch(e) {
        if(e.permanent||attempt===attempts-1)throw Error(`${e.message} at ${config}/${task} offset ${offset}; partial cache preserved at ${tmp}. Rerun the command to resume.`);
        const delay=retryDelay(response?.headers?.get('retry-after'),attempt);
        log(`${config} ${task} offset ${offset}: ${e.message}; retry ${attempt+1}/${attempts-1} in ${Math.ceil(delay/1000)}s`);
        await wait(delay);
      }
    }
    if(!Number.isInteger(data?.num_rows_total)||!Array.isArray(data.rows)||(!data.rows.length&&offset!==data.num_rows_total))throw Error('Unexpected HF rows response at '+offset);
    if(total!==null&&total!==data.num_rows_total)throw Error('Dataset changed during download; partial cache preserved');
    total=data.num_rows_total;
    if(offset+data.rows.length>total)throw Error('HF returned too many rows');
    const lines=[];
    for(let i=0;i<data.rows.length;i++) { const item=data.rows[i]; if(item.row_idx!==undefined&&item.row_idx!==offset+i)throw Error('Unexpected HF row index at '+(offset+i));validateRow(item.row,config);const id=String(item.row.id);if(ids.has(id))throw Error('Duplicate document/example ID '+id);ids.add(id);lines.push(JSON.stringify(item.row)); }
    await fs.writeFile(meta,JSON.stringify({config,task,total}));
    if(lines.length)await fs.appendFile(tmp,lines.join('\n')+'\n');
    offset+=lines.length;
    if(offset%1000===0||offset===total)log(config,task,offset+'/'+total);
  }
  if(offset!==total)throw Error('Incomplete download');
  await fs.rename(tmp,file);await fs.rm(meta,{force:true});
}
