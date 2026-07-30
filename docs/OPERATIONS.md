# 运维说明

## 服务器目录

项目部署在：

```bash
/home/ubuntu/superbrain
```

## 常用命令

查看服务：

```bash
cd /home/ubuntu/superbrain
sudo docker compose ps
```

查看日志：

```bash
sudo docker compose logs --tail=100 api
sudo docker compose logs --tail=100 web
sudo docker compose logs --tail=100 caddy
sudo docker compose logs --tail=100 neo4j
sudo docker compose logs --tail=100 postgres
sudo docker compose logs --tail=100 redis
```

重启：

```bash
sudo docker compose up -d --build
```

备份 Neo4j 数据目录：

```bash
sudo tar -czf superbrain-neo4j-backup.tgz neo4j/data
```

备份 PostgreSQL Token 账本：

```bash
sudo docker compose exec -T postgres pg_dump -U superbrain superbrain | gzip > superbrain-ledger.sql.gz
```

## 环境变量

服务器 `.env` 包含：

- `NEO4J_PASSWORD`
- `APP_SECRET`
- `ADMIN_EMAIL`
- `ADMIN_PASSWORD`
- `ADMIN_USER_ID`
- `SESSION_TTL_SECONDS`
- `POSTGRES_PASSWORD`
- `DEFAULT_MONTHLY_TOKEN_QUOTA`

注意：

- `APP_SECRET` 不能随意更换，否则已保存的用户模型 Key 无法解密。
- `NEO4J_PASSWORD` 在已有 Neo4j 数据目录存在后，修改 `.env` 不会自动修改数据库内密码。
- `.env` 不应该提交到 Git。
- Token 流水是审计数据，Neo4j 与 PostgreSQL 必须一起备份。

## 安全建议

- 尽快把 SSH 密码登录改成 SSH key 登录。
- 不要暴露 Neo4j 的 `7474` 或 `7687` 到公网。
- 管理员初始密码上线后应立即修改。
- 后续需要加注册开关或邀请制，避免公网自助注册被滥用。
# 自动测试

```bash
npm test -w api
npm run build
```

API 测试覆盖文本、Markdown、JSON、PDF、DOCX 解析、Markdown 双链编译、Token 预算和模型 Rerank 响应。

生产环境可使用不消耗真实模型 Token 的临时 Mock Provider 验收：

```bash
sudo docker compose exec -T api node scripts/verify-ingestion.mjs
sudo docker compose exec -T api node scripts/verify-production.mjs
sudo docker compose exec -T api node scripts/verify-architecture.mjs
sudo docker compose exec -T api node scripts/verify-public-content.mjs
sudo docker compose exec -T api node scripts/verify-hypothesis-flow.mjs
```

脚本会创建隔离的临时用户和 Neo4j 数据并在结束时清理。TokenUsageEvent 是不可变审计流水，因此架构验收产生的一条测试流水会保留。
