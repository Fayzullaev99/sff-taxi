import { describe, expect, it } from 'vitest';
import { ApiError } from './api-client';
import {
  contentTypeOf,
  DEFAULT_UPLOADS_CONFIG,
  fileProblem,
  isBusy,
  type LocalFile,
  mapUploadsConfig,
  PutFailed,
  resizeFor,
  runUpload,
  type UploadDeps,
  type UploadMemo,
  type UploadState,
  uploadStateText,
} from './upload-flow';

const MB = 1024 * 1024;
const PHOTO: LocalFile = {
  uri: 'file:///cache/a.jpg',
  contentType: 'image/jpeg',
  sizeBytes: 800_000,
};
const LIMITS = DEFAULT_UPLOADS_CONFIG.purposes.document;

/** Scripted steps: each call pops the next outcome (an Error is thrown). */
function fakeDeps(script: Partial<Record<keyof UploadDeps<string>, unknown[]>> = {}) {
  const calls: string[] = [];
  let clock = 1_000_000;
  let n = 0;
  const next = (name: keyof UploadDeps<string>, fallback: unknown) => {
    calls.push(name);
    const queue = script[name];
    const v = queue && queue.length ? queue.shift() : fallback;
    if (v instanceof Error) throw v;
    return v;
  };
  const deps: UploadDeps<string> = {
    prepare: async () => next('prepare', PHOTO) as LocalFile | null,
    create: async () =>
      next('create', {
        id: `up-${++n}`,
        upload: {
          method: 'PUT',
          url: `https://s3/put-${n}`,
          headers: { 'Content-Type': 'image/jpeg' },
          expiresInSeconds: 600,
        },
      }) as never,
    put: async (_file, _target, onProgress) => {
      onProgress(0.5);
      next('put', undefined);
      onProgress(1);
    },
    complete: async () => next('complete', { status: 'ready' }),
    attach: async (id) => next('attach', `attached ${id}`) as string,
    now: () => clock,
  };
  return { deps, calls, advance: (ms: number) => (clock += ms) };
}

function collect() {
  const states: UploadState[] = [];
  return { states, onState: (s: UploadState) => states.push(s) };
}

describe('runUpload', () => {
  it('goes through every step with progress and attaches the upload', async () => {
    const { deps, calls } = fakeDeps();
    const { states, onState } = collect();
    const memo: UploadMemo = {};
    const out = await runUpload(deps, 'document', LIMITS, memo, onState);
    expect(out).toEqual({ ok: true, uploadId: 'up-1', result: 'attached up-1' });
    expect(calls).toEqual(['prepare', 'create', 'put', 'complete', 'attach']);
    expect(states.map((s) => s.status)).toEqual([
      'preparing',
      'requesting',
      'uploading',
      'uploading',
      'uploading',
      'completing',
      'attaching',
      'done',
    ]);
    expect(states.filter((s) => s.status === 'uploading').map((s) => s.progress)).toEqual([
      0, 0.5, 1,
    ]);
  });

  it('stops quietly when the driver cancels the picker', async () => {
    const { deps, calls } = fakeDeps({ prepare: [null] });
    const { states, onState } = collect();
    const out = await runUpload(deps, 'document', LIMITS, {}, onState);
    expect(out).toEqual({ ok: false, cancelled: true });
    expect(calls).toEqual(['prepare']);
    expect(states.at(-1)).toEqual({ status: 'idle' });
  });

  it('refuses a file over the limit before asking the API', async () => {
    const { deps, calls } = fakeDeps({ prepare: [{ ...PHOTO, sizeBytes: 12 * MB }] });
    const { states, onState } = collect();
    const out = await runUpload(deps, 'document', LIMITS, {}, onState);
    expect(out.ok).toBe(false);
    expect(calls).toEqual(['prepare']);
    expect(states.at(-1)).toMatchObject({ status: 'failed', step: 'prepare', retryable: false });
    expect(uploadStateText(states.at(-1)!)).toMatch(/juda katta: 12 MB, ko‘pi bilan 10 MB/);
  });

  it('retries only the attach when saving failed', async () => {
    const { deps, calls } = fakeDeps({ attach: [new ApiError(0, 'offline')] });
    const memo: UploadMemo = {};
    const first = collect();
    expect((await runUpload(deps, 'document', LIMITS, memo, first.onState)).ok).toBe(false);
    expect(first.states.at(-1)).toMatchObject({
      status: 'failed',
      step: 'attach',
      retryable: true,
    });

    const second = collect();
    const out = await runUpload(deps, 'document', LIMITS, memo, second.onState);
    expect(out).toMatchObject({ ok: true, uploadId: 'up-1' });
    expect(calls).toEqual(['prepare', 'create', 'put', 'complete', 'attach', 'attach']);
    expect(second.states.map((s) => s.status)).toEqual(['attaching', 'done']);
  });

  it('re-sends the bytes to the same URL after a network failure', async () => {
    const { deps, calls } = fakeDeps({ put: [new PutFailed(0)] });
    const memo: UploadMemo = {};
    const first = collect();
    await runUpload(deps, 'document', LIMITS, memo, first.onState);
    expect(first.states.at(-1)).toMatchObject({ status: 'failed', step: 'put', retryable: true });
    expect(memo.upload?.url).toBe('https://s3/put-1');

    await runUpload(deps, 'document', LIMITS, memo, () => undefined);
    expect(calls).toEqual(['prepare', 'create', 'put', 'put', 'complete', 'attach']);
  });

  it('asks for a new URL when the old one expired or was refused', async () => {
    const { deps, calls, advance } = fakeDeps({ put: [new PutFailed(0), new PutFailed(403)] });
    const memo: UploadMemo = {};
    await runUpload(deps, 'document', LIMITS, memo, () => undefined);
    advance(590_000); // the 10-minute URL has 10 s left: not worth trying
    await runUpload(deps, 'document', LIMITS, memo, () => undefined);
    expect(memo.upload).toBeUndefined(); // 403 from the storage: signature no longer valid
    const out = await runUpload(deps, 'document', LIMITS, memo, () => undefined);
    expect(out).toMatchObject({ ok: true, uploadId: 'up-3' });
    expect(calls.filter((c) => c === 'create')).toHaveLength(3);
    expect(calls.filter((c) => c === 'prepare')).toHaveLength(1);
  });

  it('re-uploads when the API did not find the bytes, restarts when it deleted a bad file', async () => {
    const { deps, calls } = fakeDeps({
      complete: [new ApiError(409, 'Fayl hali yuklanmagan'), new ApiError(400, 'Fayl buzilgan')],
    });
    const memo: UploadMemo = {};
    await runUpload(deps, 'document', LIMITS, memo, () => undefined);
    expect(memo).toMatchObject({ put: false, upload: { id: 'up-1' } });
    const second = collect();
    await runUpload(deps, 'document', LIMITS, memo, second.onState);
    expect(second.states.at(-1)).toMatchObject({ status: 'failed', message: 'Fayl buzilgan' });
    expect(memo.upload).toBeUndefined();
    const out = await runUpload(deps, 'document', LIMITS, memo, () => undefined);
    expect(out).toMatchObject({ ok: true, uploadId: 'up-2' });
    expect(calls).toEqual([
      'prepare',
      'create',
      'put',
      'complete',
      'put',
      'complete',
      'create',
      'put',
      'complete',
      'attach',
    ]);
  });

  it('uploads again when the attach finds the upload gone', async () => {
    const { deps, calls } = fakeDeps({ attach: [new ApiError(404, 'Fayl topilmadi')] });
    const memo: UploadMemo = {};
    await runUpload(deps, 'document', LIMITS, memo, () => undefined);
    const out = await runUpload(deps, 'document', LIMITS, memo, () => undefined);
    expect(out).toMatchObject({ ok: true, uploadId: 'up-2' });
    expect(calls).toEqual([
      'prepare',
      'create',
      'put',
      'complete',
      'attach',
      'create',
      'put',
      'complete',
      'attach',
    ]);
  });

  it('shows the API message when it refuses to start (not retryable for a 400)', async () => {
    const { deps } = fakeDeps({
      create: [new ApiError(400, 'Bu turdagi fayl uchun faqat JPEG, PNG yoki WebP rasm mumkin')],
    });
    const { states, onState } = collect();
    await runUpload(deps, 'profile_photo', LIMITS, {}, onState);
    expect(states.at(-1)).toMatchObject({ step: 'request', retryable: false });
    const down = fakeDeps({
      create: [new ApiError(503, 'Fayl yuklash serverda hali sozlanmagan')],
    });
    const s2 = collect();
    await runUpload(down.deps, 'document', LIMITS, {}, s2.onState);
    expect(s2.states.at(-1)).toMatchObject({ step: 'request', retryable: true });
  });
});

describe('upload helpers', () => {
  it('recognises the accepted types', () => {
    expect(contentTypeOf('image/jpeg')).toBe('image/jpeg');
    expect(contentTypeOf('image/jpg')).toBe('image/jpeg');
    expect(contentTypeOf(null, 'scan.PDF')).toBe('application/pdf');
    expect(contentTypeOf('application/octet-stream', 'IMG_1.heic')).toBeNull();
  });

  it('resizes only what is bigger than the limit, by its longer side', () => {
    expect(resizeFor(4000, 3000, 2000)).toEqual({ width: 2000 });
    expect(resizeFor(3000, 4000, 2000)).toEqual({ height: 2000 });
    expect(resizeFor(1200, 900, 2000)).toBeNull();
  });

  it('checks type and size per purpose', () => {
    const photo = DEFAULT_UPLOADS_CONFIG.purposes.profile_photo;
    expect(fileProblem({ contentType: 'application/pdf', sizeBytes: 1 }, photo)).toMatch(/rasm/);
    expect(fileProblem({ contentType: 'image/png', sizeBytes: 6 * MB }, photo)).toMatch(/5 MB/);
    expect(fileProblem({ contentType: 'image/png', sizeBytes: 0 }, photo)).toMatch(/bo‘sh/);
    expect(fileProblem({ contentType: 'application/pdf', sizeBytes: MB }, LIMITS)).toBeNull();
  });

  it('maps the uploads config with defaults for anything missing', () => {
    const c = mapUploadsConfig({
      enabled: false,
      purposes: { document: { contentTypes: ['image/jpeg', 'text/html'], maxBytes: 2 * MB } },
    });
    expect(c.enabled).toBe(false);
    expect(c.purposes.document).toEqual({ contentTypes: ['image/jpeg'], maxBytes: 2 * MB });
    expect(c.purposes.vehicle_photo).toEqual(DEFAULT_UPLOADS_CONFIG.purposes.vehicle_photo);
    expect(mapUploadsConfig(null).enabled).toBe(true);
  });

  it('says what is happening', () => {
    expect(uploadStateText({ status: 'uploading', progress: 0.426 })).toBe('Yuklanmoqda… 43%');
    expect(isBusy({ status: 'completing' })).toBe(true);
    expect(isBusy({ status: 'failed', step: 'put', message: 'x', retryable: true })).toBe(false);
  });
});
