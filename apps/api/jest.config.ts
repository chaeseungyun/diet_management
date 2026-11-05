import type { Config } from 'jest';

const common: Pick<Config, 'transform' | 'moduleFileExtensions' | 'testEnvironment'> = {
  transform: { '^.+\.ts$': ['ts-jest', { tsconfig: 'tsconfig.json' }] },
  moduleFileExtensions: ['ts', 'js', 'json'],
  testEnvironment: 'node',
};

const config: Config = {
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
