import { useCallback, useEffect, useRef, useState } from 'react';
import { uploads } from '../api/driver';
import { useUploadsConfig } from '../data/queries';
import {
  isBusy,
  runUpload,
  type UploadMemo,
  type UploadPurpose,
  type UploadState,
} from '../lib/upload-flow';
import { type FileSource, pickAndPrepare, putFile } from './files';

/**
 * One upload slot (a document, the driver's photo, the car's photo): `start(source)` picks
 * and uploads a file, then `attach` links it to the profile; `retry()` continues from the
 * step that failed with the same file. The state drives the progress line and buttons.
 */
export function useUpload<T>(purpose: UploadPurpose, attach: (uploadId: string) => Promise<T>) {
  const config = useUploadsConfig();
  const limits = config.purposes[purpose];
  const [state, setState] = useState<UploadState>({ status: 'idle' });
  const memo = useRef<UploadMemo>({});
  const source = useRef<{ from: FileSource; front: boolean }>({ from: 'camera', front: false });
  const mounted = useRef(true);
  const attachRef = useRef(attach);
  attachRef.current = attach;

  useEffect(
    () => () => {
      mounted.current = false;
    },
    [],
  );

  const run = useCallback(async () => {
    const onState = (s: UploadState) => {
      if (mounted.current) setState(s);
    };
    return runUpload<T>(
      {
        prepare: () =>
          pickAndPrepare(source.current.from, purpose, limits.maxBytes, source.current.front),
        create: uploads.create,
        put: putFile,
        complete: uploads.complete,
        attach: (id) => attachRef.current(id),
        now: Date.now,
      },
      purpose,
      limits,
      memo.current,
      onState,
    );
  }, [purpose, limits]);

  /** A new file (`front`: the selfie camera): forgets any earlier attempt. */
  const start = useCallback(
    (from: FileSource, front = false) => {
      memo.current = {};
      source.current = { from, front };
      return run();
    },
    [run],
  );

  const retry = useCallback(() => run(), [run]);

  const reset = useCallback(() => {
    memo.current = {};
    setState({ status: 'idle' });
  }, []);

  return {
    state,
    busy: isBusy(state),
    enabled: config.enabled,
    limits,
    start,
    retry,
    reset,
  };
}
