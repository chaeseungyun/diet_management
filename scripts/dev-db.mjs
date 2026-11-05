/**
 * Docker 없이 로컬 개발용 PostgreSQL 을 띄운다(embedded-postgres, 데이터는 .local/pgdata 에 보존).
 *   pnpm db:dev          → 127.0.0.1:54320, DB diet_dev, 사용자/비번 postgres/postgres
 * Ctrl+C 로 종료. apps/api/.env 의 DATABASE_URL 기본값과 맞춘다.
 */
import { createRequire } from 'node:module';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

// embedded-postgres 는 apps/api 의 devDependency 라 그 위치에서 해석한다 (Windows 는 file:// URL 필요)
const require = createRequire(pathToFileURL(resolve(process.cwd(), 'apps/api/package.json')));
const { default: EmbeddedPostgres } = await import(
  pathToFileURL(require.resolve('embedded-postgres')).href
);

const port = Number(process.env.DEV_PG_PORT ?? 54320);
const pg = new EmbeddedPostgres({
  databaseDir: resolve(process.cwd(), '.local/pgdata'),
  user: 'postgres',
  password: 'postgres',
  port,
  persistent: true,
  onLog: () => {},
  onError: (m) => console.error(String(m)),
});

const { existsSync } = await import('node:fs');
if (!existsSync(resolve(process.cwd(), '.local/pgdata/PG_VERSION'))) {
  await pg.initialise();
}
await pg.start();
try {
  await pg.createDatabase('diet_dev');
} catch {
  // 이미 있음
}
console.log(`[dev-db] postgresql://postgres:postgres@127.0.0.1:${port}/diet_dev  (Ctrl+C to stop)`);

const stop = async () => {
  await pg.stop();
  process.exit(0);
};
process.on('SIGINT', stop);
process.on('SIGTERM', stop);
