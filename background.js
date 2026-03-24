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
          const simulateHumanMouse = (startX, startY, endX, endY) => {
            return new Promise(resolve => {
              const points = [];
              const steps = Math.floor(Math.random() * 30) + 30; // 30-60 steps
              const cx = (startX + endX) / 2 + (Math.random() * 300 - 150);
              const cy = (startY + endY) / 2 + (Math.random() * 300 - 150);

              for (let i = 0; i <= steps; i++) {
                  let t = i / steps;
                  const easeT = t < 0.5 ? 2 * t * t : -1 + (4 - 2 * t) * t;
                  let bx = (1 - easeT) * (1 - easeT) * startX + 2 * (1 - easeT) * easeT * cx + easeT * easeT * endX;
                  let by = (1 - easeT) * (1 - easeT) * startY + 2 * (1 - easeT) * easeT * cy + easeT * easeT * endY;
                  bx += (Math.random() * 6) - 3; // Jitter
                  by += (Math.random() * 6) - 3;
                  points.push({ x: bx, y: by });
              }

              let i = 0;
              const moveInterval = setInterval(() => {
                  if (i >= points.length) {
                      clearInterval(moveInterval);
                      document.dispatchEvent(new MouseEvent('mousemove', { clientX: endX, clientY: endY, bubbles: true }));
                      resolve();
                      return;
                  }
                  document.dispatchEvent(new MouseEvent('mousemove', { clientX: points[i].x, clientY: points[i].y, bubbles: true }));
                  i++;
              }, Math.floor(Math.random() * 10) + 15);
            });
          };

          return new Promise(resolve => {
            try {
              window._ghostMouseLastPos = window._ghostMouseLastPos || { x: window.innerWidth / 2, y: window.innerHeight / 2 };
              
              // Move to a random centerish point before scrolling
              const targetX = window.innerWidth / 2 + (Math.random() * 400 - 200);
              const targetY = window.innerHeight / 2 + (Math.random() * 200 - 100);
              
              console.log(`[GhostMouse] Moving cursor to read area at (${Math.round(targetX)}, ${Math.round(targetY)})...`);
              
              simulateHumanMouse(window._ghostMouseLastPos.x, window._ghostMouseLastPos.y, targetX, targetY).then(() => {
                window._ghostMouseLastPos = { x: targetX, y: targetY };
                console.log(`[GhostMouse] Settled in read area. Performing smooth scrolls.`);
                
                const scrollPixels = Math.floor(Math.random() * 700) + 100;
                window.scrollBy({ top: scrollPixels, behavior: 'smooth' });
                
                setTimeout(() => {
                  const scrollBack = Math.floor(Math.random() * 300) + scrollPixels; // Bounces back slightly
                  window.scrollBy({ top: -scrollBack, behavior: 'smooth' });
                  resolve(true);
                }, Math.floor(Math.random() * 2000) + 1000);
              });
            } catch(e) { resolve(false); }
          });
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
              const simulateHumanMouse = (startX, startY, endX, endY) => {
                return new Promise(resolve => {
                  const points = [];
                  const steps = Math.floor(Math.random() * 30) + 30; // 30-60 steps
                  const cx = (startX + endX) / 2 + (Math.random() * 300 - 150);
                  const cy = (startY + endY) / 2 + (Math.random() * 300 - 150);

                  for (let i = 0; i <= steps; i++) {
                      let t = i / steps;
                      const easeT = t < 0.5 ? 2 * t * t : -1 + (4 - 2 * t) * t;
                      let bx = (1 - easeT) * (1 - easeT) * startX + 2 * (1 - easeT) * easeT * cx + easeT * easeT * endX;
                      let by = (1 - easeT) * (1 - easeT) * startY + 2 * (1 - easeT) * easeT * cy + easeT * easeT * endY;
                      bx += (Math.random() * 6) - 3;
                      by += (Math.random() * 6) - 3;
                      points.push({ x: bx, y: by });
                  }

                  let i = 0;
                  const moveInterval = setInterval(() => {
                      if (i >= points.length) {
                          clearInterval(moveInterval);
                          document.dispatchEvent(new MouseEvent('mousemove', { clientX: endX, clientY: endY, bubbles: true }));
                          resolve();
                          return;
                      }
                      document.dispatchEvent(new MouseEvent('mousemove', { clientX: points[i].x, clientY: points[i].y, bubbles: true }));
                      i++;
                  }, Math.floor(Math.random() * 10) + 15);
                });
              };

              return new Promise(resolve => {
                try {
                  const navTabs = document.querySelectorAll('#manage-gigs-filter-tabs a');
                  if (navTabs && navTabs.length > 0) {
                    const unselectedTabs = Array.from(navTabs).filter(t => !t.classList.contains('sel'));
                    const listToPickFrom = unselectedTabs.length > 0 ? unselectedTabs : Array.from(navTabs);
                    const randomTab = listToPickFrom[Math.floor(Math.random() * listToPickFrom.length)];
                    
                    if (randomTab) {
                      const rect = randomTab.getBoundingClientRect();
                      const targetX = rect.left + rect.width / 2 + (Math.random() * 10 - 5);
                      const targetY = rect.top + rect.height / 2 + (Math.random() * 4 - 2);
                      
                      window._ghostMouseLastPos = window._ghostMouseLastPos || { x: window.innerWidth / 2, y: window.innerHeight / 2 };
                      
                      console.log(`[GhostMouse] Calculating Curvy Path from (${Math.round(window._ghostMouseLastPos.x)}, ${Math.round(window._ghostMouseLastPos.y)}) to Gig Tab at (${Math.round(targetX)}, ${Math.round(targetY)})`);
                      
                      // Move mouse towards the tab
                      simulateHumanMouse(window._ghostMouseLastPos.x, window._ghostMouseLastPos.y, targetX, targetY).then(() => {
                        window._ghostMouseLastPos = { x: targetX, y: targetY };
                        console.log(`[GhostMouse] Path complete. Hovering over tab for a bit...`);
                        
                        // Emit hover events
                        randomTab.dispatchEvent(new MouseEvent('mouseover', { bubbles: true }));
                        randomTab.dispatchEvent(new MouseEvent('mouseenter', { bubbles: true }));
                        
                        // Wait realistic time before clicking
                        setTimeout(() => {
                          console.log(`[GhostMouse] Executing click now!`);
                          randomTab.click();
                          resolve(true);
                        }, Math.floor(Math.random() * 700) + 800);
                      });
                      
                      return; // Explicitly ensure we wait for the Promise to resolve and click!
                    }
                  }
                  resolve(false);
                } catch(e) { resolve(false); }
              });
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

