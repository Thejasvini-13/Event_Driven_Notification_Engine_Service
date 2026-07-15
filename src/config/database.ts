import { Pool, PoolClient, QueryResult, QueryResultRow } from 'pg';
import { logger } from '../server';

// ─── Configuration ─────────────────────────────────────────────

interface DatabaseConfig {
  host: string;
  port: number;
  database: string;
  user: string;
  password: string;
  min: number;
  max: number;
  idleTimeoutMillis: number;
  connectionTimeoutMillis: number;
  statement_timeout: number;
}

function buildConfig(): DatabaseConfig {
  return {
    host:                    process.env['POSTGRES_HOST']     ?? 'localhost',
    port:                    parseInt(process.env['POSTGRES_PORT'] ?? '5432', 10),
    database:                process.env['POSTGRES_DB']       ?? 'notification_engine',
    user:                    process.env['POSTGRES_USER']     ?? 'notif_user',
    password:                process.env['POSTGRES_PASSWORD'] ?? 'notif_secret',
    min:                     parseInt(process.env['POSTGRES_POOL_MIN'] ?? '2', 10),
    max:                     parseInt(process.env['POSTGRES_POOL_MAX'] ?? '20', 10),
    idleTimeoutMillis:       30_000,
    connectionTimeoutMillis: 10_000,
    statement_timeout:       30_000,
  };
}

// ─── Pool Singleton ────────────────────────────────────────────

let pool: Pool | null = null;

export function getPool(): Pool {
  if (!pool) {
    pool = new Pool(buildConfig());

    pool.on('error', (err: Error) => {
      logger.error({ err }, 'PostgreSQL pool error');
    });

    pool.on('connect', () => {
      logger.debug('PostgreSQL: new client connected');
    });
  }
  return pool;
}

// ─── Query Helpers ────────────────────────────────────────────

export async function query<T extends QueryResultRow = QueryResultRow>(
  sql: string,
  params: unknown[] = [],
): Promise<QueryResult<T>> {
  const client = getPool();
  const start = Date.now();
  try {
    const result = await client.query<T>(sql, params);
    const duration = Date.now() - start;
    if (duration > 200) {
      logger.warn({ sql: sql.substring(0, 80), duration }, 'Slow query detected');
    }
    return result;
  } catch (err) {
    logger.error({ err, sql: sql.substring(0, 80) }, 'Database query failed');
    throw err;
  }
}

export async function withTransaction<T>(
  fn: (client: PoolClient) => Promise<T>,
): Promise<T> {
  const client = await getPool().connect();
  try {
    await client.query('BEGIN');
    const result = await fn(client);
    await client.query('COMMIT');
    return result;
  } catch (err) {
    await client.query('ROLLBACK');
    logger.error({ err }, 'Transaction rolled back');
    throw err;
  } finally {
    client.release();
  }
}

// ─── Health Check ────────────────────────────────────────────

export async function checkDatabaseHealth(): Promise<boolean> {
  try {
    await query('SELECT 1');
    return true;
  } catch {
    return false;
  }
}

// ─── Graceful Shutdown ────────────────────────────────────────

export async function closePool(): Promise<void> {
  if (pool) {
    await pool.end();
    pool = null;
    logger.info('PostgreSQL pool closed');
  }
}
