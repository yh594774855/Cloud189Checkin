require("dotenv").config();

const fs = require("fs");
const path = require("path");
const got = require("got");
const tough = require("tough-cookie");
const QRCode = require("qrcode");
const {
  CloudAuthClient,
  CloudClient,
  FileTokenStore,
  logger: sdkLogger,
} = require("cloud189-sdk");
const {
  WEB_URL,
  AUTH_URL,
  API_URL,
  AppID,
  ClientType,
  ReturnURL,
  UserAgent,
  clientSuffix,
} = require("cloud189-sdk/dist/const");
const accounts = require("./accounts");
const push = require("./src/push");
const { delay, mask } = require("./src/utils");

const TOKEN_DIR = path.join(__dirname, ".token");
const LOGIN_PRIORITY = parsePriority(
  process.env.CLOUD189_LOGIN_PRIORITY || process.env.LOGIN_PRIORITY || "token,refresh,password,qr"
);
const ENABLE_QR_LOGIN = process.env.CLOUD189_ENABLE_QR !== "0";
const REFRESH_THRESHOLD_MS =
  Number(process.env.CLOUD189_REFRESH_THRESHOLD_HOURS || 24) * 60 * 60 * 1000;
const QR_POLL_INTERVAL_MS = Number(process.env.CLOUD189_QR_POLL_INTERVAL_MS || 2000);
const QR_POLL_LIMIT = Number(process.env.CLOUD189_QR_POLL_LIMIT || 180);

sdkLogger.configure({
  isDebugEnabled: process.env.CLOUD189_VERBOSE === "1",
});

function parsePriority(value) {
  return value
    .split(",")
    .map((item) => item.trim().toLowerCase())
    .filter(Boolean);
}

function tokenPathOf(userName) {
  return path.join(TOKEN_DIR, `${userName}.json`);
}

function readTokenSnapshot(tokenPath) {
  try {
    if (!fs.existsSync(tokenPath)) {
      return null;
    }
    const content = fs.readFileSync(tokenPath, "utf-8").trim();
    if (!content) {
      return null;
    }
    return JSON.parse(content);
  } catch (error) {
    throw new Error(`读取 token 失败: ${error.message}`);
  }
}

function seedTokenFromEnv(tokenPath) {
  if (fs.existsSync(tokenPath) || !process.env.CLOUD189_TOKEN) {
    return;
  }
  fs.mkdirSync(path.dirname(tokenPath), { recursive: true });
  fs.writeFileSync(tokenPath, process.env.CLOUD189_TOKEN, "utf-8");
}

async function saveSessionToken(tokenStore, session, expiresInMs) {
  await tokenStore.update({
    accessToken: session.accessToken,
    refreshToken: session.refreshToken,
    expiresIn: Date.now() + expiresInMs,
  });
}

function buildCheckDate() {
  const now = new Date();
  const pad = (value, length = 2) => String(value).padStart(length, "0");
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}${pad(now.getHours())}:${pad(now.getMinutes())}:${pad(now.getSeconds())}.${pad(now.getMilliseconds(), 3)}`;
}

function createAuthRequest() {
  return got.extend({
    headers: { "User-Agent": UserAgent },
    cookieJar: new tough.CookieJar(),
    throwHttpErrors: false,
  });
}

function createQrQrClient() {
  return new CloudAuthClient();
}

function isExpiringSoon(tokenInfo) {
  return Boolean(tokenInfo?.expiresIn && tokenInfo.expiresIn - Date.now() <= REFRESH_THRESHOLD_MS);
}

function isTokenValid(tokenInfo) {
  return Boolean(tokenInfo?.accessToken && tokenInfo?.expiresIn && tokenInfo.expiresIn > Date.now());
}

async function loginByPassword(authClient, tokenStore, account) {
  if (!account.userName || !account.password) {
    throw new Error("未配置账号密码");
  }
  const session = await authClient.loginByPassword(account.userName, account.password);
  await saveSessionToken(tokenStore, session, 6 * 24 * 60 * 60 * 1000);
  return session;
}

async function loginByQr(authClient, tokenStore, account) {
  const request = authClient.authRequest;
  const loginForm = await request
    .get(`${WEB_URL}/api/portal/unifyLoginForPC.action`, {
      searchParams: {
        appId: AppID,
        clientType: ClientType,
        returnURL: ReturnURL,
        timeStamp: Date.now(),
      },
    })
    .text();

  const reqId = loginForm.match(/reqId = "(.+?)"/)?.[1];
  const lt = loginForm.match(/lt = "(.+?)"/)?.[1];
  const paramId = loginForm.match(/paramId = "(.+?)"/)?.[1];
  if (!reqId || !lt || !paramId) {
    throw new Error("获取二维码登录参数失败");
  }

  const uuidRes = await request.post(`${AUTH_URL}/api/logbox/oauth2/getUUID.do`, {
    headers: { Referer: AUTH_URL },
    form: { appId: AppID },
  });
  const uuidData = JSON.parse(uuidRes.body);
  if (!uuidData.uuid || !uuidData.encryuuid) {
    throw new Error(`获取二维码失败: ${uuidRes.body}`);
  }

  const qrText = await QRCode.toString(uuidData.uuid, {
    type: "terminal",
    small: true,
  });
  console.log(`\n[${mask(account.userName, 3, 7)}] 请扫码登录\n${qrText}`);

  const qrStateRequest = createAuthRequest();
  let lastStatus = "waiting";

  for (let count = 0; count < QR_POLL_LIMIT; count += 1) {
    const res = await qrStateRequest.post(
      `${AUTH_URL}/api/logbox/oauth2/qrcodeLoginState.do`,
      {
        headers: {
          Referer: AUTH_URL,
          Reqid: reqId,
          lt,
        },
        form: {
          appId: AppID,
          clientType: ClientType,
          returnUrl: ReturnURL,
          paramId,
          uuid: uuidData.uuid,
          encryuuid: uuidData.encryuuid,
          date: buildCheckDate(),
          timeStamp: Date.now(),
        },
      }
    );

    const data = JSON.parse(res.body);
    if (data.status === 0) {
      const redirectURL = data.redirectUrl || data.redirectURL || data.toUrl;
      if (!redirectURL) {
        throw new Error("二维码已确认但缺少跳转地址");
      }
      const session = await authClient.getSessionForPC({ redirectURL });
      await saveSessionToken(tokenStore, session, 6 * 24 * 60 * 60 * 1000);
      return session;
    }

    if (data.status === -11001) {
      throw new Error("二维码已过期，请重新获取");
    }

    if (data.status === -11002) {
      lastStatus = "scanned";
      console.log(`[${mask(account.userName, 3, 7)}] 已扫码，等待手机确认`);
    }

    await delay(QR_POLL_INTERVAL_MS);
  }

  throw new Error(`二维码登录超时，最后状态: ${lastStatus}`);
}

async function loginByAccessToken(authClient, tokenStore, tokenInfo) {
  const session = await authClient.loginByAccessToken(tokenInfo.accessToken);
  await tokenStore.update({
    accessToken: tokenInfo.accessToken,
    refreshToken: tokenInfo.refreshToken,
    expiresIn: tokenInfo.expiresIn,
  });
  return session;
}

async function refreshToken(authClient, tokenStore, tokenInfo) {
  if (!tokenInfo?.refreshToken) {
    throw new Error("缺少 refreshToken");
  }
  const refreshed = await authClient.refreshToken(tokenInfo.refreshToken);
  await tokenStore.update({
    accessToken: refreshed.accessToken,
    refreshToken: refreshed.refreshToken,
    expiresIn: Date.now() + refreshed.expiresIn * 1000,
  });
  return refreshed;
}

async function resolveSession(account) {
  const tokenPath = tokenPathOf(account.userName);
  seedTokenFromEnv(tokenPath);

  const tokenStore = new FileTokenStore(tokenPath);
  const tokenInfo = readTokenSnapshot(tokenPath) || tokenStore.get();
  const authClient = createQrQrClient();

  for (const method of LOGIN_PRIORITY) {
    if (method === "token") {
      if (!isTokenValid(tokenInfo)) {
        continue;
      }
      if (isExpiringSoon(tokenInfo) && LOGIN_PRIORITY.includes("refresh")) {
        continue;
      }
      try {
        const session = await loginByAccessToken(authClient, tokenStore, tokenInfo);
        return { session, tokenStore, method: "token" };
      } catch (error) {
        console.log(`[${mask(account.userName, 3, 7)}] token 登录失败: ${error.message}`);
      }
      continue;
    }

    if (method === "refresh") {
      if (!tokenInfo?.refreshToken) {
        continue;
      }
      try {
        const refreshed = await refreshToken(authClient, tokenStore, tokenInfo);
        const session = await authClient.loginByAccessToken(refreshed.accessToken);
        return { session, tokenStore, method: "refresh" };
      } catch (error) {
        console.log(`[${mask(account.userName, 3, 7)}] refresh 失败: ${error.message}`);
      }
      continue;
    }

    if (method === "password") {
      try {
        const session = await loginByPassword(authClient, tokenStore, account);
        return { session, tokenStore, method: "password" };
      } catch (error) {
        console.log(`[${mask(account.userName, 3, 7)}] password 登录失败: ${error.message}`);
      }
      continue;
    }

    if (method === "qr") {
      if (!ENABLE_QR_LOGIN) {
        continue;
      }
      try {
        const session = await loginByQr(authClient, tokenStore, account);
        return { session, tokenStore, method: "qr" };
      } catch (error) {
        console.log(`[${mask(account.userName, 3, 7)}] qr 登录失败: ${error.message}`);
      }
      continue;
    }
  }

  throw new Error("所有登录方式都失败");
}

function explainQrPolicy() {
  return `二维码登录: ${ENABLE_QR_LOGIN ? "开启" : "关闭"} | 轮询间隔: ${Math.round(QR_POLL_INTERVAL_MS / 1000)}s | 轮询上限: ${QR_POLL_LIMIT}`;
}

async function runCheckIn(account) {
  const before = Date.now();
  const userNameInfo = mask(account.userName, 3, 7);
  const messages = [];

  try {
    console.log(`[${userNameInfo}] 开始处理登录`);
    console.log(`[${userNameInfo}] ${explainQrPolicy()}`);
    const { tokenStore, method } = await resolveSession(account);
    console.log(`[${userNameInfo}] 登录完成，使用方式: ${method}`);

    const cloudClient = new CloudClient({ token: tokenStore });
    const beforeInfo = await cloudClient.getUserSizeInfo();
    const signResult = await cloudClient.userSign();
    const bonus = signResult.isSign ? 0 : signResult.netdiskBonus;
    const afterInfo = await cloudClient.getUserSizeInfo();

    messages.push(`登录方式: ${method}`);
    messages.push(`签到结果: +${bonus}M`);
    messages.push(
      `个人容量: +${((afterInfo.cloudCapacityInfo.totalSize - beforeInfo.cloudCapacityInfo.totalSize) / 1024 / 1024).toFixed(2)}M / ${(afterInfo.cloudCapacityInfo.totalSize / 1024 / 1024 / 1024).toFixed(2)}G`
    );

    try {
      const familyAdded = (
        (afterInfo.familyCapacityInfo.totalSize - beforeInfo.familyCapacityInfo.totalSize) /
        1024 /
        1024
      ).toFixed(2);
      if (Number(familyAdded) > 0) {
        messages.push(
          `家庭容量: +${familyAdded}M / ${(afterInfo.familyCapacityInfo.totalSize / 1024 / 1024 / 1024).toFixed(2)}G`
        );
      }
    } catch (_) {}

    messages.push(`耗时: ${((Date.now() - before) / 1000).toFixed(1)}s`);
    return { success: true, userNameInfo, messages };
  } catch (error) {
    messages.push(`失败: ${error.message}`);
    messages.push(`耗时: ${((Date.now() - before) / 1000).toFixed(1)}s`);
    return { success: false, userNameInfo, messages, error: error.message };
  }
}

function buildPushMessage(results) {
  const now = new Date().toLocaleString("zh-CN", { timeZone: "Asia/Shanghai" });
  const lines = [`天翼云盘签到 ${now}`, ""];

  for (const result of results) {
    lines.push(`账号: ${result.userNameInfo}`);
    for (const message of result.messages) {
      lines.push(`  ${message}`);
    }
    lines.push("");
  }

  return lines.join("\n");
}

async function notifyAndStop(title, content, exitCode = 1) {
  push(title, content);
  await delay(1200);
  process.exit(exitCode);
}

async function main() {
  if (!accounts.length) {
    await notifyAndStop("天翼云盘签到失败", "未配置任何账号", 1);
    return;
  }

  const results = [];
  for (const account of accounts) {
    const result = await runCheckIn(account);
    results.push(result);
    console.log(result.messages.join(" | "));
    if (!result.success) {
      const content = buildPushMessage(results);
      await notifyAndStop("天翼云盘签到失败", content, 1);
      return;
    }
  }

  const content = buildPushMessage(results);
  console.log(content);
  push("天翼云盘签到成功", content);
  await delay(1200);
}

main().catch(async (error) => {
  const content = `签到脚本异常: ${error.message}`;
  try {
    push("天翼云盘签到异常", content);
    await delay(1200);
  } finally {
    process.exit(1);
  }
});
