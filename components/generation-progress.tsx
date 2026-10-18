'use client';
import { useEffect, useState } from 'react';
import { LoaderCircle } from 'lucide-react';

export default function GenerationProgress({name,phase,startedAt,count,completed,total}:{name:string;phase:string;startedAt:number;count:number;completed:number;total:number}) {
  const [now,setNow]=useState(()=>Date.now());
  useEffect(()=>{const timer=setInterval(()=>setNow(Date.now()),1000);return()=>clearInterval(timer);},[startedAt]);
  const elapsed=Math.max(0,Math.floor((now-startedAt)/1000));
  const time=elapsed<60?`${elapsed}s`:`${Math.floor(elapsed/60)}m ${elapsed%60}s`;
  return <div className="generation-progress">
    <LoaderCircle size={17} className="spin"/>
    <div><div className="generation-status-title"><strong role="status">{phase||'Preparing'} · {name||'Your icon'}</strong><span aria-label="Time on current icon">{time}</span></div>
      <p>{phase==='Waiting for OpenAI'?`${count} alternatives arrive together when this icon finishes. ${elapsed>=60?'Still waiting. OpenAI requests time out after two minutes.':'You can scroll through your set while it works.'}`:phase==='Checking the SVG designs'?'The response arrived. Checking the vector artwork before adding it to your row.':'Preparing the original and family references for visual analysis.'}</p>
      {total>1&&<><div className="generation-meter" role="progressbar" aria-label="Icons processed" aria-valuemin={0} aria-valuemax={total} aria-valuenow={completed}><span style={{width:`${completed/total*100}%`}}/></div><small>{completed} of {total} icons processed · Working on {Math.min(completed+1,total)}</small></>}
    </div>
  </div>;
}
