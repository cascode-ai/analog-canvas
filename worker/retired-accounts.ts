type SqlStorage = {
  exec<T>(query: string, ...bindings: string[]): { toArray(): T[] };
};

/** Owner IDs are never reassigned. A revoked ID remains retired after replay. */
export function installRetiredAccounts(sql: SqlStorage) {
  sql.exec(
    "CREATE TABLE IF NOT EXISTS retired_accounts (id TEXT PRIMARY KEY) WITHOUT ROWID",
  );
}

export function retiredAccount(sql: SqlStorage, id: unknown): boolean {
  return (
    typeof id === "string" &&
    id.length > 0 &&
    sql.exec("SELECT 1 FROM retired_accounts WHERE id=?", id).toArray().length >
      0
  );
}

export function retireAccount(sql: SqlStorage, id: string) {
  sql.exec("INSERT OR IGNORE INTO retired_accounts VALUES (?)", id);
}

export function validAccountId(id: unknown): id is string {
  return typeof id === "string" && /^[a-zA-Z0-9:_-]{1,160}$/u.test(id);
}
