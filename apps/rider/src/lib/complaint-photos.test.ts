import { describe, expect, it } from 'vitest';
import {
  type AttachedPhoto,
  MAX_COMPLAINT_PHOTOS,
  photoHint,
  photosLeft,
  photosSettled,
  readyUploadIds,
  resizeFor,
  updatePhoto,
} from './complaint-photos';

const photo = (key: string, patch: Partial<AttachedPhoto> = {}): AttachedPhoto => ({
  key,
  uri: `file:///${key}.jpg`,
  status: 'ready',
  uploadId: `u-${key}`,
  error: null,
  ...patch,
});

describe('complaint photos', () => {
  it('allows three per complaint, counting the ones it has', () => {
    expect(MAX_COMPLAINT_PHOTOS).toBe(3);
    expect(photosLeft(0, [])).toBe(3);
    expect(photosLeft(1, [photo('a')])).toBe(1);
    expect(photosLeft(2, [photo('a'), photo('b')])).toBe(0);
  });

  it('sends only completed uploads and waits for the rest', () => {
    const list = [
      photo('a'),
      photo('b', { status: 'uploading', uploadId: null }),
      photo('c', { status: 'failed', uploadId: null, error: 'x' }),
    ];
    expect(readyUploadIds(list)).toEqual(['u-a']);
    expect(photosSettled(list)).toBe(false);
    expect(photosSettled([photo('a')])).toBe(true);
    expect(photosSettled([])).toBe(true);
  });

  it('updates one photo by key', () => {
    const list = [photo('a', { status: 'uploading', uploadId: null }), photo('b')];
    const next = updatePhoto(list, 'a', { status: 'ready', uploadId: 'u-9' });
    expect(next[0]).toMatchObject({ status: 'ready', uploadId: 'u-9' });
    expect(next[1]).toBe(list[1]);
  });

  it('shrinks the longest side, never enlarges', () => {
    expect(resizeFor(4000, 3000, 1600)).toEqual({ width: 1600 });
    expect(resizeFor(3000, 4000, 1600)).toEqual({ height: 1600 });
    expect(resizeFor(1200, 900, 1600)).toBeNull();
    expect(resizeFor(0, 0, 1600)).toBeNull();
  });

  it('explains what can be added', () => {
    expect(photoHint(2, true)).toContain('yana 2 ta');
    expect(photoHint(0, true)).toContain('ko‘pi bilan 3');
    expect(photoHint(3, false)).toContain('ishlamayapti');
  });
});
