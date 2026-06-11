// Background service worker for context menu integration
// Compatible with Chrome, Edge, and Firefox 142+

// Import shared utilities (only in Service Worker context)
if (typeof importScripts === 'function') {
    importScripts('ntfy.js');
}

const PARENT_MENU_ID = 'ntfy-parent';
const SEND_SELECTION_ID = 'ntfy-send-selection';
const SEND_IMAGE_ID = 'ntfy-send-image';
const SEND_LINK_ID = 'ntfy-send-link';
const SEND_TAB_ID = 'ntfy-send-tab';

const DEFAULT_POLL_INTERVAL = 300; // 5 minutes in seconds

// Initialize context menu on install and startup
chrome.runtime.onInstalled.addListener(() => {
    updateContextMenu();
    setupAlarm();
});

chrome.runtime.onStartup.addListener(() => {
    updateContextMenu();
    setupAlarm();
});

// Handle storage changes to update alarm interval
chrome.storage.onChanged.addListener((changes, area) => {
    if (area === 'sync') {
        if (changes.topics || changes.apiUrl || changes.accessToken) {
            updateContextMenu();
        }
        if (changes.pollInterval) {
            setupAlarm();
        }
    }
});

// Handle messages from popup to update alarm or reset unread counts
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (message.action === 'updateAlarm') {
        setupAlarm();
    }
});

// ========================================
// Alarm-based polling (replaces WebSocket)
// ========================================

async function setupAlarm() {
    try {
        const config = await NtfyAPI.getConfig();
        const pollInterval = config.pollInterval || DEFAULT_POLL_INTERVAL;

        await chrome.alarms.clear('ntfy-poll');

        await chrome.alarms.create('ntfy-poll', {
            periodInMinutes: pollInterval / 60
        });

        console.log(`Polling alarm set: every ${pollInterval}s`);
    } catch (error) {
        console.error('Failed to setup alarm:', error);
    }
}

chrome.alarms.onAlarm.addListener(async (alarm) => {
    if (alarm.name === 'ntfy-poll') {
        await pollForNewMessages();
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

    // Helper to get display name for a topic
    function getDisplayName(topic) {
        return config.topicNames?.[topic] || topic;
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
        const displayName = getDisplayName(topic);

        // 1. Page (Tab) - Always visible
        chrome.contextMenus.create({
            id: SEND_TAB_ID,
            parentId: PARENT_MENU_ID,
            title: `Page (${displayName})`,
            contexts: ['all']
        });

        // 2. Text - Selection only
        chrome.contextMenus.create({
            id: SEND_SELECTION_ID,
            parentId: PARENT_MENU_ID,
            title: `Text (${displayName})`,
            contexts: ['selection']
        });

        // 3. Image - Image only
        chrome.contextMenus.create({
            id: SEND_IMAGE_ID,
            parentId: PARENT_MENU_ID,
            title: `Image (${displayName})`,
            contexts: ['image']
        });

        // 4. Link - Link only
        chrome.contextMenus.create({
            id: SEND_LINK_ID,
            parentId: PARENT_MENU_ID,
            title: `Link (${displayName})`,
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
                title: getDisplayName(topic),
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
                title: getDisplayName(topic),
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
                title: getDisplayName(topic),
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
                title: getDisplayName(topic),
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
                title: titleToSend,
                click: urlToSend
            });
            showBadge('✓', '#4CAF50');
        } else if (menuId === SEND_TAB_ID || menuId.startsWith(SEND_TAB_ID)) {
            // Send current page (tab) URL
            await NtfyAPI.sendNotification(config, topic, {
                message: tab.url,
                title: tab.title,
                click: tab.url
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

async function pollForNewMessages() {
    const config = await NtfyAPI.getConfig();
    const topics = config.topics;

    if (!config.apiUrl || topics.length === 0) {
        return;
    }

    const topicsJoined = topics.join(',');

    // Get the last message ID for this topic
    const lastMessageId = await getLastMessageId(topicsJoined);
    const isFirstPoll = !lastMessageId;

    try {
        // On first poll, fetch all messages (no since parameter)
        // On subsequent polls, use the last message ID to get only new messages
        const messages = await NtfyAPI.fetchMessageHistory(config, topicsJoined, isFirstPoll ? null : lastMessageId);

        // On first poll, cache all messages and store the last ID
        if (isFirstPoll) {
            // Store the last message ID
            if (messages.length > 0) {
                const lastMsg = messages[messages.length - 1];
                await setLastMessageId(topicsJoined, lastMsg.id);
            }
            console.log(`First poll complete: ${messages.length} messages cached`);
            return;
        }

        // Subsequent polls: only process new messages
        for (const message of messages) {
            if (message.event !== 'message') continue;

            const messageTopics = message.topic ? message.topic.split(',') : [topicsJoined];

            for (const topic of messageTopics) {
                const isMuted = await isTopicMuted(topic);
                if (isMuted) continue;

                // Increment per-topic unread count in storage
                const topicUnread = await getTopicUnreadCount(topic);
                await setTopicUnreadCount(topic, topicUnread + 1);

                // Also increment total unread
                const totalUnread = await getUnreadCount();
                await setUnreadCount(totalUnread + 1);

                await showNotification(topic, message);

                if (message.click) {
                    chrome.tabs.create({ url: message.click, active: true });
                }
            }
        }

        // Update last message ID
        if (messages.length > 0) {
            const lastMsg = messages[messages.length - 1];
            await setLastMessageId(topicsJoined, lastMsg.id);
        }

        // Update badge with total unread count from storage
        const unreadCount = await getUnreadCount();
        await updateBadge(unreadCount);

        console.log(`Polling complete: ${messages.length} new messages`);
    } catch (error) {
        console.error('Polling failed:', error);
    }
}

async function updateBadge(count) {
    if (count > 0) {
        chrome.action.setBadgeText({ text: count > 99 ? '99+' : count.toString() });
        chrome.action.setBadgeBackgroundColor({ color: '#e53935' });
    } else {
        chrome.action.setBadgeText({ text: '' });
    }
}

function getUnreadCount() {
    return new Promise((resolve) => {
        chrome.storage.local.get(['unreadCount'], (items) => {
            resolve(items.unreadCount || 0);
        });
    });
}

function setUnreadCount(count) {
    return new Promise((resolve) => {
        chrome.storage.local.set({ unreadCount: count }, () => {
            resolve();
        });
    });
}

function getTopicUnreadCount(topic) {
    return new Promise((resolve) => {
        chrome.storage.local.get(['topicUnreadCounts'], (items) => {
            const counts = items.topicUnreadCounts || {};
            resolve(counts[topic] || 0);
        });
    });
}

function setTopicUnreadCount(topic, count) {
    return new Promise((resolve) => {
        chrome.storage.local.get(['topicUnreadCounts'], (items) => {
            const counts = items.topicUnreadCounts || {};
            counts[topic] = count;
            chrome.storage.local.set({ topicUnreadCounts: counts }, () => {
                resolve();
            });
        });
    });
}

function getLastMessageId(topics) {
    return new Promise((resolve) => {
        chrome.storage.local.get(['lastMessageId'], (items) => {
            resolve(items.lastMessageId?.[topics] || null);
        });
    });
}

function setLastMessageId(topics, messageId) {
    return new Promise((resolve) => {
        chrome.storage.local.get(['lastMessageId'], (items) => {
            const lastMessageId = items.lastMessageId || {};
            lastMessageId[topics] = messageId;
            chrome.storage.local.set({ lastMessageId }, () => {
                resolve();
            });
        });
    });
}

function isTopicMuted(topic) {
    return new Promise((resolve) => {
        chrome.storage.sync.get(['topicMuted'], (items) => {
            const muted = items.topicMuted || {};
            resolve(!!muted[topic]);
        });
    });
}

function showNotification(topic, message) {
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