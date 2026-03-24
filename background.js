chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.action === 'start') {
    startAlarms(message, () => {
      sendResponse({ status: 'started' });
    });
    return true; // Keep message channel open for async response
  } else if (message.action === 'stop') {
    stopAlarms();
    sendResponse({ status: 'stopped' });
  }
});

function scheduleNextScroll(min, max) {
  const scrollSeconds = Math.floor(Math.random() * ((max || 30) - (min || 10) + 1)) + (min || 10);
  chrome.alarms.create('independent-scroll-alarm', { when: Date.now() + (scrollSeconds * 1000) });
}

function startAlarms(config, callback) {
  chrome.alarms.clearAll(); // Clear any existing alarms without modifying 'isActive' state
  chrome.storage.local.set({
    targetTabId: config.tabId,
    sessionStartTime: Date.now(),
    isBreakMode: false,
    refreshCount: 0,
    targetRefreshThreshold: Math.floor(Math.random() * (config.tabMax - config.tabMin + 1)) + config.tabMin
  }, () => {
    scheduleNextRefresh(config.min, config.max, callback);
    scheduleNextScroll(config.scrollMin, config.scrollMax);
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

    if (callback) callback();
  });
}

chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === 'independent-scroll-alarm') {
    chrome.storage.local.get(['isActive', 'targetTabId', 'isBreakMode', 'scrollMinTime', 'scrollMaxTime'], (result) => {
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
              const scrollBack = Math.floor(Math.random() * 300) + scrollPixels;
              window.scrollBy({ top: -scrollBack, behavior: 'smooth' });
            }, Math.floor(Math.random() * 2000) + 1000);
          } catch (e) { }
        }
      }).catch(err => console.log('Scroll script failed:', err))
        .finally(() => {
          // Keep the loop going!
          scheduleNextScroll(result.scrollMinTime, result.scrollMaxTime);
        });
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
        let threshold = result.targetRefreshThreshold || 3;

        if (currentCount >= threshold) {
          console.log(`Threshold reached (${currentCount}/${threshold}), attempting to switch Fiverr tabs.`);

          chrome.scripting.executeScript({
            target: { tabId: result.targetTabId },
            func: () => {
              try {
                const navTabs = document.querySelectorAll('#manage-gigs-filter-tabs a');
                if (navTabs && navTabs.length > 0) {
                  const unselectedTabs = Array.from(navTabs).filter(t => !t.classList.contains('sel'));
                  const listToPickFrom = unselectedTabs.length > 0 ? unselectedTabs : Array.from(navTabs);
                  const randomTab = listToPickFrom[Math.floor(Math.random() * listToPickFrom.length)];
                  if (randomTab) { randomTab.click(); return true; }
                }
                return false;
              } catch (e) { return false; }
            }
          }).then((injectionResults) => {
            const success = injectionResults && injectionResults[0] && injectionResults[0].result;
            if (!success) chrome.tabs.reload(result.targetTabId);

            chrome.storage.local.get(['tabMinTime', 'tabMaxTime'], (res) => {
              const nextThreshold = Math.floor(Math.random() * ((res.tabMaxTime || 5) - (res.tabMinTime || 2) + 1)) + (res.tabMinTime || 2);
              chrome.storage.local.set({ refreshCount: 0, targetRefreshThreshold: nextThreshold }, () => {
                scheduleNextRefresh(result.minTime, result.maxTime);
              });
            });

          }).catch(err => {
            chrome.tabs.reload(result.targetTabId);
            chrome.storage.local.set({ refreshCount: 0 }, () => scheduleNextRefresh(result.minTime, result.maxTime));
          });

          return;
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

