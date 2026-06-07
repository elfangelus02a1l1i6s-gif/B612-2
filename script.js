(function () {
    'use strict';

    const initInterval = setInterval(() => {
        const originalSelect = document.querySelector('#themes');
        const updateButton = document.querySelector('#ui-preset-update-button');
        const saveAsButton = document.querySelector('#ui-preset-save-button');

        if (originalSelect && updateButton && saveAsButton && window.SillyTavern?.getContext && !document.querySelector('#theme-manager-panel')) {
            console.log("Theme Manager (虚拟文件夹版): 初始化...");
            clearInterval(initInterval);

            try {
                const { getRequestHeaders, showLoader, hideLoader, callGenericPopup } = SillyTavern.getContext();
                
                // ========== 存储键名 ==========
                const STORAGE_KEYS = {
                    FAVORITES: 'themeManager_favorites',
                    COLLAPSE: 'themeManager_collapsed',
                    CATEGORY_ORDER: 'themeManager_categoryOrder',
                    COLLAPSED_FOLDERS: 'themeManager_collapsedFolders',
                    BG_BINDINGS: 'themeManager_backgroundBindings',
                    CHAR_BINDINGS: 'themeManager_characterThemeBindings',
                    FOLDER_MAP: 'themeManager_folderMap'  // 虚拟文件夹映射
                };

                // ========== 虚拟文件夹数据：{ "文件夹名": ["美化名1", "美化名2"] } ==========
                let folderMap = JSON.parse(localStorage.getItem(STORAGE_KEYS.FOLDER_MAP)) || {};
                let favorites = JSON.parse(localStorage.getItem(STORAGE_KEYS.FAVORITES)) || [];
                let themeBackgroundBindings = JSON.parse(localStorage.getItem(STORAGE_KEYS.BG_BINDINGS)) || {};
                
                let allThemeNames = [];
                let allThemeObjects = [];
                let refreshNeeded = false;
                let isReorderMode = false;
                let isManageBgMode = false;
                let isBindingMode = false;
                let themeNameToBind = null;
                let selectedBackgrounds = new Set();
                let isBatchEditMode = false;
                let selectedForBatch = new Set();
                let selectedFoldersForBatch = new Set();

                // ========== 辅助函数 ==========
                async function apiRequest(endpoint, method = 'POST', body = {}) {
                    try {
                        const headers = getRequestHeaders();
                        const options = { method, headers, body: JSON.stringify(body) };
                        const response = await fetch(`/api/${endpoint}`, options);
                        const responseText = await response.text();
                        if (!response.ok) throw new Error(responseText || `HTTP ${response.status}`);
                        if (responseText.trim().toUpperCase() === 'OK') return { status: 'OK' };
                        return responseText ? JSON.parse(responseText) : {};
                    } catch (error) {
                        console.error(`API error:`, error);
                        toastr.error(`API请求失败: ${error.message}`);
                        throw error;
                    }
                }

                async function getAllThemesFromAPI() { return (await apiRequest('settings/get', 'POST', {})).themes || []; }
                async function deleteTheme(themeName) { await apiRequest('themes/delete', 'POST', { name: themeName }); }
                async function saveTheme(themeObject) { await apiRequest('themes/save', 'POST', themeObject); }

                async function deleteBackground(bgFile) {
                    const headers = getRequestHeaders();
                    await fetch('/api/backgrounds/delete', {
                        method: 'POST',
                        headers: headers,
                        body: JSON.stringify({ bg: bgFile })
                    });
                }

                async function uploadBackground(formData) {
                    const headers = getRequestHeaders();
                    delete headers['Content-Type'];
                    await fetch('/api/backgrounds/upload', { method: 'POST', headers, body: formData });
                }

                function manualUpdateOriginalSelect(action, oldName, newName) {
                    const select = document.querySelector('#themes');
                    if (!select) return;
                    if (action === 'add') {
                        const opt = document.createElement('option');
                        opt.value = newName; opt.textContent = newName;
                        select.appendChild(opt);
                    } else if (action === 'delete') {
                        const opt = select.querySelector(`option[value="${oldName}"]`);
                        if (opt) opt.remove();
                    } else if (action === 'rename') {
                        const opt = select.querySelector(`option[value="${oldName}"]`);
                        if (opt) { opt.value = newName; opt.textContent = newName; }
                    }
                }

                // 获取美化的纯净名称（去掉所有 [标签]）
                function getCleanName(themeName) {
                    return themeName.replace(/\[[^\]]*\]/g, '').trim() || themeName;
                }

                // 保存虚拟文件夹数据
                function saveFolderMap() {
                    localStorage.setItem(STORAGE_KEYS.FOLDER_MAP, JSON.stringify(folderMap));
                }

                // 将美化添加到虚拟文件夹（不改文件名）
                function addThemeToFolder(themeName, folderName) {
                    if (!folderMap[folderName]) folderMap[folderName] = [];
                    if (!folderMap[folderName].includes(themeName)) {
                        folderMap[folderName].push(themeName);
                        saveFolderMap();
                    }
                }

                // 从虚拟文件夹移除美化
                function removeThemeFromFolder(themeName, folderName) {
                    if (folderMap[folderName]) {
                        folderMap[folderName] = folderMap[folderName].filter(t => t !== themeName);
                        if (folderMap[folderName].length === 0) delete folderMap[folderName];
                        saveFolderMap();
                    }
                }

                // 重命名虚拟文件夹（不修改任何美化文件）
                function renameFolder(oldName, newName) {
                    if (folderMap[oldName]) {
                        folderMap[newName] = folderMap[oldName];
                        delete folderMap[oldName];
                        saveFolderMap();
                    }
                    // 更新排序
                    let order = JSON.parse(localStorage.getItem(STORAGE_KEYS.CATEGORY_ORDER)) || [];
                    const idx = order.indexOf(oldName);
                    if (idx !== -1) order[idx] = newName;
                    localStorage.setItem(STORAGE_KEYS.CATEGORY_ORDER, JSON.stringify(order));
                    // 更新折叠状态
                    let collapsed = JSON.parse(localStorage.getItem(STORAGE_KEYS.COLLAPSED_FOLDERS)) || [];
                    if (collapsed.includes(oldName)) {
                        collapsed = collapsed.filter(c => c !== oldName);
                        collapsed.push(newName);
                        localStorage.setItem(STORAGE_KEYS.COLLAPSED_FOLDERS, JSON.stringify(collapsed));
                    }
                }

                // 删除虚拟文件夹（不删除任何美化文件）
                function deleteFolder(folderName) {
                    delete folderMap[folderName];
                    saveFolderMap();
                    let order = JSON.parse(localStorage.getItem(STORAGE_KEYS.CATEGORY_ORDER)) || [];
                    order = order.filter(c => c !== folderName);
                    localStorage.setItem(STORAGE_KEYS.CATEGORY_ORDER, JSON.stringify(order));
                    let collapsed = JSON.parse(localStorage.getItem(STORAGE_KEYS.COLLAPSED_FOLDERS)) || [];
                    collapsed = collapsed.filter(c => c !== folderName);
                    localStorage.setItem(STORAGE_KEYS.COLLAPSED_FOLDERS, JSON.stringify(collapsed));
                }

                function showRefreshNotification() {
                    if (!refreshNeeded) {
                        refreshNeeded = true;
                        const notice = document.querySelector('#theme-manager-refresh-notice');
                        if (notice) notice.style.display = 'block';
                    }
                }

                // ========== 构建UI ==========
                const originalContainer = originalSelect.parentElement;
                if (!originalContainer) return;
                originalSelect.style.display = 'none';

                const managerPanel = document.createElement('div');
                managerPanel.id = 'theme-manager-panel';
                managerPanel.innerHTML = `
                    <div id="theme-manager-header">
                        <h4>🎨 主题美化管理</h4>
                        <div id="native-buttons-container"></div>
                        <div id="theme-manager-toggle-icon" class="fa-solid fa-chevron-down"></div>
                    </div>
                    <div id="theme-manager-content">
                        <div id="theme-manager-refresh-notice" style="display:none; margin:10px 0; padding:10px; background:rgba(255,193,7,0.15); border:1px solid #ffc107; border-radius:5px; text-align:center;">
                            💡 <b>提示：</b>检测到文件变更。请<a id="theme-manager-refresh-page-btn" style="color:#007bff; cursor:pointer;">刷新页面</a>。
                        </div>
                        <div class="theme-manager-actions" data-mode="theme">
                            <div class="tm-button-row">
                                <input type="search" id="theme-search-box" placeholder="🔍 搜索主题...">
                                <button id="random-theme-btn" class="menu_button">🎲 随机</button>
                            </div>
                            <div class="tm-button-row">
                                <button id="batch-edit-btn" class="menu_button">🔧 批量编辑</button>
                                <button id="batch-import-btn" class="menu_button">📂 批量导入</button>
                                <button id="manage-bgs-btn" class="menu_button">🖼️ 管理背景</button>
                            </div>
                        </div>
                        <div class="theme-manager-actions" data-mode="shared">
                            <div class="tm-button-row">
                                <button id="reorder-mode-btn" class="menu_button">🔄 调整顺序</button>
                                <button id="expand-all-btn" class="menu_button">全部展开</button>
                                <button id="collapse-all-btn" class="menu_button">全部折叠</button>
                            </div>
                            <div class="tm-button-row">
                                <button id="tm-export-settings-btn" class="menu_button">📤 导出配置</button>
                                <button id="tm-import-settings-btn" class="menu_button">📥 导入配置</button>
                            </div>
                        </div>
                        <div id="background-actions-bar" style="display:none;">
                            <button id="batch-import-bg-btn" class="menu_button">➕ 批量导入背景</button>
                            <button id="batch-delete-bg-btn" class="menu_button" disabled>🗑️ 删除选中背景</button>
                        </div>
                        <div id="batch-actions-bar" style="display:none;">
                            <button id="batch-add-folder-btn">📁 添加到文件夹</button>
                            <button id="batch-move-folder-btn">➡️ 移动到文件夹</button>
                            <button id="batch-remove-folder-btn">❌ 移出文件夹</button>
                            <button id="batch-delete-btn">🗑️ 删除选中</button>
                        </div>
                        <div class="theme-content"></div>
                    </div>`;
                originalContainer.prepend(managerPanel);

                const nativeContainer = managerPanel.querySelector('#native-buttons-container');
                nativeContainer.appendChild(updateButton);
                nativeContainer.appendChild(saveAsButton);

                const header = managerPanel.querySelector('#theme-manager-header');
                const content = managerPanel.querySelector('#theme-manager-content');
                const toggleIcon = managerPanel.querySelector('#theme-manager-toggle-icon');
                const contentWrapper = managerPanel.querySelector('.theme-content');
                const searchBox = managerPanel.querySelector('#theme-search-box');
                const randomBtn = managerPanel.querySelector('#random-theme-btn');
                const batchEditBtn = managerPanel.querySelector('#batch-edit-btn');
                const batchActionsBar = managerPanel.querySelector('#batch-actions-bar');
                const reorderModeBtn = managerPanel.querySelector('#reorder-mode-btn');
                const expandAllBtn = managerPanel.querySelector('#expand-all-btn');
                const collapseAllBtn = managerPanel.querySelector('#collapse-all-btn');
                const manageBgsBtn = managerPanel.querySelector('#manage-bgs-btn');
                const backgroundActionsBar = managerPanel.querySelector('#background-actions-bar');
                const batchImportBgBtn = managerPanel.querySelector('#batch-import-bg-btn');
                const batchDeleteBgBtn = managerPanel.querySelector('#batch-delete-bg-btn');
                const refreshBtn = managerPanel.querySelector('#theme-manager-refresh-page-btn');
                if (refreshBtn) refreshBtn.addEventListener('click', () => location.reload());

                // 文件输入
                const fileInput = document.createElement('input');
                fileInput.type = 'file';
                fileInput.multiple = true;
                fileInput.accept = '.json';
                fileInput.style.display = 'none';
                document.body.appendChild(fileInput);

                const bgFileInput = document.createElement('input');
                bgFileInput.type = 'file';
                bgFileInput.multiple = true;
                bgFileInput.accept = 'image/*,video/*';
                bgFileInput.style.display = 'none';
                document.body.appendChild(bgFileInput);

                const settingsFileInput = document.createElement('input');
                settingsFileInput.type = 'file';
                settingsFileInput.accept = '.json';
                settingsFileInput.style.display = 'none';
                document.body.appendChild(settingsFileInput);

                // ========== 核心渲染函数 ==========
                async function buildThemeUI() {
                    const scrollTop = contentWrapper.scrollTop;
                    contentWrapper.innerHTML = '正在加载主题...';
                    try {
                        allThemeObjects = await getAllThemesFromAPI();
                        allThemeNames = allThemeObjects.map(t => t.name);
                        
                        // 获取所有虚拟文件夹
                        const allFolders = Object.keys(folderMap);
                        
                        // 按保存的顺序排序
                        let savedOrder = JSON.parse(localStorage.getItem(STORAGE_KEYS.CATEGORY_ORDER)) || [];
                        const sortedFolders = [...savedOrder.filter(f => allFolders.includes(f)), ...allFolders.filter(f => !savedOrder.includes(f))];
                        
                        const categories = ['⭐ 收藏夹', ...sortedFolders];
                        if (allThemeNames.length > 0) categories.push('未分类');
                        
                        const collapsedFolders = new Set(JSON.parse(localStorage.getItem(STORAGE_KEYS.COLLAPSED_FOLDERS)) || []);

                        contentWrapper.innerHTML = '';

                        for (const category of categories) {
                            let themesInCategory = [];
                            if (category === '⭐ 收藏夹') {
                                themesInCategory = favorites.filter(f => allThemeNames.includes(f));
                            } else if (category === '未分类') {
                                const allInFolders = new Set(Object.values(folderMap).flat());
                                themesInCategory = allThemeNames.filter(t => !allInFolders.has(t) && !favorites.includes(t));
                            } else {
                                themesInCategory = (folderMap[category] || []).filter(t => allThemeNames.includes(t));
                            }
                            
                            if (themesInCategory.length === 0 && category !== '未分类') continue;

                            const categoryDiv = document.createElement('div');
                            categoryDiv.className = 'theme-category';
                            categoryDiv.dataset.categoryName = category;
                            
                            const title = document.createElement('div');
                            title.className = 'theme-category-title';
                            
                            let titleHTML = '';
                            if (category !== '⭐ 收藏夹' && category !== '未分类') {
                                titleHTML += `<input type="checkbox" class="folder-select-checkbox">`;
                            }
                            titleHTML += `<span>${category}</span>`;
                            if (category !== '⭐ 收藏夹' && category !== '未分类') {
                                titleHTML += `
                                    <div class="folder-buttons">
                                        <button class="rename-folder-btn">✏️</button>
                                        <button class="dissolve-folder-btn">解散</button>
                                    </div>
                                    <div class="folder-reorder-buttons">
                                        <button class="move-folder-up-btn">🔼</button>
                                        <button class="move-folder-down-btn">🔽</button>
                                    </div>
                                `;
                            }
                            title.innerHTML = titleHTML;

                            const list = document.createElement('ul');
                            list.className = 'theme-list';
                            list.style.display = collapsedFolders.has(category) ? 'none' : 'block';

                            for (const themeName of themesInCategory) {
                                const item = document.createElement('li');
                                item.className = 'theme-item';
                                item.dataset.value = themeName;
                                const isFavorited = favorites.includes(themeName);
                                const starChar = isFavorited ? '★' : '☆';
                                const isBound = !!themeBackgroundBindings[themeName];
                                // 关键：显示纯净名称，不包含任何文件夹前缀
                                const displayName = getCleanName(themeName);

                                item.innerHTML = `
                                    <span class="theme-item-name">${displayName}</span>
                                    <div class="theme-item-buttons">
                                        <button class="link-bg-btn ${isBound ? 'linked' : ''}">🔗</button>
                                        <button class="unbind-bg-btn" style="display: ${isBound ? 'inline-block' : 'none'}">🚫</button>
                                        <button class="favorite-btn">${starChar}</button>
                                        <button class="rename-btn">✏️</button>
                                        <button class="delete-btn">🗑️</button>
                                    </div>`;
                                list.appendChild(item);
                            }

                            categoryDiv.appendChild(title);
                            categoryDiv.appendChild(list);
                            contentWrapper.appendChild(categoryDiv);
                        }

                        contentWrapper.scrollTop = scrollTop;
                        updateActiveState();
                    } catch (err) {
                        contentWrapper.innerHTML = '加载主题失败';
                        console.error(err);
                    }
                }

                function updateActiveState() {
                    const currentValue = originalSelect.value;
                    managerPanel.querySelectorAll('.theme-item').forEach(item => {
                        item.classList.toggle('active', item.dataset.value === currentValue);
                    });
                }

                function saveCategoryOrder() {
                    const order = Array.from(contentWrapper.querySelectorAll('.theme-category'))
                        .map(div => div.dataset.categoryName)
                        .filter(name => name && name !== '⭐ 收藏夹' && name !== '未分类');
                    localStorage.setItem(STORAGE_KEYS.CATEGORY_ORDER, JSON.stringify(order));
                    toastr.info('文件夹顺序已保存');
                }

                function setCollapsed(isCollapsed, animate = false) {
                    if (isCollapsed) {
                        content.style.maxHeight = '0px';
                        content.style.paddingTop = '0px';
                        content.style.paddingBottom = '0px';
                        toggleIcon.classList.add('collapsed');
                        localStorage.setItem(STORAGE_KEYS.COLLAPSE, 'true');
                    } else {
                        content.style.paddingTop = '';
                        content.style.paddingBottom = '';
                        content.style.maxHeight = '';
                        toggleIcon.classList.remove('collapsed');
                        localStorage.setItem(STORAGE_KEYS.COLLAPSE, 'false');
                    }
                }

                // ========== 背景管理UI ==========
                async function renderBackgroundManagerUI() {
                    contentWrapper.innerHTML = '正在加载背景图...';
                    const bgListContainer = document.createElement('div');
                    bgListContainer.className = 'bg_list';
                    
                    const systemBgs = document.querySelectorAll('#bg_menu_content .bg_example');
                    const customBgs = document.querySelectorAll('#bg_custom_content .bg_example');
                    const allBgs = [...systemBgs, ...customBgs];

                    allBgs.forEach(bg => {
                        if (bg.querySelector('.add_bg_but')) return;
                        const bgFile = bg.getAttribute('bgfile');
                        if (!bgFile) return;
                        
                        const clone = bg.cloneNode(true);
                        const checkbox = document.createElement('input');
                        checkbox.type = 'checkbox';
                        checkbox.className = 'bg-select-checkbox';
                        checkbox.dataset.bgfile = bgFile;
                        checkbox.checked = selectedBackgrounds.has(bgFile);
                        checkbox.addEventListener('change', () => {
                            if (checkbox.checked) {
                                selectedBackgrounds.add(bgFile);
                                clone.classList.add('selected-for-batch');
                            } else {
                                selectedBackgrounds.delete(bgFile);
                                clone.classList.remove('selected-for-batch');
                            }
                            batchDeleteBgBtn.disabled = selectedBackgrounds.size === 0;
                        });
                        clone.prepend(checkbox);
                        clone.addEventListener('click', (e) => { if (e.target !== checkbox) checkbox.click(); });
                        if (selectedBackgrounds.has(bgFile)) clone.classList.add('selected-for-batch');
                        bgListContainer.appendChild(clone);
                    });

                    contentWrapper.innerHTML = '';
                    if (bgListContainer.children.length === 0) {
                        contentWrapper.innerHTML = '没有找到背景图。';
                    } else {
                        contentWrapper.appendChild(bgListContainer);
                    }
                    batchDeleteBgBtn.disabled = selectedBackgrounds.size === 0;
                }

                // ========== 批量操作（虚拟文件夹，不改文件名） ==========
                async function performBatchDelete() {
                    if (selectedForBatch.size === 0) { toastr.info('请先选择主题'); return; }
                    if (!confirm(`确定删除 ${selectedForBatch.size} 个主题吗？`)) return;
                    showLoader();
                    for (const themeName of selectedForBatch) {
                        const isActive = originalSelect.value === themeName;
                        await deleteTheme(themeName);
                        manualUpdateOriginalSelect('delete', themeName);
                        delete themeBackgroundBindings[themeName];
                        // 从所有虚拟文件夹中移除
                        for (const folder of Object.keys(folderMap)) {
                            removeThemeFromFolder(themeName, folder);
                        }
                        favorites = favorites.filter(f => f !== themeName);
                        if (isActive) {
                            const firstOpt = originalSelect.querySelector('option');
                            originalSelect.value = firstOpt?.value || '';
                            originalSelect.dispatchEvent(new Event('change'));
                        }
                    }
                    localStorage.setItem(STORAGE_KEYS.FAVORITES, JSON.stringify(favorites));
                    localStorage.setItem(STORAGE_KEYS.BG_BINDINGS, JSON.stringify(themeBackgroundBindings));
                    hideLoader();
                    selectedForBatch.clear();
                    toastr.success('批量删除完成');
                    showRefreshNotification();
                    await buildThemeUI();
                }

                async function batchAddToFolder() {
                    if (selectedForBatch.size === 0) { toastr.info('请先选择主题'); return; }
                    const folderName = prompt('请输入文件夹名称:');
                    if (!folderName || !folderName.trim()) return;
                    for (const themeName of selectedForBatch) {
                        addThemeToFolder(themeName, folderName.trim());
                    }
                    toastr.success(`已将 ${selectedForBatch.size} 个主题添加到文件夹`);
                    selectedForBatch.clear();
                    await buildThemeUI();
                }

                async function batchMoveToFolder() {
                    if (selectedForBatch.size === 0) { toastr.info('请先选择主题'); return; }
                    const folderName = prompt('请输入目标文件夹名称:');
                    if (!folderName || !folderName.trim()) return;
                    // 先从所有文件夹移除
                    for (const themeName of selectedForBatch) {
                        for (const folder of Object.keys(folderMap)) {
                            removeThemeFromFolder(themeName, folder);
                        }
                        addThemeToFolder(themeName, folderName.trim());
                    }
                    toastr.success(`已将 ${selectedForBatch.size} 个主题移动到文件夹`);
                    selectedForBatch.clear();
                    await buildThemeUI();
                }

                async function batchRemoveFromFolder() {
                    if (selectedForBatch.size === 0) { toastr.info('请先选择主题'); return; }
                    const folderName = prompt('请从哪个文件夹移出？(输入文件夹名)');
                    if (!folderName || !folderName.trim()) return;
                    for (const themeName of selectedForBatch) {
                        removeThemeFromFolder(themeName, folderName.trim());
                    }
                    toastr.success(`已将 ${selectedForBatch.size} 个主题移出文件夹`);
                    selectedForBatch.clear();
                    await buildThemeUI();
                }

                // ========== 配置导出导入 ==========
                const settingsKeysToSync = [
                    STORAGE_KEYS.FAVORITES,
                    STORAGE_KEYS.COLLAPSE,
                    STORAGE_KEYS.CATEGORY_ORDER,
                    STORAGE_KEYS.COLLAPSED_FOLDERS,
                    STORAGE_KEYS.BG_BINDINGS,
                    STORAGE_KEYS.CHAR_BINDINGS,
                    STORAGE_KEYS.FOLDER_MAP
                ];

                function exportSettings() {
                    const exportData = {
                        [STORAGE_KEYS.FAVORITES]: favorites,
                        [STORAGE_KEYS.CATEGORY_ORDER]: localStorage.getItem(STORAGE_KEYS.CATEGORY_ORDER),
                        [STORAGE_KEYS.COLLAPSED_FOLDERS]: localStorage.getItem(STORAGE_KEYS.COLLAPSED_FOLDERS),
                        [STORAGE_KEYS.BG_BINDINGS]: themeBackgroundBindings,
                        [STORAGE_KEYS.CHAR_BINDINGS]: localStorage.getItem(STORAGE_KEYS.CHAR_BINDINGS),
                        [STORAGE_KEYS.FOLDER_MAP]: folderMap
                    };
                    const blob = new Blob([JSON.stringify(exportData, null, 2)], { type: 'application/json' });
                    const a = document.createElement('a');
                    a.href = URL.createObjectURL(blob);
                    a.download = 'theme_manager_config.json';
                    a.click();
                    URL.revokeObjectURL(a.href);
                    toastr.success('配置已导出');
                }

                async function importSettings(event) {
                    const file = event.target.files[0];
                    if (!file) return;
                    const content = await file.text();
                    const data = JSON.parse(content);
                    if (data[STORAGE_KEYS.FAVORITES]) favorites = data[STORAGE_KEYS.FAVORITES];
                    if (data[STORAGE_KEYS.CATEGORY_ORDER]) localStorage.setItem(STORAGE_KEYS.CATEGORY_ORDER, data[STORAGE_KEYS.CATEGORY_ORDER]);
                    if (data[STORAGE_KEYS.COLLAPSED_FOLDERS]) localStorage.setItem(STORAGE_KEYS.COLLAPSED_FOLDERS, data[STORAGE_KEYS.COLLAPSED_FOLDERS]);
                    if (data[STORAGE_KEYS.BG_BINDINGS]) themeBackgroundBindings = data[STORAGE_KEYS.BG_BINDINGS];
                    if (data[STORAGE_KEYS.CHAR_BINDINGS]) localStorage.setItem(STORAGE_KEYS.CHAR_BINDINGS, data[STORAGE_KEYS.CHAR_BINDINGS]);
                    if (data[STORAGE_KEYS.FOLDER_MAP]) folderMap = data[STORAGE_KEYS.FOLDER_MAP];
                    localStorage.setItem(STORAGE_KEYS.FAVORITES, JSON.stringify(favorites));
                    localStorage.setItem(STORAGE_KEYS.BG_BINDINGS, JSON.stringify(themeBackgroundBindings));
                    saveFolderMap();
                    toastr.success('配置已导入，请刷新页面');
                    showRefreshNotification();
                    await buildThemeUI();
                    event.target.value = '';
                }

                // ========== 事件绑定 ==========
                header.addEventListener('click', (e) => {
                    if (e.target.closest('#native-buttons-container')) return;
                    setCollapsed(content.style.maxHeight !== '0px', true);
                });

                searchBox.addEventListener('input', (e) => {
                    const term = e.target.value.toLowerCase();
                    managerPanel.querySelectorAll('.theme-item').forEach(item => {
                        const name = item.querySelector('.theme-item-name').textContent.toLowerCase();
                        item.style.display = name.includes(term) ? 'flex' : 'none';
                    });
                    if (!term) buildThemeUI();
                });

                randomBtn.addEventListener('click', async () => {
                    const themes = await getAllThemesFromAPI();
                    if (themes.length) {
                        const random = Math.floor(Math.random() * themes.length);
                        originalSelect.value = themes[random].name;
                        originalSelect.dispatchEvent(new Event('change'));
                    }
                });

                batchEditBtn.addEventListener('click', () => {
                    isBatchEditMode = !isBatchEditMode;
                    managerPanel.classList.toggle('batch-edit-mode', isBatchEditMode);
                    batchActionsBar.style.display = isBatchEditMode ? 'flex' : 'none';
                    batchEditBtn.classList.toggle('selected', isBatchEditMode);
                    batchEditBtn.textContent = isBatchEditMode ? '退出批量编辑' : '🔧 批量编辑';
                    if (!isBatchEditMode) {
                        selectedForBatch.clear();
                        selectedFoldersForBatch.clear();
                        managerPanel.querySelectorAll('.selected-for-batch').forEach(el => el.classList.remove('selected-for-batch'));
                    }
                });

                reorderModeBtn.addEventListener('click', () => {
                    isReorderMode = !isReorderMode;
                    managerPanel.classList.toggle('reorder-mode', isReorderMode);
                    reorderModeBtn.classList.toggle('selected', isReorderMode);
                    reorderModeBtn.textContent = isReorderMode ? '完成排序' : '🔄 调整顺序';
                });

                manageBgsBtn.addEventListener('click', () => {
                    isManageBgMode = !isManageBgMode;
                    managerPanel.classList.toggle('manage-bg-mode', isManageBgMode);
                    manageBgsBtn.classList.toggle('selected', isManageBgMode);
                    manageBgsBtn.textContent = isManageBgMode ? '完成管理' : '🖼️ 管理背景';
                    backgroundActionsBar.style.display = isManageBgMode ? 'flex' : 'none';
                    if (isManageBgMode) {
                        if (isBatchEditMode) batchEditBtn.click();
                        renderBackgroundManagerUI();
                    } else {
                        selectedBackgrounds.clear();
                        buildThemeUI();
                    }
                });

                expandAllBtn.addEventListener('click', () => {
                    localStorage.setItem(STORAGE_KEYS.COLLAPSED_FOLDERS, JSON.stringify([]));
                    buildThemeUI();
                });

                collapseAllBtn.addEventListener('click', () => {
                    const folders = Array.from(contentWrapper.querySelectorAll('.theme-category')).map(d => d.dataset.categoryName).filter(n => n && n !== '⭐ 收藏夹');
                    localStorage.setItem(STORAGE_KEYS.COLLAPSED_FOLDERS, JSON.stringify(folders));
                    buildThemeUI();
                });

                fileInput.addEventListener('change', async (e) => {
                    const files = e.target.files;
                    if (!files.length) return;
                    showLoader();
                    let success = 0, fail = 0;
                    for (const file of files) {
                        try {
                            const content = await file.text();
                            const theme = JSON.parse(content);
                            if (theme && theme.name) {
                                await saveTheme(theme);
                                success++;
                            } else fail++;
                        } catch { fail++; }
                    }
                    hideLoader();
                    toastr.success(`导入完成: 成功 ${success}, 失败 ${fail}`);
                    showRefreshNotification();
                    await buildThemeUI();
                    e.target.value = '';
                });

                batchImportBtn.addEventListener('click', () => fileInput.click());

                bgFileInput.addEventListener('change', async (e) => {
                    const files = e.target.files;
                    if (!files.length) return;
                    showLoader();
                    let success = 0, fail = 0;
                    for (const file of files) {
                        try {
                            const fd = new FormData();
                            fd.append('avatar', file);
                            await uploadBackground(fd);
                            success++;
                        } catch { fail++; }
                    }
                    hideLoader();
                    toastr.success(`背景导入: 成功 ${success}, 失败 ${fail}`);
                    showRefreshNotification();
                    if (isManageBgMode) setTimeout(() => renderBackgroundManagerUI(), 100);
                    e.target.value = '';
                });

                batchImportBgBtn.addEventListener('click', () => bgFileInput.click());

                batchDeleteBgBtn.addEventListener('click', async () => {
                    if (selectedBackgrounds.size === 0) return;
                    if (!confirm(`删除 ${selectedBackgrounds.size} 个背景图？`)) return;
                    showLoader();
                    for (const bg of selectedBackgrounds) {
                        try { await deleteBackground(bg); } catch(e) {}
                    }
                    selectedBackgrounds.clear();
                    hideLoader();
                    toastr.success('背景删除完成');
                    showRefreshNotification();
                    if (isManageBgMode) setTimeout(() => renderBackgroundManagerUI(), 100);
                });

                managerPanel.querySelector('#batch-add-folder-btn')?.addEventListener('click', batchAddToFolder);
                managerPanel.querySelector('#batch-move-folder-btn')?.addEventListener('click', batchMoveToFolder);
                managerPanel.querySelector('#batch-remove-folder-btn')?.addEventListener('click', batchRemoveFromFolder);
                managerPanel.querySelector('#batch-delete-btn')?.addEventListener('click', performBatchDelete);

                managerPanel.querySelector('#tm-export-settings-btn')?.addEventListener('click', exportSettings);
                managerPanel.querySelector('#tm-import-settings-btn')?.addEventListener('click', () => settingsFileInput.click());
                settingsFileInput.addEventListener('change', importSettings);

                // 内容区域点击事件
                contentWrapper.addEventListener('click', async (e) => {
                    const btn = e.target.closest('button');
                    const item = e.target.closest('.theme-item');
                    const title = e.target.closest('.theme-category-title');
                    const folderCheckbox = e.target.closest('.folder-select-checkbox');

                    if (isBatchEditMode && folderCheckbox) {
                        const titleEl = folderCheckbox.closest('.theme-category-title');
                        const folderName = titleEl.parentElement.dataset.categoryName;
                        if (folderCheckbox.checked) {
                            selectedFoldersForBatch.add(folderName);
                            titleEl.classList.add('selected-for-batch');
                        } else {
                            selectedFoldersForBatch.delete(folderName);
                            titleEl.classList.remove('selected-for-batch');
                        }
                        return;
                    }

                    if (title) {
                        // 重命名虚拟文件夹
                        if (btn?.classList.contains('rename-folder-btn')) {
                            const folderName = title.parentElement.dataset.categoryName;
                            const newName = prompt('新文件夹名:', folderName);
                            if (newName && newName.trim() && newName !== folderName) {
                                renameFolder(folderName, newName.trim());
                                await buildThemeUI();
                                toastr.success(`文件夹已重命名为: ${newName}`);
                            }
                            return;
                        }
                        // 解散虚拟文件夹
                        if (btn?.classList.contains('dissolve-folder-btn')) {
                            const folderName = title.parentElement.dataset.categoryName;
                            if (confirm(`确定解散文件夹 "${folderName}" 吗？美化不会被删除。`)) {
                                deleteFolder(folderName);
                                await buildThemeUI();
                                toastr.success(`文件夹已解散`);
                            }
                            return;
                        }
                        // 移动文件夹顺序
                        if (btn?.classList.contains('move-folder-up-btn')) {
                            const current = title.parentElement;
                            const prev = current.previousElementSibling;
                            if (prev && prev.dataset.categoryName !== '⭐ 收藏夹') {
                                contentWrapper.insertBefore(current, prev);
                                saveCategoryOrder();
                            }
                            return;
                        }
                        if (btn?.classList.contains('move-folder-down-btn')) {
                            const current = title.parentElement;
                            const next = current.nextElementSibling;
                            if (next && next.dataset.categoryName !== '未分类') {
                                contentWrapper.insertBefore(next, current);
                                saveCategoryOrder();
                            }
                            return;
                        }
                        // 折叠/展开
                        const list = title.nextElementSibling;
                        if (list) {
                            const isHidden = list.style.display === 'none';
                            list.style.display = isHidden ? 'block' : 'none';
                            const folderName = title.parentElement.dataset.categoryName;
                            let collapsed = JSON.parse(localStorage.getItem(STORAGE_KEYS.COLLAPSED_FOLDERS)) || [];
                            if (!isHidden) collapsed.push(folderName);
                            else collapsed = collapsed.filter(c => c !== folderName);
                            localStorage.setItem(STORAGE_KEYS.COLLAPSED_FOLDERS, JSON.stringify(collapsed));
                        }
                        return;
                    }

                    if (!item) return;
                    const themeName = item.dataset.value;

                    if (isBatchEditMode) {
                        if (selectedForBatch.has(themeName)) {
                            selectedForBatch.delete(themeName);
                            item.classList.remove('selected-for-batch');
                        } else {
                            selectedForBatch.add(themeName);
                            item.classList.add('selected-for-batch');
                        }
                        return;
                    }

                    // 收藏
                    if (btn?.classList.contains('favorite-btn')) {
                        if (favorites.includes(themeName)) {
                            favorites = favorites.filter(f => f !== themeName);
                            btn.textContent = '☆';
                        } else {
                            favorites.push(themeName);
                            btn.textContent = '★';
                        }
                        localStorage.setItem(STORAGE_KEYS.FAVORITES, JSON.stringify(favorites));
                        await buildThemeUI();
                        return;
                    }

                    // 删除
                    if (btn?.classList.contains('delete-btn')) {
                        if (confirm(`删除主题 "${getCleanName(themeName)}"？`)) {
                            const isActive = originalSelect.value === themeName;
                            await deleteTheme(themeName);
                            manualUpdateOriginalSelect('delete', themeName);
                            delete themeBackgroundBindings[themeName];
                            for (const folder of Object.keys(folderMap)) {
                                removeThemeFromFolder(themeName, folder);
                            }
                            favorites = favorites.filter(f => f !== themeName);
                            localStorage.setItem(STORAGE_KEYS.FAVORITES, JSON.stringify(favorites));
                            localStorage.setItem(STORAGE_KEYS.BG_BINDINGS, JSON.stringify(themeBackgroundBindings));
                            if (isActive) {
                                const firstOpt = originalSelect.querySelector('option');
                                originalSelect.value = firstOpt?.value || '';
                                originalSelect.dispatchEvent(new Event('change'));
                            }
                            showRefreshNotification();
                            await buildThemeUI();
                            toastr.success('已删除');
                        }
                        return;
                    }

                    // 背景绑定
                    if (btn?.classList.contains('link-bg-btn')) {
                        isBindingMode = true;
                        themeNameToBind = themeName;
                        const toggle = document.querySelector('#backgrounds-drawer-toggle') || document.querySelector('#logo_block .drawer-toggle');
                        if (toggle) toggle.click();
                        toastr.info('在背景面板中选择图片绑定');
                        return;
                    }

                    if (btn?.classList.contains('unbind-bg-btn')) {
                        delete themeBackgroundBindings[themeName];
                        localStorage.setItem(STORAGE_KEYS.BG_BINDINGS, JSON.stringify(themeBackgroundBindings));
                        await buildThemeUI();
                        toastr.success('已解绑背景');
                        return;
                    }

                    // 重命名美化（实际修改文件）
                    if (btn?.classList.contains('rename-btn')) {
                        const newName = prompt(`重命名主题 (当前: ${getCleanName(themeName)})`, themeName);
                        if (newName && newName.trim() && newName !== themeName) {
                            const themeObj = allThemeObjects.find(t => t.name === themeName);
                            if (themeObj) {
                                showLoader();
                                const newTheme = { ...themeObj, name: newName.trim() };
                                await saveTheme(newTheme);
                                await deleteTheme(themeName);
                                manualUpdateOriginalSelect('rename', themeName, newName.trim());
                                // 更新绑定
                                if (themeBackgroundBindings[themeName]) {
                                    themeBackgroundBindings[newName.trim()] = themeBackgroundBindings[themeName];
                                    delete themeBackgroundBindings[themeName];
                                    localStorage.setItem(STORAGE_KEYS.BG_BINDINGS, JSON.stringify(themeBackgroundBindings));
                                }
                                // 更新收藏
                                if (favorites.includes(themeName)) {
                                    favorites = favorites.filter(f => f !== themeName);
                                    favorites.push(newName.trim());
                                    localStorage.setItem(STORAGE_KEYS.FAVORITES, JSON.stringify(favorites));
                                }
                                // 更新虚拟文件夹映射
                                for (const folder of Object.keys(folderMap)) {
                                    if (folderMap[folder].includes(themeName)) {
                                        folderMap[folder] = folderMap[folder].filter(t => t !== themeName);
                                        folderMap[folder].push(newName.trim());
                                    }
                                }
                                saveFolderMap();
                                hideLoader();
                                showRefreshNotification();
                                await buildThemeUI();
                                toastr.success('已重命名');
                            }
                        }
                        return;
                    }

                    // 应用主题
                    originalSelect.value = themeName;
                    originalSelect.dispatchEvent(new Event('change'));
                    updateActiveState();

                    // 自动应用绑定的背景
                    const bound = themeBackgroundBindings[themeName];
                    if (bound) {
                        const bgEl = document.querySelector(`#bg_menu_content .bg_example[bgfile="${bound}"], #bg_custom_content .bg_example[bgfile="${bound}"]`);
                        if (bgEl) bgEl.click();
                    }
                });

                // 背景绑定监听
                const bgHandler = (e) => {
                    if (!isBindingMode) return;
                    const bgEl = e.target.closest('.bg_example');
                    if (!bgEl) return;
                    const bgFile = bgEl.getAttribute('bgfile');
                    if (bgFile && themeNameToBind) {
                        themeBackgroundBindings[themeNameToBind] = bgFile;
                        localStorage.setItem(STORAGE_KEYS.BG_BINDINGS, JSON.stringify(themeBackgroundBindings));
                        toastr.success('背景已绑定');
                        isBindingMode = false;
                        themeNameToBind = null;
                        const toggle = document.querySelector('#backgrounds-drawer-toggle') || document.querySelector('#logo_block .drawer-toggle');
                        if (toggle) toggle.click();
                        buildThemeUI();
                    }
                };
                const bgMenu = document.getElementById('bg_menu_content');
                const bgCustom = document.getElementById('bg_custom_content');
                if (bgMenu) bgMenu.addEventListener('click', bgHandler, true);
                if (bgCustom) bgCustom.addEventListener('click', bgHandler, true);

                // 监听主题切换
                originalSelect.addEventListener('change', (e) => {
                    const bound = themeBackgroundBindings[e.target.value];
                    if (bound) {
                        const bgEl = document.querySelector(`#bg_menu_content .bg_example[bgfile="${bound}"], #bg_custom_content .bg_example[bgfile="${bound}"]`);
                        if (bgEl) bgEl.click();
                    }
                    updateActiveState();
                });

                // 角色卡绑定功能
                document.body.addEventListener('click', async (e) => {
                    if (e.target.id !== 'link-theme-btn') return;
                    const chid = document.querySelector('#rm_ch_create_block #avatar_url_pole')?.value;
                    if (!chid) { toastr.warning('请先选择角色'); return; }
                    let bindings = JSON.parse(localStorage.getItem(STORAGE_KEYS.CHAR_BINDINGS)) || {};
                    const current = bindings[chid] || '';
                    const popup = document.createElement('div');
                    popup.innerHTML = '<h4>为角色绑定美化</h4><select id="char-theme-select"></select>';
                    const select = popup.querySelector('#char-theme-select');
                    select.appendChild(new Option('— 无绑定 —', ''));
                    allThemeNames.forEach(name => {
                        select.appendChild(new Option(getCleanName(name), name));
                    });
                    select.value = current;
                    await callGenericPopup(popup, 'confirm', null, {
                        okButton: '保存',
                        onOpen: (p) => {
                            setTimeout(() => {
                                $(p.dlg.querySelector('#char-theme-select')).select2({ dropdownParent: p.dlg, width: '100%' });
                            }, 0);
                        }
                    }).then(result => {
                        if (result && select.value) {
                            bindings[chid] = select.value;
                            toastr.success(`已绑定到: ${getCleanName(select.value)}`);
                        } else if (result) {
                            delete bindings[chid];
                            toastr.info('已取消绑定');
                        }
                        localStorage.setItem(STORAGE_KEYS.CHAR_BINDINGS, JSON.stringify(bindings));
                    });
                });

                // 角色切换自动应用
                document.getElementById('right-nav-panel')?.addEventListener('click', (e) => {
                    const block = e.target.closest('.character_select');
                    if (!block) return;
                    setTimeout(() => {
                        const chars = SillyTavern.getContext().characters;
                        const chid = block.dataset.chid;
                        const character = chars[chid];
                        if (character?.avatar) {
                            const bindings = JSON.parse(localStorage.getItem(STORAGE_KEYS.CHAR_BINDINGS)) || {};
                            const bound = bindings[character.avatar];
                            if (bound && originalSelect.value !== bound) {
                                originalSelect.value = bound;
                                originalSelect.dispatchEvent(new Event('change'));
                                toastr.info(`已应用: ${getCleanName(bound)}`);
                            }
                        }
                    }, 50);
                });

                // 添加角色绑定按钮
                const btnInterval = setInterval(() => {
                    const container = document.querySelector('#avatar_controls .form_create_bottom_buttons_block');
                    if (container && !document.querySelector('#link-theme-btn')) {
                        clearInterval(btnInterval);
                        const linkBtn = document.createElement('div');
                        linkBtn.id = 'link-theme-btn';
                        linkBtn.className = 'menu_button fa-solid fa-link';
                        linkBtn.title = '为此角色绑定一个主题';
                        container.appendChild(linkBtn);
                    }
                }, 500);

                // 初始化
                const isCollapsed = localStorage.getItem(STORAGE_KEYS.COLLAPSE) !== 'false';
                setCollapsed(isCollapsed, false);
                await buildThemeUI();

            } catch (err) {
                console.error("Theme Manager 初始化失败:", err);
            }
        }
    }, 250);
})();