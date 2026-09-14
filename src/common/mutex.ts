/** Serialises async critical sections. One instance per resource. */
export class Mutex {
  private tail: Promise<unknown> = Promise.resolve();

  runExclusive<T>(fn: () => Promise<T> | T): Promise<T> {
    const run = this.tail.then(() => fn());
    this.tail = run.catch(() => undefined);
    return run;
  }
}
