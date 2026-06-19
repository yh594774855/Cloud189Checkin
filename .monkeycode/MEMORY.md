# 用户指令记忆

本文件记录了用户的指令、偏好和教导，用于在未来的交互中提供参考。

## 格式

### 用户指令条目
用户指令条目应遵循以下格式：

[用户指令摘要]
- Date: [YYYY-MM-DD]
- Context: [提及的场景或时间]
- Instructions:
  - [用户教导或指示的内容，逐行描述]

### 项目知识条目
Agent 在任务执行过程中发现的条目应遵循以下格式：

[项目知识摘要]
- Date: [YYYY-MM-DD]
- Context: Agent 在执行 [具体任务描述] 时发现
- Category: [运维部署|构建方法|测试方法|排错调试|工作流协作|环境配置]
- Instructions:
  - [具体的知识点，逐行描述]

## 去重策略
- 添加新条目前，检查是否存在相似或相同的指令
- 若发现重复，跳过新条目或与已有条目合并
- 合并时，更新上下文或日期信息

## 条目

### 签到测试执行方法
- Date: 2026-06-19
- Context: 用户要求后续每次说测试签到时，直接执行并展示结果
- Instructions:
  - 用户说"测试签到"或类似指令时，直接执行 `npm run checkin`
  - 展示每个账号的签到结果和容量变化
  - 不需要额外确认，直接执行

### 签到项目核心命令
- Date: 2026-06-19
- Context: Agent 在搭建天翼云盘签到项目时发现
- Category: 构建方法
- Instructions:
  - 手动签到: `npm run checkin`（执行 checkin-daemon.js once 模式）
  - 本地守护进程: `npm run daemon`（每天 9:00 北京时间自动签到）
  - 原始签到入口: `npm start`（src/app.js，功能类似但无定期调度）
  - Token 缓存目录: `.token/`（已加入 .gitignore）
  - 账号配置: `.env`（已加入 .gitignore），格式为 TY_USERNAME_1 / TY_PASSWORD_1
