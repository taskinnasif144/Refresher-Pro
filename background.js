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
    isBreakMode: false,
    refreshCount: 0,
    targetRefreshThreshold: Math.floor(Math.random() * 4) + 2 // 2 to 5
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
    chrome.storage.local.get(['minTime', 'maxTime', 'isActive', 'targetTabId', 'sessionStartTime', 'isBreakMode', 'refreshCount', 'targetRefreshThreshold'], (result) => {
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

        // Feature 2: Fiverr Tab Switching
        let currentCount = (result.refreshCount || 0) + 1;
        let threshold = result.targetRefreshThreshold || (Math.floor(Math.random() * 4) + 2);

        if (currentCount >= threshold) {
          console.log(`Threshold reached (${currentCount}/${threshold}), attempting to switch Fiverr tabs.`);
          
          chrome.scripting.executeScript({
            target: { tabId: result.targetTabId },
            func: () => {
              try {
                const navTabs = document.querySelectorAll('#manage-gigs-filter-tabs a');
                if (navTabs && navTabs.length > 0) {
                  // Don't click the currently selected one (.sel class in Fiverr's code)
                  const unselectedTabs = Array.from(navTabs).filter(t => !t.classList.contains('sel'));
                  
                  const listToPickFrom = unselectedTabs.length > 0 ? unselectedTabs : Array.from(navTabs);
                  const randomTab = listToPickFrom[Math.floor(Math.random() * listToPickFrom.length)];
                  
                  if (randomTab) {
                    randomTab.click();
                    return true;
                  }
                }
                return false;
              } catch(e) {
                return false;
              }
            }
          }).then((injectionResults) => {
            const success = injectionResults && injectionResults[0] && injectionResults[0].result;
            
            if (success) {
              console.log('Successfully clicked a random Fiverr gig tab.');
            } else {
              console.log('Not on Fiverr Gigs page or tabs not found. Doing normal reload.');
              chrome.tabs.reload(result.targetTabId);
            }
            
            // Reset counter and trigger next refresh schedule
            chrome.storage.local.set({
              refreshCount: 0,
              targetRefreshThreshold: Math.floor(Math.random() * 4) + 2
            }, () => {
              scheduleNextRefresh(result.minTime, result.maxTime);
            });
            
          }).catch(err => {
            console.warn('Script error, defaulting to normal reload.', err);
            chrome.tabs.reload(result.targetTabId);
            chrome.storage.local.set({ refreshCount: 0 }, () => {
              scheduleNextRefresh(result.minTime, result.maxTime);
            });
          });
          
          return; // Exit normal flow since we're handling scheduling asynchronously
        }

        // Normal flow (if threshold not reached)
        chrome.tabs.reload(result.targetTabId);
        console.log(`Target tab (${tab.url}) reloaded. Normal refresh count: ${currentCount}/${threshold}`);
        
        // Save the incremented count and schedule next refresh
        chrome.storage.local.set({ refreshCount: currentCount }, () => {
          scheduleNextRefresh(result.minTime, result.maxTime);
        });
      });
    });
  }
});

