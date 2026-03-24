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
  chrome.storage.local.set({ 
    targetTabId: tabId,
    sessionStartTime: Date.now(),
    isBreakMode: false
  }, () => {
    scheduleNextRefresh(min, max, callback);
  });
}

function stopAlarms() {
  chrome.alarms.clearAll();
  chrome.storage.local.set({ isActive: false, isBreakMode: false });
  chrome.action.setBadgeText({ text: '' });
  console.log('Refresher stopped');
}

function scheduleNextRefresh(min, max, callback) {
  const randomSeconds = Math.floor(Math.random() * (max - min + 1)) + min;
  const nextRefreshAt = Date.now() + (randomSeconds * 1000);
  
  // Save chosen time and target timestamp for the popup
  chrome.storage.local.set({ 
    nextRefreshAt: nextRefreshAt,
    chosenSeconds: randomSeconds,
    isBreakMode: false
  }, () => {
    // Set the initial badge text
    chrome.action.setBadgeText({ text: randomSeconds.toString() });
    chrome.action.setBadgeBackgroundColor({ color: '#3b82f6' });

    chrome.alarms.create('refresh-alarm', { when: nextRefreshAt });
    console.log(`Next refresh scheduled in ${randomSeconds}s`);

    // Simulate human-like scrolling before the next refresh
    if (randomSeconds > 10) {
      // Schedule a scroll alarm somewhere between 2 seconds and 5 seconds before refresh
      const scrollInSeconds = Math.floor(Math.random() * (randomSeconds - 5)) + 2;
      chrome.alarms.create('scroll-alarm', { when: Date.now() + (scrollInSeconds * 1000) });
    }

    if (callback) callback();
  });
}

chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === 'scroll-alarm') {
    chrome.storage.local.get(['isActive', 'targetTabId', 'isBreakMode'], (result) => {
      // Don't scroll if we're paused or the refresher stopped
      if (!result.isActive || !result.targetTabId || result.isBreakMode) return;

      chrome.scripting.executeScript({
        target: { tabId: result.targetTabId },
        func: () => {
          try {
            // Smoothly scroll down by a random amount (between 100-800 pixels)
            const scrollPixels = Math.floor(Math.random() * 700) + 100;
            window.scrollBy({ top: scrollPixels, behavior: 'smooth' });
            
            // Wait 1-3 seconds, then scroll back up by a smaller random amount
            setTimeout(() => {
              const scrollBack = Math.floor(Math.random() * 300) + 50;
              window.scrollBy({ top: -scrollBack, behavior: 'smooth' });
            }, Math.floor(Math.random() * 2000) + 1000);
          } catch(e) {}
        }
      }).catch(err => console.log('Scroll script failed (tab might be protected):', err));
    });
    return;
  }
  if (alarm.name === 'break-alarm') {
    chrome.storage.local.get(['minTime', 'maxTime', 'isActive', 'targetTabId'], (result) => {
      if (!result.isActive || !result.targetTabId) return;

      chrome.tabs.get(result.targetTabId, (tab) => {
        if (chrome.runtime.lastError || !tab) {
          console.warn('Target tab was closed during break. Stopping refresher.');
          stopAlarms();
          return;
        }

        console.log('Break time is over. Resuming regular refreshes.');
        chrome.storage.local.set({ sessionStartTime: Date.now(), isBreakMode: false }, () => {
          chrome.tabs.reload(result.targetTabId);
          scheduleNextRefresh(result.minTime, result.maxTime);
        });
      });
    });
    return;
  }

  if (alarm.name === 'refresh-alarm') {
    chrome.storage.local.get(['minTime', 'maxTime', 'isActive', 'targetTabId', 'sessionStartTime', 'isBreakMode'], (result) => {
      if (!result.isActive || !result.targetTabId) return;

      // Try to get the tab to check if it still exists
      chrome.tabs.get(result.targetTabId, (tab) => {
        if (chrome.runtime.lastError || !tab) {
          console.warn('Target tab was closed. Stopping refresher.');
          stopAlarms();
          return;
        }

        const RUN_DURATION_MS = 30 * 60 * 1000; // 30 minutes
        const BREAK_DURATION_MS = 15 * 60 * 1000; // 15 minutes

        const timeRunning = Date.now() - (result.sessionStartTime || Date.now());

        if (timeRunning >= RUN_DURATION_MS && !result.isBreakMode) {
          const breakEndsAt = Date.now() + BREAK_DURATION_MS;
          
          chrome.storage.local.set({ 
            isBreakMode: true,
            nextRefreshAt: breakEndsAt,
            chosenSeconds: BREAK_DURATION_MS / 1000
          }, () => {
            chrome.action.setBadgeText({ text: 'BREAK' });
            chrome.action.setBadgeBackgroundColor({ color: '#f59e0b' }); // Amber color
            chrome.alarms.create('break-alarm', { when: breakEndsAt });
            console.log(`Taking a 15-minute break. Resuming at ${new Date(breakEndsAt).toLocaleTimeString()}`);
          });
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
