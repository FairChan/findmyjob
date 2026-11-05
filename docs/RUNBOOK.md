# RUNBOOK · FindMYJob 运维手册

> 骨架 v0.2 · 2026-11-03。各节由对应任务填写：部署和回滚（M7-T06、M7-T11）、备份与恢复（M7-T12）、事故响应（M7-T13）。运维内容只写在这里。
> 隐私守则：处理任何问题时，不把真实数据、完整的 AuditLog 行、`.env` 内容贴进 Claude 会话。

## 角色

| 角色 | 人 | 职责 |
|---|---|---|
| 技术负责人 | 待定 | 部署、批准迁移、复核运维操作 |
| 运维备份人 | 待指定（B15） | GATE-M7 前独立完成一次回滚和一次恢复演练；离线密钥的第二位保管人 |

## 部署
（M7-T11 填写：findmyjob-deploy 的用法、批准迁移、健康检查失败时的自动回退。）

## 回滚
（M7-T11 填写：回滚 = 重新部署上一个镜像 tag；迁移不回滚，需要时写前滚迁移。）

## 迁移失败
（M7-T11 填写：P3009、INVALID 索引的处理步骤。）

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

（M7-T06 填写：每 90 天在 GitHub 轮换一次。）

## 备份
（M7-T12 填写。）

## 恢复演练
（M7-T12 填写。）

## 真实恢复
（M7-T12 填写；恢复之后要补跑一次 purge-deleted-accounts。）

## 事故响应
（M7-T13 填写：SEV 分级、角色、联系表（核实后再填，不编造号码）、五个止血场景、只读 SQL 模板、PDPA 通报。）

## 每周一 30 分钟例行检查

负责人：技术负责人（待定）；缺席时由运维备份人做。

- [ ] Dependabot 的安全 PR：逐个看，能合的合，不能合的在 DECISIONS 写原因和到期日
- [ ] Sentry 里未解决的 issue：确认没有新的 PII 泄露类问题
- [ ] healthchecks：备份和定时任务过去 7 天都是绿色
- [ ] `.reports/COSTS.tsv` 和中转扣费：本周花费、累计是否接近 D23 上限
- [ ] 记一行检查结果（日期、执行人、发现的问题编号）
