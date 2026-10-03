'use client';

import { useRef, useState } from 'react';
import type { CompleteUploadResponse, CreateUploadResponse } from '@sonavra/types';
import './upload.css';

const API_URL=process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3001';
const MAX_UPLOAD_BYTES=500*1024*1024;
const ACCEPTED_TYPES=['audio/ogg','application/ogg','audio/mpeg','audio/wav','audio/x-wav','audio/mp4','audio/x-m4a','audio/webm','video/mp4','video/webm'].join(',');
type UploadState='idle'|'uploading'|'complete'|'error';
function errorMessage(error: unknown) { return error instanceof Error ? error.message : 'Upload failed. Please try again.'; }
async function apiJson<T>(path:string,init:RequestInit) {
  const response=await fetch(`${API_URL}${path}`,{...init,headers:{'content-type':'application/json',...init.headers}});
  const data=(await response.json()) as T & {message?:string};
  if(!response.ok) throw new Error(data.message ?? 'Upload request failed.');
  return data;
}
function putWithProgress(upload:CreateUploadResponse['upload'],file:File,onProgress:(progress:number)=>void) {
  return new Promise<void>((resolve,reject)=>{
    const request=new XMLHttpRequest(); request.open(upload.method,upload.url);
    for(const [name,value] of Object.entries(upload.headers)) request.setRequestHeader(name,value);
    request.upload.addEventListener('progress',(event)=>{if(event.lengthComputable) onProgress(Math.round((event.loaded/event.total)*100));});
    request.addEventListener('load',()=>{if(request.status>=200&&request.status<300) resolve(); else reject(new Error(`Object upload failed with status ${request.status}.`));});
    request.addEventListener('error',()=>reject(new Error('Could not reach object storage.')));
    request.send(file);
  });
}

export default function Home() {
  const inputRef=useRef<HTMLInputElement>(null);
  const [state,setState]=useState<UploadState>('idle'), [progress,setProgress]=useState(0), [filename,setFilename]=useState(''), [message,setMessage]=useState('');
  async function upload(file:File) {
    if(file.size>MAX_UPLOAD_BYTES){setState('error');setMessage('That file is larger than the 500 MB upload limit.');return;}
    setFilename(file.name);setProgress(0);setMessage('');setState('uploading');
    try {
      const guestSessionId=localStorage.getItem('sonavraGuestSessionId') ?? undefined;
      const created=await apiJson<CreateUploadResponse>('/uploads',{method:'POST',body:JSON.stringify({filename:file.name,mimeType:file.type||'application/octet-stream',sizeBytes:file.size,guestSessionId})});
      localStorage.setItem('sonavraGuestSessionId',created.guestSessionId);
      await putWithProgress(created.upload,file,setProgress);
      const completed=await apiJson<CompleteUploadResponse>(`/uploads/${created.recordingId}/complete`,{method:'POST',body:JSON.stringify({guestSessionId:created.guestSessionId})});
      setProgress(100);setState('complete');setMessage(`Upload complete. Recording ${completed.recordingId.slice(0,8)} is ready.`);
    } catch(error) {setState('error');setMessage(errorMessage(error));}
  }
  function chooseFile(file?:File){if(file) void upload(file);}
  return <main className="shell"><section className="hero">
    <span className="eyebrow">SONAVRA</span><h1>Turn recordings into transcripts.</h1>
    <p className="lede">Drop in audio or video. Sonavra keeps your source private and prepares it for self-hosted transcription.</p>
    <div className="dropzone" onDragOver={(event)=>event.preventDefault()} onDrop={(event)=>{event.preventDefault();chooseFile(event.dataTransfer.files[0]);}}>
      <input ref={inputRef} type="file" accept={ACCEPTED_TYPES} hidden onChange={(event)=>chooseFile(event.target.files?.[0])}/>
      <div className="uploadMark" aria-hidden="true">↑</div><strong>{state==='uploading'?filename:'Drop a recording here'}</strong>
      <span>OGG, MP3, WAV, M4A, MP4 or WebM · up to 500 MB</span>
      <button type="button" disabled={state==='uploading'} onClick={()=>inputRef.current?.click()}>Choose file</button>
    </div>
    {state==='uploading'&&<div className="status" aria-live="polite"><div className="statusRow"><span>Uploading</span><span>{progress}%</span></div><progress max="100" value={progress}/></div>}
    {(state==='complete'||state==='error')&&<p className={state==='error'?'message error':'message'} role="status">{message}</p>}
    <p className="privacy">No account required. Guest uploads expire after 24 hours.</p>
  </section></main>;
}
