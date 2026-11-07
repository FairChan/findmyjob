# 容量与性能基准

> 测量时间：2026-11-08
> 测试环境：本机 PostgreSQL 16，findmyjob_laneb_test，10,000 条合成职位（faker seed=42，10% 含「财务助理实习」关键词）
> candidateWindow = 500（`search.candidateWindow` 默认值）
> 测量方法：每个场景跑 20 次，取 p95（第 19 高的那次）

## 职位搜索（M5-T11 基准）

| 场景 | p95 | 目标值 | 状态 |
|---|---|---|---|
| 空查询（relevance，游标分页） | 11ms | < 500ms | ✅ |
| 关键词「财务」RELATED 模式 | 40ms | < 1000ms | ✅ |
| 关键词无匹配 | 37ms | < 500ms | ✅ |
| 空查询 + 薪资排序（candidateWindow cap） | 18ms | < 1000ms | ✅ |

> 以上数据基于本机（无网络延迟、SSD、热数据库缓存）。
> 生产环境加上网络 RTT 和冷启动，实际 p95 可能增加 20–100ms。
> 目标值定义见 docs/DECISIONS.md（开发中决策表，M5-T11 条目）。

## 复测说明

```bash
RUN_BENCH=1 pnpm test --maxWorkers=1 tests/integration/job-search-bench.test.ts --reporter=verbose
```

每次跑完自动清理测试数据。
