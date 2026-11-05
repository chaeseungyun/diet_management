/**
 * DATABASE_URL 이 없으면 embedded-postgres 로 임시 PostgreSQL 을 띄운 뒤 인자로 받은 명령을 실행한다.
 *   node test/run-with-db.mjs jest --selectProjects e2e
 * 포트는 TEST_PG_PORT(기본 54321). 데이터는 .local/pg-test 에 두고 종료 시 지운다.
 */
import { spawn } from 'node:child_process';
import { existsSync, rmSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import EmbeddedPostgres from 'embedded-postgres';

const here = dirname(fileURLToPath(import.meta.url));
const [, , cmd, ...args] = process.argv;
if (!cmd) {
  console.error('usage: node test/run-with-db.mjs <command> [args...]');
  process.exit(2);
}

let pg;
let env = { ...process.env };

if (!process.env.DATABASE_URL) {
  const port = Number(process.env.TEST_PG_PORT ?? 54321);
  const databaseDir = join(here, '..', '.local', 'pg-test');
  if (existsSync(databaseDir)) rmSync(databaseDir, { recursive: true, force: true });
  pg = new EmbeddedPostgres({
    databaseDir,
    user: 'postgres',
    password: 'postgres',
    port,
    persistent: false,
    onLog: () => {},
    onError: (m) => console.error(String(m)),
  });
  await pg.initialise();
  await pg.start();
  await pg.createDatabase('diet_test');
  env.DATABASE_URL = `postgresql://postgres:postgres@127.0.0.1:${port}/diet_test`;
  console.log(`[run-with-db] embedded postgres on :${port}`);
}

const child = spawn(cmd, args, { stdio: 'inherit', env, shell: process.platform === 'win32' });
const code = await new Promise((resolve) => child.on('exit', (c) => resolve(c ?? 1)));

if (pg) {
  try {
    await pg.stop();
  } catch (e) {
    console.error('[run-with-db] stop failed', e);
  }
}
process.exit(code);
