# RUNBOOK · FindMYJob 运维手册

> 骨架 v0.2 · 2026-11-03。各节由对应任务填写：部署和回滚（M7-T06、M7-T11）、备份与恢复（M7-T12）、事故响应（M7-T13）。运维内容只写在这里。
> 隐私守则：处理任何问题时，不把真实数据、完整的 AuditLog 行、`.env` 内容贴进 Claude 会话。

## 角色

| 角色 | 人 | 职责 |
|---|---|---|
| 技术负责人 | 待定 | 部署、批准迁移、复核运维操作 |
| 运维备份人 | 待指定（B15） | GATE-M7 前独立完成一次回滚和一次恢复演练；离线密钥的第二位保管人 |

## 运营账号双重验证

> M6-T09，2026-11-09：以下流程对应本地实现，尚未部署。上线须批准新增迁移 `20261109092518_admin_two_factor`，并在部署后完成现场验收。

### 上线前与首次设置

1. 技术负责人按「部署」节审阅并批准迁移，确认会增加 `User.twoFactorEnabled`、`Session.twoFactorVerifiedAt` 和 `TwoFactor` 表。部署前通知部署会话及运营人员：已有 staging 演示运营账号首次进入 `/zh/admin` 或 `/en/admin` 会转到相应语言的 `/two-factor/setup`，这是预期行为。本轮不修改 `deploy/**` 或种子数据中的账号、密码。
2. 每人使用自己的运营账号和密码管理器生成的独立强密码。密码登录仍需通过 Turnstile；首次设置要求有效的 ACTIVE ADMIN 会话，并再次输入当前密码。
3. 点击「生成验证密钥」，在可信的验证器中选择手动添加，导入页面显示的密钥，使用基于时间的六位动态验证码。页面没有扫码流程，不把密钥、动态验证码或备用码放入工单、聊天、日志、截图或 AI 会话。
4. 将页面提供的备用码保存到受访问控制且设备丢失后仍可取用的安全位置。每个备用码只能使用一次；当前版本没有重新查看密钥、重新生成备用码或自助关闭 2FA 的入口。确认安全保存后勾选确认框，输入当前六位验证码，点击「验证并进入后台」。仅生成密钥尚未完成开通。
5. 退出后重新登录，确认密码之后必须输入动态验证码；也可使用一个备用码验证备用恢复入口，该码随即失效。部署现场验收还应确认未设置账号无法进入后台、未完成第二因素时没有已登录会话，且敏感动作的过期提示正常。记录版本、执行人、时间与结果，只记录账号内部 ID，不记录凭据。

### 日常登录与过期提示

- 每次运营密码登录后都需完成 TOTP 或备用码验证，不提供「信任此设备」跳过流程。登录挑战默认有效期为 10 分钟，超时后重新进行密码登录。
- 同账号登录时连续输错第二因素 5 次会锁定 15 分钟，TOTP 与备用码共同计数；成功验证后重置失败计数。设置、TOTP 验证、备用码验证各自还有每 IP 每端点 60 秒 5 次请求限制，第 6 次返回 429。遇到锁定先停止重试，等待锁定结束后重新登录；不要人工清空计数来继续尝试。
- ADMIN 会话从创建起最长 12 小时，页面活动或自动续期不会延长。运营查看学生联系方式、调整企业点数要求最近一次成功第二因素验证在 10 分钟以内；出现新鲜会话提示时重新登录并完成第二因素，再重试原操作。M8 的订单确认尚未实现，上线该功能时必须沿用相同要求。
- 每周复核运营账号的 `auth.login` 记录，关注异常时段和来源。强制 2FA 上线后仍保留独立强密码与不共用账号的要求；TM-026 须在部署及现场验收后复评，不能因本地实现而标记线上已消除。

### 验证器或备用码丢失

1. **验证器不可用但仍有备用码**：在密码登录后的验证页点击「使用备用码」，输入一个未使用的备用码。若只是设备时间偏差，先校准设备时间。若验证器永久丢失，应联系技术负责人安排重新绑定；一次备用码登录并不会自动更换旧密钥，当前没有自助重新绑定入口。
2. **验证器和备用码全部丢失，或怀疑凭据泄露**：停止登录重试，建立账号恢复或安全事故记录。技术负责人通过事先登记的独立联系方式核验本人，由另一位授权人员复核，不能仅凭当前恢复请求提供的邮箱、电话或账号密码批准。
3. **批准受审计的恢复方案后执行**：先撤销该账号全部会话及未完成的验证挑战，记录会话撤销审计 `auth.session.revoke`。专项恢复方案须使旧 TOTP 密钥和备用码失效，让账号重新进入设置流程；疑似泄露时同时处理密码重置。记录批准人、执行人、复核人、账号内部 ID、原因、时间及结果，审计和事故记录不包含任何密钥或验证码。
4. **当前实现边界**：M6-T09 未提供人工恢复工具或后台重置端点。需要执行上一项时，由技术负责人先提交并审阅专项恢复工具或修复方案；不得直接修改 `twoFactorEnabled`、伪造 `twoFactorVerifiedAt`、关闭守卫或使用绕过 SQL 恢复后台访问。恢复后由本人完成首次设置步骤，复核旧会话失效及重新登录仍要求第二因素，再关闭恢复记录。

## 部署

技术负责人通过 SSH 执行：

```bash
ssh <admin>@43.134.49.247 sudo -u deploy /opt/findmyjob/bin/findmyjob-deploy deploy <40位sha>
```

脚本自动完成：拉取镜像 → [核对 digest] → 比对迁移 → 预迁移备份 → 执行迁移 → 写入 .env → 重启 app/worker → 60 秒健康检查。
备份和迁移阶段使用 `APP_TAG=<sha>` 环境变量前缀，**.env 在迁移成功后才更新**；迁移失败时 `set -e` 直接退出，.env 仍为旧 tag；健康检查失败时 ERR trap 或显式回退将 .env 恢复为旧 tag。
成功后以 `deploy <sha> <digest> <timestamp>` 格式追加到 `/opt/findmyjob/deploy-history.log`。

**CI 输出的 digest 核对**（推荐）：CI `image` job 输出 app 镜像的 digest，传入 `--expect-digest` 可在 pull 后立即核对，防止镜像篡改：

```bash
ssh <admin>@43.134.49.247 sudo -u deploy /opt/findmyjob/bin/findmyjob-deploy deploy <sha> \
  --expect-digest sha256:<digest-from-ci>
```

**有待执行迁移时**（exit 3）：脚本打印 SQL 后停止。审阅 SQL 无破坏性操作后，加 `--approve-migrations` 重新执行：

```bash
ssh <admin>@43.134.49.247 sudo -u deploy /opt/findmyjob/bin/findmyjob-deploy deploy <sha> --approve-migrations
```

**健康检查失败时**：脚本自动将 app/worker 切回上一个镜像 tag 并以 exit 1 结束。**迁移不回滚**，需要时写前滚迁移后重新 deploy。

GitHub 不持有部署私钥。镜像由 CI `image` job 在 push 到 main 时自动推送到 GHCR：
- `ghcr.io/fairchan/findmyjob:<sha>`
- `ghcr.io/fairchan/findmyjob-migrate:<sha>`
- `ghcr.io/fairchan/findmyjob-backup:<sha>`
- `ghcr.io/fairchan/findmyjob-tools:<sha>`

**没有 registry 时（本机构建、docker load 到服务器）**（2026-11-08 起）：
- 在一台能 build 的机器上（服务器内存不够），按上面 4 个镜像名，用 `docker build -f deploy/Dockerfile --target runner|migrate|backup|tools --platform linux/amd64 -t <镜像名>:<40位sha> .` 分别构建。runner 要带 `NEXT_PUBLIC_*` 的 build-arg，这些值只在构建时生效。
- 传到服务器：`docker save <镜像名>:<sha> … | gzip | ssh <admin>@43.134.49.247 "gunzip | docker load"`。
- 部署时加 `FINDMYJOB_SKIP_PULL=1`：脚本不再 pull，改成检查镜像在本机都存在，缺了就报错退出。这种镜像没有 registry digest，history 里记成 `unknown`，`--expect-digest` 不可用。

```bash
ssh <admin>@43.134.49.247 sudo -u deploy env FINDMYJOB_SKIP_PULL=1 /opt/findmyjob/bin/findmyjob-deploy deploy <sha> --approve-migrations
```
- rollback 也是一样：加上 `FINDMYJOB_SKIP_PULL=1`，目标 sha 的镜像必须还留在服务器上。


## 回滚

```bash
ssh <admin>@43.134.49.247 sudo -u deploy /opt/findmyjob/bin/findmyjob-deploy rollback
```

回滚 = 在 `deploy-history.log` 里找「紧接在当前 sha 上一次部署之前的那条 `deploy` 记录」，将 app/worker 切换到该镜像；`rollback` 类型的条目会被跳过，避免反复来回。
若 history 里有该 sha 的 digest，拉取后自动核对；不一致则终止。**迁移不回滚**：已执行的迁移保持不变。如果回滚后旧镜像与当前 schema 不兼容，需要写一个前滚迁移并重新 deploy。

**指定回滚目标**（来自 deploy-history.log 或 CI 输出）：

```bash
ssh <admin>@43.134.49.247 sudo -u deploy /opt/findmyjob/bin/findmyjob-deploy rollback <40位sha>
# 加 --expect-digest 可核对镜像完整性：
ssh <admin>@43.134.49.247 sudo -u deploy /opt/findmyjob/bin/findmyjob-deploy rollback <40位sha> \
  --expect-digest sha256:<digest-from-history>
```

> CI 推送镜像后输出的 digest 与 deploy-history.log 里记录的 `deploy <sha> <digest>` 应当一致；对不上时停止部署并检查 GHCR 镜像完整性。

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

1. 在 GitHub → Settings → Developer settings → Personal access tokens (fine-grained) 为 `fairchan/findmyjob` 仓库生成新 PAT，权限只选 `Packages: Read`（fine-grained 对应 `read:packages`），有效期 90 天。
   推送镜像用的是 CI `image` job 的 GITHUB_TOKEN（job 级 `packages: write`），VM 上只放有读权限的凭据，不放有写权限的凭据。
2. 在生产主机上更新登录凭据：
   ```bash
   echo "<new-token>" | docker login ghcr.io -u <github-username> --password-stdin
   ```
3. 验证登录成功（使用 `deploy-history.log` 里的最新 sha）：
   ```bash
   docker pull ghcr.io/fairchan/findmyjob:<sha>
   ```
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
- 每个 dump 同时上传同名 `.counts.json`（如 `db/daily/2026-11-05T19-15-00Z.counts.json`），记录关键表行数（用于恢复演练的对账）；部署前备份（`db/pre-migrate/`）不会覆盖日常备份的计数。
- 上传完成后 curl 通知 healthchecks.io（若未收到 ping，healthchecks 会告警）。

### 备份桶配置

| 桶 | 用途 | 区域 | 版本控制 | 生命周期 |
|---|---|---|---|---|
| `findmyjob-backups` | 加密数据库备份 | ap-southeast-5（马来西亚） | 开启 + **S3 Object Lock（Governance，30 天保留期）** | 当前版本 Expiration 30 天；NoncurrentVersionExpiration 1 天；清理过期的删除标记（实际保留约 31 天，见下方说明） |
| `findmyjob-files`（应用桶） | 用户上传文件、导出压缩包 | ap-southeast-5 | 开启 | 非当前版本 30 天后过期 |

**备份桶生命周期说明**：每个 dump 的 key 唯一（如 `2026-11-05T19-15-00Z.dump.age`），始终是当前版本，NoncurrentVersionExpiration 对其不生效；必须同时配置当前版本 **Expiration 30 天**才能触发自动删除，否则 dump 永不过期，与隐私政策的「保存 30 天」矛盾。Object Lock（Governance，30 天保留期）防止写入凭据（`backup-writer`）删除或覆盖已上传对象（满足 ARCHITECTURE A20「写入凭据删不了历史」）。Expiration 在第 30 天加上删除标记，Object Lock 保留期同日到期，实际清理在第 31 天左右完成，**实际保留约 31 天**。隐私政策写的是「30 天」（用户视角的上限），实际不超过 31 天，不修改法律文本。NoncurrentVersionExpiration 1 天清理因意外重名上传产生的旧版本；清理过期删除标记防止存储费用积累。

IAM 权限见 M7-H01 配置表：
- `backup-writer`：对 `db/*` 仅 PutObject（Object Lock 下无法删除）
- `restore-reader`：只读；平时**离线保存**，演练时临时注入

**应用桶（`findmyjob-files`）PDPA purge 策略**：purge 任务（`purge-deleted-accounts` cron，每日 03:30 KL）需要对 `exports/<userId>/` 和 `resumes/<storageKey>` 执行 `DeleteObjectVersions`；应用程序凭据 `findmyjob_app_s3` 须获得该桶的 `s3:DeleteObjectVersion` 权限，且权限只限于该桶、不授予备份桶。桶策略示例：

```json
{
  "Effect": "Allow",
  "Principal": { "AWS": "arn:aws:iam::<account>:user/findmyjob_app_s3" },
  "Action": ["s3:DeleteObjectVersion", "s3:ListBucketVersions"],
  "Resource": ["arn:aws:s3:::findmyjob-files", "arn:aws:s3:::findmyjob-files/*"]
}
```

### age 密钥管理

- `age-keygen` 生成密钥对；公钥写入 `backup.env` 的 `AGE_PUBLIC_KEY`。
- **私钥仅做两份离线介质（如 USB）**，不进密码管理器，不上服务器，两人各保管一份。
- 恢复演练时，密钥持有人需在场。

### 检查备份是否正常运行

1. 登录 healthchecks.io，确认 `findmyjob-backup` 显示绿色。
2. 或者列出 S3 对象（需要 List/Get 权限；**使用 restore-reader 凭据，在管理机或其他有网络访问权限的机器上执行**）：
   ```bash
   read -rs AWS_ACCESS_KEY_ID && export AWS_ACCESS_KEY_ID
   read -rs AWS_SECRET_ACCESS_KEY && export AWS_SECRET_ACCESS_KEY
   aws s3 ls s3://findmyjob-backups/db/daily/ --region ap-southeast-5 | tail -n 5
   ```
3. 验证文件头（前 21 字节应为 `age-encryption.org/v1`；同样使用 restore-reader 凭据）：
   ```bash
   aws s3 cp s3://findmyjob-backups/db/daily/<最新文件> - --region ap-southeast-5 | head -c 21
   ```
   > VM 上的 `backup-writer` 凭据只有 PutObject 权限，无法用于 List/Get。

### 安装 cron

```bash
sudo install -m 644 deploy/server/findmyjob-cron /etc/cron.d/findmyjob
# 重新加载（Debian/Ubuntu 会自动拾取 /etc/cron.d/）
sudo systemctl reload cron
```

> **查看备份日志**：cron 以 `--rm` 运行容器，容器退出后日志不保留，所有输出重定向到了主机日志文件：
> ```bash
> sudo tail -f /var/log/findmyjob-backup.log
> ```
> 服务器初始化时，`findmyjob_app` 角色同时用于备份和应用（可读写）；M7-H01 建好只读 `findmyjob_backup` 角色后，将 `BACKUP_DATABASE_URL` 换成该角色的凭据（见 DECISIONS「开发中决策」）。

## 恢复演练

**目标**：在 GATE-M7 前完成一次，之后每季度一次。由运维备份人独立执行。

### 前提条件

- 有 age 私钥的离线介质（USB）。
- `restore-reader` IAM 凭据（平时离线保存，演练时临时注入操作人 shell，不写入任何文件）。
- **能 SSH 登录生产服务器**（`ssh <admin>@43.134.49.247`）。所有恢复操作在服务器上的
  `restore` 容器里执行；`restore` 容器接 `backend` 网络，可以用服务名 `postgres` 直接连数据库。
  管理机不需要安装 age/awscli/psql 等工具。

### 步骤

> **执行位置**：所有步骤均在**生产服务器上**执行（先 SSH 登录，再 `cd /opt/findmyjob`）。
> `restore` 服务用 `findmyjob-backup` 镜像，内含 pg 工具、age、awscli、python3，
> 通过 `backend` 网络直连 `postgres` 服务——不需要 SSH 隧道。

```bash
# 在服务器上 cd /opt/findmyjob 后操作。APP_TAG 由 /opt/findmyjob/.env 提供（部署脚本写入），
# 不要另外 export：export 的值会盖过 .env，${APP_TAG:?} 会拉错镜像或直接报错。
DC="docker compose -f /opt/findmyjob/docker-compose.prod.yml --env-file /opt/findmyjob/.env"

# 1. 临时读入凭据：read -rs 不回显、不进 shell 历史；之后只用 -e VAR 透传，值不出现在命令行参数里
read -rs RESTORE_S3_ACCESS_KEY_ID     && export RESTORE_S3_ACCESS_KEY_ID
read -rs RESTORE_S3_SECRET_ACCESS_KEY && export RESTORE_S3_SECRET_ACCESS_KEY
read -rs RESTORE_ADMIN_DATABASE_URL   && export RESTORE_ADMIN_DATABASE_URL   # postgresql://findmyjob_owner:<pass>@postgres:5432/postgres
export BACKUP_S3_BUCKET=findmyjob-backups
# 第 2 步直接调 aws CLI，它只认 AWS_* 变量名
export AWS_ACCESS_KEY_ID="$RESTORE_S3_ACCESS_KEY_ID" AWS_SECRET_ACCESS_KEY="$RESTORE_S3_SECRET_ACCESS_KEY"

# 2. 列出可用备份，由操作人选目标 key（restore 服务的入口是 restore-drill.sh，这里临时换成 aws）
$DC --profile ops run --rm -T --entrypoint aws \
  -e AWS_ACCESS_KEY_ID -e AWS_SECRET_ACCESS_KEY \
  restore s3 ls s3://findmyjob-backups/db/daily/ --region ap-southeast-5 | tail -n 10

# 3. 执行演练：私钥从 USB 经 stdin 传进 restore 容器。
#    --keep 是为了留下演练库给第 4 步用；Session 仍由脚本的 cleanup trap 清空；
#    --keep 只在演练完整完成（RESTORE_COMPLETE=1）时生效，演练过程出错时库仍会被删掉
cat /media/usb/age-private.key | \
  $DC --profile ops run --rm -T \
    -e RESTORE_ADMIN_DATABASE_URL -e RESTORE_S3_ACCESS_KEY_ID -e RESTORE_S3_SECRET_ACCESS_KEY -e BACKUP_S3_BUCKET \
    restore --key db/daily/<选中的 key>.dump.age --keep findmyjob_restore_drill

# 4. verify-decrypt（独立一步，tools 容器）：DATABASE_URL 和 PII_KEYS 同样 read -rs 读入、-e 透传
read -rs PII_KEYS     && export PII_KEYS
read -rs DATABASE_URL && export DATABASE_URL   # postgresql://findmyjob_owner:<pass>@postgres:5432/findmyjob_restore_drill
$DC --profile ops run --rm -T -e DATABASE_URL -e PII_KEYS -e PII_ACTIVE_KEY_ID=v1 \
  tools scripts/db/verify-decrypt.ts

# 5. 删掉演练库，清掉 shell 里的秘密
$DC exec -T postgres psql -U postgres -c 'DROP DATABASE IF EXISTS findmyjob_restore_drill;'
unset RESTORE_S3_ACCESS_KEY_ID RESTORE_S3_SECRET_ACCESS_KEY RESTORE_ADMIN_DATABASE_URL \
  AWS_ACCESS_KEY_ID AWS_SECRET_ACCESS_KEY PII_KEYS DATABASE_URL
# 第 3 步的输出要全部是 ✓，最后一行打印 RTO；第 4 步输出一条掩码过的手机号
```

### 脚本检查项

| 检查 | 执行方式 | 通过条件 |
|---|---|---|
| 迁移数一致 | restore 容器（脚本内） | DB 中已完成迁移数 = 镜像里 `prisma/migrations/*/migration.sql` 数量 |
| 关键表不为空 | restore 容器（脚本内） | User / StudentProfile / Company / Job / Application 有行 |
| RPO | restore 容器（脚本内） | 最新备份不超过 26 小时前 |
| 对账 SQL | restore 容器（脚本内） | CreditWallet.balance = SUM(CreditLedger.delta)，0 行不一致 |
| counts.json | restore 容器（脚本内） | 恢复后各表行数与备份时 counts.json 完全一致 |
| verify-decrypt | tools 容器（独立步骤 4） | 用离线 PII_KEYS 解密 1 条 StudentContact.phone，输出已掩码 |
| Session 清空 | restore 容器（脚本 cleanup trap） | 无论检查成功还是失败都执行；`--keep` 时也执行 |

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

> **执行位置**：所有步骤均在**生产服务器上**执行（SSH 登录后 `cd /opt/findmyjob`）。
> 与演练用同一条路径：`restore` 容器经 `backend` 网络连 `postgres`，不需要 SSH 隧道。

1. **评估**：确认无法通过其他手段恢复（如数据库 PITR），恢复会造成 RPO 时间段内数据丢失，向受影响用户沟通。
2. **通知**：告知相关人员，启动 PDPA 通报流程评估（见「事故响应」节）。
3. **停机**：临时停止 app 和 worker，避免新数据写入。
   ```bash
   docker compose -f /opt/findmyjob/docker-compose.prod.yml stop app worker
   ```
4. **执行恢复**：加 `--skip-rpo`（真实恢复时 RPO 超限属已知情况）和 `--keep`（保留恢复库用于切换）。
   目标库 `findmyjob_restore_drill` 以 `_drill` 结尾是脚本安全检查的前提。
   Session 由 cleanup trap 在脚本退出时自动清空（`--keep` 时也执行）。
   ```bash
   # 在服务器上 cd /opt/findmyjob 后操作；APP_TAG 由 .env 提供，不要另外 export
   DC="docker compose -f /opt/findmyjob/docker-compose.prod.yml --env-file /opt/findmyjob/.env"
   read -rs RESTORE_S3_ACCESS_KEY_ID     && export RESTORE_S3_ACCESS_KEY_ID
   read -rs RESTORE_S3_SECRET_ACCESS_KEY && export RESTORE_S3_SECRET_ACCESS_KEY
   read -rs RESTORE_ADMIN_DATABASE_URL   && export RESTORE_ADMIN_DATABASE_URL   # postgresql://findmyjob_owner:<pass>@postgres:5432/postgres
   export BACKUP_S3_BUCKET=findmyjob-backups
   # aws CLI 认 AWS_* 变量名；用同一份凭据列出可用备份，由操作人选目标 key
   export AWS_ACCESS_KEY_ID="$RESTORE_S3_ACCESS_KEY_ID" AWS_SECRET_ACCESS_KEY="$RESTORE_S3_SECRET_ACCESS_KEY"
   $DC --profile ops run --rm -T --entrypoint aws \
     -e AWS_ACCESS_KEY_ID -e AWS_SECRET_ACCESS_KEY \
     restore s3 ls s3://findmyjob-backups/db/daily/ --region ap-southeast-5 | tail -n 10

   cat /media/usb/age-private.key | \
     $DC --profile ops run --rm -T \
       -e RESTORE_ADMIN_DATABASE_URL -e RESTORE_S3_ACCESS_KEY_ID -e RESTORE_S3_SECRET_ACCESS_KEY -e BACKUP_S3_BUCKET \
       restore --key db/daily/<选中的 key>.dump.age --skip-rpo --keep findmyjob_restore_drill
   ```
5. **verify-decrypt**（恢复库就绪后，使用 tools 容器）：
   ```bash
   read -rs PII_KEYS     && export PII_KEYS
   read -rs DATABASE_URL && export DATABASE_URL   # postgresql://findmyjob_owner:<pass>@postgres:5432/findmyjob_restore_drill
   $DC --profile ops run --rm -T -e DATABASE_URL -e PII_KEYS -e PII_ACTIVE_KEY_ID=v1 \
     tools scripts/db/verify-decrypt.ts
   unset RESTORE_S3_ACCESS_KEY_ID RESTORE_S3_SECRET_ACCESS_KEY RESTORE_ADMIN_DATABASE_URL PII_KEYS DATABASE_URL
   ```
6. **切换数据库**（在服务器上，经 `compose exec postgres` 进入 postgres 容器执行 RENAME）：
   ```bash
   $DC exec -T postgres \
     psql -U postgres \
     -c 'ALTER DATABASE findmyjob RENAME TO findmyjob_old;' \
     -c 'ALTER DATABASE findmyjob_restore_drill RENAME TO findmyjob;'
   ```
7. **补跑账号清除**（`tools` 容器经 compose 网络连 `postgres`）：
   ```bash
   $DC --profile ops run --rm tools scripts/backfill/purge-deleted-accounts.ts
   ```
8. **重启服务**：
   ```bash
   docker compose -f /opt/findmyjob/docker-compose.prod.yml up -d app worker
   ```
9. **验证**：登录、发职位、搜人各一遍；确认 Sentry 无新增异常；通知 healthchecks。
10. **记录**：在 `docs/incidents/` 新建事故记录，注明恢复时间、数据丢失范围、后续行动。

## 事故响应

### SEV 分级

| 等级 | 描述 | 响应时间 | 示例 |
|---|---|---|---|
| SEV 1 | 生产严重故障 / PII 泄露 / 账本不一致 | 立即（< 15 分钟） | 整站持续 500、企业读到未解锁学生的联系方式、CreditLedger 对账不过 |
| SEV 2 | 核心功能受损 / 单个用户受影响 | < 1 小时 | 解锁功能报错、邮件全部投递失败、备份连续失败 2 次 |
| SEV 3 | 轻微异常 / 仅影响体验 | 下一工作日 | 个别页面加载慢、非关键告警 |

### 角色与联系方式

> 联系表须由人工核实后填写，不编造号码。

| 角色 | 人 | 联系方式 |
|---|---|---|
| 技术负责人 | 待定 | 核实后填写 |
| 运维备份人 | 待指定 | 核实后填写 |

### 止血场景

#### 场景 1：企业看到了不该看的学生数据

**判断**：收到举报，或 AuditLog 里出现 `contact.read` 记录但对应 TalentUnlock 不存在。

**步骤**：
1. 以只读身份运行「只读 SQL 模板」里的 `talent.view` / `talent.unlock` 查询，确认涉及的 actorId 和 studentId（只看 ID 和数量，不查完整行）。
2. 若确认企业读到了联系方式，立即禁用该企业并清除其会话（以 findmyjob_owner 执行）：
   ```sql
   UPDATE "Company" SET "isActive" = false WHERE id = '<companyId>';
   DELETE FROM "Session" WHERE "userId" IN (
     SELECT "userId" FROM "CompanyMember" WHERE "companyId" = '<companyId>'
   );
   ```
3. 在 `docs/incidents/` 新建事故记录（格式见 TEMPLATE.md），注明泄露范围。
4. 评估是否需要启动 PDPA 通报流程（见「PDPA 通报」节）。
5. 通知受影响学生，使用 `docs/templates/breach-notice-zh.md` / `breach-notice-en.md` 模板。

#### 场景 2：凭据泄露

包括：PII_KEYS、BETTER_AUTH_SECRET、数据库密码、S3 密钥、GHCR PAT 中的任意一个。

**步骤**：
1. **立即**在对应平台吊销泄露的凭据。
2. 生成新凭据，更新 `/opt/findmyjob/env/*.env`，重启 app 和 worker。
3. 若 PII_KEYS 泄露：评估所有加密 StudentContact 字段是否需要重新加密（`scripts/backfill/reencrypt-contacts.ts`）；旧密钥按轮换步骤处理。
4. 检查 AuditLog（用只读 SQL）是否有异常访问。
5. 若 PII_KEYS 或 BETTER_AUTH_SECRET 泄露，启动 PDPA 通报流程评估。

#### 场景 3：账本不一致

**判断**：`reconcile-wallets` 任务触发 `alert('wallet.mismatch')` 告警。

**步骤**：
1. 以只读身份运行对账 SQL，确认受影响的 companyId 和差值：
   ```sql
   SELECT w.id, w."companyId", w.balance,
          COALESCE(SUM(l.delta), 0)            AS "sumDelta",
          w.balance - COALESCE(SUM(l.delta), 0) AS diff
   FROM "CreditWallet" w
   LEFT JOIN "CreditLedger" l ON l."walletId" = w.id
   GROUP BY w.id, w."companyId", w.balance
   HAVING w.balance <> COALESCE(SUM(l.delta), 0);
   ```
2. **先停止相关扣点入口并保留证据，不要直接改余额或追加猜测的补差值。** `adminAdjust` 同时改变余额和账本总和，二者的差不会改变，因此不能用它修平对账差异。
3. 追查不一致来源，核对原始订单、解锁、账本及审计，确定真实应有余额和缺失或重复的业务事件。已提交账本保持只追加，不更新或删除历史行。
4. 技术负责人和财务/运营复核具体修复方案，先在隔离副本验证，并批准带来源凭据、预期差值及前置断言的专项修复。涉及余额投影重建或补记历史事实的修复工具须单独审查；本手册不授权临时 SQL 改账。
5. 执行获批方案后，再以同一条对账 SQL 验证差值为零、相关业务幂等及审计完整，记录事故和代码修复后恢复入口。正常业务的人工加减点仍走 `adminAdjust`，不把它用作历史差额修复。

#### 场景 4：整站不可用

**判断**：/api/health 持续返回非 200，或 UptimeRobot 告警。

**步骤**：
1. 检查容器状态和最近日志：
   ```bash
   ssh <admin>@43.134.49.247 docker compose -f /opt/findmyjob/docker-compose.prod.yml ps
   ssh <admin>@43.134.49.247 docker compose -f /opt/findmyjob/docker-compose.prod.yml logs --tail=100 app
   ```
2. 若是最近部署引起，立即执行回滚（见「回滚」节）。
3. 若是数据库连接问题，检查 postgres 容器状态和连接数：
   ```bash
   ssh <admin>@43.134.49.247 docker compose -f /opt/findmyjob/docker-compose.prod.yml exec postgres \
     psql -U postgres -d findmyjob -c "SELECT count(*) FROM pg_stat_activity;"
   ```
4. 检查 Caddy 是否正常（`docker compose logs caddy`）。
5. 整站不可用超过 15 分钟按 SEV 1 处理，记录影响时段和根因。

#### 场景 5：备份失败

**判断**：healthchecks.io 显示 `findmyjob-backup` 告警（超过 26 小时未 ping）。

**步骤**：
1. 检查备份容器日志：
   ```bash
   ssh <admin>@43.134.49.247 docker compose -f /opt/findmyjob/docker-compose.prod.yml \
     --profile ops logs findmyjob-backup
   ```
2. 常见原因及检查点：
   - age 公钥配置错误：确认 `backup.env` 里的 `AGE_PUBLIC_KEY`。
   - S3 权限问题：确认 `backup-writer` IAM 凭据和桶策略。
   - 磁盘空间不足：检查 `/backup-tmp` 挂载的卷容量。
3. 修复后手动触发一次备份验证：
   ```bash
   ssh <admin>@43.134.49.247 docker compose -f /opt/findmyjob/docker-compose.prod.yml \
     --profile ops run --rm backup
   ```
4. 若超过 72 小时无成功备份，按 SEV 1 处理并评估 PDPA 影响（数据库损坏时无备份可用）。

### 只读 SQL 模板

> `findmyjob_app` 拥有 DML 权限，必须在 `BEGIN READ ONLY` 事务里执行以下模板，防止意外写入；只输出 ID 和数量，**不输出完整 AuditLog 行**。

#### 按时间窗统计 talent.view

```sql
BEGIN READ ONLY;
SELECT "targetId"  AS "studentId",
       COUNT(*)    AS "viewCount"
FROM   "AuditLog"
WHERE  action        = 'talent.view'
  AND  "targetType"  = 'StudentProfile'
  AND  "createdAt"  >= '<开始时间 UTC>'::timestamptz
  AND  "createdAt"  <  '<结束时间 UTC>'::timestamptz
GROUP  BY "targetId"
ORDER  BY "viewCount" DESC
LIMIT  100;
COMMIT;
```

#### 按时间窗统计 talent.unlock

```sql
BEGIN READ ONLY;
SELECT "targetId"    AS "studentId",
       "actorId"     AS "actorUserId",
       COUNT(*)      AS "unlockCount"
FROM   "AuditLog"
WHERE  action        = 'talent.unlock'
  AND  "targetType"  = 'StudentProfile'
  AND  "createdAt"  >= '<开始时间 UTC>'::timestamptz
  AND  "createdAt"  <  '<结束时间 UTC>'::timestamptz
GROUP  BY "targetId", "actorId"
ORDER  BY "unlockCount" DESC
LIMIT  100;
COMMIT;
```

#### 按时间窗统计 resume.download

```sql
BEGIN READ ONLY;
SELECT "targetId"    AS "studentId",
       "actorId"     AS "actorUserId",
       COUNT(*)      AS "downloadCount"
FROM   "AuditLog"
WHERE  action        = 'resume.download'
  AND  "targetType"  = 'StudentProfile'
  AND  "createdAt"  >= '<开始时间 UTC>'::timestamptz
  AND  "createdAt"  <  '<结束时间 UTC>'::timestamptz
GROUP  BY "targetId", "actorId"
ORDER  BY "downloadCount" DESC
LIMIT  100;
COMMIT;
```

### PDPA 通报

> **待律师核实**：以下时限为草案，正式上线前须由法律顾问确认。

马来西亚《个人资料保护法》（PDPA 2010）要求：

| 通报对象 | 时限（草案） | 渠道 |
|---|---|---|
| 个人资料保护专员（PDPC） | 72 小时内 | PDPC 官方渠道（待核实后填写联系方式） |
| 受影响用户 | 7 天内 | 应用内通知 + 邮件；见 `docs/templates/breach-notice-zh/en.md` |

**触发条件**：有理由相信已发生或可能发生个人资料泄露，影响到在 FindMYJob 注册的用户。

**流程**：
1. 确认泄露范围和受影响用户 ID（用只读 SQL 模板，只看 ID）。
2. 在 `docs/incidents/` 记录事故，包含时间线和初步判断。
3. 在 72 小时截止前向 PDPC 提交初步通报。
4. 在 7 天内通过应用内通知和邮件告知受影响用户（使用 `docs/templates/` 里的模板）。
5. 完成最终事故报告，说明根因和整改措施。

**隐私守则**（全员须知）：事故处理时，**不把真实数据、完整的 AuditLog 行、`.env` 内容贴进 Claude 或任何 AI 会话**；只用 ID 和数量进行分析；需要查看具体字段时在数据库终端里操作。

## 每周一 30 分钟例行检查

负责人：技术负责人（待定）；缺席时由运维备份人做。

**安全与隐私**
- [ ] Dependabot 的安全 PR：逐个看，能合的合，不能合的在 DECISIONS 写原因和到期日
- [ ] Sentry 里未解决的 issue：确认没有新的 PII 泄露类问题
- [ ] 用只读 SQL 模板快速扫描过去 7 天 AuditLog：`talent.unlock` 次数有无异常峰值（例如单个企业单天超过 50 次）

**可用性与备份**
- [ ] healthchecks：备份和定时任务过去 7 天都是绿色
- [ ] UptimeRobot：/api/health 过去 7 天无异常告警
- [ ] S3 `db/daily/` 下最新备份不超过 26 小时，抽查一个文件前 21 字节是 `age-encryption.org/v1`

**数据库与任务**
- [ ] `reconcile-wallets` 任务日志：过去 7 天无 `wallet.mismatch` 告警
- [ ] 检查有无 INVALID 索引（若有应立即处理，见「INVALID 索引」节）：
  ```sql
  SELECT indexname FROM pg_indexes
  JOIN pg_class ON pg_class.relname = pg_indexes.indexname
  WHERE pg_class.relisvalid = false;
  ```
- [ ] pg-boss 死信队列：`deadLetter` 表是否有未处理的失败任务（`SELECT name, COUNT(*) FROM pgboss.dead GROUP BY name`）

**费用与密钥**
- [ ] `.reports/COSTS.tsv` 和中转扣费：本周花费、累计是否接近 D23 上限
- [ ] GHCR PAT 到期日：距到期少于 14 天时立即轮换（见「GHCR PAT 轮换」节）

**记录**
- [ ] 记一行检查结果到 `docs/incidents/weekly-checks.md`（日期、执行人、发现的问题编号；无问题写「无」）

## CSP 强制模式与 E3 前 HSTS 切换（M7-T15）

页面响应使用强制 `Content-Security-Policy`，不再发送 Report-Only。连续访问同一页面两次，应看到不同 nonce；每次原始 HTML 的 script nonce 应匹配该次响应。注册/登录的 Turnstile 脚本使用当前文档 nonce，页面内导航不更换它。Next 动态加载的同源 chunks 由 strict-dynamic 授信，可能使用 RSC 请求 nonce；不要仅凭导航后 DOM 中框架脚本 nonce 不同判为 CSP 失败，需同时检查原始 HTML、应用脚本和浏览器实际 CSP 违规。

根布局读取请求头使页面动态渲染；不得缓存并跨请求复用带 nonce 的 HTML。`APP_ENV=production` 时 script-src 不含 unsafe-eval。Sentry 的允许连接 origin 来自构建时内联的公开 DSN，变更 DSN 后须重新构建。API/附件保留各自的安全头和 sandbox。生产构建回归命令为 `pnpm test:e2e:prod`，与 Vitest 和其他 E2E 串行执行；使用合成测试配置。正式 key、浏览器真机及生产环境验收仍在上线闸门完成。

**E3 前、确认所有子域都是 HTTPS 之后，由部署会话把正式生产环境的 `HSTS_MAX_AGE` 设为 `31536000`。** `deploy/Caddyfile` 默认 `300` 保持不变，不把一年配置带到 staging，不添加 includeSubDomains 或 preload。部署会话变更后检查正式域名的 `Strict-Transport-Security: max-age=31536000`，记录执行人、时间与证据；本次本地代码任务不执行该切换。

## 增长与风控后台（M6-T08）

运营须使用自己的 ACTIVE ADMIN 账号并完成双重验证。`/admin/growth` 的注册数与试点上限口径一致；作废邀请需填写原因，提交后邀请人的新职位浏览额度立即按剩余有效邀请重算。历史 JobView、已有投递和邀请豁免保留。重复作废不覆盖首个原因，也不生成重复审计。

`/admin/reports` 默认显示待处理举报，可按状态查看结果。处理或驳回只记录结论，不自动关闭职位或停用企业；需要处置时另走职位/企业管理。已处理结果不能反向修改；并发冲突时刷新查看实际结论。举报按用户、KL 自然日计数，跨职位共用 `limits.jobReportsPerDay`，处理完的举报仍计入当天次数。通知失败不撤销已经提交的举报，可直接查看队列。M7-T09 交付公开入口之前，后台联调使用合成举报，不向生产插演示数据。

`/admin/synonyms` 保存时去空格、转小写并去重，需至少两个不同词语；停用保留记录。当前进程在提交后更新缓存，其他实例最长约 60 秒后读取新值；确认所有实例生效时至少覆盖该窗口。不要为加快更新修改数据库历史记录或全局关闭缓存。EXACT 模式不因同义词改动扩展结果。

`/admin/articles` 新文章默认草稿，勾选发布后才对公开读取可见，取消发布即可撤回。正文可填写中文、英文或双语；界面语言不自动翻译正文。Markdown 预览不加载图片、HTML 或嵌入播放器，视频仅用 http/https 外链打开。发布前核实案例来源、个人信息和号码：PRD 指定马来西亚报警电话 999；领事保护电话及 seed 中额外热线须由运营独立核实并保存来源、核实日期，不以仓库已有内容视为已核实。正式内容验收与上线闸门由人签字。
