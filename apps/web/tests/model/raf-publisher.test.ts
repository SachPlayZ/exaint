import { describe, expect, it } from 'vitest';
import {
  RafPublisher,
  type AnimationFrameScheduler,
} from '../../features/market/model/raf-publisher.js';

class FakeAnimationFrames implements AnimationFrameScheduler {
  #nextHandle = 1;
  readonly #callbacks = new Map<number, () => void>();
  readonly cancelled: number[] = [];

  get pending(): number {
    return this.#callbacks.size;
  }

  request(callback: () => void): number {
    const handle = this.#nextHandle++;
    this.#callbacks.set(handle, callback);
    return handle;
  }

  cancel(handle: number): void {
    this.cancelled.push(handle);
    this.#callbacks.delete(handle);
  }

  flush(): void {
    const callbacks = [...this.#callbacks.values()];
    this.#callbacks.clear();
    for (const callback of callbacks) callback();
  }
}

describe('RafPublisher', () => {
  it('coalesces mutations and dirty signals into one publication per frame', () => {
    const frames = new FakeAnimationFrames();
    const published: Readonly<{ value: number }>[] = [];
    let value = 0;
    const publisher = new RafPublisher({
      createSnapshot: () => ({ value }),
      publish: (snapshot) => published.push(snapshot),
      scheduler: frames,
    });

    publisher.mutate(() => {
      value += 1;
    });
    publisher.mutate(() => {
      value += 1;
    });
    publisher.markDirty();

    expect(frames.pending).toBe(1);
    expect(published).toEqual([]);
    frames.flush();
    expect(published).toEqual([{ value: 2 }]);
    expect(Object.isFrozen(published[0])).toBe(true);

    publisher.markDirty();
    frames.flush();
    expect(published).toEqual([{ value: 2 }, { value: 2 }]);
  });

  it('cancels a pending frame and ignores work after disposal', () => {
    const frames = new FakeAnimationFrames();
    const published: number[] = [];
    let value = 0;
    const publisher = new RafPublisher({
      createSnapshot: () => ({ value }),
      publish: (snapshot) => published.push(snapshot.value),
      scheduler: frames,
    });

    publisher.mutate(() => {
      value = 1;
    });
    publisher.dispose();
    publisher.mutate(() => {
      value = 2;
    });
    publisher.markDirty();
    frames.flush();

    expect(frames.cancelled).toEqual([1]);
    expect(value).toBe(1);
    expect(published).toEqual([]);
  });

  it('keeps mutations while hidden and publishes one fresh snapshot on resume', () => {
    const frames = new FakeAnimationFrames();
    const published: number[] = [];
    let value = 0;
    const publisher = new RafPublisher({
      createSnapshot: () => ({ value }),
      publish: (snapshot) => published.push(snapshot.value),
      scheduler: frames,
    });

    publisher.setPaused(true);
    publisher.mutate(() => {
      value = 1;
    });
    publisher.mutate(() => {
      value = 2;
    });
    expect(frames.pending).toBe(0);

    publisher.setPaused(false);
    expect(frames.pending).toBe(1);
    frames.flush();
    expect(published).toEqual([2]);
  });
});
