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

    const { code, grant_type, refresh_token, redirect_uri } = req.body;
    if (!code && !refresh_token) {
        res.status(400).json({ error: 'Missing code or refresh_token' });
        return;
    }

    try {
        const APP_ID = process.env.FEISHU_APP_ID;
        const APP_SECRET = process.env.FEISHU_APP_SECRET;

        if (!APP_ID || !APP_SECRET) {
            throw new Error('Server misconfiguration: Missing App ID or Secret');
        }

        const appAccessToken = await getAppAccessToken(APP_ID, APP_SECRET);

        // API Endpoint: Determine based on grant_type
        const endpoint = grant_type === 'refresh_token'
            ? 'https://open.feishu.cn/open-apis/authen/v1/refresh_access_token'
            : 'https://open.feishu.cn/open-apis/authen/v1/access_token';

        const body = grant_type === 'refresh_token'
            ? { grant_type: 'refresh_token', refresh_token }
            : {
                grant_type: 'authorization_code',
                code,
                redirect_uri: redirect_uri
            };

        const response = await fetch(endpoint, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json; charset=utf-8',
                'Authorization': `Bearer ${appAccessToken}`
            },
            body: JSON.stringify(body)
        });

        const data = await response.json();
        if (data.code !== 0) {
            throw new Error(`Feishu API Error: ${data.msg}`);
        }

        // data.data contains: access_token, refresh_token, open_id (only in login), expires_in
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
