---
name: prisma-migrations
description: FindMYJob 唯一的数据库迁移规程。只在以下情况使用：修改 prisma/schema.prisma、生成或审查 Prisma 迁移（migrate dev --create-only）、写数据回填脚本（scripts/backfill）、处理失败的迁移（P3009、INVALID 索引）。其他任务不要加载。
---

# prisma-migrations

本项目是普通 PostgreSQL 16 + Prisma 6（`pnpm prisma`）。和 CLAUDE.md「数据库与迁移」一致；冲突时以 CLAUDE.md 为准。没有 down 迁移，迁移只往前滚。

## §1 先判断阶段
- `grep -q '^#### \[x\] 🚦 GATE-M7' docs/TASKS.md`：没勾选 = 上线前，可以直接改结构（仍要走 §2）；已勾选 = 上线后，只允许 expand，任何破坏性语句都输出 `STATUS: BLOCKED <ID> MIGRATION_REVIEW`，等人审核。

## §2 生成和审查
1. 改 schema：DateTime 加 `@db.Timestamptz(3)`；每个外键标量都有以它开头的索引；主键 `cuid()`；令牌只存 sha256 哈希。
2. `pnpm prisma migrate dev --create-only --name <名字>`，然后读一遍生成的 SQL，逐项检查：
   - `DROP TABLE` / `DROP COLUMN`；
   - 改名被生成成「DROP + ADD」（会丢数据）；
   - `ALTER COLUMN ... TYPE`；`SET NOT NULL`；
   - 带易变默认值的 `ADD COLUMN`（例如 `now()`、随机值）；
   - enum 加值和使用这个新值写在同一个迁移里。
3. 有破坏性语句时：上线前写 `-- contract-approved: <理由>` 注释后才能继续；上线后按 §1 停下。
4. `pnpm prisma migrate dev` 应用，再跑 `pnpm db:check`，必须退出码为 0。已提交的迁移不改、不删。

## §3 超时
- `findmyjob_owner` 角色上已设 `lock_timeout 5s`、`statement_timeout 10min`，迁移文件里不写 lock_timeout。
- 确实需要更长的 statement_timeout 时，只在多语句迁移的第一行写 `SET statement_timeout = '30min';`，并在完成说明里写原因。

## §4 模板
- **加可空列**：直接加，安全。
- **加带常量默认值的 NOT NULL 列**：`ADD COLUMN ... NOT NULL DEFAULT <常量>`，PG16 不重写表。
- **给已有列加 NOT NULL（五步，分版本）**：① `ADD CONSTRAINT x_nn CHECK (col IS NOT NULL) NOT VALID`；② 回填（§6）；③ `VALIDATE CONSTRAINT x_nn`；④ `ALTER COLUMN col SET NOT NULL`（有已验证的 CHECK，不再全表扫描）；⑤ `DROP CONSTRAINT x_nn`。
- **改名**：上线后不改真实列名，只改 Prisma 字段名并用 `@map("旧列名")` 保留旧名。上线前可以直接改（确认生成的不是 DROP + ADD）。
- **删列（两个版本）**：第一版字段加 `@ignore`、代码不再读写；下一版再删列（带 contract-approved 注释）。
- **改类型**：新增列 → 回填 → 代码切换到新列 → 下一版删旧列；不直接 `ALTER COLUMN TYPE`。
- **enum 加值**：单独一个迁移只做 `ALTER TYPE ... ADD VALUE`，使用新值的改动放到下一个迁移。

## §5 索引
- 大表在线建索引用 `CREATE INDEX CONCURRENTLY`，单独放一个迁移文件，文件里只有这一条语句（多语句文件会进事务，CONCURRENTLY 会失败）。
- CONCURRENTLY 失败会留下 INVALID 索引：由人先执行 `DROP INDEX CONCURRENTLY IF EXISTS <名>`，再 `prisma migrate resolve --rolled-back <迁移名>`，然后重新部署。AI 不运行 migrate resolve。
- trigram 索引写在 schema 里：`@@index([col(ops: raw("gin_trgm_ops"))], type: Gin)`；`pg_trgm` 扩展在首个迁移第一行创建。不在迁移里手写 schema 表达不了的索引，否则下一次迁移会把它删掉，db:check 也会报漂移。

## §6 回填
- 写在 `scripts/backfill/<name>.ts`，不放进迁移、不用 pg-boss。
- 按主键 id 游标分批，每批不超过 1000 行，每批一个短事务；可以重复执行（只处理还没回填的行）。
- 只打印进度（批次号、行数），不打印任何字段值。用 `tsx --conditions=react-server` 运行。

## §7 只追加的表
- 新建只追加的表（账本、审计类）时，在同一个迁移末尾写 DO 块：`findmyjob_app` 存在时收回它对这张表的 UPDATE、DELETE、TRUNCATE。用 findmyjob_app 测一次 UPDATE，应返回 42501。

## §8 生产
- 生产迁移只通过 `findmyjob-deploy deploy <sha> --approve-migrations` 执行（先备份再迁移），由人批准。AI 永远不运行 `migrate deploy`、`migrate resolve`、`migrate reset`、`db push`。
- P3009（有失败的迁移）：由人查 `_prisma_migrations` 里失败的那条和数据库实际状态，修好后用 `migrate resolve --rolled-back` 或 `--applied` 标记，再重新部署；步骤记在 docs/RUNBOOK.md。
- 回滚 = 重新部署上一个镜像 tag，必要时再写一个前滚迁移。每个迁移都必须和上一个已发布的镜像兼容（先 expand，代码切换后再 contract）。
