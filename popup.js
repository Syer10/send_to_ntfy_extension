document.addEventListener('DOMContentLoaded', () => {

  // Elements
  const elements = {
    // Views
    mainView: document.getElementById('main-view'),
    settingsView: document.getElementById('settings-view'),

    // Header
    backBtn: document.getElementById('back-btn'),
    headerText: document.getElementById('header-text'),
    openUrlBtn: document.getElementById('open-url-btn'),
    settingsBtn: document.getElementById('settings-btn'),

    // Topic list
    topicList: document.getElementById('topic-list'),
    topicListItems: document.getElementById('topic-list-items'),
    topicCount: document.getElementById('topic-count'),
    newTopicInputMain: document.getElementById('new-topic-input-main'),

    // Message history
    messageHistory: document.getElementById('message-history'),
    emptyState: document.getElementById('empty-state'),

    // Send form
    titleInput: document.getElementById('title-input'),
    messageInput: document.getElementById('message-input'),
    tagsContainer: document.getElementById('tags-container'),
    newTagInput: document.getElementById('new-tag-input'),
    tagInputHint: document.getElementById('tag-input-hint'),

    // File handling
    fileInput: document.getElementById('file-input'),
    fileBtn: document.getElementById('file-btn'),
    filePreview: document.getElementById('file-preview'),
    fileName: document.getElementById('file-name'),
    fileSize: document.getElementById('file-size'),
    fileRemove: document.getElementById('file-remove'),

    // Priority & Theme chips
    priorityChips: document.getElementById('priority-chips'),
    themeChips: document.getElementById('theme-chips'),

    // Advanced options
    advancedToggle: document.getElementById('advanced-toggle'),
    advancedOptions: document.getElementById('advanced-options'),

    // Delay input
    delayInput: document.getElementById('delay-input'),

    // Actions
    sendBtn: document.getElementById('send-btn'),
    sendAnotherCheckbox: document.getElementById('send-another-checkbox'),

    // Status
    status: document.getElementById('status'),
    settingsStatus: document.getElementById('settings-status'),

    // Settings inputs
    urlInput: document.getElementById('url-input'),
    tokenInput: document.getElementById('token-input'),
    pollIntervalInput: document.getElementById('poll-interval-input'),
  };

  // State
  let config = {
    topics: [],
    apiUrl: '',
    accessToken: '',
    theme: 'auto',
    pageUrl: '',
    topicMuted: {},
    topicNames: {},
    allNotificationsSelected: true,
    topicLastViewed: {},
    pollInterval: 300
  };

  let tags = []; // State for tags
  let dragSrcIndex = null;
  let dragType = null;
  let selectedPriority = 3;
  let isSettingsView = false;
  let rightCtrlDown = false;
  let selectedTopic = null;
  let currentMessages = [];

  const STORAGE_KEYS = ['topics', 'apiUrl', 'accessToken', 'theme', 'priority', 'lastTags', 'lastTopic', 'sendAnotherEnabled', 'topicMuted', 'topicNames', 'topicLastViewed', 'pollInterval'];

  // Initialize
  init();

  async function init() {
    await loadConfig();
    await restoreDraftState();
    await checkSessionAndCleanup();
    await loadStoredFile();
    setupEventListeners();
    updateUI();
    updatePriorityUI();
    applyTheme();
    renderTags();
    updateSendFormState();
    selectAllNotifications();
    updateBrowserBadge();
    elements.messageInput.focus();
  }

  // ==================
  // Configuration
  // ==================

  async function loadConfig() {
    try {
      const items = await getFromStorage(STORAGE_KEYS);
      config.pageUrl = await getPageUrl();
      config = {
        ...config,
        topics: items.topics ? items.topics.split(',').map(t => t.trim()).filter(Boolean) : [],
        apiUrl: items.apiUrl || '',
        accessToken: items.accessToken || '',
        theme: items.theme || 'auto',
        sendAnotherEnabled: items.sendAnotherEnabled === true,
        topicMuted: items.topicMuted || {},
        topicNames: items.topicNames || {}
      };

      if (!('allNotificationsSelected' in items)) {
        config.allNotificationsSelected = true;
      } else {
        config.allNotificationsSelected = items.allNotificationsSelected;
      }

      if (items.topicLastViewed) {
        config.topicLastViewed = items.topicLastViewed;
      } else {
        config.topicLastViewed = {};
      }

      if (items.pollInterval) {
        config.pollInterval = items.pollInterval;
      } else {
        config.pollInterval = 300;
      }

      elements.sendAnotherCheckbox.checked = config.sendAnotherEnabled;

      if (items.priority) {
        selectedPriority = items.priority;
      }

      if (items.lastTopic && config.topics.includes(items.lastTopic)) {
        config.lastTopic = items.lastTopic;
      }

      if (items.lastTags) {
        tags = Array.isArray(items.lastTags) ? items.lastTags : [];
      }
    } catch (error) {
      console.error('Error loading config:', error);
    }
  }

  async function saveConfig() {
    const newConfig = {
      apiUrl: elements.urlInput.value.trim(),
      accessToken: elements.tokenInput.value,
      topics: config.topics.join(','),
      theme: config.theme,
      topicMuted: config.topicMuted,
      topicNames: config.topicNames,
      pollInterval: config.pollInterval
    };

    try {
      await saveToStorage(newConfig);
      config = {
        ...config,
        ...newConfig,
        topics: newConfig.topics.split(',').map(t => t.trim()).filter(Boolean)
      };

      updateTopicList();
      updateThemeChipsUI();

    } catch (error) {
      showSettingsStatus('Failed to save settings', 'error');
    }
  }

  function debounce(func, wait) {
    let timeout;
    return function executedFunction(...args) {
      const later = () => {
        clearTimeout(timeout);
        func(...args);
      };
      clearTimeout(timeout);
      timeout = setTimeout(later, wait);
    };
  }

  // ==================
  // Unread Count Management
  // ==================

  function getUnreadCount(topic) {
    const lastViewed = config.topicLastViewed[topic] || 0;
    const notifications = config.subscriptionNotifications?.[topic] || [];
    return notifications.filter(n => n.time > lastViewed).length;
  }

  function getTotalUnreadCount() {
    let total = 0;
    for (const topic of config.topics) {
      total += getUnreadCount(topic);
    }
    return total;
  }

  function updateBrowserBadge() {
    const total = getTotalUnreadCount();
    if (total > 0) {
      chrome.action.setBadgeText({ text: total > 99 ? '99+' : total.toString() });
      chrome.action.setBadgeBackgroundColor({ color: '#e53935' });
    } else {
      chrome.action.setBadgeText({ text: '' });
    }
  }

  function markTopicAsViewed(topic) {
    config.topicLastViewed[topic] = Date.now();
    saveToStorage({ topicLastViewed: config.topicLastViewed });
    updateBrowserBadge();
  }

  // ==================
  // Theme Management
  // ==================

  function applyTheme() {
    document.body.setAttribute('data-theme', config.theme);
    updateThemeChipsUI();
  }

  function updateThemeChipsUI() {
    document.querySelectorAll('#theme-chips .chip').forEach(chip => {
      chip.classList.toggle('active', chip.dataset.theme === config.theme);
    });
  }

  function handleThemeChange(e) {
    const chip = e.target.closest('.chip');
    if (!chip || !chip.dataset.theme) return;

    config.theme = chip.dataset.theme;
    applyTheme();
  }

  // ==================
  // File Handling
  // ==================

  async function loadStoredFile() {
    try {
      const result = await new Promise(resolve => {
        chrome.storage.local.get(['storedFile'], resolve);
      });

      if (result.storedFile) {
        elements.fileName.textContent = result.storedFile.name;
        elements.fileSize.textContent = formatFileSize(result.storedFile.size);
        elements.filePreview.classList.add('visible');
        elements.fileBtn.style.display = 'none';
      }
    } catch (error) {
      console.error('Error loading stored file:', error);
    }
  }

  async function checkSessionAndCleanup() {
    // Hybrid storage approach:
    // Files are stored in 'local' (large quota).
    // Session state is tracked in 'session'.
    // If 'sessionActive' is missing from 'session' storage, it means the browser restarted.
    // In that case, we clear the file from 'local' storage.

    try {
      const session = await new Promise(resolve => chrome.storage.session.get(['sessionActive'], resolve));

      if (!session.sessionActive) {
        console.log('New session detected, cleaning up stored file');
        await new Promise(resolve => chrome.storage.local.remove(['storedFile'], resolve));
        await new Promise(resolve => chrome.storage.session.set({ sessionActive: true }, resolve));
      }
    } catch (error) {
      console.error('Error checking session state:', error);
    }
  }

  async function handleFileButtonClick() {
    // Save state first because popup will close
    await saveDraftState();

    // Open file picker in a popup window to avoid main popup closing
    const filePickerUrl = chrome.runtime.getURL(`filepicker.html?theme=${config.theme}`);
    const width = 610;
    const height = 340;

    // Get current window to center the popup
    chrome.windows.getCurrent((currentWindow) => {
      let left = undefined;
      let top = undefined;

      if (currentWindow && currentWindow.left !== undefined && currentWindow.top !== undefined) {
        left = Math.round(currentWindow.left + (currentWindow.width - width) / 2);
        top = Math.round(currentWindow.top + (currentWindow.height - height) / 2);
      }

      chrome.windows.create({
        url: filePickerUrl,
        type: 'popup',
        width: width,
        height: height,
        left: left,
        top: top,
        focused: true
      }, (window) => {
        if (chrome.runtime.lastError) {
          console.log('Windows API error, trying tabs:', chrome.runtime.lastError);
          // Fallback to tab
          chrome.tabs.create({ url: filePickerUrl, active: true });
        }
      });
    });
  }

  function handleFileSelect(e) {
    const file = e.target.files[0];
    if (file) {
      readAndStoreFile(file);
    }
  }

  async function readAndStoreFile(file) {
    try {
      const reader = new FileReader();
      reader.onload = async (e) => {
        const base64Data = e.target.result;

        await new Promise((resolve, reject) => {
          chrome.storage.local.set({
            storedFile: {
              name: file.name,
              type: file.type,
              size: file.size,
              data: base64Data
            }
          }, () => {
            if (chrome.runtime.lastError) reject(chrome.runtime.lastError);
            else resolve();
          });
        });

        elements.fileName.textContent = file.name;
        elements.fileSize.textContent = formatFileSize(file.size);
        elements.filePreview.classList.add('visible');
        elements.fileBtn.style.display = 'none';
      };
      reader.readAsDataURL(file);
    } catch (error) {
      console.error('Error storing file:', error);
      showStatus('Failed to attach file', 'error');
    }
  }

  async function removeFile() {
    await new Promise((resolve) => {
      chrome.storage.local.remove(['storedFile'], resolve);
    });

    elements.fileInput.value = '';
    elements.filePreview.classList.remove('visible');
    elements.fileBtn.style.display = '';
  }

  function formatFileSize(bytes) {
    if (bytes < 1024) return bytes + ' B';
    if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
    return (bytes / (1024 * 1024)).toFixed(1) + ' MB';
  }

// ==================
  // Topic List
  // ==================

  function updateUI() {
    const isConfigured = config.apiUrl && config.topics.length > 0;

    elements.settingsBtn.classList.toggle('highlight', !isConfigured);
    elements.openUrlBtn.disabled = !config.apiUrl;

    updateTopicList();
    updatePriorityUI();
  }

  function updateTopicList() {
    const items = elements.topicListItems;
    items.innerHTML = '';

    const allTopics = ['All notifications', ...config.topics];

    elements.topicCount.textContent = allTopics.length;

    allTopics.forEach((topic, index) => {
      const item = document.createElement('div');
      const isAllNotifications = topic === 'All notifications';
      item.className = 'topic-list-item' + (selectedTopic === topic ? ' selected' : '') + (config.topicMuted[topic] ? ' muted' : '');

      const displayName = isAllNotifications ? 'All notifications' : (config.topicNames[topic] || topic);

      item.addEventListener('click', (e) => {
        if (e.target.closest('.topic-menu-btn') || e.target.closest('.topic-dropdown-menu')) return;
        if (isAllNotifications) {
          selectAllNotifications();
        } else {
          selectTopic(topic);
        }
      });

      const name = document.createElement('span');
      name.className = 'topic-name';
      name.textContent = displayName;

      const count = getUnreadCount(topic);
      if (count > 0) {
        const badge = document.createElement('span');
        badge.className = 'topic-unread-badge';
        badge.textContent = count;
        item.appendChild(badge);
      }

      const menuBtn = document.createElement('button');
      menuBtn.className = 'topic-menu-btn';
      menuBtn.textContent = '⋮';
      menuBtn.title = 'Options';
      menuBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        toggleTopicMenu(topic, menuBtn, item, isAllNotifications);
      });

      item.appendChild(name);
      item.appendChild(menuBtn);
      items.appendChild(item);
    });
  }

  let activeMenu = null;

  function toggleTopicMenu(topic, menuBtn, item, isAllNotifications) {
    if (activeMenu && activeMenu._topic === topic) {
      removeTopicMenu(topic);
      return;
    }

    if (activeMenu) {
      removeTopicMenu(activeMenu._topic);
    }

    // Remove any existing menu
    const existing = document.querySelector('.topic-dropdown-menu');
    if (existing) existing.remove();

    const menu = document.createElement('div');
    menu.className = 'topic-dropdown-menu';
    menu._topic = topic;

    if (!isAllNotifications) {
      const displayName = config.topicNames[topic] || topic;

      const renameItem = document.createElement('div');
      renameItem.className = 'topic-menu-item';
      renameItem.textContent = 'Rename';
      renameItem.addEventListener('click', () => {
        removeTopicMenu(topic);
        promptRenameTopic(topic);
      });

      menu.appendChild(renameItem);
    }

    const muteItem = document.createElement('div');
    muteItem.className = 'topic-menu-item';
    muteItem.textContent = config.topicMuted[topic] ? 'Unmute' : 'Mute';
    muteItem.addEventListener('click', () => {
      removeTopicMenu(topic);
      toggleTopicMute(topic);
    });
    menu.appendChild(muteItem);

    if (!isAllNotifications) {
      const copyItem = document.createElement('div');
      copyItem.className = 'topic-menu-item';
      copyItem.textContent = 'Copy topic';
      copyItem.addEventListener('click', () => {
        const actualTopic = config.topics.find(t => {
          const name = config.topicNames[t] || t;
          return name === topic;
        }) || topic;
        navigator.clipboard.writeText(actualTopic).then(() => {
          copyItem.textContent = 'Copied!';
          setTimeout(() => {
            copyItem.textContent = 'Copy topic';
          }, 1500);
        });
      });
      menu.appendChild(copyItem);

      const removeItem = document.createElement('div');
      removeItem.className = 'topic-menu-item topic-menu-item-remove';
      removeItem.textContent = 'Remove';
      removeItem.addEventListener('click', () => {
        removeTopicMenu(topic);
        removeTopic(config.topics.indexOf(topic));
      });
      menu.appendChild(removeItem);
    }

    item.appendChild(menu);
    activeMenu = menu;

    // Close menu when clicking outside
    const closeHandler = (e) => {
      if (!item.contains(e.target)) {
        removeTopicMenu(topic);
        document.removeEventListener('click', closeHandler);
      }
    };
    setTimeout(() => document.addEventListener('click', closeHandler), 0);
  }

  function removeTopicMenu(topic) {
    const menu = document.querySelector('.topic-dropdown-menu');
    if (menu && menu._topic === topic) {
      menu.remove();
      activeMenu = null;
    }
  }

  function promptRenameTopic(topic) {
    const currentName = config.topicNames[topic] || topic;
    const newName = prompt('Rename topic:', currentName);
    if (newName !== null && newName.trim() !== '') {
      config.topicNames[topic] = newName.trim();
      saveToStorage({ topicNames: config.topicNames });
      updateTopicList();
    }
  }

  function selectTopic(topic) {
    selectedTopic = topic;
    markTopicAsViewed(topic);
    updateTopicList();
    loadStoredFile();
    updateSendFormState();
    fetchMessageHistory(topic);
    saveToStorage({ lastTopic: topic });
  }

  function selectAllNotifications() {
    selectedTopic = 'All notifications';
    // Mark all topics as viewed since we're showing all messages
    for (const topic of config.topics) {
      markTopicAsViewed(topic);
    }
    updateTopicList();
    loadStoredFile();
    updateSendFormState();
    fetchAllNotifications();
    saveToStorage({ allNotificationsSelected: true });
  }

  async function fetchMessageHistory(topic) {
    const apiConfig = {
      apiUrl: config.apiUrl,
      accessToken: config.accessToken
    };

    try {
      const messages = await NtfyAPI.fetchMessageHistory(apiConfig, topic);
      currentMessages = messages;
      renderMessageHistory(messages);
    } catch (error) {
      console.error('Failed to fetch messages:', error);
      elements.messageHistory.innerHTML = '<div class="empty-state">Failed to load messages</div>';
    }
  }

  async function fetchAllNotifications() {
    elements.messageHistory.innerHTML = '<div class="empty-state">Loading all notifications...</div>';
    currentMessages = [];

    const apiConfig = {
      apiUrl: config.apiUrl,
      accessToken: config.accessToken
    };

    currentMessages = await NtfyAPI.fetchMessageHistory(apiConfig, config.topics.join(','));
    renderMessageHistory(currentMessages);
  }

  function formatMessageWithLinks(text) {
    const urlRegex = /(https?:\/\/[^\s<]+)/g;
    return text.replace(urlRegex, '<a href="$1" class="message-link" target="_blank" rel="noopener noreferrer">$1</a>');
  }

  function renderMessageHistory(messages) {
    const history = elements.messageHistory;
    history.innerHTML = '';

    if (messages.length === 0) {
      history.innerHTML = '<div class="empty-state">No messages yet</div>';
      return;
    }

    const reversedMessages = [...messages].reverse();

    reversedMessages.forEach((msg) => {
      const card = document.createElement('div');
      card.className = 'message-card priority-' + (msg.priority || 3);

      if (msg.title) {
        const title = document.createElement('div');
        title.className = 'message-card-title';
        title.textContent = msg.title;
        card.appendChild(title);
      }

      if (msg.time) {
        const time = document.createElement('span');
        time.className = 'message-card-time';
        time.textContent = new Date(msg.time * 1000).toLocaleString();
        card.appendChild(time);
      }

      if (msg.message) {
        const messageDiv = document.createElement('div');
        messageDiv.className = 'message-card-message' + (msg.title ? '' : ' no-title');
        messageDiv.innerHTML = formatMessageWithLinks(msg.message);
        card.appendChild(messageDiv);
      }

      if (msg.tags && msg.tags.length > 0) {
        const tags = document.createElement('div');
        tags.className = 'message-card-tags';
        msg.tags.forEach(tag => {
          const tagEl = document.createElement('span');
          tagEl.className = 'message-tag';
          tagEl.textContent = tag;
          tags.appendChild(tagEl);
        });
        card.appendChild(tags);
      }

      if (msg.click || (msg.actions && msg.actions.length > 0)) {
        const actionsContainer = document.createElement('div');
        actionsContainer.className = 'message-card-actions';

        if (msg.click) {
          const openBtn = document.createElement('button');
          openBtn.className = 'message-card-btn click-btn';
          openBtn.textContent = 'Open link';
          openBtn.addEventListener('click', () => {
            chrome.tabs.create({ url: msg.click, active: true });
          });
          actionsContainer.appendChild(openBtn);

          const copyBtn = document.createElement('button');
          copyBtn.className = 'message-card-btn copy-link-btn';
          copyBtn.textContent = 'Copy link';
          copyBtn.addEventListener('click', () => {
            navigator.clipboard.writeText(msg.click).then(() => {
              copyBtn.textContent = 'Copied!';
              setTimeout(() => {
                copyBtn.textContent = 'Copy link';
              }, 1500);
            });
          });
          actionsContainer.appendChild(copyBtn);
        }

        if (msg.actions && msg.actions.length > 0) {
          msg.actions.forEach(action => {
            const btn = document.createElement('button');
            btn.className = 'message-card-btn action-btn';
            btn.textContent = action.label || 'Action';
            btn.addEventListener('click', () => handleAction(action));
            actionsContainer.appendChild(btn);
          });
        }

        card.appendChild(actionsContainer);
      }

      if (msg.topic) {
        const topicLabel = document.createElement('span');
        topicLabel.className = 'message-card-topic';
        topicLabel.textContent = config.topicNames[msg.topic] || msg.topic;
        card.appendChild(topicLabel);
      }

      history.appendChild(card);
    });
  }

  async function handleAction(action) {
    if (!action) return;

    const actionType = action.action || 'view';

    switch (actionType) {
      case 'view':
        if (action.url) {
          chrome.tabs.create({ url: action.url, active: true });
        }
        break;

      case 'http':
        if (action.url) {
          const method = (action.method || 'POST').toUpperCase();
          try {
            await fetch(action.url, {
              method: method,
              headers: { 'Content-Type': 'application/json' },
              body: action.body || ''
            });
            showStatus('Action sent', 'success');
          } catch (error) {
            showStatus('Action failed: ' + error.message, 'error');
          }
        }
        break;

      case 'copy':
        if (action.value || action.text) {
          try {
            await navigator.clipboard.writeText(action.value || action.text);
            showStatus('Copied to clipboard', 'success');
          } catch (error) {
            showStatus('Failed to copy', 'error');
          }
        }
        break;

      default:
        if (action.url) {
          chrome.tabs.create({ url: action.url, active: true });
        }
        break;
    }
  }

  function toggleTopicMute(topic) {
    config.topicMuted[topic] = !config.topicMuted[topic];
    saveToStorage({ topicMuted: config.topicMuted });
    updateTopicList();
  }

  function removeTopic(index) {
    config.topics.splice(index, 1);
    saveConfig();
  }

  function updateSendFormState() {
    const enabled = selectedTopic !== null && selectedTopic !== '';
    elements.titleInput.disabled = !enabled;
    elements.messageInput.disabled = !enabled;
    elements.fileBtn.disabled = !enabled;
    elements.sendBtn.disabled = !enabled;
  }

  // ==================
  // File Handling
  // ==================

  async function saveDraftState() {
    const draft = {
      title: elements.titleInput.value,
      message: elements.messageInput.value,
      topic: selectedTopic,
      tags: tags,
      priority: selectedPriority
    };
    await new Promise(resolve => chrome.storage.local.set({ draftState: draft }, resolve));
  }

  async function restoreDraftState() {
    return new Promise(resolve => {
      chrome.storage.local.get(['draftState'], (result) => {
        if (result.draftState) {
          const draft = result.draftState;
          if (draft.title) elements.titleInput.value = draft.title;
          if (draft.message) elements.messageInput.value = draft.message;
          if (draft.tags) {
            tags = Array.isArray(draft.tags) ? draft.tags : draft.tags.split(',').filter(Boolean);
            renderTags();
          }
          if (draft.priority) {
            selectedPriority = draft.priority;
            updatePriorityUI();
          }
          if (draft.topic && config.topics.includes(draft.topic)) {
            selectTopic(draft.topic);
          }

          chrome.storage.local.remove(['draftState']);
        }
        resolve();
      });
    });
  }

  // ==================
  // Storage Helpers
  // ==================

  function getFromStorage(keys) {
    return new Promise((resolve, reject) => {
      chrome.storage.sync.get(keys, items => {
        if (chrome.runtime.lastError) {
          reject(chrome.runtime.lastError);
        } else {
          resolve(items);
        }
      });
    });
  }

  function saveToStorage(data) {
    return new Promise((resolve, reject) => {
      chrome.storage.sync.set(data, () => {
        if (chrome.runtime.lastError) {
          reject(chrome.runtime.lastError);
        } else {
          resolve();
        }
      });
    });
  }

  async function getPageUrl() {
    return new Promise((resolve, reject) => {
      chrome.tabs.query({ active: true, currentWindow: true }, tabs => {
        if (chrome.runtime.lastError) {
          reject(chrome.runtime.lastError);
        } else {
          resolve(tabs[0]?.url || '');
        }
      });
    });
  }

  // ==================
  // Event Listeners
  // ==================

  function setupEventListeners() {
    // View switching
    elements.settingsBtn.addEventListener('click', showSettingsView);
    elements.backBtn.addEventListener('click', showMainView);

    // Settings Auto-save
    const debouncedSave = debounce(saveConfig, 1000);

    elements.urlInput.addEventListener('input', () => {
      debouncedSave();
    });

    elements.tokenInput.addEventListener('input', () => {
      debouncedSave();
    });

    // Poll interval input
    elements.pollIntervalInput.addEventListener('input', () => {
      const value = parseInt(elements.pollIntervalInput.value, 10);
      if (value && value >= 30) {
        config.pollInterval = value;
        saveToStorage({ pollInterval: value });
        // Notify background to update alarm
        chrome.runtime.sendMessage({ action: 'updateAlarm' });
      }
      // Hide hint after clearing
    });

    // Topic input
    elements.newTopicInputMain.addEventListener('keydown', handleNewTopicKeydown);

    // Theme chips
    elements.themeChips.addEventListener('click', (e) => {
      handleThemeChange(e);
      saveConfig();
    });

    // Open ntfy URL
    elements.openUrlBtn.addEventListener('click', openNtfyUrl);

    // Send message
    elements.sendBtn.addEventListener('click', sendNotification);

    // Send another checkbox - save state on change
    elements.sendAnotherCheckbox.addEventListener('change', () => {
      config.sendAnotherEnabled = elements.sendAnotherCheckbox.checked;
      saveToStorage({ sendAnotherEnabled: config.sendAnotherEnabled });
    });

    // File handling
    elements.fileBtn.addEventListener('click', handleFileButtonClick);
    elements.fileInput.addEventListener('change', handleFileSelect);
    elements.fileRemove.addEventListener('click', removeFile);

    // Priority chips
    elements.priorityChips.addEventListener('click', handlePriorityClick);

    // Tags handling
    elements.newTagInput.addEventListener('keydown', handleTagKeydown);
    elements.newTagInput.addEventListener('input', updateTagInputHint);
    elements.tagsContainer.addEventListener('click', handleTagRemove);

    // Advanced options toggle
    elements.advancedToggle.addEventListener('click', toggleAdvancedOptions);

    // Listen for file selection from external picker
    chrome.storage.onChanged.addListener((changes, area) => {
      if (area === 'local' && changes.storedFile) {
        loadStoredFile();
      }
    });

    setupTooltips();

    // Global keyboard shortcuts
    document.addEventListener('keydown', handleGlobalKeydown);
    document.addEventListener('keyup', handleGlobalKeyup);
    window.addEventListener('blur', () => {
      rightCtrlDown = false;
    });
  }

  // ==================
  // View Switching
  // ==================

  function showSettingsView() {
    // Populate settings fields with current config
    elements.urlInput.value = config.apiUrl;
    elements.tokenInput.value = config.accessToken;
    elements.pollIntervalInput.value = config.pollInterval || 300;

    updateThemeChipsUI();

    elements.mainView.classList.remove('active');
    elements.settingsView.classList.add('active');
    elements.backBtn.classList.add('visible');
    elements.settingsBtn.style.display = 'none';
    elements.openUrlBtn.style.display = 'none';
    elements.headerText.textContent = 'Settings';
    isSettingsView = true;
  }

  function showMainView() {
    elements.settingsView.classList.remove('active');
    elements.mainView.classList.add('active');
    elements.backBtn.classList.remove('visible');
    elements.settingsBtn.style.display = '';
    elements.openUrlBtn.style.display = '';
    elements.headerText.textContent = 'Send to ntfy';
    isSettingsView = false;

    updateUI();
  }

  // ==================
  // New Topic Input Handler
  // ==================

  function handleNewTopicKeydown(e) {
    if (e.key === 'Enter') {
      e.preventDefault();
      const value = elements.newTopicInputMain.value.trim();

      if (value && !config.topics.includes(value)) {
        config.topics.push(value);
        saveConfig();
        elements.newTopicInputMain.value = '';
      }
    }
  }

  // ==================
  // UI Updates
  // ==================

  function updateUI() {
    const isConfigured = config.apiUrl && config.topics.length > 0;

    elements.settingsBtn.classList.toggle('highlight', !isConfigured);
    elements.openUrlBtn.disabled = !config.apiUrl;

    updateTopicList();
    updatePriorityUI();
  }

  function updatePriorityUI() {
    document.querySelectorAll('#priority-chips .chip').forEach(chip => {
      const priority = parseInt(chip.dataset.priority, 10);
      chip.classList.toggle('active', priority === selectedPriority);
    });
  }



  function showStatus(message, type) {
    elements.status.textContent = message;
    elements.status.className = `status visible ${type}`;

    setTimeout(() => {
      elements.status.classList.remove('visible');
    }, 3000);
  }

  function showSettingsStatus(message, type) {
    elements.settingsStatus.textContent = message;
    elements.settingsStatus.className = `status visible ${type}`;

    setTimeout(() => {
      elements.settingsStatus.classList.remove('visible');
    }, 3000);
  }

  function toggleAdvancedOptions() {
    elements.advancedToggle.classList.toggle('open');
    elements.advancedOptions.classList.toggle('visible');
  }

  // ==================
  // Drag and Drop
  // ==================

  function setupDragAndDrop(element, index, type) {
    element.draggable = true;

    element.addEventListener('dragstart', (e) => {
      dragSrcIndex = index;
      dragType = type;
      element.classList.add('dragging');
      e.dataTransfer.effectAllowed = 'move';
      e.dataTransfer.setData('text/plain', index);
    });

    element.addEventListener('dragend', () => {
      element.classList.remove('dragging');
      element.classList.remove('drag-over');
      dragSrcIndex = null;
      dragType = null;
    });

    element.addEventListener('dragover', (e) => {
      e.preventDefault(); // Necessary to allow dropping
      e.dataTransfer.dropEffect = 'move';
      return false;
    });

    element.addEventListener('dragenter', (e) => {
      e.preventDefault();
      if (dragType === type && dragSrcIndex !== index) {
        element.classList.add('drag-over');
      }
    });

    element.addEventListener('dragleave', (e) => {
      element.classList.remove('drag-over');
    });

    element.addEventListener('drop', (e) => {
      e.preventDefault();
      e.stopPropagation();

      element.classList.remove('drag-over');

      if (dragType !== type) return;
      if (dragSrcIndex === null) return;
      if (dragSrcIndex === index) return;

      // Adjust index if moving item from earlier position to later position
      // because removal shifts indices
      // Note: Splice logic actually handles "insert at index" naturally, 
      // but interpretation of "drop on" varies.
      // Current implementation: Remove then Insert.

      // We will perform the move in the data model and re-render.
      // Since we re-render, the dragend might not fire on the original element,
      // so we reset state here too.

      const srcIdx = dragSrcIndex;
      dragSrcIndex = null;
      dragType = null;

      if (type === 'tag') {
        const item = tags[srcIdx];
        tags.splice(srcIdx, 1);
        tags.splice(index, 0, item);
        renderTags();
        saveToStorage({ lastTags: [...tags] });
      } else if (type === 'topic') {
        const item = config.topics[srcIdx];
        config.topics.splice(srcIdx, 1);
        config.topics.splice(index, 0, item);
        renderTopics();
        saveConfig();
      }
    });
  }

  // ==================
  // Tags Handling
  // ==================

  function renderTags() {
    // Clear current badges but keep input
    const badges = elements.tagsContainer.querySelectorAll('.tag-badge');
    badges.forEach(b => b.remove());

    // Insert badges before input
    tags.forEach((tag, index) => {
      const badge = document.createElement('div');
      badge.className = 'tag-badge';
      badge.textContent = tag;

      setupDragAndDrop(badge, index, 'tag');

      const removeSpan = document.createElement('span');
      removeSpan.className = 'tag-remove';
      removeSpan.dataset.index = index;
      removeSpan.textContent = '×';
      badge.appendChild(removeSpan);
      elements.tagsContainer.insertBefore(badge, elements.newTagInput);
    });
  }

  function handleTagKeydown(e) {
    if (e.key === 'Enter') {
      e.preventDefault();
      const value = elements.newTagInput.value.trim();

      if (value) {
        // Add tag
        if (!tags.includes(value)) {
          tags.push(value);
          renderTags();
          saveToStorage({ lastTags: [...tags] });
        }
        elements.newTagInput.value = '';
        updateTagInputHint(); // Hide hint after clearing
      }
    } else if (e.key === 'Backspace' && !elements.newTagInput.value) {
      // Remove last tag if input is empty
      if (tags.length > 0) {
        tags.pop();
        renderTags();
        saveToStorage({ lastTags: [...tags] });
      }
    }
  }

  function updateTagInputHint() {
    elements.tagInputHint.classList.toggle('visible', elements.newTagInput.value.length > 0);
  }

  function handleTagRemove(e) {
    if (e.target.classList.contains('tag-remove')) {
      const index = parseInt(e.target.dataset.index, 10);
      tags.splice(index, 1);
      renderTags();
      saveToStorage({ lastTags: [...tags] });
    }

    // Focus input if clicking on container
    if (e.target === elements.tagsContainer) {
      elements.newTagInput.focus();
    }
  }

  // ==================
  // Priority Handling
  // ==================

  function handlePriorityClick(e) {
    const chip = e.target.closest('.chip');
    if (!chip || !chip.dataset.priority) return;

    selectedPriority = parseInt(chip.dataset.priority, 10);
    updatePriorityUI();

    // Persist priority
    saveToStorage({ priority: selectedPriority });
    saveToStorage({ priority: selectedPriority });
  }

// ==================
  // Open ntfy URL
  // ==================

  function openNtfyUrl() {
    if (config.apiUrl) {
      let url = config.apiUrl;
      const topic = selectedTopic;

      if (topic && config.topics.includes(topic)) {
        if (url.endsWith('/')) {
          url = url.slice(0, -1);
        }
        url += `/${topic}`;
      }

      chrome.tabs.create({ url: url });
    }
  }

  // ==================
  // Send Notification
  // ==================

  async function sendNotification() {
    const topic = selectedTopic;
    const message = elements.messageInput.value.trim();
    const title = elements.titleInput.value.trim();
    const tagsString = tags.join(',');
    const delay = elements.delayInput.value.trim();

    // Auto-detect link in message for click URL
    let clickUrl = '';
    if (message) {
      const urlRegex = /^(https?:\/\/[^\s]+)$/;
      const match = message.match(urlRegex);
      if (match) {
        clickUrl = match[1];
      }
    }

    const storedFile = await new Promise((resolve) => {
      chrome.storage.local.get(['storedFile'], items => {
        resolve(items.storedFile || null);
      });
    });

    if (!config.apiUrl) {
      showStatus('Configure ntfy URL in settings', 'warning');
      return;
    }

    if (!topic) {
      showStatus('Select a topic', 'warning');
      return;
    }

    elements.sendBtn.disabled = true;

    try {
      const apiConfig = {
        apiUrl: config.apiUrl,
        accessToken: config.accessToken
      };

      let response;

      if (storedFile) {
        // Send file as attachment using NtfyAPI
        const base64 = storedFile.data.split(',')[1];
        const binaryString = atob(base64);
        const bytes = new Uint8Array(binaryString.length);
        for (let i = 0; i < binaryString.length; i++) {
          bytes[i] = binaryString.charCodeAt(i);
        }

        response = await NtfyAPI.sendAttachment(apiConfig, topic, {
          data: bytes.buffer,
          filename: storedFile.name,
          message: message,
          title: title,
          priority: selectedPriority,
          tags: tagsString,
          delay: delay || undefined,
          click: clickUrl || undefined
        });
      } else {
        // Send text notification using NtfyAPI
        response = await NtfyAPI.sendNotification(apiConfig, topic, {
          message: message,
          title: title,
          priority: selectedPriority,
          tags: tagsString,
          delay: delay || undefined,
          click: clickUrl || undefined
        });
      }

      elements.messageInput.value = '';
      elements.titleInput.value = '';

      await removeFile();
      // Clear any saved draft state so it doesn't overwrite preferences next time
      await new Promise(resolve => chrome.storage.local.remove(['draftState'], resolve));

      updatePriorityUI();

      // Close the popup unless "Send another" is checked
      if (!elements.sendAnotherCheckbox.checked) {
        setTimeout(() => window.close(), 100);
      } else {
        // Only show success message if staying open
        showStatus('Notification sent!', 'success');
      }
    } catch (error) {
      showStatus(`Error: ${error.message}`, 'error');
    } finally {
      elements.sendBtn.disabled = false;
    }
  }
  function setupTooltips() {
    const tooltip = document.getElementById('tooltip');
    let activeElement = null;
    let tooltipTimeout = null;

    document.addEventListener('mouseover', (e) => {
      // Find closest element with a title attribute or data-tooltip
      const target = e.target.closest('[title], [data-tooltip]');

      // If we are already tracking this element, do nothing (prevents timer reset on mouse move inside element)
      if (activeElement && target === activeElement) {
        return;
      }

      // If we moved to a new element (or no element), clear any pending tooltip
      if (activeElement) {
        clearTimeout(tooltipTimeout);
        hideTooltip();
      }

      if (!target) {
        return;
      }

      // If it has a title, move it to data-tooltip to suppress native tooltip
      if (target.hasAttribute('title')) {
        const title = target.getAttribute('title');
        target.setAttribute('data-tooltip', title);
        target.removeAttribute('title');
      }

      const text = target.getAttribute('data-tooltip');
      if (!text) return;

      activeElement = target;

      // Delay showing the tooltip
      tooltipTimeout = setTimeout(() => {
        // Double-check we are still active on this element
        if (activeElement === target) {
          showTooltip(target, text);
        }
      }, 1000); // 1000ms delay
    });

    document.addEventListener('mouseout', (e) => {
      if (activeElement && (e.target === activeElement || e.target.closest('[data-tooltip]') === activeElement)) {
        // check if we moved to child of the active element
        if (e.relatedTarget && activeElement.contains(e.relatedTarget)) {
          return;
        }

        // otherwise, we left the element entirely
        clearTimeout(tooltipTimeout);
        hideTooltip();
      }
    });

    function showTooltip(element, text) {
      if (!element.isConnected) return; // Verify element is still in DOM

      tooltip.textContent = text;
      tooltip.classList.add('visible');

      const rect = element.getBoundingClientRect();
      const tooltipRect = tooltip.getBoundingClientRect();
      const margin = 8;

      // Default: Top center
      let top = rect.top - tooltipRect.height - margin;
      let left = rect.left + (rect.width - tooltipRect.width) / 2;

      // prevent overflow top
      if (top < 0) {
        top = rect.bottom + margin;
      }

      // prevent overflow left/right
      if (left < margin) {
        left = margin;
      } else if (left + tooltipRect.width > window.innerWidth - margin) {
        left = window.innerWidth - tooltipRect.width - margin;
      }

      tooltip.style.top = `${top}px`;
      tooltip.style.left = `${left}px`;
    }

    function hideTooltip() {
      tooltip.classList.remove('visible');
      activeElement = null;
    }
  }

  // ==================
  // Keyboard Shortcuts
  // ==================

  function handleGlobalKeydown(e) {
    if (e.code === 'ControlRight') {
      rightCtrlDown = true;
    }

    if (e.key === 'Enter' && rightCtrlDown) {
      // Check if send button is visible and enabled
      // offsetParent is null if element or any parent is hidden (display: none)
      if (elements.sendBtn.offsetParent !== null && !elements.sendBtn.disabled) {
        e.preventDefault();
        elements.sendBtn.click();
      }
    }
  }

  function handleGlobalKeyup(e) {
    if (e.code === 'ControlRight') {
      rightCtrlDown = false;
    }
  }

});
