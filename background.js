// Background service worker for context menu integration
// Compatible with Chrome, Edge, and Firefox 142+

// Import shared utilities (only in Service Worker context)
if (typeof importScripts === 'function') {
    importScripts('ntfy.js');
}

const PARENT_MENU_ID = 'ntfy-parent';
const SEND_SELECTION_ID = 'ntfy-send-selection';
const SEND_IMAGE_ID = 'ntfy-send-image';
const SEND_LINK_ID = 'ntfy-send-link'; // Replaced SEND_PAGE_ID
const SEND_TAB_ID = 'ntfy-send-tab';

// Initialize context menu on install and startup
chrome.runtime.onInstalled.addListener(() => {
    updateContextMenu();
});

chrome.runtime.onStartup.addListener(() => {
    updateContextMenu();
});

// Listen for storage changes to update menu when topics change
chrome.storage.onChanged.addListener((changes, area) => {
    if (area === 'sync' && changes.topics) {
        updateContextMenu();
    }
});

// Build or rebuild the context menu based on current topics
async function updateContextMenu() {
    // Remove all existing menus first
    await chrome.contextMenus.removeAll();

    const config = await NtfyAPI.getConfig();
    const topics = config.topics;

    if (!config.apiUrl || topics.length === 0) {
        // No valid configuration, don't create menu
        return;
    }

    // Create a single parent menu "Send to ntfy" for ALL contexts
    chrome.contextMenus.create({
        id: PARENT_MENU_ID,
        title: 'Send to ntfy',
        contexts: ['all']
    });

    if (topics.length === 1) {
        // Single topic: Text/Image/Link are direct clickable items under the parent
        const topic = topics[0];

        // 1. Page (Tab) - Always visible
        chrome.contextMenus.create({
            id: SEND_TAB_ID,
            parentId: PARENT_MENU_ID,
            title: `Page (${topic})`,
            contexts: ['all']
        });

        // 2. Text - Selection only
        chrome.contextMenus.create({
            id: SEND_SELECTION_ID,
            parentId: PARENT_MENU_ID,
            title: `Text (${topic})`,
            contexts: ['selection']
        });

        // 3. Image - Image only
        chrome.contextMenus.create({
            id: SEND_IMAGE_ID,
            parentId: PARENT_MENU_ID,
            title: `Image (${topic})`,
            contexts: ['image']
        });

        // 4. Link - Link only
        chrome.contextMenus.create({
            id: SEND_LINK_ID,
            parentId: PARENT_MENU_ID,
            title: `Link (${topic})`,
            contexts: ['link']
        });
    } else {
        // Multiple topics: Text/Image/Link are submenus containing topics

        // 1. Page (Tab) Submenu
        chrome.contextMenus.create({
            id: `${PARENT_MENU_ID}-tab`,
            parentId: PARENT_MENU_ID,
            title: 'Page',
            contexts: ['all']
        });

        topics.forEach((topic, index) => {
            chrome.contextMenus.create({
                id: `${SEND_TAB_ID}-${index}`,
                parentId: `${PARENT_MENU_ID}-tab`,
                title: topic,
                contexts: ['all']
            });
        });

        // 2. Text Submenu
        chrome.contextMenus.create({
            id: `${PARENT_MENU_ID}-selection`,
            parentId: PARENT_MENU_ID,
            title: 'Text',
            contexts: ['selection']
        });

        topics.forEach((topic, index) => {
            chrome.contextMenus.create({
                id: `${SEND_SELECTION_ID}-${index}`,
                parentId: `${PARENT_MENU_ID}-selection`,
                title: topic,
                contexts: ['selection']
            });
        });

        // 3. Image Submenu
        chrome.contextMenus.create({
            id: `${PARENT_MENU_ID}-image`,
            parentId: PARENT_MENU_ID,
            title: 'Image',
            contexts: ['image']
        });

        topics.forEach((topic, index) => {
            chrome.contextMenus.create({
                id: `${SEND_IMAGE_ID}-${index}`,
                parentId: `${PARENT_MENU_ID}-image`,
                title: topic,
                contexts: ['image']
            });
        });

        // 4. Link Submenu
        chrome.contextMenus.create({
            id: `${PARENT_MENU_ID}-link`,
            parentId: PARENT_MENU_ID,
            title: 'Link',
            contexts: ['link']
        });

        topics.forEach((topic, index) => {
            chrome.contextMenus.create({
                id: `${SEND_LINK_ID}-${index}`,
                parentId: `${PARENT_MENU_ID}-link`,
                title: topic,
                contexts: ['link']
            });
        });
    }
}

// Handle context menu clicks
chrome.contextMenus.onClicked.addListener(async (info, tab) => {
    let menuId = info.menuItemId;

    // Check if we need to request permission for an image
    if ((menuId === SEND_IMAGE_ID || menuId.startsWith(SEND_IMAGE_ID + '-')) && info.srcUrl) {
        if (info.srcUrl.startsWith('http')) {
            const imgUrlObj = new URL(info.srcUrl);
            const origin = imgUrlObj.origin + '/*';

            try {
                // Request permission immediately while we have the user gesture
                // We don't check permissions.contains first because that is async and will kill the user gesture
                const granted = await new Promise(resolve => {
                    chrome.permissions.request({ origins: [origin] }, resolve);
                });

                if (!granted) {
                    console.error('Permission denied to access image origin');
                    return;
                }
            } catch (e) {
                console.error('Failed to request permission:', e);
                // Continue anyway, it might fail later in fetch but we tried
            }
        }
    }

    const config = await NtfyAPI.getConfig();
    const topics = config.topics;

    if (!config.apiUrl || topics.length === 0) {
        console.error('ntfy not configured');
        return;
    }

    let topic;

    // Determine which topic was selected
    if (topics.length === 1) {
        topic = topics[0];
    } else {
        // Extract topic index from menu ID
        const match = menuId.match(/-(\d+)$/);
        if (match) {
            const index = parseInt(match[1], 10);
            topic = topics[index];
        }
    }

    if (!topic) {
        console.error('Could not determine topic');
        return;
    }

    try {
        if (menuId === SEND_SELECTION_ID || menuId.startsWith(SEND_SELECTION_ID)) {
            // Send selected text
            await NtfyAPI.sendNotification(config, topic, {
                message: info.selectionText
            });
            showBadge('✓', '#4CAF50');
        } else if (menuId === SEND_IMAGE_ID || menuId.startsWith(SEND_IMAGE_ID)) {
            // Send image
            await NtfyAPI.sendImageFromUrl(config, topic, info.srcUrl);
            showBadge('✓', '#4CAF50');
        } else if (menuId === SEND_LINK_ID || menuId.startsWith(SEND_LINK_ID)) {
            // Send link URL
            const urlToSend = info.linkUrl;
            let titleToSend = '';

            // Try to get link text from the page
            try {
                const results = await chrome.scripting.executeScript({
                    target: { tabId: tab.id },
                    func: (targetUrl) => {
                        // Find the link element that matches the URL
                        // We use .href because it returns the absolute URL, matching targetUrl
                        const links = document.querySelectorAll('a');
                        for (const link of links) {
                            if (link.href === targetUrl) {
                                return link.innerText || link.textContent || '';
                            }
                        }
                        return '';
                    },
                    args: [info.linkUrl]
                });

                if (results && results[0] && results[0].result) {
                    titleToSend = results[0].result.trim();
                }
            } catch (e) {
                console.error('Failed to retrieve link text:', e);
            }

            await NtfyAPI.sendNotification(config, topic, {
                message: urlToSend,
                title: titleToSend
            });
            showBadge('✓', '#4CAF50');
        } else if (menuId === SEND_TAB_ID || menuId.startsWith(SEND_TAB_ID)) {
            // Send current page (tab) URL
            await NtfyAPI.sendNotification(config, topic, {
                message: tab.url,
                title: tab.title
            });
            showBadge('✓', '#4CAF50');
        }
    } catch (error) {
        console.error('Failed to send notification:', error);
        showBadge('✗', '#f44336');
    }
});

// Show a temporary badge on the extension icon
function showBadge(text, color) {
    chrome.action.setBadgeText({ text: text });
    chrome.action.setBadgeBackgroundColor({ color: color });

    setTimeout(() => {
        chrome.action.setBadgeText({ text: '' });
    }, 2000);
}


// Subscription management for listening to ntfy channels
const SubscriptionsManager = {
    ws: null,
    connected: false,

    async init() {
        const topics = await this.getTopics();
        if (topics.length === 0) return;

        this.connectAllTopics(topics.join(','));
    },

    getTopics() {
        return new Promise((resolve) => {
            chrome.storage.sync.get(['topics'], (items) => {
                const topics = items.topics || '';
                resolve(topics.split(',').map(t => t.trim()).filter(Boolean));
            });
        });
    },

    connectAllTopics(topics) {
        if (this.ws) {
            this.ws.close();
        }

        NtfyAPI.getConfig().then(async (config) => {
            const callbacks = {
                onOpen: () => {
                    console.log(`Connected to topics: ${topics}`);
                    this.connected = true;
                },
                onMessage: (message) => {
                    const topics = message.topic ? message.topic.split(',') : [];
                    for (const topic of topics) {
                        this.handleMessage(message, topic);
                    }
                },
                onClose: () => {
                    console.log('WebSocket closed, reconnecting in 5s');
                    this.connected = false;
                    setTimeout(() => this.init(), 5000);
                },
                onError: (error) => {
                    console.error('WebSocket error:', error);
                }
            };

            try {
                this.ws = await NtfyAPI.createSubscription(config, topics, callbacks);
            } catch (error) {
                console.error('Failed to subscribe to topics:', error);
                setTimeout(() => this.init(), 5000);
            }
        });
    },

    async toggleMute(topic) {
        return new Promise((resolve) => {
            chrome.storage.sync.get(['topicMuted'], (items) => {
                const muted = items.topicMuted || {};
                muted[topic] = !muted[topic];
                chrome.storage.sync.set({ topicMuted: muted }, () => {
                    resolve(!muted[topic]);
                });
            });
        });
    },

    isMuted(topic) {
        return new Promise((resolve) => {
            chrome.storage.sync.get(['topicMuted'], (items) => {
                const muted = items.topicMuted || {};
                resolve(!!muted[topic]);
            });
        });
    },

    async removeNotification(topic, notifId) {
        return new Promise((resolve) => {
            chrome.storage.local.get(['subscriptionNotifications'], (items) => {
                const notifications = items.subscriptionNotifications || {};
                if (notifications[topic]) {
                    notifications[topic] = notifications[topic].filter(n => n.id !== notifId);
                    chrome.storage.local.set({ subscriptionNotifications: notifications }, resolve);
                } else {
                    resolve();
                }
            });
        });
    },

    async clearNotifications(topic) {
        return new Promise((resolve) => {
            chrome.storage.local.get(['subscriptionNotifications'], (items) => {
                const notifications = items.subscriptionNotifications || {};
                if (notifications[topic]) {
                    notifications[topic] = [];
                    chrome.storage.local.set({ subscriptionNotifications: notifications }, resolve);
                } else {
                    resolve();
                }
            });
        });
    },

    getNotifications(topic) {
        return new Promise((resolve) => {
            chrome.storage.local.get(['subscriptionNotifications'], (items) => {
                const notifications = items.subscriptionNotifications || {};
                resolve(notifications[topic] || []);
            });
        });
    },

    handleMessage(message, topic) {
        if (message.event !== 'message') return;

        this.storeNotification(topic, message);

        this.isMuted(topic).then((muted) => {
            if (!muted) {
                this.showNotification(topic, message);

                if (message.click) {
                    chrome.tabs.create({ url: message.click, active: false });
                }
            }
        });
    },

    storeNotification(topic, message) {
        chrome.storage.local.get(['subscriptionNotifications'], (items) => {
            const notifications = items.subscriptionNotifications || {};
            if (!notifications[topic]) notifications[topic] = [];

            notifications[topic].push({
                id: message.id,
                time: message.time,
                event: message.event,
                topic: topic,
                title: message.title || `ntfy.sh/${topic}`,
                message: message.message || '',
                priority: message.priority,
                tags: message.tags,
                click: message.click,
                received: Date.now()
            });

            if (notifications[topic].length > 100) {
                notifications[topic] = notifications[topic].slice(-100);
            }

            chrome.storage.local.set({ subscriptionNotifications: notifications });
        });
    },

    showNotification(topic, message) {
        const title = message.title || `ntfy.sh/${topic}`;
        const body = message.message || '';

        chrome.notifications.create(`ntfy-${message.id}-${Date.now()}`, {
            type: 'basic',
            iconUrl: 'icons/icon48.png',
            title: title,
            message: body,
            priority: Math.max(0, (message.priority || 3) - 2)
        });
    }
};

chrome.runtime.onStartup.addListener(() => {
    SubscriptionsManager.init();
});

// Listen for storage changes to reconnect when topics, url, or token change
chrome.storage.onChanged.addListener((changes, area) => {
    if (area === 'sync' && (changes.topics || changes.apiUrl || changes.accessToken)) {
        SubscriptionsManager.init();
    }
});
