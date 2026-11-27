export type StorageDialect = "sqlite" | "postgres";

/**
 * Coordinates atomic multi-step repository operations across narrow ports.
 */
export interface TransactionRunner {
  runInTx<T>(fn: () => Promise<T>): Promise<T>;
}
