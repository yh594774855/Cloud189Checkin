function loadAccountsFromEnv() {
    let accounts = []

    // 单变量格式：账号#密码&账号2#密码2
    if (process.env.TY_ACCOUNTS) {
        const packedAccounts = process.env.TY_ACCOUNTS.split("&")
            .map(item => item.trim())
            .filter(Boolean)

        accounts = packedAccounts.map(item => {
            const separatorIndex = item.indexOf("#")
            if (separatorIndex <= 0) {
                throw new Error(`TY_ACCOUNTS 格式错误: ${item}`)
            }
            const userName = item.slice(0, separatorIndex).trim()
            const password = item.slice(separatorIndex + 1)
            if (!userName || !password) {
                throw new Error(`TY_ACCOUNTS 格式错误: ${item}`)
            }
            return {
                userName,
                password
            }
        })
    } else {
        // 从环境变量中读取账号，支持任意数量
        let index = 1
        while (true) {
            const userName = process.env[`TY_USERNAME_${index}`]
            const password = process.env[`TY_PASSWORD_${index}`]
            if (!userName || !password) {
                break
            }
            accounts.push({
                userName,
                password
            })
            index++
        }
    }

    return accounts
}

const accounts = loadAccountsFromEnv()
module.exports = accounts
