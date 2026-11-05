# diet-app

식단·재고·체중 관리 웹앱. 적은 입력으로 식사·영양·체중을 기록하고 식품 소진을 예측한다.

- 설계 문서: [`docs/`](docs/) — 요구사항([`requirements-phase1.md`](docs/requirements-phase1.md)), ERD, 상태 전이, 화면, API, 결정 기록([`decisions.md`](docs/decisions.md))
- 운영 문서(로컬 실행·배포·백업): [`docs/ops.md`](docs/ops.md)
- 작업 지침: [`CLAUDE.md`](CLAUDE.md)

```bash
pnpm install && pnpm --filter @diet/shared build && pnpm --filter @diet/api prisma:generate
pnpm db:dev                                 # 로컬 PostgreSQL
pnpm --filter @diet/api prisma:deploy
pnpm --filter @diet/api dev                 # http://localhost:4000/api/v1/docs
pnpm --filter @diet/web dev                 # http://localhost:3000
pnpm test
```
