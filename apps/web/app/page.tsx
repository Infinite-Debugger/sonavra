'use client';

import { useRef, useState } from 'react';
import type {
  CompleteUploadResponse,
  CreateUploadResponse,
} from '@sonavra/types';

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3001';
const MAX_UPLOAD_BYTES = 500 * 1024 * 1024;
const ACCEPTED_TYPES = [
  'audio/ogg',
  'application/ogg',
  'audio/mpeg',
  'audio/wav',
  'audio/x-wav',
  'audio/mp4',
  'audio/x-m4a',
  'audio/webm',
  'video/mp4',
  'video/webm',
].join(',');

type UploadState = 'idle' | 'uploading' | 'complete' | 'error';

function errorMessage(error: unknown) {
  return error instanceof Error
    ? error.message
    : 'Upload failed. Please try again.';
}

async function apiJson<T>(path: string, init: RequestInit) {
  const response = await fetch(`${API_URL}${path}`, {
    ...init,
    headers: { 'content-type': 'application/json', ...init.headers },
  });
  const data = (await response.json()) as T & { message?: string };
  if (!response.ok) throw new Error(data.message ?? 'Upload request failed.');
  return data;
}

function putWithProgress(
  upload: CreateUploadResponse['upload'],
  file: File,
  onProgress: (progress: number) => void,
) {
  return new Promise<void>((resolve, reject) => {
    const request = new XMLHttpRequest();
    request.open(upload.method, upload.url);
    for (const [name, value] of Object.entries(upload.headers)) {
      request.setRequestHeader(name, value);
    }
    request.upload.addEventListener('progress', (event) => {
      if (event.lengthComputable) {
        onProgress(Math.round((event.loaded / event.total) * 100));
      }
    });
    request.addEventListener('load', () => {
      if (request.status >= 200 && request.status < 300) resolve();
      else
        reject(
          new Error(`Object upload failed with status ${request.status}.`),
        );
    });
    request.addEventListener('error', () =>
      reject(new Error('Could not reach object storage.')),
    );
    request.send(file);
  });
}

export default function Home() {
  const inputRef = useRef<HTMLInputElement>(null);
  const [state, setState] = useState<UploadState>('idle');
  const [progress, setProgress] = useState(0);
  const [filename, setFilename] = useState('');
  const [message, setMessage] = useState('');

  async function upload(file: File) {
    if (file.size > MAX_UPLOAD_BYTES) {
      setState('error');
      setMessage('That file is larger than the 500 MB upload limit.');
      return;
    }

    setFilename(file.name);
    setProgress(0);
    setMessage('');
    setState('uploading');

    try {
      const guestSessionId =
        localStorage.getItem('sonavraGuestSessionId') ?? undefined;
      const created = await apiJson<CreateUploadResponse>('/uploads', {
        method: 'POST',
        body: JSON.stringify({
          filename: file.name,
          mimeType: file.type || 'application/octet-stream',
          sizeBytes: file.size,
          guestSessionId,
        }),
      });
      localStorage.setItem('sonavraGuestSessionId', created.guestSessionId);

      await putWithProgress(created.upload, file, setProgress);
      const completed = await apiJson<CompleteUploadResponse>(
        `/uploads/${created.recordingId}/complete`,
        {
          method: 'POST',
          body: JSON.stringify({ guestSessionId: created.guestSessionId }),
        },
      );

      setProgress(100);
      setState('complete');
      setMessage(
        `Upload complete. Recording ${completed.recordingId.slice(0, 8)} is ready.`,
      );
    } catch (error) {
      setState('error');
      setMessage(errorMessage(error));
    }
  }

  function chooseFile(file?: File) {
    if (file) void upload(file);
  }

  return (
    <main className="grid min-h-screen place-items-center bg-white px-5 py-12 text-zinc-950 transition-colors dark:bg-zinc-950 dark:text-zinc-50">
      <section className="w-full max-w-3xl text-center">
        <span className="mb-5 inline-block text-xs font-extrabold tracking-[0.24em] text-zinc-500 dark:text-zinc-400">
          SONAVRA
        </span>
        <h1 className="text-5xl leading-[0.98] font-bold tracking-[-0.055em] sm:text-7xl">
          Turn recordings into transcripts.
        </h1>
        <p className="mx-auto mt-6 mb-9 max-w-2xl text-base leading-7 text-zinc-600 sm:text-lg dark:text-zinc-400">
          Drop in audio or video. Sonavra keeps your source private and prepares
          it for self-hosted transcription.
        </p>

        <div
          className="flex flex-col items-center gap-3 rounded-3xl border border-dashed border-zinc-300 bg-zinc-50 px-6 py-11 shadow-2xl shadow-zinc-200/40 dark:border-zinc-700 dark:bg-zinc-900 dark:shadow-black/30"
          onDragOver={(event) => event.preventDefault()}
          onDrop={(event) => {
            event.preventDefault();
            chooseFile(event.dataTransfer.files[0]);
          }}
        >
          <input
            ref={inputRef}
            type="file"
            accept={ACCEPTED_TYPES}
            hidden
            onChange={(event) => chooseFile(event.target.files?.[0])}
          />
          <div
            className="mb-1 grid size-13 place-items-center rounded-full bg-zinc-950 text-3xl text-white dark:bg-white dark:text-zinc-950"
            aria-hidden="true"
          >
            ↑
          </div>
          <strong className="text-xl">
            {state === 'uploading' ? filename : 'Drop a recording here'}
          </strong>
          <span className="text-sm text-zinc-500 dark:text-zinc-400">
            OGG, MP3, WAV, M4A, MP4 or WebM · up to 500 MB
          </span>
          <button
            className="mt-2 cursor-pointer rounded-full bg-zinc-950 px-5 py-3 font-bold text-white transition hover:bg-zinc-800 focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-zinc-950 disabled:cursor-wait disabled:opacity-50 dark:bg-white dark:text-zinc-950 dark:hover:bg-zinc-200 dark:focus-visible:outline-white"
            type="button"
            disabled={state === 'uploading'}
            onClick={() => inputRef.current?.click()}
          >
            Choose file
          </button>
        </div>

        {state === 'uploading' && (
          <div
            className="mt-5 rounded-2xl bg-zinc-100 p-4 text-left dark:bg-zinc-900"
            aria-live="polite"
          >
            <div className="mb-2.5 flex justify-between text-sm">
              <span>Uploading</span>
              <span>{progress}%</span>
            </div>
            <progress
              className="h-2 w-full accent-zinc-950 dark:accent-white"
              max="100"
              value={progress}
            />
          </div>
        )}

        {(state === 'complete' || state === 'error') && (
          <p
            className={`mt-5 rounded-2xl bg-zinc-100 px-5 py-4 dark:bg-zinc-900 ${
              state === 'error' ? 'text-red-700 dark:text-red-300' : ''
            }`}
            role="status"
          >
            {message}
          </p>
        )}

        <p className="mt-5 text-sm text-zinc-500 dark:text-zinc-500">
          No account required. Guest uploads expire after 24 hours.
        </p>
      </section>
    </main>
  );
}
