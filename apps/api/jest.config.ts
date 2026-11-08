import type { Config } from 'jest';

const common: Pick<Config, 'transform' | 'moduleFileExtensions' | 'testEnvironment'> = {
  transform: { '^.+\.ts$': ['ts-jest', { tsconfig: 'tsconfig.json' }] },
  moduleFileExtensions: ['ts', 'js', 'json'],
  testEnvironment: 'node',
};

const config: Config = {
  // e2e 파일들이 한 PostgreSQL 을 공유하고 TRUNCATE 를 쓰므로 파일을 직렬로 돈다
  maxWorkers: 1,
  projects: [
    {
      displayName: 'unit',
      rootDir: 'src',
      testRegex: '.*\.spec\.ts$',
      ...common,
    },
    {
      displayName: 'e2e',
      rootDir: '.',
      testRegex: 'test/.*\.e2e-spec\.ts$',
      globalSetup: '<rootDir>/test/global-setup.ts',
      globalTeardown: '<rootDir>/test/global-teardown.ts',
      testTimeout: 60_000,
      ...common,
    },
  ],
};

export default config;
