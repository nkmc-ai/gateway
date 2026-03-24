export interface D1Result<T = Record<string, unknown>> {
  results: T[];
  success: boolean;
}

export interface D1RunResult {
  success: boolean;
  changes: number;
  lastRowId: number;
}

export interface D1PreparedStatement {
  bind(...values: unknown[]): D1PreparedStatement;
  first<T = Record<string, unknown>>(): Promise<T | null>;
  all<T = Record<string, unknown>>(): Promise<D1Result<T>>;
  run(): Promise<D1RunResult>;
}

export interface D1Database {
  prepare(sql: string): D1PreparedStatement;
  exec(sql: string): Promise<void>;
}
