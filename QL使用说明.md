# 青龙面板签到使用说明

## 目标

这个脚本只做一件事：天翼云盘签到。

支持的登录顺序由环境变量控制，默认顺序是：`token -> refresh -> password -> qr`。

## 脚本入口

- `npm run ql`
- 等价于 `node checkin-daemon.js once`

## 新用户接入步骤

1. 在青龙面板里新建一个定时任务。
2. 任务命令填写 `npm run ql`。
3. 先配置账号变量。
4. 第一次运行时，如果没有有效 token，可以开启二维码登录。
5. 执行任务后，脚本会把 token 写入 `.token/<账号>.json`。
6. 之后日常运行会优先使用 token，再按优先级执行后续方式。

## 必填变量

```bash
TY_ACCOUNTS=账号1#密码1&账号2#密码2
```

示例：

```bash
TY_ACCOUNTS=13800138000#pass1&13900139000#pass2
```

说明：

- `&` 用来分隔多个账号
- `#` 用来分隔账号和密码
- 这种写法适合青龙面板只配一个变量

## 推荐变量

```bash
CLOUD189_LOGIN_PRIORITY=token,refresh,password,qr
CLOUD189_ENABLE_QR=1
CLOUD189_REFRESH_THRESHOLD_HOURS=24
CLOUD189_QR_POLL_INTERVAL_MS=2000
CLOUD189_QR_POLL_LIMIT=180
CLOUD189_VERBOSE=0
```

## 变量说明

- `TY_ACCOUNTS`：账号和密码打包变量，格式为 `账号#密码&账号2#密码2`。
- `CLOUD189_LOGIN_PRIORITY`：登录优先级，按逗号分隔。
- `CLOUD189_ENABLE_QR`：是否启用扫码登录，`1` 开启，`0` 关闭。
- `CLOUD189_REFRESH_THRESHOLD_HOURS`：token 进入刷新窗口的小时数。
- `CLOUD189_QR_POLL_INTERVAL_MS`：扫码状态轮询间隔。
- `CLOUD189_QR_POLL_LIMIT`：扫码状态轮询次数上限。
- `CLOUD189_VERBOSE`：SDK 调试日志开关。

## 扫码登录流程

1. 把 `CLOUD189_ENABLE_QR` 设为 `1`。
2. 运行任务 `npm run ql`。
3. 日志里会出现终端二维码。
4. 用天翼云盘 App 扫码确认。
5. 脚本自动换取 session，保存 token，并继续签到。
6. 日志和推送里都会显示登录方式和签到结果。

## 二维码规则

- 二维码过期后，重新运行任务即可生成新的二维码。
- 代码里通过轮询状态判断是否确认。
- 轮询到确认状态后，脚本自动继续签到。

## 失败处理

- 任一账号登录失败后，脚本先推送失败消息，再停止。
- 这样可以避免后续账号继续执行，方便你马上处理问题。

## 日常使用

1. 首次运行建议打开 `CLOUD189_ENABLE_QR=1`。
2. 扫码成功后，token 会保存在 `.token/`。
3. 后续可以把 `CLOUD189_ENABLE_QR=0`，让日常任务只走 token 和 refresh。
4. 如果 token 失效，再临时打开扫码开关重新绑定。

## 推荐青龙任务名

- `天翼云盘签到`
- 命令：`npm run ql`
