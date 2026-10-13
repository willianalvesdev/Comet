import { Pool, types } from 'pg';
import type { PoolClient, QueryResultRow } from 'pg';

types.setTypeParser(1082, value => value);
types.setTypeParser(1114, value => new Date(value.replace(' ', 'T') + 'Z'));

export interface Database {
    query<T extends object = Record<string, unknown>>(sql: string, params?: unknown[]): Promise<T[]>;
}
const shared = globalThis as typeof globalThis & { cometPool?: Pool };
export function pool(): Pool {
    if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL não configurada. Execute configurar_banco.bat.');
    if (shared.cometPool) return shared.cometPool;
    const instance = new Pool({
        connectionString: process.env.DATABASE_URL,
        max: 10, connectionTimeoutMillis: 5000, idleTimeoutMillis: 30000,
        options: '-c timezone=UTC -c statement_timeout=30000 -c idle_in_transaction_session_timeout=60000',
    });
    instance.on('error', () => console.warn('Uma conexão ociosa com o PostgreSQL foi encerrada. A próxima consulta abrirá outra conexão.'));
    return shared.cometPool = instance;
}
export async function query<T extends object = Record<string, unknown>>(sql: string, params: unknown[] = []): Promise<T[]> {
    return (await pool().query<T & QueryResultRow>(sql, params)).rows;
}
export async function transaction<T>(run: (db: Database) => Promise<T>): Promise<T> {
    const client: PoolClient = await pool().connect();
    try {
        await client.query('BEGIN');
        const result = await run({ query: async <R extends object>(sql: string, params: unknown[] = []) =>
            (await client.query<R & QueryResultRow>(sql, params)).rows });
        await client.query('COMMIT');
        return result;
    } catch (error) {
        await client.query('ROLLBACK');
        throw error;
    } finally { client.release(); }
}
export async function closeDatabase() {
    const current = shared.cometPool;
    delete shared.cometPool;
    await current?.end();
}
