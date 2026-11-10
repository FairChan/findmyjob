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

## 公开反诈内容与举报（M7-T09）

`/safety` 无需登录，按内容类别显示已发布文章。正文及联系方式由运营维护，不随界面语言自动翻译。发布/撤回后，下一次访问应反映当前状态；草稿不得进入公开 HTML 或 RSC。无效筛选和游标会给出重置入口，查询结果为空不表示页面故障。紧急危险请使用页面提示的 999；领事保护等号码必须独立核实后发布。

已登录的正常账号可以在职位详情或额度锁定卡片上举报。入口只传职位 ID、原因和可选说明，隐藏正文不会随表单发送。单日额度按 KL 自然日、同一用户跨职位计算，默认第 11 次返回限流；运营处理后也不释放当天次数。重复点击提交期间禁用按钮，但用户再次主动提交属于新的举报并占用次数。

成功提交只关闭弹窗、显示持久提示并把焦点还给举报按钮，不刷新详情以触发额外浏览计数。失败保留输入，网络结果不确定时避免连续提交，可先联系运营核查。收到举报后运营在 `/admin/reports` 查看、处理或驳回，按上一节规则记录审计，必要时另行下架职位。

## 套餐管理与占位定价（M8-T01）

完成二因素认证的运营可在 `/admin/plans` 新增或编辑企业套餐，以整数 sen 输入金额（100 sen = MYR 1.00）。代码和商品类型创建后固定；变更类型应另建商品。明确选择“不限”才会保存无限权益，点数包的空订阅字段表示不含订阅。FREE 不能停用或删除，旧学生商品只保留历史。普通套餐管理使用常规管理员会话，到账确认将单独要求新鲜二因素认证。

多人编辑冲突会保留当前输入；确认放弃草稿并加载最新版本后重新编辑。已被任何订单或订阅引用的套餐无法删除，应停用以停止新销售；不得删除历史订单来绕过限制。新增、更新、停用、删除分别记录 plan.* 审计。后台变价后，下一次公开访问 `/pricing` 可读到新配置。

`billing.enabled=false` 时公开页只展示免费方案及公益说明，不展示付费草案或购买入口。四个 seed 套餐为商业方案占位值，重跑仅补缺失代码，不覆盖运营配置；不要为更改价格重跑全部 seed。本轮只用合成数据验收，不执行真实 seed、不开启收费。正式价目、银行/支付账户、税务信息和上线闸门继续按收费前清单确认。

## 订单、收款配置与人工核款（M8-T02）

银行资料在 `/admin/settings` 的专用表单维护，账号按字符串保存，保留前导零。三个必需字段全部填齐才可创建新银行单；全部字段清空可停止新银行单。创始优惠默认关闭，启用前须确认真实资格、适用商品和时间窗；不能在普通设置文本框直接编辑对象。正式启用收费、真实银行资料及对外价目仍须完成 GATE-M8。

企业 OWNER 从 `/pricing` 查看报价并明确创建订单，GET 报价不建单。报价过期时保留已展示金额，须获取新报价并再次确认。网络结果不确定时先查 `/e/billing`，避免重复下单。订单金额为净应付，折扣不能再扣一次。未认证企业可以购买，但其他企业能力仍遵守各自认证规则。

上传回单与提交核款是两步。上传成功不代表付款成功，替换回单在再次提交前不会改变已绑定凭证。待付款且尚未提交回单的订单可由 OWNER 取消；已提交或已付款订单不在该自助取消范围。关闭收费或清空银行资料后，历史订单仍可查看并提交合法凭证；尚未付款时应先向运营核实付款资料。

运营在 `/admin/orders` 按实际银行到账核款；查看回单与确认都要求最近10分钟内完成二因素验证。金额手动输入 MYR，两位小数以内，不接受指数/逗号/负值；核款备注不填账号或其他个人资料，系统仅保留已填写的审计事实。回单走受控字节预览，不分发存储签名地址。会话过期、凭证被替换或权限撤销时重新登录并重新核对。

成功确认后订单、点数账本、订阅与 order.confirm 审计一并提交。重复确认不会再次发点，金额冲突不会被当作成功重放。通知失败不改变已付款结果，可查看订单与账本确认；不要通过重复核款来重发通知。资金对账继续使用既有 reconcile-wallets。历史缺快照订单不能从当前套餐补造权益，应人工核查原始合同和入账记录。

## Stripe Checkout 与到账恢复（M8-T03）

线上配置与测试账户联调需单独批准。先在 Stripe 测试账户确认马来西亚商户资格、card/FPX 可见性及实际金额边界；不要用离线测试替代真实测试模式联调。固定 API 版本为 `2026-10-28.endive`，端点为 `POST /api/payments/stripe/webhook`，订阅 `checkout.session.completed`、`checkout.session.async_payment_succeeded`、`checkout.session.async_payment_failed`、`checkout.session.expired`。端点签名密钥与 CLI 转发密钥不可混用。`STRIPE_MODE` 默认 test；正式模式及真实配置按 GATE-M8 确认。

OWNER 先创建本地订单，再明确启动安全结账；允许的托管目的地只有 `https://checkout.stripe.com`。订单详情只读取本地状态，成功/取消回跳参数不证明付款。FPX 待处理时等待到账通知；已付款页展示来自实际 Charge 的交易时间、净金额、Seller Order No.、FPX 交易号、银行名称和状态，缺失字段标注暂未提供，不以本地订单号补造银行回执。

同一订单仅一个持久支付尝试，超时后沿原订单恢复，不另建会话或改写幂等键。尚未绑定会话且首次请求超过23小时会转 `RECONCILIATION_REQUIRED`：需在商户后台核对原会话、实际收款和本地账本后，制定专项处理；禁止删除attempt或改付款状态来强行重收款。FAILED/EXPIRED不自动重开会话，Stripe订单不适用银行回单或银行取消/核款操作。

暂态服务/数据库故障返回503，可重投；错误签名或永久绑定/金额不一致返回400，检查安全告警及内部订单/attempt ID。关闭新销售不阻止已有attempt的恢复和合法到账履约。不得将原始事件、签名、密钥、完整SDK错误或付款资料复制到日志/工单；只记录内部ID和错误类别。重复事件不重复发点；通知失败也不能用重新结算重发通知。

## 套餐权益与到期（M8-T04）

职位、团队和邀请页面展示当前使用量与限额。到期后已有资源保留，超额只限制新增；职位关闭、成员移除和草稿编辑仍可操作。普通成员联系 OWNER，当前 OWNER 且销售开启时可查看方案与账单。关闭销售不会撤销仍有效的已付合同；有效期结束后按当前公益或免费规则计算，不依赖后台任务及时运行。不要通过改动历史订单快照或删除用量记录解除限制。

`expire-subscriptions` 每天 00:30 吉隆坡时间执行，停机后补跑一次。每批最多 50 家公司，每家公司独立事务；一家公司失败时其他公司继续，任务最后失败以便重试。到期前 7 天只向当前 ACTIVE OWNER 发站内通知；连续同档已付续期按最终连续覆盖尾段提醒，未付款或中间断档不能延后提醒。持久标记与通知同事务，重复运行及清理旧通知不会重发。

告警 `Subscription entitlement fallback` 只含内部公司 ID 和固定原因。遇到 INVALID_SNAPSHOT/OVERLAP，应核对原始订单、付款与续期关系；不得用当前商品信息自动补写合同。FREE或配置损坏时使用有限安全默认值，修复应通过既有后台设置/套餐入口。不要重置 expiryReminderAt 来补发历史通知；确需补发应另行安排有审计的运营流程。

## 发票发行、PDF 与恢复（M8-T05）

管理员在 `/admin/settings` 专用开票主体表单填写法定名称、地址及配置版本；注册号可留空，全部清空可暂停新发行。正式主体、税务处理与对外开票资格须完成收费上线闸门。当前 PDF 标题为 Invoice / 发票，标明 SST 未单独列示，不声称税额为零或 MyInvois 已验证。`einvoiceRef` 仅预留，尚未接通官方电子发票。

已付款订单由系统发行一次；开票故障不改变付款、点数或订阅。`invoice-tasks` 每分钟先补发缺失发票，再处理最多 50 个 PDF 候选；坏历史订单会报固定错误但不阻塞后续订单。缺失开票主体时先配置，再等待任务恢复。历史订单快照无效时核查原合同，不按当前套餐补造。若已有发票而编号计数器缺失，停止自动发行并由授权财务人员核对历史最大编号，通过经审查的维护流程初始化；不得删除发票或从 1 重启。

企业当前 OWNER 在已付款订单详情查看发票，准备完成后显式下载。页面刷新和 GET 不生成 PDF。关闭新销售、停用套餐或更新开票主体不会改动旧文档。成员撤权后旧页面按钮仍可能可见，但实际下载会拒绝。不要共享私有对象路径或签名 URL。

PDF 最多三次尝试，失败退避 1/5 分钟，崩溃由 60 秒租约恢复。暂态下载失败保留原 READY 引用，可稍后重试；明确对象缺失或损坏按剩余预算重建，不自动重置次数。`PDF_FONT_UNAVAILABLE` 应核对部署包 `assets/fonts/` 的字体、许可和 manifest，禁止临时换系统字体。`PDF_CANDIDATE_CLEANUP_REQUIRED` 或 `PDF_PUBLICATION_OUTCOME_UNKNOWN` 要核对数据库当前引用与内部任务 ID；不要整目录清理，不能删除当前已发布 key。终止失败应先查固定错误类别并人工决定恢复方案，不直接改编号、快照或账本。

## 公益转收费演练（M8-T06）

正式切换须先完成 GATE-M8，并确认商品、创始合作伙伴名单/折扣窗口、收款账户、开票主体、备份与恢复证据。此次代码交付只在隔离的本地合成库演练。获准后由管理员通过 `/admin/settings` 设置 `billing.enabled=true` 并保留 `setting.update` 审计；学生收费保持关闭，不迁移或清零现有钱包。

切换完成后，新认证企业仍创建钱包但不发公益点；月度任务及已预选的公司都在最终 CREDIT 锁后重新读取开关。只有有效 boolean false 允许公益发点，坏配置停止发点且不消耗月份标记。管理员设置提交与所有公司发点事务没有全局原子屏障；严格运营切换应先暂停/排空公益任务，再切换并核对余额与账本。

验证现有余额不变、既有职位/成员保留，OWNER 余额不足时可进入账单购买，其他成员收到联系所有者提示。创始优惠必须同时满足已审名单、商品、时间窗和首次资格；净应付金额已经扣除折扣，核款和发票不得二次减扣。回单到账确认或 Stripe 合法到账后仅增加一次点数和订阅。

`billing.enabled=false` 同时关闭新销售并恢复公益模式资格，不能作为独立的“只暂停收款”开关。回退前应明确是否恢复公益补发；若仅验证历史履约，保持公益任务暂停。关闭新销售后，旧订单仍可按原冻结净额结算、发行及下载发票，有效已付权益保持到期；不得改写订单、删除账本或撤销已交付点数。隔离演练覆盖旧余额 23、原价 299901 sen、折扣 149950 sen、净额 149951 sen、到账后余额 143，以及续年恢复原价。

## 私有简历解析与导出切换（M9-T01）

以下是 T01 合并后的配置与部署要求，不构成已部署、测试通过或真实外发获准的记录。代码、依赖和迁移验收与真实账户/法律/外发启用分开；默认保持关闭，不批量回填或发送历史简历。

### 默认关闭、政策版本与 epoch

- `ai.resumeParse` 是一个严格对象：`enabled` 为 boolean、`legalVersion` 为 null 或已批准版本、`epoch` 为服务器生成的 UUID。缺配置、对象无效或 `enabled` 非 true 均关闭，不在模块导入或 seed 时创建可用授权。初始关闭配置可使用 `enabled:false, legalVersion:null`；epoch 由受控 ADMIN 更新入口生成，不能从文档复制固定值。
- 配置更新通过专用 ADMIN 服务校验并写 `setting.update`，每次更新都生成新 epoch，包括禁用和重新启用；不能从客户端传入或复用旧 epoch。启用要求 `legalVersion` 非空且等于 fresh 读取的 `legal.currentVersion`。更新法律正文不等于发布新版本；律师/负责人确认后，法律版本另走既有受审流程，不因合并本文自动改值。
- `ANTHROPIC_API_KEY` 与明确的 `AI_MODEL_PARSE` 均由人工配置项目凭据和已核验模型；缺项失败关闭，不回退 Claude Code/CLI 登录、开发中转或任意 base URL。候选固定直连 `https://api.anthropic.com`。密钥按既有秘密管理要求保存，不进入日志、工单或 AI 会话。
- 每次解析冻结模型、prompt/schema 版本、来源 hash、同意来源及 epoch。只修改环境模型不会自动废弃已冻结的旧任务；需要废弃旧代次时必须通过受控配置更新旋转 epoch，再由用户明确重新请求，不复用旧 grant/epoch。
- 注册、普通条款、人才库同意和上传不代替 `AI_RESUME_PARSE` 独立同意；同意本身也不触发外发。只有本人明确解析请求才入队。关闭功能时保留普通上传、手工编辑、本人已有草稿读取、放弃和撤回，停止新解析和确认。撤回/关闭不能收回 provider 已接受的文本，也不能据取消结果断言对方未处理或未计费。

### 发布前核验与任务关闭

上线前核对 SUBPROCESSORS 和双语政策中 Anthropic 的实际地区、合同/DPA、保留/删除、日志例外、训练使用和跨境依据；未核实不以“脱敏”或“结构化输出可支持零保留”代替批准。确认专用同意、请求/确认、撤回、删除、导出和企业出口的实际验收记录，再另行批准受控启用。此手册不指定测试已经通过，也不授权用真实用户简历联调。

部署包必须包含固定 PDF child 入口和同一已审 PDF.js 版本的本地 worker、CMaps、字体及 WASM 资源；页数使用当前 `resume.maxPages`（默认 20，合法范围 1–100）。只有取得资源槽后才读取 PDF。子进程 15 秒触发终止后仍须等实际 `close`；provider 45 秒取消后仍须等调用实际 settle；解析 attempt 总预算为 90 秒。这些预算不等于远端操作已撤销。V8 old-space 限额不是 RSS/ArrayBuffer/native 硬额度，独立 child 也不是文件系统/网络沙箱；OS/容器资源限制、父进程退出后的子进程清理和目标平台资源打包须在启用前实际验收。

| T01 队列 | 运行要求 |
| --- | --- |
| `resume-parse` | 本进程 `localConcurrency:1,batchSize:1`；合并 shutdown 与 pg-boss job signal，沿 storage/extractor/provider 传递。无 cron。 |
| `dispatch-resume-parses` | 每分钟、missed:once，并发/batch 均 1；恢复持久解析意图。 |
| `recover-data-exports` | 每分钟、missed:once，并发/batch 均 1；独立于账户 purge 持续恢复 artifact。 |

SIGINT/SIGTERM 首次进入关闭流程时立即停止新 T01 admission 并取消解析；重复信号复用同一个关闭 Promise。并行等待实际未 settle 的 T01 解析/dispatcher/export recovery、`boss.stop({graceful:true})` 和已开始的 startup/registry，三者 settle 后再等待 Sentry 收尾并退出。没有 abort port 的恢复服务继续 drain，不能看到 signal 已取消就假定远端 I/O 结束。pg-boss 默认 30 秒 graceful timeout 不能替代这条实际完成屏障。

上述独立 drain 只覆盖新接线的 T01 三类任务；既有任务仍按原 pg-boss 关闭语义处理。进程管理器 SIGKILL 不在应用保证内。核对实际队列 expiry（新队列依赖默认 15 分钟，但旧部署可能覆盖），并给停止宽限留出 child close、已开始的恢复操作、数据库等待与遥测收尾时间；不要把 90 秒预算或 30 秒 grace 当成无条件安全的强杀时点。

### 旧导出的人工切换闸门

新导出 artifact 协议不能直接接管历史固定 key。在允许新导出请求/worker/recovery 消费旧队列之前，技术负责人须按以下顺序留存审批和执行记录；临时 legacy 清理队列默认不注册，不能仅因 AI 开关关闭而跳过这道与导出有关的闸门。

1. 暂停旧 export 的入队入口和 worker，禁止旧二进制自动重启、重试或补发；核清已被远端接受的旧 PUT，并证明这些写入已静止。进程死亡、HTTP 超时、队列 ACK 或租约到期都不是远端不会迟到写入的证明。无法证明时保留全部旧 key 引用，不启用会最终清除引用的 legacy sweep，也不让新 worker 消费旧 OPEN 请求。
2. 审阅并记录一个固定 UTC `cutoverAt`。在正常迁移审批记录下执行一次性旧请求清单：使旧未被 artifact 管理的请求过期为 REJECTED、推进 generation，并保留实际非空 key。对旧 null-resultKey 请求，按已确认的旧公式 `exports/<userId>/<requestId>.zip` 留下待清理引用，覆盖 PUT 成功但 DB 尚未确认的情形；不得伪造新 artifact UUID key，也不授予新 PUT 或下载权限。
3. 在开始新导出前完成这次清单；清理成功后不重复执行清单，以免重新补回已清理引用。旧下载链接作废，用户须重新请求新导出；不绕过新 artifact 授权静默继续提供旧 key。
4. 只有完成旧写入静止和清单核验后，才人工接入临时 `cleanup-legacy-data-exports`。其 `cleanupLegacyDataExports({cutoverAt,oldWritersQuiesced:true})` 参数是受审部署事实，不来自队列或用户，不在每次运行时用当前时间替代固定 cutoff。任务仅清理 cutoff 前、符合旧确定 key 规则且没有 artifact 的记录；失败保留引用，成功后再次校验请求/key/generation 才清除引用。
5. 非规范旧 key 保留在清单中人工核实来源，不因带有 `exports/` 前缀就删除或改写。未解决旧引用前，不硬删承载引用的 DataRequest/User；需要硬删除时先另行设计持久迁移记录。清单耗尽且异常 key 全部解决后再移除临时队列，正常 `recover-data-exports` 继续保留。

新导出每次应用级 PUT 使用独立 artifact/key，`DataRequest.resultKey` 只是发布指针；artifact 清理账本不随账户/请求级联删除。`UNKNOWN` 远端写入结果在成功 DELETE、租约到期或账户匿名化后仍不能标记终态 CLEANED，需保留并持续恢复。不要用任意年龄阈值删掉这些账本行，也不要把已静止的 legacy 清理规则套用到未知的新 PUT。

本人导出只包含同一数据库快照里的正式资料和经校验的本人 READY 建议，非 READY 不含 payload；不包含旧 parsedJson、原模型响应、source key、grant/epoch/lease 等内部信息。AI 关闭不妨碍本人导出。撤回/放弃发生在快照前会反映在新快照中；已生成的导出副本不会仅因随后撤回就自动回溯修改，既已发送的邮件/下载链接或已下载文件不能召回。账号删除会另行使未来下载授权失效并安排对象清理；不要把 DB 权限失效当成远端文件已全部删除的证明。

### 排障与记录边界

只记录固定失败码、内部 ID、代次和必要计数；查看 `resume.parse.consent`、`resume.parse.confirm`、`resume.parse.discard` 及受控 `setting.update` 的最小元数据，不复制 PDF 文本、建议正文、provider 原始响应/错误正文或对象路径到日志/Sentry/工单。保留 UNKNOWN 清理和失败重试记录，先查当前授权、来源、版本与租约，不用直接 SQL 改 READY、复用旧 token/key 或抹除账本来绕过失败。普通源简历删除仍沿既有 postcommit 存储失败策略；本次导出 artifact 协议不意味着所有源 PDF 删除也已具备同样的持久恢复能力。

## M9-T02 JD 助手的启用与停用

默认不创建或启用 `ai.jdAssistant`。真实外发前核对 Anthropic 项目账号、明确的 `AI_MODEL_JD`、成本限额、数据区域/保留条款与 SUBPROCESSORS；完成法律审阅及披露版本发布，让相关用户重新接受当前 TERMS/PRIVACY。不得用本地合成 SDK/E2E 通过替代这些步骤。

专用 `saveJdAssistantSettingsAction` 只接受 `{enabled,legalVersion}`，要求近期二因素管理员身份，启用时核对最新 `legal.currentVersion`；每次保存由服务器生成新的 UUID epoch。通用设置写入不允许写此 gate。关闭时保存 `enabled:false`，旧页面之后的请求仍由服务 fresh 检查拒绝；已被外部提供方接受的请求不能因此被召回，不能承诺零处理/零费用。关闭后原手工职位编辑、保存草稿和审核继续使用。

`limits.aiJdPerUserPerHour` / `limits.aiJdPerCompanyPerHour` 默认 10 / 30，受控整数 1..1000，采用持久固定小时窗口。预检失败不占额；通过预检后预占，提供方失败/超时仍计次，不自动退款或重试。公司额度拒绝前用户预占可能已经成功。该计数是本地请求控制，不是外部账单计费证明。

只传经 redact 的 title/points；redact 不能保证匿名化。单次 SDK 请求使用明确模型、固定系统提示、结构化输出、20 秒预算和零自动重试；原始请求、输出与错误正文不进入日志/Sentry/审计。`ai.jd.generate` 只含内部 companyId、固定结果类别和 schema/prompt 版本。排障按固定错误码、当前成员状态、最新法律 grant、gate epoch 和模型配置检查，不复制岗位正文或 API 原始错误到工单。

生成结果仍需人工核对事实及中英文一致性。应用只替换本地正文，关闭页面会丢失未保存编辑；替换已有内容须确认，若内容在确认期间变化会要求重新确认。只有原有保存/提交审核动作会持久化；助手不直接发布职位。浏览器关闭弹窗会丢弃迟到结果，并不证明服务端或远端已停止处理。

## 语义推荐（M9-T03）

ai.matching 缺失、禁用或格式非法时关闭。先完成独立法律披露、政策发布和重新同意，再由具有新鲜会话的管理员通过 saveMatchingSettingsAction 提交 enabled/legalVersion/configurationId；epoch 只由服务器生成，每次保存包括关闭均轮换。不得通过 generic setting writer 或直接复用 T01/T02 gate。VOYAGE_API_KEY 与 AI_MODEL_EMBED 仅由人工秘密管理配置；不在报告、日志、工单展示。当前交付不改 legal.currentVersion，不启用任何 gate。

Prisma 先独立 enum create-only，再生成metadata扩展、审SQL、附加CHECK；使用真实生成client。普通PostgreSQL应可运行。vector能力另按 t03-pgvector-environment 的独立库和固定镜像digest审部署，单独建 side table；普通迁移、应用启动、测试setup不得安装extension。未具备vector不得调用provider。

matching-index 每次处理单一 indexId/generation；dispatch-matching-indexes 每分钟恢复已有QUEUED、过期PROCESSING并清CANCELLED旧向量。reconcile-matching-corpus 默认每5分钟按独立student/job游标扫描每类25项；ai.matching.reconcileBatchSize 为1..50，reconcileEveryMinutes为1..30，后者需重启worker。scanner只做短DB事务、不调用provider/queue。关闭gate先停止新外发；旧epoch立即失效，但远端已经接受的请求不保证撤回或免计费。

停止worker沿T01先abort→等待全部活动promise与boss.stop/startup结算→关闭telemetry→退出。dispatcher从registry接收当前已启动boss的send port和合成signal，逐条前检查signal；已发send真实await结算，abort后不发下一条，不启全局sendBoss，不用race判断settle。pg-boss grace结束仍不能宣称业务已停。send无公开AbortSignal，未结算操作继续等待；若连接始终不结算，需部署/基础设施处理，不把超时冒充完成。进程强杀会留下lease，待过期后由dispatcher恢复；不得清generation、attempts或重置grant来强行成功。检查固定failureCode与队列、metadata数量，不打印职业文本、vector、key或原始错误。回滚保持gate关闭，部署上个兼容镜像；metadata按前滚迁移保留，不删除既有迁移或数据库卷。

导出privacy.json包含全部AI_MATCHING同意历史；matching.json只包含本人kind/state/generation/sourceRevision及时间，不含vector、sourceHash、model、epoch、grant/lease、provider文本。账户删除与purge的既有T03生命周期使metadata取消，源物理删除由外键cascade清除metadata和可选vector。完成普通库fallback、独立vector SQL/CAS/rollback/删除、provider synthetic、UI/a11y与shutdown回归后才能另行批准启用。

### T03 review: cancelled-vector probes and real provider settlement

CANCELLED nextAttemptAt is the next physical cleanup probe time, not a deletion-completion marker. Every dispatcher tick selects at most 50 due/null probes in nextAttemptAt NULLS FIRST / id order. A confirmed idempotent DELETE schedules a 24-hour repeat probe; a delete/transaction failure schedules a 5-minute retry in a separate short transaction with the same source→metadata order and exact CANCELLED generation. No embedding attempt/generation/completedAt/failureCode is reset. Cleaned rows remain CANCELLED and are probed again, so this trades up to one idempotent DELETE per retained row per day (plus retries) for a schema-free recovery mechanism. A finite backlog advances across ticks; overload and outages are not a cleanup SLA.

Missing vector capability skips physical cleanup without a success stamp; loss between probes raises the existing controlled store-unavailable error and uses retry rotation. On capability recovery persistent CANCELLED/due rows resume. A DB outage can also prevent retry timestamp persistence; those rows remain pending and the next healthy tick retries. Regrant/new generation resets nextAttemptAt through the existing request helper; old cleanup cannot delete READY or a different generation. Logical eligibility still excludes CANCELLED immediately, independently of physical cleanup.

The worker aborts promptly but now awaits the actual embedding adapter promise, including pending fetch/body cancellation cleanup, before returning to registry/lifecycle. A timeout sentinel is not proof of settlement. Unresponsive transport cleanup can exceed the attempt budget; local runner ownership is retained, while existing lease/generation fences still reject a late publication. No guarantee is made that an upstream request was recalled or not charged; another process can recover an expired lease under the existing at-least-once protocol. Do not reset leases/attempts or mark unknown outcomes as cancelled remotely.

## M9-T04 release and recovery gate
Final preparation serializes talentPool.searchEnabled and talentPool.minCompleteness with their controlled setSetting writer using SYSTEM_SETTING namespace 1011, including the first insert when a key is absent. Keep the source → MARKETING → sorted setting keys → configuration rows order in future writers. Missing talent-pool rows retain the established true/60 defaults; the three matching/legal/marketing configuration rows must exist. Legal appenders use the source lock and monotonic database timestamps. No provider request runs inside these transactions.

Keep marketing.weekly absent or disabled. Before any activation, obtain explicit approval for real marketing/provider account use, resolve lawyer draft markers, publish both reviewed privacy policies under one new legal version, set the release-owned marketing-disclosure manifest to that version and exact UTF-8 SHA256 hashes, provision a dedicated >=32-byte MARKETING_UNSUBSCRIBE_SECRET outside the repository, and verify authenticated and token withdrawal with synthetic recipients. Never commit secrets or tokens. Activation uses only saveMarketingSettingsAction with recent two-factor admin authentication; clients cannot select epoch. Disabling also rotates epoch and requires no legal/publication/secret prerequisite.

Generate ordinary Prisma migration with create-only after merging T01–T04 metadata; inspect the generated SQL, append the reviewed ordinary constraint fragment, then run the authorized migration workflow. No vector deployment is implied. Run weekly and recovery schedules on the existing pg-boss connection. Monitor only internal IDs/fixed error codes and counts; do not log token URLs, email bodies, addresses or provider errors.

UNKNOWN is terminal for automation. Do not reset attempts, requeue UNKNOWN, backfill old weeks or infer non-acceptance from silence. Manual reconciliation needs provider evidence and separate authorization. Withdrawal/deletion cannot recall an accepted/in-flight email. SIGTERM aborts admission and waits owned callbacks and timeout tails before exit; process termination remains the operator emergency boundary. Registry weekly schedules pass the current already-started boss.send port and combined shutdown/job signal, await real pending sends, and stop before the next recipient after abort. The existing worker owns and closes this boss. The default sendBoss port remains only for isolated/direct compatibility calls; that caller owns producer close and actual drain and must not treat a response timeout as cancellation. The production registry creates no second producer. No production smoke send or gate change is authorized by this candidate.

Weekly sender also awaits the configured provider instance's optional settle() in finally. This waits for its actual send promise after the 20-second UNKNOWN deadline; late acceptance never converts UNKNOWN to automatic retry. SMTP close is invoked through the public API; promise settlement is not proof of remote cancellation or inbox delivery. An indefinitely pending provider can keep graceful shutdown pending; operators retain the explicit process-termination boundary and must not replay that row.
