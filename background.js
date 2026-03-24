chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.action === 'start') {
    startAlarms(message.min, message.max, message.tabId, () => {
      sendResponse({ status: 'started' });
    });
    return true; // Keep message channel open for async response
  } else if (message.action === 'stop') {
    stopAlarms();
    sendResponse({ status: 'stopped' });
  }
});

function startAlarms(min, max, tabId, callback) {
  chrome.alarms.clearAll(); // Clear any existing alarms without modifying 'isActive' state
  chrome.storage.local.set({ targetTabId: tabId }, () => {
    scheduleNextRefresh(min, max, callback);
  });
}

function stopAlarms() {
  chrome.alarms.clearAll();
  chrome.storage.local.set({ isActive: false });
  chrome.action.setBadgeText({ text: '' });
  console.log('Refresher stopped');
}

function scheduleNextRefresh(min, max, callback) {
  const randomSeconds = Math.floor(Math.random() * (max - min + 1)) + min;
  const nextRefreshAt = Date.now() + (randomSeconds * 1000);
  
  // Save chosen time and target timestamp for the popup
  chrome.storage.local.set({ 
    nextRefreshAt: nextRefreshAt,
    chosenSeconds: randomSeconds
  }, () => {
    // Set the initial badge text
    chrome.action.setBadgeText({ text: randomSeconds.toString() });
    chrome.action.setBadgeBackgroundColor({ color: '#3b82f6' });

    chrome.alarms.create('refresh-alarm', { when: nextRefreshAt });
    console.log(`Next refresh scheduled in ${randomSeconds}s`);
    if (callback) callback();
  });
}

chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === 'refresh-alarm') {
    chrome.storage.local.get(['minTime', 'maxTime', 'isActive', 'targetTabId'], (result) => {
      if (!result.isActive || !result.targetTabId) return;

      // Try to get the tab to check if it still exists
      chrome.tabs.get(result.targetTabId, (tab) => {
        if (chrome.runtime.lastError || !tab) {
          console.warn('Target tab was closed. Stopping refresher.');
          stopAlarms();
          return;
        }

        // Reload the specific target tab
        chrome.tabs.reload(result.targetTabId);
        console.log(`Target tab (${tab.url}) reloaded.`);
        
        // Schedule next refresh
        scheduleNextRefresh(result.minTime, result.maxTime);
      });
    });
  }
});
