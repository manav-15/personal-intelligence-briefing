declare module 'node:sqlite' {
  export class DatabaseSync {
    constructor(location: string);
    prepare(query: string): {
      all(...values: unknown[]): unknown[];
      run(...values: unknown[]): { changes: number | bigint };
    };
  }
}
