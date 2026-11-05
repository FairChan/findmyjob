# RUNBOOK · FindMYJob 运维手册

> 骨架 v0.2 · 2026-11-03。各节由对应任务填写：部署和回滚（M7-T06、M7-T11）、备份与恢复（M7-T12）、事故响应（M7-T13）。运维内容只写在这里。
> 隐私守则：处理任何问题时，不把真实数据、完整的 AuditLog 行、`.env` 内容贴进 Claude 会话。

## 角色

| 角色 | 人 | 职责 |
|---|---|---|
| 技术负责人 | 待定 | 部署、批准迁移、复核运维操作 |
| 运维备份人 | 待指定（B15） | GATE-M7 前独立完成一次回滚和一次恢复演练；离线密钥的第二位保管人 |

## 部署

技术负责人通过 SSH 执行：

```bash
ssh <admin>@43.134.49.247 sudo -u deploy /opt/findmyjob/bin/findmyjob-deploy deploy <40位sha>
```

脚本自动完成：拉取镜像 → 比对迁移 → 预迁移备份 → 执行迁移 → 重启 app/worker → 60 秒健康检查。
成功后 sha 和 digest 写入 `/opt/findmyjob/deploy-history.log`。

**有待执行迁移时**（exit 3）：脚本打印 SQL 后停止。审阅 SQL 无破坏性操作后，加 `--approve-migrations` 重新执行：

```bash
ssh <admin>@43.134.49.247 sudo -u deploy /opt/findmyjob/bin/findmyjob-deploy deploy <sha> --approve-migrations
```

**健康检查失败时**：脚本自动将 app/worker 切回上一个镜像 tag 并以 exit 1 结束。**迁移不回滚**，需要时写前滚迁移后重新 deploy。

GitHub 不持有部署私钥。镜像由 CI `image` job 在 push 到 main 时自动推送到 GHCR：
- `ghcr.io/fairchan/findmyjob:<sha>`
- `ghcr.io/fairchan/findmyjob-migrate:<sha>`
- `ghcr.io/fairchan/findmyjob-backup:<sha>`

## 回滚

```bash
ssh <admin>@43.134.49.247 sudo -u deploy /opt/findmyjob/bin/findmyjob-deploy rollback
```

回滚 = 将 app/worker 切换回 `deploy-history.log` 倒数第二条记录的镜像 tag。**迁移不回滚**：已执行的迁移保持不变。如果回滚后旧镜像与当前 schema 不兼容，需要写一个前滚迁移并重新 deploy。

## 迁移失败

### P3009（迁移标记为失败）

Prisma 在迁移失败时会将 `_prisma_migrations` 中该行的 `finished_at` 置为 null、`applied_steps_count` 记为 0。

1. 确认迁移是否有部分执行（例如建表成功但索引失败）：

   ```bash
   docker compose -f /opt/findmyjob/docker-compose.prod.yml \
     exec postgres psql -U postgres -d findmyjob -c "\d+ <表名>"
   ```

2. **迁移完全未执行**（可安全重试）：删除失败记录，然后重新 deploy。

   ```sql
   -- 以 findmyjob_owner 身份执行
   DELETE FROM _prisma_migrations WHERE migration_name = '<失败迁移名>';
   ```

3. **迁移已部分执行**：手动完成剩余操作，或写一个新迁移完成它，然后重新 deploy。

### INVALID 索引（`CREATE INDEX CONCURRENTLY` 失败）

CONCURRENTLY 索引在事务外运行，失败后留下 INVALID 状态的索引，会阻止后续同名迁移。

1. 确认 INVALID 索引：

   ```sql
   SELECT schemaname, tablename, indexname
   FROM pg_indexes
   JOIN pg_class ON pg_class.relname = pg_indexes.indexname
   WHERE pg_class.relisvalid = false;
   ```

2. 删除 INVALID 索引：

   ```sql
   DROP INDEX CONCURRENTLY IF EXISTS "<索引名>";
   ```

3. 在 `_prisma_migrations` 中删除对应的失败记录（同 P3009 步骤 2），然后重新 deploy。

## 密钥生成与轮换

### 生成新 PII 密钥

```bash
# 生成 32 字节随机密钥并输出 base64（作为 PII_KEYS 的值部分）
openssl rand -base64 32
```

初始配置示例（单密钥）：
```
PII_KEYS=v1:<openssl rand -base64 32 的输出>
PII_ACTIVE_KEY_ID=v1
```

### 密钥轮换步骤

1. 生成新密钥：`openssl rand -base64 32`
2. 将新密钥作为 v2（或下一个 ID）加入 PII_KEYS（用实际 base64 值替换 KEY1/KEY2）：
   ```
   PII_KEYS=v1:KEY1,v2:KEY2
   PII_ACTIVE_KEY_ID=v2
   ```
3. 重启 app 和 worker 使新配置生效；新写入的 StudentContact 字段将以 `enc:v2:` 开头。
4. 运行回填脚本 `scripts/backfill/reencrypt-contacts.ts` 将现有字段重新加密为 v2。
5. **旧密钥（v1）必须保留在 PII_KEYS 中，直到所有含 v1 密文的备份全部过期（30 天）。**
6. 30 天后，从 PII_KEYS 中删除 v1 条目，重启服务。

### GHCR PAT 轮换

每 90 天轮换一次（在日历上设置提醒）：

1. 在 GitHub → Settings → Developer settings → Personal access tokens (fine-grained) 为 `fairchan/findmyjob` 仓库生成新 PAT，权限只选 `packages: write`，有效期 90 天。
2. 在生产主机上更新登录凭据：
   ```bash
   echo "<new-token>" | docker login ghcr.io -u <github-username> --password-stdin
   ```
3. 验证登录成功（`docker pull ghcr.io/fairchan/findmyjob:latest` 或最新 sha）。
4. 在密码管理器里更新 PAT 记录，注明到期日。
5. 在 GitHub 里撤销旧 PAT。

## 备份

### 备份方案概述

每天 **19:15 UTC**（吉隆坡 03:15）自动触发：

```
pg_dump -Fc --exclude-schema=pgboss <DB> | age -r <公钥> → /backup-tmp/<时间戳>.dump.age → S3
```

- 明文**全程不落磁盘**：管道直接从 pg_dump 经 age 加密写入 `/backup-tmp`（Docker 卷）中的临时文件；上传完成后 `trap` 删除。
- S3 路径：`db/daily/<YYYY-MM-DDTHH-MM-SSZ>.dump.age`，预迁移备份写 `db/pre-migrate/`。
- 同时上传 `db/counts.json`，记录关键表行数（用于恢复演练的对账）。
- 上传完成后 curl 通知 healthchecks.io（若未收到 ping，healthchecks 会告警）。

### 备份桶配置

| 桶 | 用途 | 区域 | 版本控制 | 生命周期 |
|---|---|---|---|---|
| `findmyjob-backups` | 加密数据库备份 | ap-southeast-5（马来西亚） | 开启 | 当前版本 30 天后过期 |
| `findmyjob-files`（应用桶） | 用户上传文件 | ap-southeast-5 | 开启 | 非当前版本 30 天后过期 |

IAM 权限见 M7-H01 配置表：
- `backup-writer`：对 `db/*` 仅 PutObject
- `restore-reader`：只读；平时**离线保存**，演练时临时注入

### age 密钥管理

- `age-keygen` 生成密钥对；公钥写入 `backup.env` 的 `AGE_PUBLIC_KEY`。
- **私钥仅做两份离线介质（如 USB）**，不进密码管理器，不上服务器，两人各保管一份。
- 恢复演练时，密钥持有人需在场。

### 检查备份是否正常运行

1. 登录 healthchecks.io，确认 `findmyjob-backup` 显示绿色。
2. 或者列出 S3 对象：
   ```bash
   aws s3 ls s3://findmyjob-backups/db/daily/ | tail -n 5
   ```
3. 验证文件头（前 21 字节应为 `age-encryption.org/v1`）：
   ```bash
   aws s3 cp s3://findmyjob-backups/db/daily/<最新文件> - | head -c 21
   ```

### 安装 cron

```bash
sudo install -m 644 deploy/server/findmyjob-cron /etc/cron.d/findmyjob
# 重新加载（Debian/Ubuntu 会自动拾取 /etc/cron.d/）
sudo systemctl reload cron
# 查看日志
sudo tail -f /var/log/findmyjob-backup.log
```

## 恢复演练

**目标**：在 GATE-M7 前完成一次，之后每季度一次。由运维备份人独立执行。

### 前提条件

- 有 age 私钥的离线介质。
- `restore-reader` IAM 凭据（临时注入）。
- 目标机器上安装了 `age`、`awscli`、`postgresql-client-16`、`python3`。
- Docker 和 `docker compose` 可用。
- 已 `clone` 仓库并位于仓库根目录。

### 步骤

```bash
# 1. 设置恢复凭据（演练时临时设置，不要写入 .env）
export RESTORE_S3_ACCESS_KEY_ID=<restore-reader key>
export RESTORE_S3_SECRET_ACCESS_KEY=<restore-reader secret>
export RESTORE_ADMIN_DATABASE_URL=postgresql://findmyjob_owner:<pass>@127.0.0.1:5432/postgres
export BACKUP_S3_BUCKET=findmyjob-backups
export PII_KEYS=<离线 PII 密钥>
export APP_TAG=<当前镜像 tag>

# 2. 执行演练（私钥从 USB 通过 stdin 传入）
cat /media/usb/age-private.key | bash scripts/db/restore-drill.sh findmyjob_drill

# 3. 检查输出：所有 ✓，最后打印 RTO
# 4. 演练完成后删除钻演数据库
psql "$RESTORE_ADMIN_DATABASE_URL" -c 'DROP DATABASE IF EXISTS findmyjob_drill;'
```

### 脚本检查项

| 检查 | 通过条件 |
|---|---|
| 迁移数一致 | DB 中已完成迁移数 = 磁盘上 `prisma/migrations/*/migration.sql` 数量 |
| 关键表不为空 | User / StudentProfile / Company / Job / Application 有行 |
| RPO | 最新备份不超过 26 小时前 |
| 对账 SQL | CreditWallet.balance = SUM(CreditLedger.delta)，0 行不一致 |
| counts.json | 恢复后各表行数与备份时 counts.json 完全一致 |
| verify-decrypt | 用离线 PII_KEYS 解密 1 条 StudentContact.phone，输出已掩码 |
| Session | 恢复后清空，防止会话固定 |

### 记录结果

演练完成后，在 `docs/incidents/` 目录新建一个文件（格式参考 TEMPLATE.md）记录：

- 执行日期、执行人
- 使用的备份时间戳（RPO）
- 脚本输出的 RTO
- 发现的问题（如有）

## 真实恢复

**触发条件**：数据库损坏、误删、主机不可恢复。

> 恢复完成后，**必须补跑一次 `purge-deleted-accounts`**，
> 因为备份时间点和恢复时间点之间可能有已删除账号的数据在恢复后重新出现。

### 步骤

1. **评估**：确认无法通过其他手段恢复（如数据库 PITR），恢复会造成 RPO 时间段内数据丢失，向受影响用户沟通。
2. **通知**：告知相关人员，启动 PDPA 通报流程评估（见「事故响应」节）。
3. **停机**：临时停止 app 和 worker，避免新数据写入。
   ```bash
   docker compose -f /opt/findmyjob/docker-compose.prod.yml stop app worker
   ```
4. **执行恢复**：按恢复演练步骤执行，目标库改为 `findmyjob_restore`（仍以 `_drill` 结尾是为了演练安全检查）。实际恢复时需将最终数据库改名为 `findmyjob`，或修改 DATABASE_URL。
5. **补跑账号清除**：
   ```bash
   docker compose -f /opt/findmyjob/docker-compose.prod.yml \
     --profile ops run --rm tools scripts/backfill/purge-deleted-accounts.ts
   ```
6. **重启服务**：
   ```bash
   docker compose -f /opt/findmyjob/docker-compose.prod.yml up -d app worker
   ```
7. **验证**：登录、发职位、搜人各一遍；确认 Sentry 无新增异常；通知 healthchecks。
8. **记录**：在 `docs/incidents/` 新建事故记录，注明恢复时间、数据丢失范围、后续行动。

## 事故响应
（M7-T13 填写：SEV 分级、角色、联系表（核实后再填，不编造号码）、五个止血场景、只读 SQL 模板、PDPA 通报。）

## 每周一 30 分钟例行检查

负责人：技术负责人（待定）；缺席时由运维备份人做。

- [ ] Dependabot 的安全 PR：逐个看，能合的合，不能合的在 DECISIONS 写原因和到期日
- [ ] Sentry 里未解决的 issue：确认没有新的 PII 泄露类问题
- [ ] healthchecks：备份和定时任务过去 7 天都是绿色
- [ ] `.reports/COSTS.tsv` 和中转扣费：本周花费、累计是否接近 D23 上限
- [ ] 记一行检查结果（日期、执行人、发现的问题编号）
