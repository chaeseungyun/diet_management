/**
 * e2e 전역 설정: DATABASE_URL 의 DB를 비우고 prisma/migrations 의 SQL을 순서대로 적용한다.
 * DB 자체는 test/run-with-db.mjs 가 띄운다(embedded-postgres). CI 에서는 services 의 PostgreSQL 을 쓴다.
 */
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { Client } from 'pg';

export default async function globalSetup(): Promise<void> {
  const url = process.env.DATABASE_URL;
  if (!url) {
    throw new Error(
      'DATABASE_URL is required for e2e tests (run via test/run-with-db.mjs or CI services)',
    );
  }
  const client = new Client({ connectionString: url });
  await client.connect();
  try {
    await client.query('DROP SCHEMA IF EXISTS public CASCADE; CREATE SCHEMA public;');
    const dir = join(__dirname, '..', 'prisma', 'migrations');
    const folders = readdirSync(dir)
      .filter((f) => statSync(join(dir, f)).isDirectory())
      .sort();
    for (const folder of folders) {
      const sql = readFileSync(join(dir, folder, 'migration.sql'), 'utf8');
      await client.query(sql);
    }
  } finally {
    await client.end();
  }
}
