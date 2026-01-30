// ==UserScript==
// @name         FF14跨区小助手Pro
// @namespace    https://github.com/gezimao/DCtravelerWeb
// @version      1.1
// @description  FF14 跨区传送辅助脚本 - 自动监控服务器状态并执行跨区传送
// @author       LIDaoJY,gezimao
// @match        https://ff14bjz.sdo.com/RegionKanTelepo*
// @match        https://login.u.sdo.com/sdo/Login/LoginFrameFC.php*
// @match        https://login.sdo.com/sdo/Login/LoginFrameFC.php*
// @grant        GM_addStyle
// @grant        GM_xmlhttpRequest
// @grant        GM_notification
// @grant        GM_setValue
// @grant        GM_getValue
// @run-at       document-end
// @connect      ff14bjz.sdo.com
// @license      MIT
// ==/UserScript==

(function () {
    'use strict';

    // =============== 环境判定 ===============
    const isTopWindow = (window.self === window.top);

    // =============== 统一日志桥接 ===============
    function addLog(message) {
        if (!isTopWindow) {
            window.parent.postMessage({ type: 'FF14_TRACE_LOG', content: message }, '*');
            return;
        }
        const timestamp = new Date().toLocaleTimeString('zh-CN', { hour12: false });
        const entry = document.createElement('div');
        entry.className = 'ff14-log-entry';
        entry.textContent = `[${timestamp}] ${message}`; // 仅保留时间戳
        if (logContainer) {
            logContainer.appendChild(entry);
            logContainer.scrollTop = logContainer.scrollHeight;
            if (logContainer.children.length > 200) {
                logContainer.removeChild(logContainer.firstChild);
            }
        }
        console.log(`[${timestamp}] ${message}`);
    }

    // =============== [子框架核心逻辑] 自动协议勾选 ===============
    if (!isTopWindow) {
        addLog('登录组件脚本加载成功，正在扫描协议框');

        const scanTimer = setInterval(() => {
            const autoAgree = GM_getValue('ff14_auto_agree_enabled', true);
            if (!autoAgree) return;

            const checkbox = document.getElementById('isAgreementAccept');
            const agreementPara = document.querySelector('.accept-agreement');

            if (checkbox && !checkbox.checked) {
                try {
                    checkbox.click();
                    checkbox.checked = true;
                    if (agreementPara) agreementPara.click();
                    checkbox.dispatchEvent(new Event('change', { bubbles: true }));
                    addLog('协议须知已自动勾选');
                } catch (e) {
                    addLog('自动勾选执行失败: ' + e.message);
                }
            }
        }, 500);
        return;
    }

    // =============== [主窗口逻辑] ===============

    window.addEventListener('message', (e) => {
        if (e.data && e.data.type === 'FF14_TRACE_LOG') {
            addLog(e.data.content);
        }
    });

    let FF14_GROUP_LIST = null;
    let FF14_STATUS_INFO = null;
    let selectedRoleInfo = null;
    let selectedTargetAreaInfo = null;
    let statusCheckTimeoutId = null;
    let retryTimeoutId = null;
    let audioContext = null;

    let logContainer = null;
    let fetchButton = null;
    let controlSection = null;
    let linkStartBtn = null;
    let characterSelectionWindow = null;
    let targetAreaSelectionWindow = null;
    let statusWindow = null;

    GM_addStyle(`
        #ff14-helper-window {
            position: fixed; top: 120px; left: 40px; width: 350px; height: 500px;
            background: rgba(30, 30, 30, 0.95); color: #fff; z-index: 999999;
            padding: 10px; border-radius: 6px; font-size: 14px; display: flex; flex-direction: column;
            box-shadow: 0 0 10px rgba(0,0,0,0.5); border: 1px solid #555;
        }
        #ff14-helper-header { cursor: move; font-weight: bold; margin-bottom: 8px; display: flex; justify-content: space-between; border-bottom: 1px solid #555; padding-bottom: 5px; }
        .ff14-helper-btn { background: #444; border-radius: 3px; padding: 2px 6px; cursor: pointer; font-size: 11px; }
        #ff14-control-section { flex: 0 0 auto; padding-bottom: 10px; }
        #ff14-log-section { flex: 1 1 auto; overflow-y: auto; padding-top: 10px; background: #111; border-radius: 4px; border: 1px solid #333; }
        .ff14-log-entry { font-size: 11px; line-height: 1.4; margin-bottom: 2px; color: #bbb; padding: 0 5px; }
        .ff14-action-btn { display: inline-block; margin: 5px 5px 0 0; padding: 6px 12px; background: linear-gradient(to bottom, #2196F3, #1976D2); border: 1px solid #0d47a1; border-radius: 4px; color: white; cursor: pointer; font-size: 13px; }
        .ff14-action-btn:disabled { opacity: 0.5; cursor: not-allowed; }
        .ff14-config-panel { margin-top: 8px; padding: 8px; background: rgba(60,60,60,0.5); border-radius: 4px; border: 1px solid #444; }
        .ff14-config-row { margin-bottom: 5px; display: flex; align-items: center; font-size: 11px; color: #ddd; gap: 5px; }
        .ff14-input-small { width: 40px; background: #222; color: #fff; border: 1px solid #555; text-align: center; border-radius: 2px; }
        #ff14-fetch-btn { width: 100%; padding: 10px; background: #4CAF50; border: none; color: white; cursor: pointer; border-radius: 4px; font-weight: bold; }
        .ff14-selection-window { position: fixed; top: 150px; left: 50%; transform: translateX(-50%); background: rgba(30, 30, 30, 0.98); color: #fff; z-index: 1000000; padding: 15px; border-radius: 6px; width: 320px; box-shadow: 0 0 20px rgba(0,0,0,0.8); border: 1px solid #666; }
        .ff14-window-header { cursor: move; font-weight: bold; margin-bottom: 10px; display: flex; justify-content: space-between; }
        .ff14-list-container { height: 180px; overflow-y: auto; border: 1px solid #444; background: #222; margin: 10px 0; }
        .ff14-list-container li { padding: 6px; cursor: pointer; border-bottom: 1px solid #333; font-size: 12px; }
        .ff14-list-container li:hover { background: #333; }
        .ff14-list-container li.selected { background: #1976D2; }
        #ff14-status-window { position: fixed; top: 120px; left: 50%; transform: translateX(-50%); width: 500px; height: 350px; background: rgba(30, 30, 30, 0.95); color: #fff; z-index: 999998; padding: 10px; border-radius: 6px; display: flex; flex-direction: column; border: 1px solid #555; }
        .status-column { flex: 1; overflow-y: auto; padding: 5px; background: #222; border: 1px solid #444; font-size: 12px; }
        .status-open { color: #4CAF50; }
        .status-busy { color: #FFC107; }
        .status-blocked { color: #f44336; }
    `);

    function initMainUI() {
        if (document.getElementById('ff14-helper-window')) return;
        const win = document.createElement('div');
        win.id = 'ff14-helper-window';
        win.innerHTML = `
            <div id="ff14-helper-header">
                <span>FF14 跨区传送辅助</span>
                <div style="display:flex; gap:5px;">
                    <div class="ff14-helper-btn" id="ff14-min-btn">最小化</div>
                    <div class="ff14-helper-btn" id="ff14-close-btn">关闭</div>
                </div>
            </div>
            <div id="ff14-control-section">
                <button id="ff14-fetch-btn">获取服务器列表 (登录后点击)</button>
                <div class="ff14-config-panel">
                    <div class="ff14-config-row">
                        <input type="checkbox" id="ff14-opt-agree">
                        <label for="ff14-opt-agree" style="color:#4CAF50; font-weight:bold;">自动确认用户协议须知</label>
                    </div>
                    <div class="ff14-config-row">
                        <label>查询间隔(秒):</label>
                        <input type="number" id="ff14-opt-interval" class="ff14-input-small" value="30" min="1">
                        <input type="checkbox" id="ff14-opt-burst" checked>
                        <label for="ff14-opt-burst" style="color:#FFC107;">整10分时1秒间隔（估计没用）</label>
                    </div>
                </div>
                <div id="ff14-action-area" style="display:none; border-top:1px solid #444; margin-top:8px; padding-top:8px;"></div>
            </div>
            <div id="ff14-log-section"></div>
        `;
        document.body.appendChild(win);
        logContainer = document.getElementById('ff14-log-section');
        fetchButton = document.getElementById('ff14-fetch-btn');
        controlSection = document.getElementById('ff14-control-section');

        const agreeToggle = document.getElementById('ff14-opt-agree');
        const savedValue = GM_getValue('ff14_auto_agree_enabled', true);
        agreeToggle.checked = savedValue;
        GM_setValue('ff14_auto_agree_enabled', savedValue);

        agreeToggle.onchange = (e) => {
            GM_setValue('ff14_auto_agree_enabled', e.target.checked);
            addLog(`自动确认协议已${e.target.checked ? '开启' : '关闭'}`);
        };

        enableDrag(win, win.querySelector('#ff14-helper-header'));
        document.getElementById('ff14-min-btn').onclick = () => {
            const h = logContainer.style.display === 'none';
            logContainer.style.display = h ? 'block' : 'none';
            controlSection.style.display = h ? 'block' : 'none';
        };
        document.getElementById('ff14-close-btn').onclick = () => win.style.display = 'none';
        fetchButton.onclick = fetchServerData;

        addLog('脚本已启动');
    }

    function fetchServerData() {
        addLog('正在请求服务器列表...');
        GM_xmlhttpRequest({
            method: 'GET',
            url: 'https://ff14bjz.sdo.com/api/orderserivce/queryGroupListTravelSource?appId=100001900',
            onload: (res) => {
                const data = JSON.parse(res.responseText);
                if (data.return_code === 0 && data.data) {
                    FF14_GROUP_LIST = JSON.parse(data.data.groupList);
                    fetchButton.style.display = 'none';
                    showActionArea();
                    addLog('服务器列表加载成功');
                } else {
                    addLog('获取失败，请确认是否已在网页登录');
                }
            }
        });
    }

    function showActionArea() {
        const area = document.getElementById('ff14-action-area');
        area.style.display = 'block';
        area.innerHTML = `
            <button id="btn-char" class="ff14-action-btn">选择角色</button>
            <button id="btn-target" class="ff14-action-btn">选择目标大区</button>
            <button id="btn-start" class="ff14-action-btn" disabled>开始尝试</button>
        `;
        document.getElementById('btn-char').onclick = openCharWindow;
        document.getElementById('btn-target').onclick = openTargetWindow;
        linkStartBtn = document.getElementById('btn-start');
        linkStartBtn.onclick = toggleMonitoring;
    }

    function updateLinkStartState() {
        if (selectedRoleInfo && selectedTargetAreaInfo) {
            linkStartBtn.disabled = false;
        }
    }

    function toggleMonitoring() {
        if (linkStartBtn.textContent === '取消重试') {
            if (retryTimeoutId) clearTimeout(retryTimeoutId);
            linkStartBtn.textContent = '开始尝试';
            linkStartBtn.style.background = 'linear-gradient(to bottom, #2196F3, #1976D2)';
            addLog('自动重试已取消');
            return;
        }
        if (statusCheckTimeoutId) stopMonitoring();
        else startMonitoring();
    }

    function startMonitoring() {
        linkStartBtn.textContent = 'STOP';
        linkStartBtn.style.background = '#f44336';
        openStatusWindow();
        addLog('开启状态查询');
        runLoop();
    }

    function stopMonitoring() {
        if (statusCheckTimeoutId) { clearTimeout(statusCheckTimeoutId); statusCheckTimeoutId = null; }
        linkStartBtn.textContent = '开始重试';
        linkStartBtn.style.background = 'linear-gradient(to bottom, #2196F3, #1976D2)';
        if (statusWindow && document.body.contains(statusWindow)) document.body.removeChild(statusWindow);
        addLog('监控已停止');
    }

    function runLoop() {
        if (!linkStartBtn || linkStartBtn.textContent !== 'STOP') return;

        addLog(`正在获取目标大区实时状态...`);
        GM_xmlhttpRequest({
            method: 'GET',
            url: 'https://ff14bjz.sdo.com/api/orderserivce/queryGroupListTravelTarget?appId=100001900&areaId=-1&groupId=-1',
            onload: (res) => {
                const data = JSON.parse(res.responseText);
                if (data.return_code === 0 && data.data) {
                    const list = JSON.parse(data.data.groupList);
                    FF14_STATUS_INFO = list.map(a => ({
                        areaId: a.areaId, areaName: a.areaName, state: a.state,
                        groups: a.groups.map(g => ({ groupId: g.groupId, groupName: g.groupName, queueTime: g.queueTime, groupCode: g.groupCode }))
                    }));
                    updateStatusUI();

                    const target = FF14_STATUS_INFO.find(a => a.areaId == selectedTargetAreaInfo.areaId);
                    if (target && (target.state === 0 || target.state === 1)) {
                        addLog(`目标大区 ${target.areaName} 可用`);
                        stopMonitoring();
                        playBeep();
                        const avGroups = target.groups.filter(g => g.queueTime === 0);
                        if (avGroups.length > 0) executeMigration(target, avGroups);
                        else addLog('目标虽开放但负载已满');
                    } else {
                        const config = getNextInterval();
                        addLog(`${config.mode}，${config.seconds} 秒后重试`);
                        statusCheckTimeoutId = setTimeout(runLoop, config.seconds * 1000);
                    }
                }
            }
        });
    }

    function getNextInterval() {
        const now = new Date();
        const min = now.getMinutes(), sec = now.getSeconds();
        const burst = document.getElementById('ff14-opt-burst').checked;
        const custom = parseInt(document.getElementById('ff14-opt-interval').value) || 30;
        const isNear = burst && ((min % 10 === 0 && sec <= 15) || (min % 10 === 9 && sec >= 55));
        return { seconds: isNear ? 1 : custom, mode: isNear ? '快速模式' : '常规模式' };
    }

    function executeMigration(targetArea, groups) {
        const sourceArea = FF14_GROUP_LIST.find(a => a.areaId == selectedRoleInfo.selectedAreaId);
        const sourceGroup = sourceArea?.groups?.find(g => g.groupId == selectedRoleInfo.selectedGroupId);

        if (!sourceArea || !sourceGroup) {
            addLog('错误: 无法获取源服务器信息');
            return;
        }

        const targetGroup = groups[Math.floor(Math.random() * groups.length)];
        const roleList = [{ roleId: selectedRoleInfo.roleId, roleName: selectedRoleInfo.roleName, key: 1 }];

        const params = new URLSearchParams({
            appId: '100001900',
            areaId: sourceArea.areaId,
            areaName: sourceArea.areaName,
            groupId: sourceGroup.groupId,
            groupCode: sourceGroup.groupCode,
            groupName: sourceGroup.groupName,
            productId: '1', productNum: '1', migrationType: '4',
            targetArea: targetArea.areaId,
            targetAreaName: targetArea.areaName,
            targetGroupId: targetGroup.groupId,
            targetGroupCode: targetGroup.groupCode,
            targetGroupName: targetGroup.groupName,
            roleList: JSON.stringify(roleList),
            isMigrationTimes: '0'
        });

        addLog(`正在提交跨区申请: ${sourceGroup.groupName} -> ${targetGroup.groupName}`);
        GM_xmlhttpRequest({
            method: 'GET',
            url: `https://ff14bjz.sdo.com/api/orderserivce/travelOrder?${params.toString()}`,
            onload: (res) => {
                const data = JSON.parse(res.responseText);
                if (data.return_code === 0 && data.data?.resultCode === 0) {
                    addLog(`跨区传送申请已提交成功`);
                    showOrderDialog(data.data.orderId);
                } else {
                    const errorMsg = data.data?.resultMsg || data.return_message || '接口拒绝';
                    addLog(`申请失败: ${errorMsg}`);
                    linkStartBtn.textContent = '取消重试';
                    linkStartBtn.style.background = '#FF9800';
                    retryTimeoutId = setTimeout(() => {
                        if (linkStartBtn.textContent === '取消重试') startMonitoring();
                    }, 80000);
                }
            },
            onerror: () => {
                addLog('网络错误，跨区申请提交失败');
            }
        });
    }

    function showOrderDialog(id) {
        const div = document.createElement('div');
        div.style = "position:fixed;top:50%;left:50%;transform:translate(-50%,-50%);background:#222;color:#fff;padding:25px;border:2px solid #4CAF50;z-index:1000010;text-align:center;border-radius:10px;box-shadow:0 0 30px #000";
        div.innerHTML = `<h3 style="color:#4CAF50">提交成功</h3><p>订单号: ${id}</p><button id="btn-go" style="padding:10px 20px;background:#4CAF50;color:#fff;border:none;cursor:pointer;">查看订单列表</button>`;
        document.body.appendChild(div);
        document.getElementById('btn-go').onclick = () => window.location.href = 'https://ff14bjz.sdo.com/orderList';
    }

    function openCharWindow() {
        if (characterSelectionWindow && document.body.contains(characterSelectionWindow)) { characterSelectionWindow.style.display='block'; return; }
        characterSelectionWindow = createWindow('win-char', '选择角色');
        characterSelectionWindow.innerHTML += `<div style="font-size:12px;"><label>区域:</label><select id="sel-area" style="width:100%;background:#333;color:#fff;"></select><label>服务器:</label><select id="sel-group" style="width:100%;background:#333;color:#fff;"></select><button id="btn-query" class="ff14-action-btn" style="width:100%;">查询角色</button><div id="r-list" class="ff14-list-container"></div><button id="btn-ok" class="ff14-action-btn" style="width:100%;display:none;">确认选择</button></div>`;
        document.body.appendChild(characterSelectionWindow);
        const aS = characterSelectionWindow.querySelector('#sel-area');
        const gS = characterSelectionWindow.querySelector('#sel-group');
        FF14_GROUP_LIST.forEach(a => aS.add(new Option(a.areaName, a.areaId)));
        aS.onchange = () => { gS.innerHTML = ""; const area = FF14_GROUP_LIST.find(a => a.areaId == aS.value); area.groups.forEach(g => gS.add(new Option(g.groupName, g.groupId))); }; aS.onchange();
        characterSelectionWindow.querySelector('#btn-query').onclick = () => {
            GM_xmlhttpRequest({
                method: 'GET',
                url: `https://ff14bjz.sdo.com/api/gmallgateway/queryRoleList4Migration?appId=100001900&areaId=${aS.value}&groupId=${gS.value}`,
                onload: (res) => {
                    const data = JSON.parse(res.responseText);
                    const roles = data.data.roleList ? JSON.parse(data.data.roleList) : [];
                    const list = characterSelectionWindow.querySelector('#r-list'); list.innerHTML = "<ul></ul>";
                    roles.forEach(r => {
                        const li = document.createElement('li'); li.textContent = r.roleName;
                        li.onclick = () => {
                            list.querySelectorAll('li').forEach(el => el.classList.remove('selected'));
                            li.classList.add('selected');
                            selectedRoleInfo = { roleId: r.roleId, roleName: r.roleName, selectedAreaId: aS.value, selectedGroupId: gS.value };
                            characterSelectionWindow.querySelector('#btn-ok').style.display='block';
                        };
                        list.firstChild.appendChild(li);
                    });
                }
            });
        };
        characterSelectionWindow.querySelector('#btn-ok').onclick = () => {
            addLog(`已选定角色: ${selectedRoleInfo.roleName}`);
            characterSelectionWindow.style.display='none';
            updateLinkStartState();
        };
        enableDrag(characterSelectionWindow, characterSelectionWindow.querySelector('.ff14-window-header'));
        characterSelectionWindow.querySelector('.ff14-window-btn').onclick = () => characterSelectionWindow.style.display='none';
    }

    function openTargetWindow() {
        if (targetAreaSelectionWindow && document.body.contains(targetAreaSelectionWindow)) { targetAreaSelectionWindow.style.display='block'; return; }
        targetAreaSelectionWindow = createWindow('win-target', '选择目标大区');
        targetAreaSelectionWindow.innerHTML += `<div id="t-list" class="ff14-list-container"><ul></ul></div><button id="btn-tok" class="ff14-action-btn" style="width:100%;display:none;">确认选择</button>`;
        document.body.appendChild(targetAreaSelectionWindow);
        const ul = targetAreaSelectionWindow.querySelector('ul');
        FF14_GROUP_LIST.forEach(a => {
            const li = document.createElement('li'); li.textContent = a.areaName;
            li.onclick = () => {
                ul.querySelectorAll('li').forEach(el => el.classList.remove('selected'));
                li.classList.add('selected');
                selectedTargetAreaInfo = { areaId: a.areaId, areaName: a.areaName };
                targetAreaSelectionWindow.querySelector('#btn-tok').style.display='block';
            };
            ul.appendChild(li);
        });
        targetAreaSelectionWindow.querySelector('#btn-tok').onclick = () => {
            addLog(`已选定目标大区: ${selectedTargetAreaInfo.areaName}`);
            targetAreaSelectionWindow.style.display='none';
            updateLinkStartState();
        };
        enableDrag(targetAreaSelectionWindow, targetAreaSelectionWindow.querySelector('.ff14-window-header'));
        targetAreaSelectionWindow.querySelector('.ff14-window-btn').onclick = () => targetAreaSelectionWindow.style.display='none';
    }

    function openStatusWindow() {
        if (statusWindow && document.body.contains(statusWindow)) return;
        statusWindow = document.createElement('div'); statusWindow.id = 'ff14-status-window';
        statusWindow.innerHTML = `<div class="ff14-window-header"><span>状态实时监控</span></div><div style="display:flex; flex:1; gap:5px; overflow:hidden;"><div id="sa-list" class="status-column"></div><div id="sg-list" class="status-column">详情</div></div>`;
        document.body.appendChild(statusWindow); enableDrag(statusWindow, statusWindow.querySelector('.ff14-window-header'));
    }

    function updateStatusUI() {
        if (!statusWindow) return; const alist = statusWindow.querySelector('#sa-list'); alist.innerHTML = "";
        FF14_STATUS_INFO.forEach(a => {
            const d = document.createElement('div');
            d.className = `status-item ${a.state === 0 ? 'status-open' : (a.state === 1 ? 'status-busy' : 'status-blocked')}`;
            d.textContent = `${a.areaName}`;
            d.onclick = () => {
                const gl = statusWindow.querySelector('#sg-list'); gl.innerHTML = "";
                a.groups.forEach(g => {
                    const gd = document.createElement('div');
                    gd.className = `status-item ${g.queueTime === 0 ? 'status-open' : 'status-busy'}`;
                    gd.textContent = `${g.groupName}`;
                    gl.appendChild(gd);
                });
            };
            alist.appendChild(d);
        });
    }

    function createWindow(id, title) {
        const win = document.createElement('div'); win.id = id; win.className = 'ff14-selection-window';
        win.innerHTML = `<div class="ff14-window-header"><span>${title}</span><div class="ff14-window-btn">×</div></div>`; return win;
    }

    function playBeep() { try { if (!audioContext) audioContext = new (window.AudioContext || window.webkitAudioContext)(); const osc = audioContext.createOscillator(); const g = audioContext.createGain(); osc.connect(g); g.connect(audioContext.destination); osc.frequency.value = 880; g.gain.linearRampToValueAtTime(0.2, audioContext.currentTime + 0.1); g.gain.exponentialRampToValueAtTime(0.01, audioContext.currentTime + 0.8); osc.start(); osc.stop(audioContext.currentTime + 0.8); } catch(e){} }

    function enableDrag(el, h) { let isD = false, ox = 0, oy = 0; h.onmousedown = (e) => { isD = true; ox = e.clientX - el.offsetLeft; oy = e.clientY - el.offsetTop; }; document.onmouseup = () => isD = false; document.onmousemove = (e) => { if (isD) { el.style.left = (e.clientX - ox) + 'px'; el.style.top = (e.clientY - oy) + 'px'; el.style.transform = 'none'; } }; }

    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', initMainUI); else initMainUI();
})();
