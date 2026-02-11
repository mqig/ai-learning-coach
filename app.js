/* ============================================
   AI 学习教练 - 核心逻辑
   ============================================ */

// ===== 数据层：localStorage 管理 =====
const DB = {
    KEY: 'learnflow_data',

    // 获取全部数据（自动补充缺失的新字段，兼容旧版本数据）
    getAll() {
        try {
            const stored = JSON.parse(localStorage.getItem(this.KEY));
            if (!stored) return this._defaultData();
            // 合并默认字段，确保旧数据中缺失的字段有默认值
            const defaults = this._defaultData();
            return {
                topics: stored.topics || defaults.topics,
                knowledgePoints: stored.knowledgePoints || defaults.knowledgePoints,
                practices: stored.practices || defaults.practices,
                reviewSchedule: stored.reviewSchedule || defaults.reviewSchedule,
                dailyLog: stored.dailyLog || defaults.dailyLog,
                streak: stored.streak ?? defaults.streak,
                lastStudyDate: stored.lastStudyDate ?? defaults.lastStudyDate,
            };
        } catch { return this._defaultData(); }
    },

    // 保存全部数据
    saveAll(data) {
        localStorage.setItem(this.getKey(), JSON.stringify(data));

        // 尝试触发飞书自动同步
        if (typeof FeishuSync !== 'undefined') {
            FeishuSync.scheduleAutoSync();
        }
    },

    // 默认数据结构
    _defaultData() {
        return {
            topics: [],        // 学习主题列表
            knowledgePoints: [], // 知识点列表
            practices: [],      // 练习记录
            reviewSchedule: [], // 复习计划
            dailyLog: {},       // 每日学习记录 { 'YYYY-MM-DD': count }
            streak: 0,          // 连续学习天数
            lastStudyDate: null // 最后学习日期
        };
    },

    // 添加主题
    addTopic(title, content) {
        const data = this.getAll();
        const topic = {
            id: Date.now().toString(),
            title,
            content,
            createdAt: new Date().toISOString(),
            knowledgePointIds: []
        };
        data.topics.push(topic);
        this._updateDailyLog(data);
        this.saveAll(data);
        return topic;
    },

    // 添加知识点
    addKnowledgePoint(topicId, title, description) {
        const data = this.getAll();
        const kp = {
            id: Date.now().toString() + Math.random().toString(36).substr(2, 5),
            topicId,
            title,
            description,
            mastery: 0,     // 掌握度 0-100
            reviewCount: 0,  // 复习次数
            lastReview: null,
            nextReview: null,
            createdAt: new Date().toISOString()
        };
        data.knowledgePoints.push(kp);
        // 关联到主题
        const topic = data.topics.find(t => t.id === topicId);
        if (topic) topic.knowledgePointIds.push(kp.id);
        this.saveAll(data);
        return kp;
    },

    // 记录练习
    addPractice(knowledgePointId, question, answer, score, feedback) {
        const data = this.getAll();
        const practice = {
            id: Date.now().toString(),
            knowledgePointId,
            question,
            answer,
            score,
            feedback,
            createdAt: new Date().toISOString()
        };
        data.practices.push(practice);

        // 更新知识点掌握度
        const kp = data.knowledgePoints.find(k => k.id === knowledgePointId);
        if (kp) {
            kp.mastery = Math.min(100, Math.max(0, score));
            kp.reviewCount++;
            kp.lastReview = new Date().toISOString();
            kp.nextReview = this._calculateNextReview(kp.reviewCount, score);
        }

        this._updateDailyLog(data);
        this.saveAll(data);
        return practice;
    },

    // 基于遗忘曲线计算下次复习时间
    _calculateNextReview(reviewCount, score) {
        // 间隔（天）：1, 3, 7, 14, 30, 60
        const intervals = [1, 3, 7, 14, 30, 60];
        const idx = Math.min(reviewCount - 1, intervals.length - 1);
        let interval = intervals[idx];

        // 分数低的要更快复习
        if (score < 60) interval = Math.max(1, Math.floor(interval * 0.5));
        else if (score < 80) interval = Math.floor(interval * 0.75);

        const next = new Date();
        next.setDate(next.getDate() + interval);
        return next.toISOString();
    },

    // 获取今日待复习项
    getReviewDue() {
        const data = this.getAll();
        const now = new Date();
        return data.knowledgePoints.filter(kp => {
            if (!kp.nextReview) return false;
            return new Date(kp.nextReview) <= now;
        });
    },

    // 更新每日记录
    _updateDailyLog(data) {
        const today = new Date().toISOString().split('T')[0];
        data.dailyLog[today] = (data.dailyLog[today] || 0) + 1;

        // 更新连续天数
        if (data.lastStudyDate !== today) {
            const yesterday = new Date();
            yesterday.setDate(yesterday.getDate() - 1);
            const yesterdayStr = yesterday.toISOString().split('T')[0];

            if (data.lastStudyDate === yesterdayStr) {
                data.streak++;
            } else if (data.lastStudyDate !== today) {
                data.streak = 1;
            }
            data.lastStudyDate = today;
        }
    },

    // ===== CRUD 操作 =====

    // 更新主题
    updateTopic(id, title) { // content is not used in UI for now
        const data = this.getAll();
        const topic = data.topics.find(t => t.id === id);
        if (topic) {
            topic.title = title;
            // topic.content = content; 
            this.saveAll(data);
        }
    },

    // 删除主题（级联删除）
    deleteTopic(id) {
        const data = this.getAll();
        const topicIndex = data.topics.findIndex(t => t.id === id);
        if (topicIndex === -1) return;

        // 1. 找到该主题下的所有知识点 ID
        const topic = data.topics[topicIndex];
        const kpIds = topic.knowledgePointIds || [];

        // 2. 删除相关的练习记录
        data.practices = data.practices.filter(p => {
            const kp = data.knowledgePoints.find(k => k.id === p.knowledgePointId);
            return kp && kp.topicId !== id;
        });

        // 3. 删除知识点
        data.knowledgePoints = data.knowledgePoints.filter(kp => kp.topicId !== id);

        // 4. 删除主题
        data.topics.splice(topicIndex, 1);

        this.saveAll(data);
    },

    // 更新知识点
    updateKnowledgePoint(id, title, description) {
        const data = this.getAll();
        const kp = data.knowledgePoints.find(k => k.id === id);
        if (kp) {
            kp.title = title;
            kp.description = description;
            this.saveAll(data);
        }
    },

    // 删除知识点
    deleteKnowledgePoint(id) {
        const data = this.getAll();
        const kpIndex = data.knowledgePoints.findIndex(k => k.id === id);
        if (kpIndex === -1) return;

        const kp = data.knowledgePoints[kpIndex];

        // 1. 删除关联的练习记录
        data.practices = data.practices.filter(p => p.knowledgePointId !== id);

        // 2. 从主题的 knowledgePointIds 中移除
        const topic = data.topics.find(t => t.id === kp.topicId);
        if (topic && topic.knowledgePointIds) {
            topic.knowledgePointIds = topic.knowledgePointIds.filter(kid => kid !== id);
        }

        // 3. 删除知识点
        data.knowledgePoints.splice(kpIndex, 1);

        this.saveAll(data);
    }
};


// ===== AI 配置管理 =====
const AIConfig = {
    KEY: 'learnflow_ai_config',

    // 各提供商默认 Base URL
    PROVIDER_URLS: {
        openai: 'https://api.openai.com',
        claude: 'https://api.anthropic.com',
        gemini: 'https://generativelanguage.googleapis.com',
        deepseek: 'https://api.deepseek.com',
        custom: ''
    },

    // 各提供商默认模型
    PROVIDER_MODELS: {
        openai: 'gpt-4o-mini',
        claude: 'claude-sonnet-4-20250514',
        gemini: 'gemini-2.0-flash',
        deepseek: 'deepseek-chat',
        custom: ''
    },

    // 默认知识点提取提示词
    DEFAULT_EXTRACT_PROMPT: `你是一位专业的学习教练。请从以下学习材料中提取核心知识点。

要求：
1. 提取 5-15 个最重要的知识点
2. 每个知识点需要有简洁的标题（不超过30字）和详细的描述（50-200字）
3. 描述应包含关键概念、原理和要点，便于后续出题和复习
4. 按照逻辑顺序排列，从基础到进阶
5. 忽略重复或过于琐碎的信息

请严格按照以下 JSON 格式返回，不要包含 markdown 代码块标记或任何其他内容：
[{"title": "知识点标题", "description": "知识点详细描述..."}]

学习材料：
`,

    // 默认答案评估提示词
    DEFAULT_EVAL_PROMPT: `你是一位费曼学习法教练。请评估以下学生对知识点的理解程度。

知识点标题：{{title}}
知识点内容：{{description}}
学生回答：{{answer}}

评分维度（总分100）：
1. 核心概念覆盖（40分）：回答是否涵盖了知识点的关键概念
2. 自我表达（20分）：是否用自己的话表达，而非照搬原文
3. 举例类比（15分）：是否使用了生活化的例子或类比来解释
4. 深度理解（15分）：是否体现了对底层原理的深层理解
5. 表达结构（10分）：回答是否条理清晰、逻辑连贯

请严格按照以下 JSON 格式返回，不要包含 markdown 代码块标记或任何其他内容：
{"score": 75, "feedback": ["反馈1", "反馈2"], "correct": ["做得好的点1", "做得好的点2"], "missing": ["缺失的关键概念1", "缺失的关键概念2"]}

feedback 数组的第一项应为总体评价（带emoji），后续为具体改进建议。
correct 数组列出做得好的点（以 ✅ 开头）。
missing 数组列出回答中缺失的关键概念（不超过5个）。
`,

    // 获取配置
    get() {
        try {
            const saved = JSON.parse(localStorage.getItem(this.KEY));
            return saved || this._default();
        } catch { return this._default(); }
    },

    // 保存配置
    save(config) {
        localStorage.setItem(this.KEY, JSON.stringify(config));
    },

    // 默认配置
    _default() {
        return {
            provider: 'openai',
            baseUrl: '',
            apiKey: '',
            model: '',
            extractPrompt: this.DEFAULT_EXTRACT_PROMPT,
            evalPrompt: this.DEFAULT_EVAL_PROMPT
        };
    },

    // 检查是否已配置 API
    isConfigured() {
        const config = this.get();
        return !!(config.apiKey && config.apiKey.trim());
    },

    // 获取实际使用的 Base URL
    getBaseUrl() {
        const config = this.get();
        return config.baseUrl || this.PROVIDER_URLS[config.provider] || '';
    },

    // 获取实际使用的模型
    getModel() {
        const config = this.get();
        return config.model || this.PROVIDER_MODELS[config.provider] || 'gpt-4o-mini';
    }
};


// ===== AI 调用日志管理 =====
const AILog = {
    KEY: 'learnflow_ai_logs',
    MAX_LOGS: 100,

    // 获取所有日志
    getAll() {
        try {
            return JSON.parse(localStorage.getItem(this.KEY)) || [];
        } catch { return []; }
    },

    // 添加日志
    add(entry) {
        const logs = this.getAll();
        logs.unshift({
            id: Date.now(),
            time: new Date().toISOString(),
            ...entry
        });
        // 限制最多保留 MAX_LOGS 条
        if (logs.length > this.MAX_LOGS) logs.length = this.MAX_LOGS;
        localStorage.setItem(this.KEY, JSON.stringify(logs));
        this._updateBadge(logs.length);
    },

    // 清除所有日志
    clear() {
        localStorage.removeItem(this.KEY);
        this._updateBadge(0);
    },

    // 更新日志数量 badge
    _updateBadge(count) {
        const el = document.getElementById('logCount');
        if (el) el.textContent = count;
    },

    // 初始化 badge
    initBadge() {
        this._updateBadge(this.getAll().length);
    }
};
// ===== AI API 调用 =====

// 统一的 AI 请求函数（兼容 OpenAI 格式），自动记录日志
async function callAI(systemPrompt, userContent, logType = 'api') {
    const config = AIConfig.get();
    const baseUrl = AIConfig.getBaseUrl();
    const model = AIConfig.getModel();

    if (!config.apiKey) {
        throw new Error('未配置 API Key，请点击右上角齿轮按钮进行配置');
    }

    const startTime = Date.now();
    try {
        let result;
        // Claude 使用不同的 API 格式
        if (config.provider === 'claude') {
            result = await callClaudeAPI(baseUrl, config.apiKey, model, systemPrompt, userContent);
        } else {
            // 其他都使用 OpenAI 兼容格式（OpenAI / DeepSeek / 自定义中转）
            result = await callOpenAICompatible(baseUrl, config.apiKey, model, systemPrompt, userContent);
        }

        const duration = Date.now() - startTime;
        const apiUrl = config.provider === 'claude'
            ? `${baseUrl}/v1/messages`
            : `${baseUrl}/v1/chat/completions`;
        AILog.add({
            type: logType,
            status: 'success',
            provider: config.provider,
            model,
            apiUrl,
            systemPrompt: systemPrompt.substring(0, 500),
            userInput: userContent,
            fullResponse: result,
            inputLength: userContent.length,
            outputLength: result.length,
            duration
        });

        return result;
    } catch (err) {
        const duration = Date.now() - startTime;
        const apiUrl = config.provider === 'claude'
            ? `${baseUrl}/v1/messages`
            : `${baseUrl}/v1/chat/completions`;
        AILog.add({
            type: logType,
            status: 'error',
            provider: config.provider,
            model,
            apiUrl,
            systemPrompt: systemPrompt.substring(0, 500),
            userInput: userContent,
            inputLength: userContent.length,
            duration,
            error: err.message
        });
        throw err;
    }
}

// OpenAI 兼容格式 API
async function callOpenAICompatible(baseUrl, apiKey, model, systemPrompt, userContent) {
    const url = `${baseUrl}/v1/chat/completions`;

    const response = await fetch(url, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${apiKey}`
        },
        body: JSON.stringify({
            model,
            messages: [
                { role: 'system', content: systemPrompt },
                { role: 'user', content: userContent }
            ],
            temperature: 0.3,
            max_tokens: 4000
        })
    });

    if (!response.ok) {
        const err = await response.text();
        throw new Error(`API 请求失败 (${response.status}): ${err.substring(0, 200)}`);
    }

    const data = await response.json();
    return data.choices[0].message.content;
}

// Claude API 格式
async function callClaudeAPI(baseUrl, apiKey, model, systemPrompt, userContent) {
    const url = `${baseUrl}/v1/messages`;

    const response = await fetch(url, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'x-api-key': apiKey,
            'anthropic-version': '2023-06-01',
            'anthropic-dangerous-direct-browser-access': 'true'
        },
        body: JSON.stringify({
            model,
            system: systemPrompt,
            messages: [
                { role: 'user', content: userContent }
            ],
            max_tokens: 4000,
            temperature: 0.3
        })
    });

    if (!response.ok) {
        const err = await response.text();
        throw new Error(`API 请求失败 (${response.status}): ${err.substring(0, 200)}`);
    }

    const data = await response.json();
    return data.content[0].text;
}

// 从 AI 响应中解析 JSON
function parseAIJSON(text) {
    // 尝试直接解析
    try {
        return JSON.parse(text);
    } catch { }

    // 尝试从 markdown 代码块中提取
    const codeBlockMatch = text.match(/```(?:json)?\s*\n?([\s\S]*?)\n?```/);
    if (codeBlockMatch) {
        try {
            return JSON.parse(codeBlockMatch[1].trim());
        } catch { }
    }

    // 尝试找到 JSON 数组或对象
    const jsonMatch = text.match(/(\[\s*\{[\s\S]*\}\s*\]|\{[\s\S]*\})/);
    if (jsonMatch) {
        try {
            return JSON.parse(jsonMatch[1]);
        } catch { }
    }

    throw new Error('无法解析 AI 返回的 JSON 内容');
}


// ===== 配置弹窗控制 =====
function initAIConfig() {
    const modal = document.getElementById('aiConfigModal');
    const configBtn = document.getElementById('aiConfigBtn');
    const closeBtn = document.getElementById('closeConfigModal');
    const cancelBtn = document.getElementById('cancelConfigBtn');
    const saveBtn = document.getElementById('saveConfigBtn');
    const testBtn = document.getElementById('testApiBtn');
    const toggleKeyBtn = document.getElementById('toggleKeyBtn');
    const providerSelect = document.getElementById('cfgProvider');
    const resetExtractBtn = document.getElementById('resetExtractPrompt');
    const resetEvalBtn = document.getElementById('resetEvalPrompt');

    // 打开弹窗
    configBtn.addEventListener('click', () => {
        loadConfigToForm();
        modal.classList.add('active');
    });

    // 关闭弹窗
    const closeModal = () => modal.classList.remove('active');
    closeBtn.addEventListener('click', closeModal);
    cancelBtn.addEventListener('click', closeModal);
    modal.addEventListener('click', (e) => {
        if (e.target === modal) closeModal();
    });

    // ESC 关闭
    document.addEventListener('keydown', (e) => {
        if (e.key === 'Escape' && modal.classList.contains('active')) closeModal();
    });

    // 切换密码显示
    toggleKeyBtn.addEventListener('click', () => {
        const input = document.getElementById('cfgApiKey');
        input.type = input.type === 'password' ? 'text' : 'password';
        toggleKeyBtn.textContent = input.type === 'password' ? '👁️' : '🙈';
    });

    // 切换提供商时自动填充 URL 和模型
    providerSelect.addEventListener('change', () => {
        const provider = providerSelect.value;
        const urlInput = document.getElementById('cfgBaseUrl');
        const modelInput = document.getElementById('cfgModel');
        urlInput.value = AIConfig.PROVIDER_URLS[provider] || '';
        urlInput.placeholder = AIConfig.PROVIDER_URLS[provider] || '请输入 API 地址';
        modelInput.value = AIConfig.PROVIDER_MODELS[provider] || '';
        modelInput.placeholder = AIConfig.PROVIDER_MODELS[provider] || '请输入模型名称';
    });

    // 恢复默认提示词
    resetExtractBtn.addEventListener('click', () => {
        document.getElementById('cfgExtractPrompt').value = AIConfig.DEFAULT_EXTRACT_PROMPT;
        showToast('已恢复默认知识点提取提示词', 'info');
    });
    resetEvalBtn.addEventListener('click', () => {
        document.getElementById('cfgEvalPrompt').value = AIConfig.DEFAULT_EVAL_PROMPT;
        showToast('已恢复默认答案评估提示词', 'info');
    });

    // 保存配置
    saveBtn.addEventListener('click', () => {
        const config = {
            provider: document.getElementById('cfgProvider').value,
            baseUrl: document.getElementById('cfgBaseUrl').value.trim().replace(/\/$/, ''),
            apiKey: document.getElementById('cfgApiKey').value.trim(),
            model: document.getElementById('cfgModel').value.trim(),
            extractPrompt: document.getElementById('cfgExtractPrompt').value.trim() || AIConfig.DEFAULT_EXTRACT_PROMPT,
            evalPrompt: document.getElementById('cfgEvalPrompt').value.trim() || AIConfig.DEFAULT_EVAL_PROMPT
        };
        AIConfig.save(config);
        updateConfigStatus();
        closeModal();
        showToast('✅ AI 配置已保存', 'success');
    });

    // 测试连接
    testBtn.addEventListener('click', async () => {
        testBtn.disabled = true;
        testBtn.textContent = '⏳ 测试中...';

        // 临时使用表单中的配置
        const tempConfig = {
            provider: document.getElementById('cfgProvider').value,
            baseUrl: document.getElementById('cfgBaseUrl').value.trim().replace(/\/$/, ''),
            apiKey: document.getElementById('cfgApiKey').value.trim(),
            model: document.getElementById('cfgModel').value.trim(),
            extractPrompt: AIConfig.DEFAULT_EXTRACT_PROMPT,
            evalPrompt: AIConfig.DEFAULT_EVAL_PROMPT
        };

        // 临时保存配置用于测试
        const oldConfig = AIConfig.get();
        AIConfig.save(tempConfig);

        try {
            const result = await callAI('你是一个助手。', '请回复"连接成功"两个字。');
            showToast('✅ API 连接成功！回复：' + result.substring(0, 50), 'success');
            document.getElementById('configStatus').className = 'config-status connected';
        } catch (err) {
            showToast('❌ 连接失败：' + err.message, 'error');
            document.getElementById('configStatus').className = 'config-status error';
            // 恢复旧配置
            AIConfig.save(oldConfig);
        } finally {
            testBtn.disabled = false;
            testBtn.textContent = '🧪 测试连接';
        }
    });

    // 初始化状态指示灯
    updateConfigStatus();

    // 初始化日志 badge
    AILog.initBadge();

    // Tab 切换逻辑
    document.querySelectorAll('.modal-tab').forEach(tab => {
        tab.addEventListener('click', () => {
            // 切换 tab 高亮
            document.querySelectorAll('.modal-tab').forEach(t => t.classList.remove('active'));
            tab.classList.add('active');
            // 切换内容
            document.querySelectorAll('.modal-tab-content').forEach(c => c.classList.remove('active'));
            const tabMap = { config: 'tabConfig', logs: 'tabLogs', feishu: 'tabFeishu' };
            const targetId = tabMap[tab.dataset.tab] || 'tabConfig';
            document.getElementById(targetId)?.classList.add('active');
            // 切换到日志 tab 时刷新日志
            if (tab.dataset.tab === 'logs') {
                renderLogList();
            }
            // 切换到飞书 tab 时加载配置
            if (tab.dataset.tab === 'feishu') {
                FeishuSync.loadConfigToUI();
            }
        });
    });

    // 清除日志
    document.getElementById('clearLogsBtn').addEventListener('click', () => {
        AILog.clear();
        renderLogList();
        showToast('🗑️ 日志已清除', 'info');
    });

    // 日志 tab 关闭按钮
    document.getElementById('closeLogsBtn').addEventListener('click', closeModal);
}

// 加载配置到表单
function loadConfigToForm() {
    const config = AIConfig.get();
    document.getElementById('cfgProvider').value = config.provider;
    document.getElementById('cfgBaseUrl').value = config.baseUrl;
    document.getElementById('cfgApiKey').value = config.apiKey;
    document.getElementById('cfgModel').value = config.model;
    document.getElementById('cfgExtractPrompt').value = config.extractPrompt || AIConfig.DEFAULT_EXTRACT_PROMPT;
    document.getElementById('cfgEvalPrompt').value = config.evalPrompt || AIConfig.DEFAULT_EVAL_PROMPT;

    // 更新 placeholder
    const provider = config.provider;
    document.getElementById('cfgBaseUrl').placeholder = AIConfig.PROVIDER_URLS[provider] || '请输入 API 地址';
    document.getElementById('cfgModel').placeholder = AIConfig.PROVIDER_MODELS[provider] || '请输入模型名称';
}

// 更新状态指示灯
function updateConfigStatus() {
    const statusEl = document.getElementById('configStatus');
    if (AIConfig.isConfigured()) {
        statusEl.className = 'config-status connected';
    } else {
        statusEl.className = 'config-status';
    }
}

// 渲染日志列表（支持展开/收起详情）
function renderLogList() {
    const logs = AILog.getAll();
    const listEl = document.getElementById('logList');
    const infoEl = document.getElementById('logInfo');

    infoEl.textContent = `共 ${logs.length} 条日志`;

    if (logs.length === 0) {
        listEl.innerHTML = '<div class="log-empty">暂无 API 调用日志</div>';
        return;
    }

    const typeLabels = {
        extract: '知识提取',
        eval: '答案评估',
        test: '连接测试',
        api: 'API 调用'
    };

    const typeClasses = {
        extract: 'extract',
        eval: 'eval',
        test: '',
        api: ''
    };

    const providerLabels = {
        openai: 'OpenAI',
        claude: 'Claude',
        gemini: 'Gemini',
        deepseek: 'DeepSeek',
        custom: '自定义'
    };

    // 转义 HTML 特殊字符
    const escHtml = (str) => (str || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

    listEl.innerHTML = logs.map((log, idx) => {
        const time = new Date(log.time).toLocaleString('zh-CN', {
            year: 'numeric', month: '2-digit', day: '2-digit',
            hour: '2-digit', minute: '2-digit', second: '2-digit'
        });
        const typeLabel = typeLabels[log.type] || log.type;
        const typeClass = log.status === 'error' ? 'error' : (typeClasses[log.type] || '');
        const duration = log.duration ? `${(log.duration / 1000).toFixed(2)}s` : '-';
        const providerName = providerLabels[log.provider] || log.provider || '-';

        // 摘要行（始终显示）
        let summaryLine = '';
        if (log.status === 'success') {
            summaryLine = `
                <div class="log-item-detail">
                    <span class="log-label">提供商:</span> ${providerName} · 
                    <span class="log-label">模型:</span> ${log.model || '-'} · 
                    <span class="log-label">耗时:</span> ${duration} · 
                    <span class="log-label">输入:</span> ${log.inputLength || 0}字 · 
                    <span class="log-label">输出:</span> ${log.outputLength || 0}字
                </div>
            `;
        } else {
            summaryLine = `
                <div class="log-item-detail">
                    <span class="log-label">提供商:</span> ${providerName} · 
                    <span class="log-label">模型:</span> ${log.model || '-'} · 
                    <span class="log-label">耗时:</span> ${duration}
                </div>
                <div class="log-item-error">❌ ${escHtml(log.error || '未知错误')}</div>
            `;
        }

        // 详情区（点击展开）
        let detailSection = `
            <div class="log-detail-section" id="logDetail_${idx}" style="display:none;">
                <div class="log-detail-block">
                    <div class="log-detail-title">🌐 请求地址</div>
                    <div class="log-detail-content">${escHtml(log.apiUrl || '-')}</div>
                </div>
                <div class="log-detail-block">
                    <div class="log-detail-title">📤 系统提示词</div>
                    <pre class="log-detail-pre">${escHtml(log.systemPrompt || '-')}</pre>
                </div>
                <div class="log-detail-block">
                    <div class="log-detail-title">📥 用户输入 (${log.inputLength || 0}字)</div>
                    <pre class="log-detail-pre">${escHtml(log.userInput || '-')}</pre>
                </div>
        `;

        if (log.status === 'success' && log.fullResponse) {
            detailSection += `
                <div class="log-detail-block">
                    <div class="log-detail-title">🤖 AI 响应 (${log.outputLength || 0}字)</div>
                    <pre class="log-detail-pre">${escHtml(log.fullResponse)}</pre>
                </div>
            `;
        }
        if (log.status === 'error' && log.error) {
            detailSection += `
                <div class="log-detail-block">
                    <div class="log-detail-title">❌ 错误信息</div>
                    <pre class="log-detail-pre log-detail-error">${escHtml(log.error)}</pre>
                </div>
            `;
        }
        detailSection += '</div>';

        return `
            <div class="log-item" onclick="toggleLogDetail(${idx})" style="cursor:pointer;">
                <div class="log-item-header">
                    <span class="log-item-type ${typeClass}">${log.status === 'success' ? '✅' : '❌'} ${typeLabel}</span>
                    <span class="log-item-time">${time}</span>
                </div>
                ${summaryLine}
                <div class="log-expand-hint" id="logHint_${idx}">👇 点击展开详情</div>
                ${detailSection}
            </div>
        `;
    }).join('');
}

// 切换日志详情展开/收起
function toggleLogDetail(idx) {
    const detailEl = document.getElementById(`logDetail_${idx}`);
    const hintEl = document.getElementById(`logHint_${idx}`);
    if (!detailEl) return;
    const isVisible = detailEl.style.display !== 'none';
    detailEl.style.display = isVisible ? 'none' : 'block';
    if (hintEl) hintEl.textContent = isVisible ? '👇 点击展开详情' : '👆 点击收起';
}


// ===== UI 控制器 =====

// 当前状态
let currentPage = 'input';
let currentTopicId = null;
let currentKnowledgePoints = [];

// 初始化
document.addEventListener('DOMContentLoaded', () => {
    // ===== 飞书登录初始化 =====
    if (typeof FeishuAuth !== 'undefined') {
        const overlay = document.getElementById('loginOverlay');
        const logoutBtn = document.getElementById('logoutBtn');

        // 1. 处理 OAuth 回调
        FeishuAuth.handleCallback();

        // 绑定退出按钮
        if (logoutBtn) {
            logoutBtn.onclick = function (e) {
                e.preventDefault();
                FeishuAuth.logout();
            };
        }

        // 2. 检查登录状态
        if (FeishuAuth.isLoggedIn()) {
            // 已登录：隐藏遮罩，显示退出按钮
            if (overlay) overlay.style.display = 'none';
            if (logoutBtn) logoutBtn.style.display = 'flex';
        } else {
            // 未登录：显示遮罩
            if (overlay) {
                overlay.style.display = 'flex';
                document.body.style.overflow = 'hidden';
            }
        }

        // 3. 绑定登录页事件
        document.getElementById('feishuLoginBtn')?.addEventListener('click', () => {
            FeishuAuth.login();
        });

        // 全局捕获阶段监听退出点击
        window.addEventListener('click', (e) => {
            if (e.target && (e.target.id === 'logoutBtn' || e.target.closest('#logoutBtn'))) {
                e.preventDefault();
                e.stopPropagation();
                FeishuAuth.logout();
            }
        }, true);

        document.getElementById('guestLogin')?.addEventListener('click', () => {
            if (overlay) overlay.style.display = 'none';
            document.body.style.overflow = '';
            // 游客模式：显示退出按钮
            if (logoutBtn) logoutBtn.style.display = 'flex';
        });
    }

    // 初始化 Config UI
    initAIConfig();
    initNavigation();
    initCRUD();
    initConfirmModal();
    initInputPage();
    updateStats();
    updateReviewBadge();
    renderDashboard();
    renderKnowledgeGraph();
    renderReviewPage();
});

// ===== 导航 =====
function initNavigation() {
    // 侧边栏导航点击
    document.querySelectorAll('.nav-item').forEach(item => {
        item.addEventListener('click', (e) => {
            e.preventDefault();
            const page = item.dataset.page;
            switchPage(page);
        });
    });

    // 侧边栏折叠
    document.getElementById('sidebarToggle').addEventListener('click', () => {
        document.getElementById('sidebar').classList.toggle('collapsed');
    });

    // 侧边栏展开按钮（收起后恢复）
    document.getElementById('sidebarExpandBtn').addEventListener('click', () => {
        document.getElementById('sidebar').classList.remove('collapsed');
    });

    // 移动端菜单
    document.getElementById('mobileMenuBtn').addEventListener('click', () => {
        document.getElementById('sidebar').classList.add('open');
        document.getElementById('overlay').classList.add('active');
    });

    document.getElementById('overlay').addEventListener('click', () => {
        document.getElementById('sidebar').classList.remove('open');
        document.getElementById('overlay').classList.remove('active');
    });
}

function switchPage(pageName) {
    currentPage = pageName;

    // 更新导航高亮
    document.querySelectorAll('.nav-item').forEach(item => {
        item.classList.toggle('active', item.dataset.page === pageName);
    });

    // 切换页面显示
    document.querySelectorAll('.page').forEach(page => {
        page.classList.toggle('active', page.id === `page-${pageName}`);
    });

    // 页面切换时刷新数据
    if (pageName === 'dashboard') renderDashboard();
    if (pageName === 'knowledge') renderKnowledgeGraph();
    if (pageName === 'review') renderReviewPage();
    if (pageName === 'practice') renderPracticePage();

    // 移动端关闭侧边栏
    document.getElementById('sidebar').classList.remove('open');
    document.getElementById('overlay').classList.remove('active');
}

// ===== 输入学习页面 =====
function initInputPage() {
    const textarea = document.getElementById('articleInput');
    const analyzeBtn = document.getElementById('analyzeBtn');
    const charCount = document.getElementById('charCount');

    // 字符计数
    textarea.addEventListener('input', () => {
        charCount.textContent = textarea.value.length;
    });

    // AI 分析按钮
    analyzeBtn.addEventListener('click', handleAnalyze);

    // 开始费曼检验按钮
    document.getElementById('startPracticeBtn').addEventListener('click', () => {
        if (currentKnowledgePoints.length > 0) {
            startFeynmanTest(currentKnowledgePoints);
            switchPage('practice');
        }
    });
}

// 处理 AI 分析
async function handleAnalyze() {
    const content = document.getElementById('articleInput').value.trim();
    const title = document.getElementById('articleTitle').value.trim() || '未命名学习';

    // 检查标题是否重复
    const existingTopics = DB.getAll().topics;
    if (existingTopics.some(t => t.title === title)) {
        showToast('该主题名称已存在，请使用其他名称', 'error');
        return;
    }

    if (!content) {
        showToast('请先输入学习内容', 'error');
        return;
    }

    if (content.length < 50) {
        showToast('内容太短，建议输入至少50个字', 'error');
        return;
    }

    const btn = document.getElementById('analyzeBtn');
    btn.disabled = true;
    btn.classList.add('btn-loading');
    btn.innerHTML = '<span class="btn-icon">⏳</span> AI 分析中...';

    try {
        const knowledgePoints = await extractKnowledgePoints(content);

        // 保存到数据库
        const topic = DB.addTopic(title, content);
        currentTopicId = topic.id;
        currentKnowledgePoints = [];

        knowledgePoints.forEach(kp => {
            const saved = DB.addKnowledgePoint(topic.id, kp.title, kp.description);
            currentKnowledgePoints.push(saved);
        });

        // 渲染知识点
        renderKnowledgeList(currentKnowledgePoints);
        document.getElementById('knowledgeResult').classList.remove('hidden');

        updateStats();
        showToast(`成功提取 ${knowledgePoints.length} 个知识点！`, 'success');

    } catch (err) {
        showToast('分析失败：' + err.message, 'error');
    } finally {
        btn.disabled = false;
        btn.classList.remove('btn-loading');
        btn.innerHTML = '<span class="btn-icon">✨</span> AI 提取知识点';
    }
}

// 智能提取知识点（AI 优先，失败回退本地分析）
async function extractKnowledgePoints(text) {
    // 优先使用 AI API
    if (AIConfig.isConfigured()) {
        try {
            const config = AIConfig.get();
            const prompt = config.extractPrompt || AIConfig.DEFAULT_EXTRACT_PROMPT;
            const response = await callAI(prompt, text, 'extract');
            const points = parseAIJSON(response);

            if (Array.isArray(points) && points.length > 0) {
                // 验证格式正确
                const valid = points.filter(p => p.title && typeof p.title === 'string');
                if (valid.length > 0) {
                    showToast('✨ AI 已完成知识点提取', 'success');
                    return valid.slice(0, 15);
                }
            }
            throw new Error('AI 返回格式不正确');
        } catch (err) {
            console.warn('AI 提取失败，回退到本地分析：', err.message);
            showToast('AI 提取失败，使用本地分析: ' + err.message, 'info');
        }
    }

    // 本地文本分析兜底
    return extractKnowledgePointsLocal(text);
}

// 本地文本分析提取知识点
function extractKnowledgePointsLocal(text) {
    const points = [];
    const lines = text.split('\n').filter(l => l.trim());

    const titlePatterns = [
        /^#{1,4}\s+(.+)/,
        /^(\d+[\.\、\)）])\s*(.+)/,
        /^[一二三四五六七八九十]+[\.\、]/,
        /^\*\*(.+)\*\*/,
        /^[•\-\*]\s*\*\*(.+)\*\*/,
    ];

    let currentTitle = '';
    let currentDesc = '';

    for (const line of lines) {
        let isTitle = false;
        let titleText = '';

        for (const pattern of titlePatterns) {
            const match = line.match(pattern);
            if (match) {
                isTitle = true;
                titleText = match[match.length - 1] || match[1];
                titleText = titleText.replace(/\*\*/g, '').replace(/[#\*]/g, '').trim();
                break;
            }
        }

        if (isTitle && titleText.length > 2 && titleText.length < 80) {
            if (currentTitle) {
                points.push({ title: currentTitle, description: currentDesc.trim() });
            }
            currentTitle = titleText;
            currentDesc = '';
        } else if (currentTitle) {
            const cleanLine = line.replace(/^[\s\-\*•]+/, '').trim();
            if (cleanLine.length > 5) {
                currentDesc += (currentDesc ? '\n' : '') + cleanLine;
            }
        }
    }

    if (currentTitle) {
        points.push({ title: currentTitle, description: currentDesc.trim() });
    }

    if (points.length === 0) {
        const paragraphs = text.split(/\n\s*\n/).filter(p => p.trim().length > 20);
        paragraphs.forEach((p, i) => {
            const firstLine = p.trim().split('\n')[0].substring(0, 60);
            const rest = p.trim().split('\n').slice(1).join('\n');
            points.push({
                title: `知识点 ${i + 1}：${firstLine}`,
                description: rest || p.trim()
            });
        });
    }

    return points.slice(0, 15);
}

// 渲染知识点列表
function renderKnowledgeList(points) {
    const container = document.getElementById('knowledgeList');
    container.innerHTML = points.map((kp, i) => `
        <div class="knowledge-item" data-id="${kp.id}">
            <div class="knowledge-number">${i + 1}</div>
            <div class="knowledge-content">
                <div class="knowledge-title">${escapeHtml(kp.title)}</div>
                <div class="knowledge-desc">${escapeHtml(kp.description).substring(0, 150)}${kp.description.length > 150 ? '...' : ''}</div>
                <div class="knowledge-mastery">
                    <div class="mastery-bar">
                        <div class="mastery-fill ${getMasteryClass(kp.mastery)}" style="width: ${kp.mastery}%"></div>
                    </div>
                    <span class="mastery-text">${kp.mastery}% 掌握</span>
                </div>
            </div>
        </div>
    `).join('');
}

// ===== 费曼检验 =====

// 渲染费曼检验页面（从 DB 加载历史练习记录）
function renderPracticePage() {
    const container = document.getElementById('practiceContainer');
    const data = DB.getAll();

    // 如果正在进行新的费曼检验（已有内容且有未提交的答案卡片），保持不动
    if (container.querySelector('.practice-card') && container.querySelector('.submit-answer-btn:not([disabled])')) {
        return;
    }

    // 检查是否有练习记录
    if (data.practices.length === 0 && data.knowledgePoints.length === 0) {
        container.innerHTML = `
            <div class="empty-state">
                <div class="empty-icon">🎯</div>
                <h3>暂无练习题</h3>
                <p>先在「输入学习」中提取知识点，然后开始费曼检验</p>
                <button class="btn btn-primary" onclick="switchPage('input')">去输入学习</button>
            </div>
        `;
        return;
    }

    // 按主题分组展示历史练习记录
    const practicesByTopic = {};
    data.practices.forEach(p => {
        const kp = data.knowledgePoints.find(k => k.id === p.knowledgePointId);
        if (!kp) return;
        const topic = data.topics.find(t => t.id === kp.topicId);
        const topicTitle = topic ? topic.title : '未分类';
        if (!practicesByTopic[topicTitle]) practicesByTopic[topicTitle] = [];
        practicesByTopic[topicTitle].push({ practice: p, kp });
    });

    const topicNames = Object.keys(practicesByTopic);

    if (topicNames.length === 0 && data.knowledgePoints.length > 0) {
        // 有知识点但没做过练习
        container.innerHTML = `
            <div class="empty-state">
                <div class="empty-icon">🎯</div>
                <h3>还没有练习记录</h3>
                <p>你已有 ${data.knowledgePoints.length} 个知识点，去知识图谱选择一个开始费曼检验吧</p>
                <button class="btn btn-primary" onclick="switchPage('knowledge')">去知识图谱</button>
            </div>
        `;
        return;
    }

    // 渲染历史练习记录
    container.innerHTML = `
        <div class="practice-history-header">
            <h3>📚 费曼检验记录</h3>
            <span class="practice-history-count">共 ${data.practices.length} 次练习</span>
        </div>
        ${topicNames.map(topicName => {
        const items = practicesByTopic[topicName];
        return `
                <div class="practice-history-group">
                    <div class="practice-history-topic">📘 ${escapeHtml(topicName)} · ${items.length} 次练习</div>
                    ${items.reverse().map((item, idx) => renderCompletedPractice(item.practice, item.kp, idx)).join('')}
                </div>
            `;
    }).join('')}
    `;
}

// 渲染已完成的练习卡片（历史记录）
function renderCompletedPractice(practice, kp, idx) {
    const score = practice.score;
    const scoreClass = score >= 80 ? 'score-high' : score >= 60 ? 'score-medium' : 'score-low';
    const scoreLabel = score >= 80 ? '掌握良好' : score >= 60 ? '基本掌握' : '需要加强';
    const time = new Date(practice.createdAt).toLocaleString('zh-CN', {
        month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit'
    });

    const evaluation = practice.feedback || {};
    const feedbackList = Array.isArray(evaluation.feedback) ? evaluation.feedback :
        (typeof evaluation === 'string' ? [evaluation] : []);
    const correctList = Array.isArray(evaluation.correct) ?
        evaluation.correct.filter(c => typeof c === 'string' && c.startsWith('✅')) : [];
    const uniqueId = `hist_${practice.id}_${idx}`;

    return `
        <div class="practice-card completed" onclick="toggleHistoryDetail('${uniqueId}')" style="cursor:pointer;">
            <div class="practice-question">
                <div class="question-meta">
                    <span class="eval-score-circle ${scoreClass}" style="width:36px;height:36px;font-size:0.85rem;">${score}</span>
                    <span class="question-from">${escapeHtml(kp.title)}</span>
                    <span class="practice-time">${time}</span>
                </div>
                <div class="question-text">${escapeHtml(practice.question || kp.title)}</div>
            </div>
            <div class="practice-history-detail" id="${uniqueId}" style="display:none;">
                <div class="practice-answer-display">
                    <div class="answer-label">📝 我的回答：</div>
                    <div class="answer-text">${escapeHtml(practice.answer)}</div>
                </div>
                ${feedbackList.length > 0 || correctList.length > 0 ? `
                    <div class="evaluation-result">
                        <div class="eval-score">
                            <div class="eval-score-circle ${scoreClass}">${score}</div>
                            <div class="eval-score-info">
                                <h4>${scoreLabel}</h4>
                            </div>
                        </div>
                        <div class="eval-details">
                            ${feedbackList.map(f => `
                                <div class="eval-detail-item">
                                    <span class="eval-detail-icon">${f.charAt(0)}</span>
                                    <span>${escapeHtml(f.substring(2))}</span>
                                </div>
                            `).join('')}
                            ${correctList.map(c => `
                                <div class="eval-detail-item">
                                    <span class="eval-detail-icon">✅</span>
                                    <span>${escapeHtml(c.substring(2))}</span>
                                </div>
                            `).join('')}
                        </div>
                    </div>
                ` : ''}
            </div>
            <div class="log-expand-hint">👇 点击查看详情</div>
        </div>
    `;
}

// 切换历史练习详情展开/收起
function toggleHistoryDetail(id) {
    const el = document.getElementById(id);
    if (!el) return;
    const isVisible = el.style.display !== 'none';
    el.style.display = isVisible ? 'none' : 'block';
    // 更新提示文字
    const hint = el.closest('.practice-card').querySelector('.log-expand-hint');
    if (hint) hint.textContent = isVisible ? '👇 点击查看详情' : '👆 点击收起';
}

function startFeynmanTest(knowledgePoints) {
    const container = document.getElementById('practiceContainer');

    const questions = knowledgePoints.map(kp => {
        const difficulty = kp.mastery >= 70 ? 'hard' : (kp.mastery >= 40 ? 'medium' : 'easy');
        return generateQuestion(kp, difficulty);
    });

    container.innerHTML = `
        <div class="practice-progress">
            <div class="progress-text">
                共 <strong>${questions.length}</strong> 道题目，请用自己的话回答
            </div>
        </div>
        ${questions.map((q, i) => renderPracticeCard(q, i)).join('')}
    `;

    // 绑定提交事件
    container.querySelectorAll('.submit-answer-btn').forEach(btn => {
        btn.addEventListener('click', handleSubmitAnswer);
    });
}

function generateQuestion(kp, difficulty) {
    const templates = {
        easy: [
            `请用自己的话解释：「${kp.title}」是什么？`,
            `用最简单的语言描述一下你理解的「${kp.title}」`,
            `假设你要向一个小学生解释「${kp.title}」，你会怎么说？`
        ],
        medium: [
            `「${kp.title}」解决了什么问题？没有它会怎样？`,
            `请举一个生活中的例子来说明「${kp.title}」的原理`,
            `「${kp.title}」和你之前学过的什么知识有关联？请说明`
        ],
        hard: [
            `「${kp.title}」有哪些局限性或缺点？如何改进？`,
            `在什么场景下不应该使用「${kp.title}」？为什么？`,
            `如果要把「${kp.title}」应用到一个新的领域，你会怎么做？`
        ]
    };

    const qList = templates[difficulty] || templates.easy;
    const questionText = qList[Math.floor(Math.random() * qList.length)];

    return {
        knowledgePointId: kp.id,
        knowledgePoint: kp,
        difficulty,
        question: questionText
    };
}

function renderPracticeCard(q, index) {
    const difficultyMap = { easy: '入门', medium: '进阶', hard: '挑战' };
    const difficultyClass = `difficulty-${q.difficulty}`;

    return `
        <div class="practice-card" data-index="${index}" data-kp-id="${q.knowledgePointId}">
            <div class="practice-question">
                <div class="question-meta">
                    <span class="question-difficulty ${difficultyClass}">${difficultyMap[q.difficulty]}</span>
                    <span class="question-from">来自：${escapeHtml(q.knowledgePoint.title)}</span>
                </div>
                <div class="question-text">${escapeHtml(q.question)}</div>
            </div>
            <div class="practice-answer">
                <textarea class="answer-input" id="answer-${index}" 
                    placeholder="用你自己的话回答这个问题...&#10;&#10;提示：不需要背诵原文，用自己的理解来表达"></textarea>
                <div class="answer-actions">
                    <span class="answer-hint">💡 费曼学习法：能用简单的话说清楚，才是真正理解了</span>
                    <button class="btn btn-primary submit-answer-btn" data-index="${index}" data-kp-id="${q.knowledgePointId}">
                        <span class="btn-icon">📝</span>
                        提交答案
                    </button>
                </div>
                <div class="evaluation-container" id="eval-${index}"></div>
            </div>
        </div>
    `;
}

// 处理答案提交
async function handleSubmitAnswer(e) {
    const btn = e.currentTarget;
    const index = btn.dataset.index;
    const kpId = btn.dataset.kpId;
    const answer = document.getElementById(`answer-${index}`).value.trim();

    if (!answer) {
        showToast('请先写下你的理解', 'error');
        return;
    }

    if (answer.length < 10) {
        showToast('回答太简短了，试着多解释一些', 'error');
        return;
    }

    btn.disabled = true;
    btn.innerHTML = '<span class="btn-icon">⏳</span> AI 评估中...';

    try {
        const data = DB.getAll();
        const kp = data.knowledgePoints.find(k => k.id === kpId);

        // 评估答案（AI 优先，失败回退本地）
        const evaluation = await evaluateAnswer(answer, kp);

        // 保存练习记录
        DB.addPractice(kpId, kp.title, answer, evaluation.score, evaluation);

        // 渲染评估结果
        renderEvaluation(index, evaluation);

        updateStats();
        updateReviewBadge();

        const msg = evaluation.score >= 80 ? '回答得很好！' :
            evaluation.score >= 60 ? '基本理解了，还可以更好' :
                '需要再深入理解一下';
        showToast(`得分 ${evaluation.score}分 - ${msg}`, evaluation.score >= 60 ? 'success' : 'info');

    } catch (err) {
        showToast('评估失败：' + err.message, 'error');
    } finally {
        btn.disabled = false;
        btn.innerHTML = '<span class="btn-icon">📝</span> 重新提交';

        // 标记已提交状态：禁用 textarea，显示已完成状态
        const card = btn.closest('.practice-card');
        if (card) card.classList.add('completed');
    }
}

// 评估答案（AI 优先，失败回退本地）
async function evaluateAnswer(answer, kp) {
    // 优先使用 AI API
    if (AIConfig.isConfigured()) {
        try {
            const config = AIConfig.get();
            let prompt = config.evalPrompt || AIConfig.DEFAULT_EVAL_PROMPT;

            // 替换模板变量
            prompt = prompt
                .replace(/\{\{title\}\}/g, kp.title)
                .replace(/\{\{description\}\}/g, kp.description || '暂无详细描述')
                .replace(/\{\{answer\}\}/g, answer);

            const response = await callAI(prompt, `知识点：${kp.title}\n描述：${kp.description || ''}\n\n学生回答：${answer}`, 'eval');
            const result = parseAIJSON(response);

            // 验证返回格式
            if (typeof result.score === 'number' && Array.isArray(result.feedback)) {
                result.score = Math.min(100, Math.max(0, Math.round(result.score)));
                result.correct = result.correct || [];
                result.missing = (result.missing || []).slice(0, 5);
                return result;
            }
            throw new Error('AI 返回格式不正确');
        } catch (err) {
            console.warn('AI 评估失败，回退到本地评估：', err.message);
            showToast('AI 评估失败，使用本地评估', 'info');
        }
    }

    // 本地评估兜底
    return evaluateAnswerLocal(answer, kp);
}

// 本地评估逻辑（兜底方案）
function evaluateAnswerLocal(answer, kp) {
    let score = 0;
    const feedback = [];
    const correct = [];
    const missing = [];

    const len = answer.length;
    if (len >= 30 && len <= 500) score += 20;
    else if (len > 500) score += 15;
    else score += Math.floor(len / 30 * 10);

    const descWords = (kp.description || '').split(/[\s，、。！？；：""''（）\n]+/).filter(w => w.length > 1);
    const titleWords = kp.title.split(/[\s，、。！？；：""''（）]+/).filter(w => w.length > 1);
    const allKeywords = [...new Set([...descWords, ...titleWords])].filter(w => w.length >= 2);

    let matched = 0;
    allKeywords.forEach(kw => {
        if (answer.includes(kw)) {
            matched++;
            correct.push(kw);
        } else if (kw.length >= 3) {
            missing.push(kw);
        }
    });

    const coverage = allKeywords.length > 0 ? matched / allKeywords.length : 0;
    score += Math.floor(coverage * 40);

    if (kp.description) {
        const similarity = calculateSimilarity(answer, kp.description);
        if (similarity < 0.7) {
            score += 20;
            correct.push('✅ 使用了自己的语言表达');
        } else {
            score += 5;
            feedback.push('⚠️ 建议用更多自己的话来表达理解，而不是照搬原文');
        }
    } else {
        score += 15;
    }

    const hasExample = /比如|例如|就像|类似于|可以理解为|打个比方|相当于/.test(answer);
    if (hasExample) {
        score += 15;
        correct.push('✅ 使用了举例或类比来说明');
    } else {
        feedback.push('💡 试着用一个生活中的例子来类比，会帮助加深理解');
    }

    const hasStructure = answer.includes('\n') || /[：:;；]/.test(answer) || /第?[一二三1-9]/.test(answer);
    if (hasStructure) {
        score += 5;
        correct.push('✅ 回答有条理、有结构');
    }

    score = Math.min(100, Math.max(0, score));

    if (score >= 85) {
        feedback.unshift('🎉 非常棒！你对这个知识点有很深的理解');
    } else if (score >= 70) {
        feedback.unshift('👍 理解得不错，还有一些细节可以补充');
    } else if (score >= 50) {
        feedback.unshift('📖 基本理解了概念，但需要更深入的思考');
    } else {
        feedback.unshift('💪 还需要再学习一下，建议重新阅读相关内容');
    }

    if (missing.length > 0 && missing.length <= 5) {
        feedback.push('📝 这些关键概念可以关注一下：' + missing.slice(0, 5).join('、'));
    }

    return { score, feedback, correct, missing: missing.slice(0, 5) };
}

// 简单的文本相似度计算
function calculateSimilarity(text1, text2) {
    const set1 = new Set(text1.split(''));
    const set2 = new Set(text2.split(''));
    const intersection = new Set([...set1].filter(x => set2.has(x)));
    const union = new Set([...set1, ...set2]);
    return intersection.size / union.size;
}

// 渲染评估结果
function renderEvaluation(index, evaluation) {
    const container = document.getElementById(`eval-${index}`);
    const scoreClass = evaluation.score >= 80 ? 'score-high' :
        evaluation.score >= 60 ? 'score-medium' : 'score-low';
    const scoreLabel = evaluation.score >= 80 ? '掌握良好' :
        evaluation.score >= 60 ? '基本掌握' : '需要加强';

    container.innerHTML = `
        <div class="evaluation-result">
            <div class="eval-score">
                <div class="eval-score-circle ${scoreClass}">${evaluation.score}</div>
                <div class="eval-score-info">
                    <h4>${scoreLabel}</h4>
                    <p>系统将根据遗忘曲线安排复习</p>
                </div>
            </div>
            <div class="eval-details">
                ${evaluation.feedback.map(f => `
                    <div class="eval-detail-item">
                        <span class="eval-detail-icon">${f.charAt(0)}</span>
                        <span>${escapeHtml(f.substring(2))}</span>
                    </div>
                `).join('')}
                ${evaluation.correct.filter(c => c.startsWith('✅')).map(c => `
                    <div class="eval-detail-item">
                        <span class="eval-detail-icon">✅</span>
                        <span>${escapeHtml(c.substring(2))}</span>
                    </div>
                `).join('')}
            </div>
        </div>
    `;
}

// ===== 知识图谱页面 =====
let currentKnowledgeTopicId = 'all'; // 当前选中的知识图谱主题

function renderKnowledgeGraph() {
    const container = document.getElementById('knowledgeGraph');
    const data = DB.getAll();

    if (data.topics.length === 0) {
        container.innerHTML = `
            <div class="empty-state">
                <div class="empty-icon">📚</div>
                <h3>还没有知识点</h3>
                <p>去「输入学习」页面添加你的第一份学习材料吧</p>
                <button class="btn btn-primary" onclick="switchPage('input')">开始学习</button>
            </div>
        `;
        return;
    }

    // 渲染 Tabs 和 内容容器
    container.innerHTML = `
        <div class="topic-tabs" id="topicTabs"></div>
        <div id="topicContent"></div>
    `;

    renderTopicTabs(data.topics);
    renderTopicContent(data.topics, data.knowledgePoints);
}

// 渲染主题 Tabs
function renderTopicTabs(topics) {
    const container = document.getElementById('topicTabs');
    if (!container) return;

    container.innerHTML = ''; // Clear first

    // "全部" Tab
    const allTab = document.createElement('div');
    allTab.className = `topic-tab ${currentKnowledgeTopicId === 'all' ? 'active' : ''}`;
    allTab.textContent = '全部';
    allTab.onclick = () => switchKnowledgeTab('all');
    container.appendChild(allTab);

    // 各个 Topic Tabs
    topics.forEach(topic => {
        const tab = document.createElement('div');
        tab.className = `topic-tab ${currentKnowledgeTopicId === topic.id ? 'active' : ''}`;
        tab.textContent = topic.title.length > 10 ? topic.title.substring(0, 10) + '...' : topic.title;
        tab.title = topic.title;
        tab.onclick = () => switchKnowledgeTab(topic.id);
        container.appendChild(tab);
    });

    // 新增主题按钮
    const addBtn = document.createElement('div');
    addBtn.className = 'topic-tab topic-tab-add';
    addBtn.innerHTML = '+';
    addBtn.title = '新增主题';
    addBtn.onclick = (e) => {
        e.stopPropagation();
        showCrudModal('topic');
    };
    container.appendChild(addBtn);
}

// 切换 Tab
function switchKnowledgeTab(topicId) {
    if (currentKnowledgeTopicId === topicId) return;
    currentKnowledgeTopicId = topicId;

    // 更新 Tab 高亮
    document.querySelectorAll('.topic-tab').forEach(tab => {
        if (tab.classList.contains('topic-tab-add')) return;
        tab.classList.toggle('active',
            (topicId === 'all' && tab.textContent === '全部') ||
            (topicId !== 'all' && tab.title === DB.getAll().topics.find(t => t.id === topicId)?.title)
        );
    });

    // 重新渲染内容
    const data = DB.getAll();
    renderTopicContent(data.topics, data.knowledgePoints);
}

// 渲染知识点内容
function renderTopicContent(topics, knowledgePoints) {
    const container = document.getElementById('topicContent');
    if (!container) return;

    let topicsToShow = topics;
    if (currentKnowledgeTopicId !== 'all') {
        topicsToShow = topics.filter(t => t.id === currentKnowledgeTopicId);
    }

    if (topicsToShow.length === 0) {
        container.innerHTML = '<div class="empty-state"><p>该主题下暂无知识点</p></div>';
        return;
    }

    container.innerHTML = topicsToShow.map(topic => {
        const kps = knowledgePoints.filter(kp => kp.topicId === topic.id);
        if (kps.length === 0 && currentKnowledgeTopicId !== 'all') {
            // 单主题视图下的空状态
            return `
                <div class="topic-group">
                    <div class="topic-group-header">
                        <div class="topic-group-title">📘 ${escapeHtml(topic.title)}</div>
                        <div class="topic-actions">
                             <button class="btn-icon-sm" onclick="showCrudModal('topic', '${topic.id}')" title="编辑主题">✏️</button>
                             <button class="btn-icon-sm" onclick="handleCrudDelete('topic', '${topic.id}')" title="删除主题">🗑️</button>
                        </div>
                    </div>
                    <div class="empty-state" style="padding:20px 0;">
                        <p>暂无知识点</p>
                        <button class="btn btn-sm btn-outline" onclick="showCrudModal('kp', null, '${topic.id}')">+ 添加知识点</button>
                    </div>
                </div>`;
        }
        if (kps.length === 0) return ''; // "全部"模式下不显示空主题

        const avgMastery = kps.length > 0
            ? Math.round(kps.reduce((sum, k) => sum + k.mastery, 0) / kps.length)
            : 0;

        return `
            <div class="topic-group">
                <div class="topic-group-header">
                    <div class="topic-group-title">📘 ${escapeHtml(topic.title)}</div>
                    <div class="topic-group-meta">
                        <span class="topic-group-count">${kps.length} 个知识点 · 掌握度 ${avgMastery}%</span>
                        <div class="topic-actions">
                             <button class="btn-icon-sm" onclick="showCrudModal('topic', '${topic.id}')" title="编辑主题">✏️</button>
                             <button class="btn-icon-sm" onclick="handleCrudDelete('topic', '${topic.id}')" title="删除主题">🗑️</button>
                             <button class="btn-icon-sm" onclick="showCrudModal('kp', null, '${topic.id}')" title="添加知识点">➕</button>
                        </div>
                    </div>
                </div>
                <div class="topic-group-items">
                    ${kps.map(kp => `
                        <div class="topic-card" onclick="quickReview('${kp.id}')">
                            <div class="topic-card-header">
                                <div class="topic-card-title">${escapeHtml(kp.title)}</div>
                                <div class="card-actions">
                                    <button class="btn-icon-xs" onclick="event.stopPropagation(); showCrudModal('kp', '${kp.id}', '${topic.id}')">✏️</button>
                                    <button class="btn-icon-xs" onclick="event.stopPropagation(); handleCrudDelete('kp', '${kp.id}')">🗑️</button>
                                </div>
                            </div>
                            <div class="topic-card-desc">${escapeHtml(kp.description || '暂无描述')}</div>
                            <div class="topic-card-footer">
                                <div class="knowledge-mastery">
                                    <div class="mastery-bar">
                                        <div class="mastery-fill ${getMasteryClass(kp.mastery)}" style="width: ${kp.mastery}%"></div>
                                    </div>
                                    <span class="mastery-text">${kp.mastery}%</span>
                                </div>
                                <span class="mastery-text">复习 ${kp.reviewCount} 次</span>
                            </div>
                        </div>
                    `).join('')}
                </div>
            </div>
        `;
    }).join('');
}

// 快速复习某个知识点
function quickReview(kpId) {
    const data = DB.getAll();
    const kp = data.knowledgePoints.find(k => k.id === kpId);
    if (!kp) return;

    currentKnowledgePoints = [kp];
    startFeynmanTest([kp]);
    switchPage('practice');
}

// ===== 复习页面 =====
function renderReviewPage() {
    const container = document.getElementById('reviewContainer');
    const dueItems = DB.getReviewDue();
    const data = DB.getAll();

    if (dueItems.length === 0) {
        // 检查是否有任何知识点
        if (data.knowledgePoints.length === 0) {
            container.innerHTML = `
                <div class="empty-state">
                    <div class="empty-icon">📚</div>
                    <h3>还没有学习内容</h3>
                    <p>先去「输入学习」添加学习材料，完成费曼检验后系统会自动安排复习</p>
                    <button class="btn btn-primary" onclick="switchPage('input')">去学习</button>
                </div>
            `;
        } else {
            // 显示即将到期的复习
            const upcoming = data.knowledgePoints
                .filter(kp => kp.nextReview)
                .sort((a, b) => new Date(a.nextReview) - new Date(b.nextReview))
                .slice(0, 5);

            container.innerHTML = `
                <div class="empty-state">
                    <div class="empty-icon">🎉</div>
                    <h3>今日复习全部完成！</h3>
                    <p>保持良好的复习习惯，知识才能真正内化</p>
                </div>
                ${upcoming.length > 0 ? `
                    <div class="content-card" style="margin-top: 24px;">
                        <div class="card-header"><h3>📅 即将到期的复习</h3></div>
                        <div class="card-body">
                            ${upcoming.map(kp => {
                const days = Math.ceil((new Date(kp.nextReview) - new Date()) / 86400000);
                return `
                                    <div class="recent-item">
                                        <div class="recent-date">${days > 0 ? days + '天后' : '今天'}</div>
                                        <div class="recent-title">${escapeHtml(kp.title)}</div>
                                        <div class="recent-score" style="background: ${getMasteryColor(kp.mastery)}20; color: ${getMasteryColor(kp.mastery)}">${kp.mastery}%</div>
                                    </div>
                                `;
            }).join('')}
                        </div>
                    </div>
                ` : ''}
            `;
        }
        return;
    }

    container.innerHTML = `
        <div class="content-card" style="margin-bottom: 24px; padding: 16px 24px; background: var(--accent-blue-bg); border-color: var(--accent-blue);">
            <div style="display: flex; align-items: center; gap: 12px;">
                <span style="font-size: 1.5rem">⏰</span>
                <div>
                    <strong>你有 ${dueItems.length} 个知识点需要复习</strong>
                    <p style="font-size: 0.85rem; color: var(--text-secondary); margin-top: 2px;">根据遗忘曲线，现在复习效果最好</p>
                </div>
            </div>
        </div>
        ${dueItems.map(kp => {
        const topic = data.topics.find(t => t.id === kp.topicId);
        const urgency = kp.mastery < 40 ? 'high' : (kp.mastery < 70 ? 'medium' : 'low');
        const urgencyLabel = { high: '紧急', medium: '建议', low: '巩固' };

        return `
                <div class="review-card">
                    <div class="review-card-header">
                        <div class="review-topic">${escapeHtml(kp.title)}</div>
                        <span class="review-urgency urgency-${urgency}">${urgencyLabel[urgency]}</span>
                    </div>
                    <div class="review-info">
                        <span>📘 ${escapeHtml(topic ? topic.title : '未知主题')}</span>
                        <span>🔄 已复习 ${kp.reviewCount} 次</span>
                        <span>📊 掌握度 ${kp.mastery}%</span>
                    </div>
                    <div class="review-actions">
                        <button class="btn btn-primary btn-sm" onclick="quickReview('${kp.id}')">
                            <span class="btn-icon">🎯</span> 开始复习
                        </button>
                        <button class="btn btn-ghost btn-sm" onclick="skipReview('${kp.id}')">跳过</button>
                    </div>
                </div>
            `;
    }).join('')}
    `;
}

// 跳过复习
function skipReview(kpId) {
    const data = DB.getAll();
    const kp = data.knowledgePoints.find(k => k.id === kpId);
    if (kp) {
        const next = new Date();
        next.setDate(next.getDate() + 1);
        kp.nextReview = next.toISOString();
        DB.saveAll(data);
        renderReviewPage();
        updateReviewBadge();
        showToast('已跳过，明天再复习', 'info');
    }
}

// ===== 仪表盘 =====
function renderDashboard() {
    const data = DB.getAll();

    // 统计数据
    document.getElementById('dashTotalTopics').textContent = data.topics.length;
    document.getElementById('dashTotalKnowledge').textContent = data.knowledgePoints.length;
    document.getElementById('dashTotalAnswered').textContent = data.practices.length;
    document.getElementById('dashStreak').textContent = data.streak;

    // 热力图
    renderHeatmap(data.dailyLog);

    // 遗忘曲线
    renderForgettingCurve();

    // 最近记录
    renderRecentList(data);
}

// 渲染热力图（最近52周）
function renderHeatmap(dailyLog) {
    const container = document.getElementById('heatmapContainer');
    const cells = [];
    const today = new Date();

    // 生成最近364天的数据
    for (let i = 363; i >= 0; i--) {
        const date = new Date(today);
        date.setDate(date.getDate() - i);
        const dateStr = date.toISOString().split('T')[0];
        const count = dailyLog[dateStr] || 0;

        let level = 0;
        if (count >= 8) level = 4;
        else if (count >= 5) level = 3;
        else if (count >= 3) level = 2;
        else if (count >= 1) level = 1;

        cells.push(`<div class="heatmap-cell level-${level}" title="${dateStr}: ${count} 次学习活动"></div>`);
    }

    container.innerHTML = cells.join('');
}

// 遗忘曲线
function renderForgettingCurve() {
    const canvas = document.getElementById('curveCanvas');
    if (!canvas) return;

    const ctx = canvas.getContext('2d');
    const w = canvas.width;
    const h = canvas.height;

    ctx.clearRect(0, 0, w, h);

    // 背景网格
    ctx.strokeStyle = '#ffffff0a';
    ctx.lineWidth = 1;
    for (let y = 0; y <= h; y += 50) {
        ctx.beginPath();
        ctx.moveTo(0, y);
        ctx.lineTo(w, y);
        ctx.stroke();
    }

    // 艾宾浩斯遗忘曲线（无复习）
    ctx.beginPath();
    ctx.strokeStyle = '#e06c7580';
    ctx.lineWidth = 2;
    ctx.setLineDash([5, 5]);
    for (let x = 0; x <= w; x++) {
        const t = x / w * 30; // 30天
        const retention = 100 * Math.exp(-0.3 * t);
        const y = h - (retention / 100 * h * 0.85) - 20;
        if (x === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
    }
    ctx.stroke();

    // 有复习的记忆曲线
    ctx.beginPath();
    ctx.strokeStyle = '#4dab6f';
    ctx.lineWidth = 2.5;
    ctx.setLineDash([]);

    const reviewDays = [0, 1, 3, 7, 14, 30]; // 复习时间节点
    let lastRetention = 100;

    for (let x = 0; x <= w; x++) {
        const t = x / w * 30;

        // 检查是否到了复习节点
        let retention = lastRetention * Math.exp(-0.15 * (t - (reviewDays.find(d => d <= t && t < d + 0.5) !== undefined ? t : 0)));

        // 简化的复习曲线模拟
        const nearReview = reviewDays.some(d => Math.abs(t - d) < 0.5);
        if (nearReview) {
            retention = Math.min(100, retention + 30);
        } else {
            retention = retention * Math.exp(-0.05 * (t % 7));
        }

        retention = Math.max(40, Math.min(100, retention));

        const y = h - (retention / 100 * h * 0.85) - 20;
        if (x === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
    }
    ctx.stroke();

    // 标签
    ctx.font = '12px Inter, sans-serif';
    ctx.fillStyle = '#e06c7580';
    ctx.fillText('无复习', w - 60, h - 20);

    ctx.fillStyle = '#4dab6f';
    ctx.fillText('定期复习', w - 70, 40);

    // 坐标轴标签
    ctx.fillStyle = '#ffffff52';
    ctx.font = '11px Inter, sans-serif';
    ctx.fillText('记忆保持率', 5, 15);
    ctx.fillText('0天', 5, h - 5);
    ctx.fillText('30天', w - 35, h - 5);

    // 复习节点标记
    ctx.fillStyle = '#529CCA';
    reviewDays.forEach(d => {
        const x = (d / 30) * w;
        ctx.beginPath();
        ctx.arc(x, h - 8, 3, 0, Math.PI * 2);
        ctx.fill();
    });
}

// 最近学习记录
function renderRecentList(data) {
    const container = document.getElementById('recentList');

    if (data.practices.length === 0) {
        container.innerHTML = '<div class="empty-state small"><p>暂无学习记录</p></div>';
        return;
    }

    const recent = data.practices.slice(-10).reverse();
    container.innerHTML = recent.map(p => {
        const kp = data.knowledgePoints.find(k => k.id === p.knowledgePointId);
        const date = new Date(p.createdAt);
        const dateStr = `${date.getMonth() + 1}/${date.getDate()}`;
        const scoreClass = p.score >= 80 ? 'var(--accent-green)' :
            p.score >= 60 ? 'var(--accent-orange)' : 'var(--accent-red)';

        return `
            <div class="recent-item">
                <div class="recent-date">${dateStr}</div>
                <div class="recent-title">${escapeHtml(kp ? kp.title : p.question)}</div>
                <div class="recent-score" style="background: ${scoreClass}20; color: ${scoreClass}">${p.score}分</div>
            </div>
        `;
    }).join('');
}

// ===== 通用工具函数 =====

function updateStats() {
    const data = DB.getAll();
    document.getElementById('totalTopics').textContent = data.topics.length;
    document.getElementById('totalQuestions').textContent = data.practices.length;
}

function updateReviewBadge() {
    const due = DB.getReviewDue();
    const badge = document.getElementById('reviewBadge');
    badge.textContent = due.length;
    badge.style.display = due.length > 0 ? 'inline' : 'none';
}

function getMasteryClass(mastery) {
    if (mastery >= 70) return 'high';
    if (mastery >= 40) return 'medium';
    return 'low';
}

function getMasteryColor(mastery) {
    if (mastery >= 70) return '#4dab6f';
    if (mastery >= 40) return '#cc7832';
    return '#e06c75';
}

function escapeHtml(text) {
    if (!text) return '';
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
}

function showToast(message, type = 'info') {
    const container = document.getElementById('toastContainer');
    const toast = document.createElement('div');
    toast.className = `toast toast-${type}`;

    const icons = { success: '✅', error: '❌', info: '💡' };
    toast.innerHTML = `<span>${icons[type] || '💡'}</span> ${message}`;

    container.appendChild(toast);

    setTimeout(() => {
        toast.style.opacity = '0';
        toast.style.transform = 'translateX(100px)';
        toast.style.transition = 'all 0.3s ease';
        setTimeout(() => toast.remove(), 300);
    }, 3000);
}

// ===== CRUD 交互逻辑 =====

function initCRUD() {
    const modal = document.getElementById('crudModal');
    const closeBtn = document.getElementById('crudModalClose');
    const cancelBtn = document.getElementById('crudCancelBtn');
    const saveBtn = document.getElementById('crudSaveBtn');

    const closeModal = () => modal.style.display = 'none';

    closeBtn.onclick = closeModal;
    cancelBtn.onclick = closeModal;
    modal.onclick = (e) => { if (e.target === modal) closeModal(); };

    // 保存逻辑
    saveBtn.onclick = handleCrudSave;
}

function showCrudModal(type, id = null, parentId = null) {
    const modal = document.getElementById('crudModal');
    const title = document.getElementById('crudModalTitle');
    const typeInput = document.getElementById('crudType');
    const idInput = document.getElementById('crudId');
    const parentInput = document.getElementById('crudParentId');
    const titleInput = document.getElementById('crudTitleInput');
    const descInput = document.getElementById('crudDescInput');
    const descGroup = document.getElementById('crudDescGroup');

    typeInput.value = type;
    idInput.value = id || '';
    parentInput.value = parentId || '';

    // 重置表单
    titleInput.value = '';
    descInput.value = '';

    if (type === 'topic') {
        descGroup.style.display = 'none'; // 主题暂时不需要描述
        if (id) {
            const topic = DB.getAll().topics.find(t => t.id === id);
            title.textContent = '编辑主题';
            titleInput.value = topic.title;
        } else {
            title.textContent = '新增主题';
        }
    } else if (type === 'kp') {
        descGroup.style.display = 'block';
        if (id) {
            const kp = DB.getAll().knowledgePoints.find(k => k.id === id);
            title.textContent = '编辑知识点';
            titleInput.value = kp.title;
            descInput.value = kp.description || '';
        } else {
            title.textContent = '新增知识点';
            // 如果是在"全部" Tab 下新增，且没有指定 parentId (topicId)，则需要处理
            // 这里我们假设入口都传入了 correct parentId
            if (!parentId) {
                showToast('请在具体主题下添加知识点', 'error');
                return;
            }
        }
    }

    modal.style.display = 'block';
    titleInput.focus();
}

async function handleCrudSave() {
    const type = document.getElementById('crudType').value;
    const id = document.getElementById('crudId').value;
    const parentId = document.getElementById('crudParentId').value;
    const title = document.getElementById('crudTitleInput').value.trim();
    const desc = document.getElementById('crudDescInput').value.trim();

    if (!title) {
        showToast('标题不能为空', 'error');
        return;
    }

    if (type === 'topic') {
        if (id) {
            DB.updateTopic(id, title);
            showToast('主题已更新', 'success');
        } else {
            DB.addTopic(title, '');
            showToast('主题已添加', 'success');
        }
    } else if (type === 'kp') {
        if (id) {
            DB.updateKnowledgePoint(id, title, desc);
            showToast('知识点已更新', 'success');
        } else {
            DB.addKnowledgePoint(parentId, title, desc);
            showToast('知识点已添加', 'success');
        }
    }

    document.getElementById('crudModal').style.display = 'none';
    renderKnowledgeGraph(); // 刷新页面
}

// 确认对话框逻辑
let confirmCallback = null;

function initConfirmModal() {
    const modal = document.getElementById('confirmModal');
    const closeBtn = document.getElementById('confirmClose');
    const cancelBtn = document.getElementById('confirmCancelBtn');
    const okBtn = document.getElementById('confirmOkBtn');

    const closeModal = () => modal.style.display = 'none';

    closeBtn.onclick = closeModal;
    cancelBtn.onclick = closeModal;
    modal.onclick = (e) => { if (e.target === modal) closeModal(); };

    okBtn.onclick = () => {
        if (confirmCallback) confirmCallback();
        closeModal();
    };
}

function showConfirm(message, callback) {
    const modal = document.getElementById('confirmModal');
    document.getElementById('confirmMessage').textContent = message;
    confirmCallback = callback;
    modal.style.display = 'block';
}

function handleCrudDelete(type, id) {
    const message = type === 'topic'
        ? '确定要删除这个主题吗？\n删除后该主题下的所有知识点和练习记录都将被永久清除，无法恢复。'
        : '确定要删除这个知识点吗？\n删除后相关的练习记录也会被清除。';

    showConfirm(message, () => {
        if (type === 'topic') {
            DB.deleteTopic(id);
            if (currentKnowledgeTopicId === id) {
                currentKnowledgeTopicId = 'all'; // 如果删除的是当前选中的主题，切换回All
            }
            showToast('主题已删除', 'success');
        } else if (type === 'kp') {
            DB.deleteKnowledgePoint(id);
            showToast('知识点已删除', 'success');
        }

        // 强制刷新界面
        renderKnowledgeGraph();
        updateStats(); // 同时更新统计数据
    });
}


// 获取 API 基础域名 (用于本地开发指向线上环境)
function getApiBaseUrl() {
    // 如果是本地环境 (file, localhost, 127.0.0.1)，使用线上 API
    if (location.protocol === 'file:' || location.hostname === 'localhost' || location.hostname === '127.0.0.1') {
        // 尝试从配置读取 (虽然配置 key 可能变化，作为 fallback)
        try {
            const config = JSON.parse(localStorage.getItem('learnflow_feishu_config') || '{}');
            if (config.vercelUrl) return config.vercelUrl;
        } catch (e) { }
        return 'https://ai-learning-coach-sigma.vercel.app';
    }
    return '';
}

// ===== 飞书授权管理 =====
// Feishu OAuth Configuration & Logic
// Make it globally accessible for event handlers
window.FeishuAuth = {
    // 飞书 App ID (需替换为您的实际 App ID)
    APP_ID: 'cli_a906a5b58876dbc7', // Updated App ID
    // For local dev/vercel, use explicit Vercel URL as redirect URI
    // 飞书后台必须添加: https://ai-learning-coach-sigma.vercel.app/
    REDIRECT_URI: 'https://ai-learning-coach-sigma.vercel.app/',

    // 状态 Key
    TOKEN_KEY: 'feishu_user_token',
    USER_INFO_KEY: 'feishu_user_info',

    // 登录
    login() {
        // 构建授权 URL
        const redirectUri = encodeURIComponent(this.REDIRECT_URI);
        const appId = this.APP_ID;
        const scope = 'contact:user.id:readonly bitable:app:readonly bitable:app:read_write'; // Need permissions
        // Feishu OAuth URL (Web app)
        const url = `https://open.feishu.cn/open-apis/authen/v1/index?app_id=${appId}&redirect_uri=${redirectUri}&state=LOGIN`;
        window.location.href = url;
    },

    // 防止 handleCallback 被多次调用的标志
    _handlingCallback: false,

    // 处理回调 (在页面加载时检查 URL param 'code')
    async handleCallback() {
        // 防止重复调用
        if (this._handlingCallback) return false;

        const urlParams = new URLSearchParams(window.location.search);
        const code = urlParams.get('code');
        const state = urlParams.get('state');

        // 如果检测到 code 参数，立即显示加载遮罩，隐藏登录遮罩
        if (code) {
            const loadingOverlay = document.getElementById('loadingOverlay');
            const loginOverlay = document.getElementById('loginOverlay');
            if (loadingOverlay) loadingOverlay.style.display = 'flex';
            if (loginOverlay) loginOverlay.style.display = 'none';
        }

        if (code && state === 'LOGIN') {
            // 立即标记为正在处理 & 清除 URL 中的 code (防止重复使用)
            this._handlingCallback = true;
            window.history.replaceState({}, document.title, window.location.pathname);

            try {
                // 请求后端换票 (自动适配本地/线上环境)
                const res = await fetch(getApiBaseUrl() + '/api/auth/feishu', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ code })
                });

                const data = await res.json();
                if (data.error) throw new Error(data.error);

                // 保存 Token
                this.setToken(data.access_token, data.expires_in, data.refresh_token);
                // 保存 User Info (open_id as user ID)
                this.setUserInfo({
                    id: data.open_id,
                    name: data.name || '飞书用户',
                    avatar: data.avatar_url || ''
                });

                showToast('登录成功！', 'success');
                // 刷新页面以加载用户数据 (URL 已经干净)
                setTimeout(() => window.location.reload(), 1000);

            } catch (err) {
                console.error('Login Failed:', err);
                showToast(`登录失败: ${err.message}`, 'error');
                // 失败时恢复显示登录遮罩
                const loadingOverlay = document.getElementById('loadingOverlay');
                const loginOverlay = document.getElementById('loginOverlay');
                if (loadingOverlay) loadingOverlay.style.display = 'none';
                if (loginOverlay) loginOverlay.style.display = 'flex';
                this._handlingCallback = false;
            }
            return true;
        }
        return false;
    },

    // 退出
    logout() {
        // 清除所有以 feishu_ 开头的 Key
        const keysToRemove = [];
        for (let i = 0; i < localStorage.length; i++) {
            const key = localStorage.key(i);
            if (key && key.startsWith('feishu_')) {
                keysToRemove.push(key);
            }
        }
        keysToRemove.forEach(key => localStorage.removeItem(key));

        document.body.style.overflow = ''; // 恢复滚动
        window.location.reload();
    },

    // Token Expiry Key
    EXPIRE_KEY: 'feishu_token_expire',
    REFRESH_TOKEN_KEY: 'feishu_refresh_token',

    // 获取当前 Token (自动刷新)
    async getToken() {
        let token = localStorage.getItem(this.TOKEN_KEY);
        if (!token) return null;

        // 检查是否过期 (提前 5 分钟刷新)
        const expireTime = parseInt(localStorage.getItem(this.EXPIRE_KEY) || '0');
        const now = Date.now();

        if (expireTime > 0 && now > expireTime - 300000) { // 5 minutes buffer
            console.log('Token expiring, refreshing...');
            token = await this.refreshToken();
        }
        return token;
    },

    // 刷新 Token
    async refreshToken() {
        const refreshToken = localStorage.getItem(this.REFRESH_TOKEN_KEY);
        if (!refreshToken) return null;

        try {
            const res = await fetch(getApiBaseUrl() + '/api/auth/feishu', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    grant_type: 'refresh_token',
                    refresh_token: refreshToken
                })
            });
            const data = await res.json();
            if (data.access_token) {
                this.setToken(data.access_token, data.expires_in, data.refresh_token);
                console.log('Token refreshed successfully');
                return data.access_token;
            }
        } catch (e) {
            console.error('Failed to refresh token:', e);
            // 如果刷新失败且已彻底过期，需要重新登录
            const expireTime = parseInt(localStorage.getItem(this.EXPIRE_KEY) || '0');
            if (Date.now() > expireTime) {
                this.logout(); // Force logout
                return null;
            }
        }
        // 如果刷新失败但旧 token 还能撑着用，暂时返回旧 token
        return localStorage.getItem(this.TOKEN_KEY);
    },

    setToken(token, expiresIn, refreshToken) {
        localStorage.setItem(this.TOKEN_KEY, token);
        if (expiresIn) {
            // expiresIn is seconds (e.g. 7200)
            localStorage.setItem(this.EXPIRE_KEY, (Date.now() + expiresIn * 1000).toString());
        }
        if (refreshToken) {
            localStorage.setItem(this.REFRESH_TOKEN_KEY, refreshToken);
        }
    },

    setUserInfo(user) {
        localStorage.setItem(this.USER_INFO_KEY, JSON.stringify(user));
    },

    isLoggedIn() {
        return !!localStorage.getItem(this.TOKEN_KEY);
    }
};

// ===== 飞书多维表格同步模块 =====
const FeishuSync = {
    CONFIG_KEY: 'learnflow_feishu_config',

    // 数据表定义
    TABLE_DEFS: {
        topics: {
            name: 'LearnFlow_主题',
            fields: [
                { name: 'id', type: 1 },
                { name: 'title', type: 1 },
                { name: 'content', type: 1 },
                { name: 'createdAt', type: 1 }
            ]
        },
        knowledgePoints: {
            name: 'LearnFlow_知识点',
            fields: [
                { name: 'id', type: 1 },
                { name: 'topicId', type: 1 },
                { name: 'title', type: 1 },
                { name: 'description', type: 1 },
                { name: 'mastery', type: 2 },
                { name: 'nextReview', type: 1 },
                { name: 'reviewCount', type: 2 },
                { name: 'lastReview', type: 1 },
                { name: 'createdAt', type: 1 }
            ]
        },
        practices: {
            name: 'LearnFlow_练习',
            fields: [
                { name: 'id', type: 1 },
                { name: 'kpId', type: 1 },
                { name: 'topicId', type: 1 },
                { name: 'question', type: 1 },
                { name: 'answer', type: 1 },
                { name: 'score', type: 2 },
                { name: 'feedback', type: 1 },
                { name: 'createdAt', type: 1 }
            ]
        },
        userState: {
            name: 'LearnFlow_用户状态',
            fields: [
                { name: 'key', type: 1 },
                { name: 'value', type: 1 }
            ]
        }
    },

    // 获取当前配置 Key
    getConfigKey() {
        if (typeof FeishuAuth !== 'undefined' && FeishuAuth.isLoggedIn()) {
            const user = FeishuAuth.getUser();
            if (user && user.id) {
                return `learnflow_feishu_config_${user.id}`;
            }
        }
        return 'learnflow_feishu_config';
    },

    // 获取配置
    getConfig() {
        try {
            return JSON.parse(localStorage.getItem(this.getConfigKey())) || {};
        } catch { return {}; }
    },

    // 保存配置
    saveConfig(config) {
        localStorage.setItem(this.getConfigKey(), JSON.stringify(config));
    },

    // 判断是否已配置
    isConfigured() {
        const c = this.getConfig();
        return !!(c.appId && c.appSecret && c.appToken);
    },

    // 获取 API 完整 URL
    getApiUrl() {
        return getApiBaseUrl() + '/api/feishu';
    },

    // 调用飞书 API 代理
    async callApi(action, extra = {}) {
        const config = this.getConfig();
        const apiUrl = this.getApiUrl();

        const resp = await fetch(`${apiUrl}/api/feishu`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                action,
                appId: config.appId,
                appSecret: config.appSecret,
                appToken: config.appToken,
                ...extra
            })
        });

        const result = await resp.json();
        if (!resp.ok || result.error) {
            throw new Error(result.error || `HTTP ${resp.status}`);
        }
        return result;
    },

    // 日志输出
    log(msg, type = 'info') {
        const logEl = document.getElementById('feishuSyncLog');
        if (!logEl) return;
        const line = document.createElement('div');
        line.className = `log-line log-${type}`;
        const time = new Date().toLocaleTimeString();
        line.textContent = `[${time}] ${msg}`;
        logEl.appendChild(line);
        logEl.scrollTop = logEl.scrollHeight;
    },

    // 清空日志
    clearLog() {
        const logEl = document.getElementById('feishuSyncLog');
        if (logEl) logEl.innerHTML = '';
    },

    // 更新状态显示
    setStatus(text, state = 'idle') {
        const dot = document.querySelector('#feishuSyncStatus .sync-dot');
        const textEl = document.getElementById('feishuStatusText');
        if (dot) {
            dot.className = `sync-dot sync-dot-${state}`;
        }
        if (textEl) textEl.textContent = text;
    },

    // 启用/禁用按钮
    setButtonsEnabled(enabled) {
        const ids = ['feishuInitBtn', 'feishuUploadBtn', 'feishuDownloadBtn'];
        ids.forEach(id => {
            const btn = document.getElementById(id);
            if (btn) btn.disabled = !enabled;
        });
    },

    // ===== 测试连接 =====
    async testConnection() {
        this.clearLog();
        this.setStatus('正在连接...', 'loading');
        this.log('开始测试飞书连接...');

        try {
            const result = await this.callApi('testConnection');
            this.log(`✅ 连接成功！多维表格中有 ${result.tableCount} 张数据表`, 'success');
            this.setStatus('已连接', 'success');
            this.setButtonsEnabled(true);
            showToast('飞书连接成功！', 'success');
        } catch (err) {
            this.log(`❌ 连接失败: ${err.message}`, 'error');
            this.setStatus('连接失败', 'error');
            this.setButtonsEnabled(false);
            showToast('飞书连接失败: ' + err.message, 'error');
        }
    },

    // ===== 初始化数据表 =====
    async initTables() {
        this.clearLog();
        this.setStatus('正在初始化表格...', 'loading');
        this.log('开始创建数据表...');

        try {
            // 先获取已有表格
            const existing = await this.callApi('listTables');
            const existingNames = (existing.tables || []).map(t => t.name);

            const config = this.getConfig();
            config.tableIds = config.tableIds || {};

            // 对已存在的表格，记录其 table_id
            for (const [key, def] of Object.entries(this.TABLE_DEFS)) {
                const found = (existing.tables || []).find(t => t.name === def.name);
                if (found) {
                    config.tableIds[key] = found.table_id;
                    this.log(`📋 表 "${def.name}" 已存在 (${found.table_id})`);
                }
            }

            // 创建不存在的表格
            for (const [key, def] of Object.entries(this.TABLE_DEFS)) {
                if (existingNames.includes(def.name)) continue;

                this.log(`📋 创建表 "${def.name}"...`);
                const result = await this.callApi('createTable', {
                    data: { name: def.name, fields: def.fields }
                });
                config.tableIds[key] = result.tableId;
                this.log(`✅ 表 "${def.name}" 创建成功 (${result.tableId})`, 'success');
            }

            this.saveConfig(config);
            this.setStatus('表格已就绪', 'success');
            this.log('🎉 所有数据表初始化完成！', 'success');
            showToast('飞书数据表初始化完成！', 'success');
        } catch (err) {
            this.log(`❌ 初始化失败: ${err.message}`, 'error');
            this.setStatus('初始化失败', 'error');
            showToast('初始化失败: ' + err.message, 'error');
        }
    },

    // 自动同步定时器
    timer: null,

    // 调度自动同步（防抖）
    scheduleAutoSync() {
        const config = this.getConfig();
        if (!config.autoSync) return;

        // 如果未初始化表格，跳过
        if (!config.tableIds) return;

        if (this.timer) clearTimeout(this.timer);
        this.timer = setTimeout(() => {
            this.uploadData({ silent: true });
        }, 5000); // 5秒后自动同步
    },

    // ===== 上传数据到飞书 =====
    async uploadData(options = { silent: false }) {
        if (!options.silent) {
            this.clearLog();
            this.setStatus('正在上传...', 'loading');
            this.log('开始上传数据到飞书...');
        } else {
            this.setStatus('正在自动同步...', 'loading');
        }

        const config = this.getConfig();
        if (!config.tableIds) {
            if (!options.silent) {
                this.log('❌ 请先初始化数据表', 'error');
                this.setStatus('未初始化', 'error');
                showToast('请先点击"初始化表格"按钮', 'error');
            }
            return;
        }

        try {
            const data = DB.getAll();

            // 1. 清空飞书表中的旧数据
            if (!options.silent) this.log('🗑️ 清空飞书旧数据...');
            for (const [key, tableId] of Object.entries(config.tableIds)) {
                await this.callApi('deleteAllRecords', { tableId });
                this.log(`  清空表 ${this.TABLE_DEFS[key]?.name || key}`);
            }

            // 2. 上传主题
            if (data.topics.length > 0) {
                if (!options.silent) this.log(`⬆️ 上传 ${data.topics.length} 个主题...`);
                const topicRecords = data.topics.map(t => ({
                    id: t.id, title: t.title,
                    content: t.content, createdAt: t.createdAt
                }));
                await this.callApi('batchCreate', {
                    tableId: config.tableIds.topics,
                    data: { records: topicRecords }
                });
                if (!options.silent) this.log(`✅ 主题上传完成`, 'success');
            }

            // 3. 上传知识点
            if (data.knowledgePoints.length > 0) {
                if (!options.silent) this.log(`⬆️ 上传 ${data.knowledgePoints.length} 个知识点...`);
                const kpRecords = data.knowledgePoints.map(kp => ({
                    id: kp.id, topicId: kp.topicId, title: kp.title,
                    description: kp.description, mastery: kp.mastery || 0,
                    nextReview: kp.nextReview || '', reviewCount: kp.reviewCount || 0,
                    lastReview: kp.lastReview || '', createdAt: kp.createdAt
                }));
                await this.callApi('batchCreate', {
                    tableId: config.tableIds.knowledgePoints,
                    data: { records: kpRecords }
                });
                if (!options.silent) this.log(`✅ 知识点上传完成`, 'success');
            }

            // 4. 上传练习记录
            if (data.practices.length > 0) {
                if (!options.silent) this.log(`⬆️ 上传 ${data.practices.length} 条练习记录...`);
                const practiceRecords = data.practices.map(p => ({
                    id: p.id, kpId: p.kpId, topicId: p.topicId,
                    question: p.question, answer: p.answer || '',
                    score: p.score || 0, feedback: p.feedback || '',
                    createdAt: p.createdAt
                }));
                await this.callApi('batchCreate', {
                    tableId: config.tableIds.practices,
                    data: { records: practiceRecords }
                });
                if (!options.silent) this.log(`✅ 练习记录上传完成`, 'success');
            }

            // 5. 上传用户状态
            if (!options.silent) this.log('⬆️ 上传用户状态...');
            const stateRecords = [
                { key: 'streak', value: String(data.streak || 0) },
                { key: 'lastStudyDate', value: data.lastStudyDate || '' },
                { key: 'dailyLog', value: JSON.stringify(data.dailyLog || {}) }
            ];
            await this.callApi('batchCreate', {
                tableId: config.tableIds.userState,
                data: { records: stateRecords }
            });
            if (!options.silent) this.log(`✅ 用户状态上传完成`, 'success');

            this.setStatus('上传完成', 'success');
            if (!options.silent) {
                this.log(`🎉 数据上传成功！共 ${data.topics.length} 主题, ${data.knowledgePoints.length} 知识点, ${data.practices.length} 练习`, 'success');
                showToast('数据已上传到飞书！', 'success');
            } else {
                const time = new Date().toLocaleTimeString();
                const logEl = document.getElementById('feishuSyncLog');
                if (logEl) {
                    const line = document.createElement('div');
                    line.className = 'log-line log-success';
                    line.textContent = `[${time}] 🔄 自动同步成功`;
                    logEl.appendChild(line);
                    logEl.scrollTop = logEl.scrollHeight;
                }
            }
        } catch (err) {
            if (!options.silent) {
                this.log(`❌ 上传失败: ${err.message}`, 'error');
                showToast('上传失败: ' + err.message, 'error');
            } else {
                console.error('自动同步失败:', err);
                // Keep silent
            }
            this.setStatus('上传失败', 'error');
        }
    },

    // ===== 从飞书下载数据 =====
    async downloadData() {
        this.clearLog();
        this.setStatus('正在下载...', 'loading');
        this.log('开始从飞书下载数据...');

        const config = this.getConfig();
        if (!config.tableIds) {
            this.log('❌ 请先初始化数据表', 'error');
            this.setStatus('未初始化', 'error');
            showToast('请先点击"初始化表格"按钮', 'error');
            return;
        }

        try {
            const newData = DB._defaultData();

            // 1. 下载主题
            this.log('⬇️ 下载主题...');
            const topicsResult = await this.callApi('listRecords', {
                tableId: config.tableIds.topics
            });
            newData.topics = (topicsResult.records || []).map(r => ({
                id: r.fields.id, title: r.fields.title,
                content: r.fields.content, createdAt: r.fields.createdAt
            })).filter(t => t.id && t.title);
            this.log(`  获取到 ${newData.topics.length} 个主题`);

            // 2. 下载知识点
            this.log('⬇️ 下载知识点...');
            const kpResult = await this.callApi('listRecords', {
                tableId: config.tableIds.knowledgePoints
            });
            newData.knowledgePoints = (kpResult.records || []).map(r => ({
                id: r.fields.id, topicId: r.fields.topicId,
                title: r.fields.title, description: r.fields.description,
                mastery: Number(r.fields.mastery) || 0,
                nextReview: r.fields.nextReview || null,
                reviewCount: Number(r.fields.reviewCount) || 0,
                lastReview: r.fields.lastReview || null,
                createdAt: r.fields.createdAt
            })).filter(kp => kp.id && kp.title);
            this.log(`  获取到 ${newData.knowledgePoints.length} 个知识点`);

            // 3. 下载练习记录
            this.log('⬇️ 下载练习记录...');
            const practicesResult = await this.callApi('listRecords', {
                tableId: config.tableIds.practices
            });
            newData.practices = (practicesResult.records || []).map(r => ({
                id: r.fields.id, kpId: r.fields.kpId,
                topicId: r.fields.topicId,
                question: r.fields.question, answer: r.fields.answer || '',
                score: Number(r.fields.score) || 0,
                feedback: r.fields.feedback || '',
                createdAt: r.fields.createdAt
            })).filter(p => p.id);
            this.log(`  获取到 ${newData.practices.length} 条练习`);

            // 4. 下载用户状态
            this.log('⬇️ 下载用户状态...');
            const stateResult = await this.callApi('listRecords', {
                tableId: config.tableIds.userState
            });
            for (const r of (stateResult.records || [])) {
                const key = r.fields.key;
                const value = r.fields.value;
                if (key === 'streak') newData.streak = Number(value) || 0;
                else if (key === 'lastStudyDate') newData.lastStudyDate = value || null;
                else if (key === 'dailyLog') {
                    try { newData.dailyLog = JSON.parse(value); } catch { newData.dailyLog = {}; }
                }
            }
            this.log(`  用户状态已恢复`);

            // 5. 保存到 localStorage
            DB.saveAll(newData);

            // 6. 刷新界面
            updateStats();
            renderDashboard();
            renderKnowledgeGraph();
            renderReviewPage();

            this.setStatus('下载完成', 'success');
            this.log(`🎉 下载成功！共 ${newData.topics.length} 主题, ${newData.knowledgePoints.length} 知识点, ${newData.practices.length} 练习`, 'success');
            showToast('数据已从飞书下载！', 'success');
        } catch (err) {
            this.log(`❌ 下载失败: ${err.message}`, 'error');
            this.setStatus('下载失败', 'error');
            showToast('下载失败: ' + err.message, 'error');
        }
    },

    // UI 初始化：加载配置到表单
    loadConfigToUI() {
        const config = this.getConfig();
        const appId = document.getElementById('feishuAppId');
        const appSecret = document.getElementById('feishuAppSecret');
        const appToken = document.getElementById('feishuAppToken');
        const autoSync = document.getElementById('feishuAutoSync');

        if (appId) appId.value = config.appId || '';
        if (appSecret) appSecret.value = config.appSecret || '';
        if (appToken) appToken.value = config.appToken || '';
        if (autoSync) autoSync.checked = !!config.autoSync;

        // 更新状态
        if (this.isConfigured()) {
            this.setStatus('已配置（点击测试连接）', 'idle');
        } else {
            this.setStatus('未配置', 'idle');
        }
    },

    // UI：保存表单到配置
    saveConfigFromUI() {
        const config = this.getConfig();
        config.appId = document.getElementById('feishuAppId')?.value.trim() || '';
        config.appSecret = document.getElementById('feishuAppSecret')?.value.trim() || '';
        config.appToken = document.getElementById('feishuAppToken')?.value.trim() || '';
        config.autoSync = document.getElementById('feishuAutoSync')?.checked || false;
        this.saveConfig(config);
        showToast('飞书配置已保存', 'success');

        if (this.isConfigured()) {
            this.setStatus('已配置（点击测试连接）', 'idle');
        }
    }
};


// ===== 飞书同步事件绑定 =====
function initFeishuEvents() {
    // 密钥显示/隐藏
    const toggleBtn = document.getElementById('toggleFeishuSecretBtn');
    if (toggleBtn) {
        toggleBtn.addEventListener('click', () => {
            const input = document.getElementById('feishuAppSecret');
            if (input) {
                input.type = input.type === 'password' ? 'text' : 'password';
            }
        });
    }

    // 保存配置
    const saveBtn = document.getElementById('feishuSaveBtn');
    if (saveBtn) {
        saveBtn.addEventListener('click', () => FeishuSync.saveConfigFromUI());
    }

    // 关闭按钮
    const closeBtn = document.getElementById('closeFeishuBtn');
    if (closeBtn) {
        closeBtn.addEventListener('click', () => {
            document.getElementById('aiConfigModal')?.classList.remove('active');
        });
    }

    // 测试连接
    const testBtn = document.getElementById('feishuTestBtn');
    if (testBtn) {
        testBtn.addEventListener('click', () => {
            FeishuSync.saveConfigFromUI();
            FeishuSync.testConnection();
        });
    }

    // 初始化表格
    const initBtn = document.getElementById('feishuInitBtn');
    if (initBtn) {
        initBtn.addEventListener('click', () => FeishuSync.initTables());
    }

    // 上传数据
    const uploadBtn = document.getElementById('feishuUploadBtn');
    if (uploadBtn) {
        uploadBtn.addEventListener('click', () => {
            showConfirm('确定要上传数据到飞书吗？\n这将覆盖飞书中的现有数据。', () => {
                FeishuSync.uploadData();
            });
        });
    }

    // 下载数据
    const downloadBtn = document.getElementById('feishuDownloadBtn');
    if (downloadBtn) {
        downloadBtn.addEventListener('click', () => {
            showConfirm('确定要从飞书下载数据吗？\n这将覆盖本地浏览器中的数据。', () => {
                FeishuSync.downloadData();
            });
        });
    }

    // 加载配置到表单
    FeishuSync.loadConfigToUI();

    // 监听自动同步开关
    const autoSync = document.getElementById('feishuAutoSync');
    if (autoSync) {
        autoSync.addEventListener('change', () => {
            FeishuSync.saveConfigFromUI();
            if (autoSync.checked) {
                showToast('已开启自动同步 (5秒后自动备份)', 'info');
            }
        });
    }
}

// 在页面初始化时绑定飞书事件
document.addEventListener('DOMContentLoaded', () => {
    // 延迟初始化飞书模块（确保其他模块已加载）
    setTimeout(initFeishuEvents, 100);
});
