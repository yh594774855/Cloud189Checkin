require("dotenv").config();

const fs = require("fs");
const path = require("path");
const {
  CloudClient,
  FileTokenStore,
} = require("cloud189-sdk");
const accounts = require("./accounts");
const push = require("./src/push");

const TOKEN_DIR = path.join(__dirname, ".token");

// ---------- GH Actions 首次运行: 从 Secret 初始化 token ----------
function seedTokenFromEnv(userName) {
  const tokenPath = path.join(TOKEN_DIR, `${userName}.json`);
  if (!fs.existsSync(tokenPath) && process.env.CLOUD189_TOKEN) {
    fs.mkdirSync(TOKEN_DIR, { recursive: true });
    fs.writeFileSync(tokenPath, process.env.CLOUD189_TOKEN, "utf-8");
    console.log(`[${mask(userName, 3, 7)}] 从 CLOUD189_TOKEN 初始化缓存`);
  }
}

// ---------- 工具函数 ----------
function mask(str, head, tail) {
  if (!str) return "***";
  if (str.length <= head + tail) return str;
  return str.substring(0, head) + "****" + str.substring(str.length - tail);
}

function randomDelay() {
  const ms = (Math.floor(Math.random() * 91) + 10) * 1000;
  return ms;
}

// ---------- 签到逻辑 ----------
async function doCheckIn(account) {
  const { userName, password } = account;
  const userNameInfo = mask(userName, 3, 7);
  const messages = [];

  seedTokenFromEnv(userName);

  const tokenPath = path.join(TOKEN_DIR, `${userName}.json`);
  const cloudClient = new CloudClient({
    username: userName,
    password,
    token: new FileTokenStore(tokenPath),
  });

  const before = Date.now();
  try {
    // 获取签到前容量
    const beforeInfo = await cloudClient.getUserSizeInfo();

    // 执行签到
    const signResult = await cloudClient.userSign();
    const bonus = signResult.isSign ? 0 : signResult.netdiskBonus;
    messages.push(`签到成功: +${bonus}M`);

    // 获取签到后容量
    const afterInfo = await cloudClient.getUserSizeInfo();
    const personalAdded = (
      (afterInfo.cloudCapacityInfo.totalSize -
        beforeInfo.cloudCapacityInfo.totalSize) /
      1024 /
      1024
    ).toFixed(2);
    const personalTotal = (
      afterInfo.cloudCapacityInfo.totalSize /
      1024 /
      1024 /
      1024
    ).toFixed(2);

    messages.push(`个人容量: +${personalAdded}M / ${personalTotal}G`);

    // 家庭容量（如有变化）
    try {
      const familyAdded = (
        (afterInfo.familyCapacityInfo.totalSize -
          beforeInfo.familyCapacityInfo.totalSize) /
        1024 /
        1024
      ).toFixed(2);
      const familyTotal = (
        afterInfo.familyCapacityInfo.totalSize /
        1024 /
        1024 /
        1024
      ).toFixed(2);
      if (parseFloat(familyAdded) > 0) {
        messages.push(`家庭容量: +${familyAdded}M / ${familyTotal}G`);
      }
    } catch (_) {
      // 无家庭空间
    }

    const elapsed = ((Date.now() - before) / 1000).toFixed(1);
    messages.push(`耗时: ${elapsed}s`);
    return { success: true, userNameInfo, messages };
  } catch (e) {
    const elapsed = ((Date.now() - before) / 1000).toFixed(1);
    let errMsg = e.message || String(e);
    if (e.response) {
      try {
        const body = JSON.parse(e.response.body);
        errMsg = body.msg || body.errorMsg || errMsg;
      } catch (_) {}
    }
    messages.push(`失败: ${errMsg}`);
    messages.push(`耗时: ${elapsed}s`);
    return { success: false, userNameInfo, messages };
  }
}

// ---------- 执行所有账号签到 ----------
async function runAllCheckins() {
  const results = [];
  for (const account of accounts) {
    const startMsg = `[${mask(account.userName, 3, 7)}] 开始签到`;
    console.log(startMsg);
    const result = await doCheckIn(account);
    results.push(result);
    console.log(result.messages.join(" | "));
  }
  return results;
}

// ---------- 构建推送消息 ----------
function buildPushMessage(results) {
  const now = new Date().toLocaleString("zh-CN", { timeZone: "Asia/Shanghai" });
  const lines = [`天翼云盘签到 ${now}`, ""];

  for (const r of results) {
    lines.push(`账号: ${r.userNameInfo}`);
    for (const m of r.messages) {
      lines.push(`  ${m}`);
    }
    lines.push("");
  }
  return lines.join("\n");
}

// ---------- 单次签到执行 ----------
async function doDailyCheckin() {
  console.log(`\n${"=".repeat(40)}`);
  console.log(`[${new Date().toISOString()}] 开始执行签到任务`);
  const results = await runAllCheckins();

  const msg = buildPushMessage(results);
  console.log(msg);

  // 推送通知
  const title = "天翼云盘签到";
  push(title, msg);

  return results;
}

// ---------- 启动模式 ----------
async function main() {
  const mode = process.argv[2];

  if (mode === "once") {
    // 立即执行一次
    await doDailyCheckin();
    process.exit(0);
  }

  // 定时模式：每天早上 9:00 (北京时间) + 随机延迟 10~100 秒
  console.log("签到守护进程已启动");
  console.log("定时规则: 每天北京时间 9:00 AM + 随机延迟 10~100 秒");

  function scheduleNext() {
    const now = new Date();

    // 获取当前北京时间
    const beijingNow = new Date(
      now.toLocaleString("en-US", { timeZone: "Asia/Shanghai" })
    );

    // 目标时间：北京时间今天 9:00
    const targetBeijing = new Date(
      beijingNow.getFullYear(),
      beijingNow.getMonth(),
      beijingNow.getDate(),
      9,
      0,
      0,
      0
    );

    // 如果今天 9 点已过，设为明天 9 点
    if (targetBeijing <= beijingNow) {
      targetBeijing.setDate(targetBeijing.getDate() + 1);
    }

    // 转换为 UTC 时间戳计算延迟
    const targetUTC = new Date(
      targetBeijing.toLocaleString("en-US", { timeZone: "UTC" })
    );

    const baseDelay = targetUTC.getTime() - now.getTime();
    const randomExtra = randomDelay();
    const totalDelay = baseDelay + randomExtra;

    console.log(
      `下次签到: ${targetBeijing.toLocaleString("zh-CN", { timeZone: "Asia/Shanghai" })} + ${Math.round(randomExtra / 1000)}秒 (北京 9:00)`
    );

    setTimeout(async () => {
      await doDailyCheckin();
      scheduleNext();
    }, totalDelay);
  }

  // 也支持通过环境变量立即执行一次
  if (process.env.RUN_ON_START === "1") {
    console.log("启动时执行一次...");
    await doDailyCheckin();
  }

  scheduleNext();
}

main().catch((e) => {
  console.error("守护进程异常:", e);
  process.exit(1);
});
