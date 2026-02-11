export default async function handler(req, res) {
    // CORS Headers
    res.setHeader('Access-Control-Allow-Credentials', true);
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET,OPTIONS,PATCH,DELETE,POST,PUT');
    res.setHeader(
        'Access-Control-Allow-Headers',
        'X-CSRF-Token, X-Requested-With, Accept, Accept-Version, Content-Length, Content-MD5, Content-Type, Date, X-Api-Version, Authorization'
    );

    if (req.method === 'OPTIONS') {
        res.status(200).end();
        return;
    }

    const { code } = req.body;
    if (!code) {
        res.status(400).json({ error: 'Missing code' });
        return;
    }

    try {
        const APP_ID = process.env.FEISHU_APP_ID;
        const APP_SECRET = process.env.FEISHU_APP_SECRET;

        if (!APP_ID || !APP_SECRET) {
            throw new Error('Server misconfiguration: Missing App ID or Secret');
        }

        // 1. 获取 user_access_token
        const tokenRes = await fetch('https://open.feishu.cn/open-apis/authen/v1/oidc/access_token', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${await getAppAccessToken(APP_ID, APP_SECRET)}` // 需要 app_access_token? NO, OIDC uses app_id/secret directly or app_access_token?
                // Feishu OIDC /authen/v1/oidc/access_token requires app_access_token usually, OR app_id/secret in body?
                // Let's check docs. Standard OAuth: POST /authen/v1/access_token
                // Body: { grant_type: 'authorization_code', code: code }
                // Headers: Authorization: Bearer <app_access_token>
            }
        });

        // Wait, let's use the standard "Login" API (v1/access_token).
        // URL: https://open.feishu.cn/open-apis/authen/v1/access_token

        const appAccessToken = await getAppAccessToken(APP_ID, APP_SECRET);

        const response = await fetch('https://open.feishu.cn/open-apis/authen/v1/access_token', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json; charset=utf-8',
                'Authorization': `Bearer ${appAccessToken}`
            },
            body: JSON.stringify({
                grant_type: 'authorization_code',
                code: code
            })
        });

        const data = await response.json();
        if (data.code !== 0) {
            throw new Error(`Feishu API Error: ${data.msg}`);
        }

        // data.data contains: access_token, refresh_token, open_id, etc.
        res.status(200).json(data.data);

    } catch (error) {
        console.error('Auth Error:', error);
        res.status(500).json({ error: error.message });
    }
}

// 辅助函数：获取 app_access_token (自建应用)
async function getAppAccessToken(appId, appSecret) {
    const url = 'https://open.feishu.cn/open-apis/auth/v3/app_access_token/internal';
    const res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ app_id: appId, app_secret: appSecret })
    });
    const data = await res.json();
    if (data.code !== 0) throw new Error(`Get App Token Failed: ${data.msg}`);
    return data.app_access_token;
}
