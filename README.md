# 超级大脑

面向个人和团队的知识管理系统，由 Obsidian 式资料层、Neo4j 实体关系层和 LLM 检索生成层组成。

系统通过 Agent 对话摄取文字、文件、图片和互联网资料，自动形成实体、关系、事实及来源证据。私有知识可经过审核发布到公共空间，并继续形成公理、观察和版本记录。

## 核心能力

- 邮箱验证注册、头像、用户中心和管理员用户管理
- Private / Public 知识空间隔离
- 仅展示名词实体的三维知识图谱
- Fact 证据库和 Axiom 公理治理
- 文本、Markdown、PDF、DOCX、图片摄取
- 互联网多轮研究与知识编译 Agent
- 多模型兼容配置和个人 API Token
- Token 额度预占、结算与消费流水
- 向量、全文和图关系混合检索
- Docker Compose、Caddy HTTPS 部署

## 技术栈

- Neo4j 5：名词实体、实体关系和知识来源
- PostgreSQL：Token 账户、额度与审计流水
- Redis：额度预占、限流和检索缓存
- SearXNG：公共互联网检索
- Node.js + Express：API 与 Agent 工作流
- React + Vite + Three.js：知识工作台和三维图谱
- Docker Compose + Caddy：生产部署

## 文档

- [架构说明](docs/ARCHITECTURE.md)
- [产品路线图](docs/PRODUCT_ROADMAP.md)
- [运维说明](docs/OPERATIONS.md)

## 本地运行

```bash
cp .env.example .env
npm install
docker compose up -d neo4j
npm run seed
npm run dev
```

访问：

- Web 管理台：http://localhost:5173
- API：http://localhost:4000
- Neo4j Browser：http://localhost:7474

## 服务器部署

1. 将项目上传到服务器。
2. 在服务器安装 Docker 和 Docker Compose。
3. 创建 `.env`，配置强密码、`RESEND_API_KEY` 和已验证域名的 `EMAIL_FROM`。
4. 执行：

```bash
docker compose up -d --build
docker compose exec api npm run seed
```

默认端口：

- `80`：HTTP，自动跳转 HTTPS
- `443`：HTTPS Web 管理台，同时反向代理 `/api`

生产环境默认不公开 API、Neo4j Browser 和 Bolt 端口，只允许容器内网访问。需要调试 Neo4j 时建议用 SSH 隧道。

公开注册账户必须通过邮件中的 24 小时有效链接验证邮箱；管理员创建的账户直接激活。

## 知识分层

- `Entity`：具有稳定身份、可以归一化和重复引用的名词对象
- `Property`：实体自身的描述和属性，不建立独立实体
- `Relationship`：两个实体之间具有方向和语义的关系
- `Fact`：由来源直接支持的原子断言，不作为三维实体节点
- `Evidence`：事实或关系对应的原文片段和来源位置
- `Hypothesis`：基于事实提出、等待验证的推断
- `Axiom`：经过发布、观察和版本治理的公共断言

三维图只呈现实体与实体关系。事实、公理、假设和观察分别保留在证据与治理界面。
