import { AsyncLocalStorage } from "node:async_hooks";
import type { Database } from "bun:sqlite";
import type { TransactionRunner } from "../ports/transaction.ts";

/**
 * Reentrant async transaction runner for `bun:sqlite`.
 * Top-level `runInTx` acquires an async write mutex and wraps execution in `BEGIN IMMEDIATE` /
 * `COMMIT` / `ROLLBACK`. Nested calls on the same async execution context use `SAVEPOINT`.
 */
export class SqliteTransactionRunner implements TransactionRunner {
  private mutexTail: Promise<void> = Promise.resolve();
  private readonly txDepthStorage = new AsyncLocalStorage<number>();

  constructor(private readonly sqlite: Database) {}

  async runInTx<T>(fn: () => Promise<T>): Promise<T> {
    const currentDepth = this.txDepthStorage.getStore() ?? 0;
    if (currentDepth > 0) {
      const savepoint = `sp_${currentDepth}`;
      this.sqlite.exec(`SAVEPOINT ${savepoint};`);
      try {
        const result = await this.txDepthStorage.run(currentDepth + 1, fn);
        this.sqlite.exec(`RELEASE SAVEPOINT ${savepoint};`);
        return result;
      } catch (err) {
        try {
          this.sqlite.exec(`ROLLBACK TO SAVEPOINT ${savepoint};`);
          this.sqlite.exec(`RELEASE SAVEPOINT ${savepoint};`);
        } catch {
          // ignore cleanup failure after inner error
        }
        throw err;
      }
    }

    let releaseLock!: () => void;
    const gate = new Promise<void>((resolve) => {
      releaseLock = resolve;
    });
    const prevTail = this.mutexTail;
    this.mutexTail = prevTail.then(
      () => gate,
      () => gate,
    );
    await prevTail;

    try {
      this.sqlite.exec("BEGIN IMMEDIATE;");
      const result = await this.txDepthStorage.run(1, fn);
      this.sqlite.exec("COMMIT;");
      return result;
    } catch (err) {
      try {
        this.sqlite.exec("ROLLBACK;");
      } catch {
        // ignore if already rolled back
      }
      throw err;
    } finally {
      releaseLock();
    }
  }

  /**
   * Executes synchronous multi-statement SQLite work atomically.
   * Uses a savepoint when already inside an active transaction, or `sqlite.transaction` otherwise.
   */
  runSyncAtomic<T>(fn: () => T): T {
    const depth = this.txDepthStorage.getStore() ?? 0;
    if (depth > 0 || this.sqlite.inTransaction) {
      const savepoint = `sp_sync_${depth}_${Math.random().toString(36).slice(2, 8)}`;
      this.sqlite.exec(`SAVEPOINT ${savepoint};`);
      try {
        const result = fn();
        this.sqlite.exec(`RELEASE SAVEPOINT ${savepoint};`);
        return result;
      } catch (err) {
        try {
          this.sqlite.exec(`ROLLBACK TO SAVEPOINT ${savepoint};`);
          this.sqlite.exec(`RELEASE SAVEPOINT ${savepoint};`);
        } catch {
          // ignore cleanup failure after inner error
        }
        throw err;
      }
    }
    return this.sqlite.transaction(fn)();
  }
}
