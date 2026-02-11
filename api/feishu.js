// Vercel Serverless Function - 飞书多维表格 API 代理
// 解决浏览器端 CORS 限制，代理所有飞书 API 请求

export default async function handler(req, res) {
    // 设置 CORS 头
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

    // 处理 OPTIONS 预检请求
    if (req.method === 'OPTIONS') {
        return res.status(200).end();
    }

    if (req.method !== 'POST') {
        return res.status(405).json({ error: '仅支持 POST 请求' });
    }

    try {
        const { action, appId, appSecret, appToken, tableId, data } = req.body;

        if (!action) {
            return res.status(400).json({ error: '缺少 action 参数' });
        }

        // 根据 action 分发处理
        switch (action) {
            case 'getToken':
                return await handleGetToken(res, appId, appSecret);

            case 'testConnection':
                return await handleTestConnection(res, appId, appSecret, appToken);

            case 'listTables':
                return await handleListTables(res, appId, appSecret, appToken);

            case 'createTable':
                return await handleCreateTable(res, appId, appSecret, appToken, data);

            case 'listRecords':
                return await handleListRecords(res, appId, appSecret, appToken, tableId, data);

            case 'batchCreate':
                return await handleBatchCreate(res, appId, appSecret, appToken, tableId, data);

            case 'deleteAllRecords':
                return await handleDeleteAllRecords(res, appId, appSecret, appToken, tableId);

            default:
                return res.status(400).json({ error: `未知 action: ${action}` });
        }
    } catch (err) {
        console.error('飞书 API 代理错误:', err);
        return res.status(500).json({ error: err.message || '服务器内部错误' });
    }
}

// ===== 获取 tenant_access_token =====
async function getTenantToken(appId, appSecret) {
    const resp = await fetch('https://open.feishu.cn/open-apis/auth/v3/tenant_access_token/internal', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
            app_id: appId,
            app_secret: appSecret
        })
    });
    const result = await resp.json();
    if (result.code !== 0) {
        throw new Error(`获取 token 失败: ${result.msg}`);
    }
    return result.tenant_access_token;
}

// ===== 各 action 处理函数 =====

// 获取 token（测试凭证有效性）
async function handleGetToken(res, appId, appSecret) {
    if (!appId || !appSecret) {
        return res.status(400).json({ error: '缺少 appId 或 appSecret' });
    }
    const token = await getTenantToken(appId, appSecret);
    return res.json({ success: true, token });
}

// 测试连接（验证凭证 + 多维表格可访问性）
async function handleTestConnection(res, appId, appSecret, appToken) {
    if (!appId || !appSecret || !appToken) {
        return res.status(400).json({ error: '缺少 appId、appSecret 或 appToken' });
    }
    const token = await getTenantToken(appId, appSecret);

    // 尝试获取多维表格的数据表列表
    const resp = await fetch(`https://open.feishu.cn/open-apis/bitable/v1/apps/${appToken}/tables?page_size=1`, {
        headers: { 'Authorization': `Bearer ${token}` }
    });
    const result = await resp.json();
    if (result.code !== 0) {
        throw new Error(`连接多维表格失败: ${result.msg}（请检查 app_token 是否正确，以及应用是否有权限访问该多维表格）`);
    }
    return res.json({ success: true, tableCount: result.data?.total || 0 });
}

// 列出数据表
async function handleListTables(res, appId, appSecret, appToken) {
    const token = await getTenantToken(appId, appSecret);
    const resp = await fetch(`https://open.feishu.cn/open-apis/bitable/v1/apps/${appToken}/tables?page_size=100`, {
        headers: { 'Authorization': `Bearer ${token}` }
    });
    const result = await resp.json();
    if (result.code !== 0) {
        throw new Error(`获取数据表列表失败: ${result.msg}`);
    }
    return res.json({ success: true, tables: result.data?.items || [] });
}

// 创建数据表（含字段定义）
async function handleCreateTable(res, appId, appSecret, appToken, data) {
    const token = await getTenantToken(appId, appSecret);
    const { name, fields } = data;

    const resp = await fetch(`https://open.feishu.cn/open-apis/bitable/v1/apps/${appToken}/tables`, {
        method: 'POST',
        headers: {
            'Authorization': `Bearer ${token}`,
            'Content-Type': 'application/json'
        },
        body: JSON.stringify({
            table: {
                name,
                default_view_name: '默认视图',
                fields: fields.map(f => ({
                    field_name: f.name,
                    type: f.type, // 1=文本, 2=数字
                }))
            }
        })
    });
    const result = await resp.json();
    if (result.code !== 0) {
        throw new Error(`创建数据表 "${name}" 失败: ${result.msg}`);
    }
    return res.json({ success: true, tableId: result.data?.table_id });
}

// 查询记录（支持分页，自动获取全部记录）
async function handleListRecords(res, appId, appSecret, appToken, tableId, data) {
    const token = await getTenantToken(appId, appSecret);
    const allRecords = [];
    let pageToken = data?.pageToken || undefined;
    const pageSize = 500;

    // 分页获取所有记录
    do {
        let url = `https://open.feishu.cn/open-apis/bitable/v1/apps/${appToken}/tables/${tableId}/records?page_size=${pageSize}`;
        if (pageToken) url += `&page_token=${pageToken}`;

        const resp = await fetch(url, {
            headers: { 'Authorization': `Bearer ${token}` }
        });
        const result = await resp.json();
        if (result.code !== 0) {
            throw new Error(`查询记录失败: ${result.msg}`);
        }

        const items = result.data?.items || [];
        allRecords.push(...items);

        pageToken = result.data?.has_more ? result.data.page_token : null;
    } while (pageToken);

    return res.json({ success: true, records: allRecords, total: allRecords.length });
}

// 批量创建记录（最多500条/次）
async function handleBatchCreate(res, appId, appSecret, appToken, tableId, data) {
    const token = await getTenantToken(appId, appSecret);
    const { records } = data;

    if (!records || !Array.isArray(records) || records.length === 0) {
        return res.json({ success: true, created: 0 });
    }

    // 分批处理（每批最多500条）
    const batchSize = 500;
    let totalCreated = 0;

    for (let i = 0; i < records.length; i += batchSize) {
        const batch = records.slice(i, i + batchSize);
        const resp = await fetch(`https://open.feishu.cn/open-apis/bitable/v1/apps/${appToken}/tables/${tableId}/records/batch_create`, {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${token}`,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                records: batch.map(r => ({ fields: r }))
            })
        });
        const result = await resp.json();
        if (result.code !== 0) {
            throw new Error(`批量创建记录失败: ${result.msg}`);
        }
        totalCreated += result.data?.records?.length || 0;
    }

    return res.json({ success: true, created: totalCreated });
}

// 删除表中所有记录（先查再删）
async function handleDeleteAllRecords(res, appId, appSecret, appToken, tableId) {
    const token = await getTenantToken(appId, appSecret);

    // 先获取所有记录 ID
    const allIds = [];
    let pageToken = undefined;

    do {
        let url = `https://open.feishu.cn/open-apis/bitable/v1/apps/${appToken}/tables/${tableId}/records?page_size=500&field_names=["_"]`;
        if (pageToken) url += `&page_token=${pageToken}`;

        const resp = await fetch(url, {
            headers: { 'Authorization': `Bearer ${token}` }
        });
        const result = await resp.json();
        if (result.code !== 0) {
            // 如果表为空或出错，直接返回成功
            return res.json({ success: true, deleted: 0 });
        }

        const items = result.data?.items || [];
        allIds.push(...items.map(item => item.record_id));
        pageToken = result.data?.has_more ? result.data.page_token : null;
    } while (pageToken);

    if (allIds.length === 0) {
        return res.json({ success: true, deleted: 0 });
    }

    // 分批删除（每批最多500条）
    let totalDeleted = 0;
    for (let i = 0; i < allIds.length; i += 500) {
        const batch = allIds.slice(i, i + 500);
        const resp = await fetch(`https://open.feishu.cn/open-apis/bitable/v1/apps/${appToken}/tables/${tableId}/records/batch_delete`, {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${token}`,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({ records: batch })
        });
        const result = await resp.json();
        if (result.code !== 0) {
            throw new Error(`删除记录失败: ${result.msg}`);
        }
        totalDeleted += batch.length;
    }

    return res.json({ success: true, deleted: totalDeleted });
}
