document.addEventListener('DOMContentLoaded', () => {
  const minTimeInput = document.getElementById('minTime');
  const maxTimeInput = document.getElementById('maxTime');
  const toggleBtn = document.getElementById('toggleBtn');
  const statusText = document.getElementById('statusText');
  const statusDot = document.getElementById('statusDot');
  const countdownContainer = document.getElementById('countdownContainer');
  const countdownValue = document.getElementById('countdownValue');
  
  const scrollMinTimeInput = document.getElementById('scrollMinTime');
  const scrollMaxTimeInput = document.getElementById('scrollMaxTime');
  const tabMinTimeInput = document.getElementById('tabMinTime');
  const tabMaxTimeInput = document.getElementById('tabMaxTime');

  let countdownInterval;

  // 1. Initial Load - Get current state
  chrome.storage.local.get(['minTime', 'maxTime', 'scrollMinTime', 'scrollMaxTime', 'tabMinTime', 'tabMaxTime', 'isActive', 'nextRefreshAt', 'isBreakMode'], (result) => {
    if (result.minTime) minTimeInput.value = result.minTime;
    if (result.maxTime) maxTimeInput.value = result.maxTime;
    if (result.scrollMinTime) scrollMinTimeInput.value = result.scrollMinTime;
    if (result.scrollMaxTime) scrollMaxTimeInput.value = result.scrollMaxTime;
    if (result.tabMinTime) tabMinTimeInput.value = result.tabMinTime;
    if (result.tabMaxTime) tabMaxTimeInput.value = result.tabMaxTime;

    updateUI(result.isActive, result.isBreakMode);
    if (result.isActive && result.nextRefreshAt) {
      startCountdown(Number(result.nextRefreshAt));
    }
  });

  // 2. Storage Listener - Sync with background script
  chrome.storage.onChanged.addListener((changes, areaName) => {
    if (areaName === 'local') {
      if (changes.isActive || changes.isBreakMode) {
        chrome.storage.local.get(['isActive', 'isBreakMode'], (res) => {
          updateUI(res.isActive, res.isBreakMode);
        });
      }
      if (changes.nextRefreshAt && changes.nextRefreshAt.newValue) {
        startCountdown(Number(changes.nextRefreshAt.newValue));
      }
    }
  });

  function startCountdown(targetTime) {
    if (countdownInterval) clearInterval(countdownInterval);
    if (!targetTime || isNaN(targetTime)) {
      countdownValue.textContent = '--';
      return;
    }

    const updateCountdown = () => {
      const now = Date.now();
      const remaining = Math.max(0, Math.ceil((targetTime - now) / 1000));
      countdownValue.textContent = remaining;

      if (remaining <= 0) {
        clearInterval(countdownInterval);
      }
    };

    updateCountdown();
    countdownInterval = setInterval(updateCountdown, 1000);
  }

  toggleBtn.addEventListener('click', () => {
    const min = parseInt(minTimeInput.value) || 30;
    const max = parseInt(maxTimeInput.value) || 60;
    const scrollMin = parseInt(scrollMinTimeInput.value) || 10;
    const scrollMax = parseInt(scrollMaxTimeInput.value) || 30;
    const tabMin = parseInt(tabMinTimeInput.value) || 2;
    const tabMax = parseInt(tabMaxTimeInput.value) || 5;

    if (isNaN(min) || isNaN(max) || min <= 0 || max <= 0) {
      alert('Please enter valid positive numbers.');
      return;
    }

    if (min >= max) {
      alert('Maximum refresh time must be greater than minimum time.');
      return;
    }
    
    if (scrollMin >= scrollMax) {
      alert('Maximum scroll interval must be greater than minimum.');
      return;
    }
    
    if (tabMin >= tabMax) {
      alert('Maximum tab switch refreshes must be greater than minimum.');
      return;
    }

    chrome.storage.local.get('isActive', (result) => {
      const active = !result.isActive;

      if (!active) {
        // Stop logic
        chrome.storage.local.set({ isActive: false });
        chrome.runtime.sendMessage({ action: 'stop' });
        updateUI(false);
      } else {
        // Start logic
        chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
          const tab = tabs[0];
          if (!tab) return;

          // Set state first, then send message
          chrome.storage.local.set({
            minTime: min,
            maxTime: max,
            scrollMinTime: scrollMin,
            scrollMaxTime: scrollMax,
            tabMinTime: tabMin,
            tabMaxTime: tabMax,
            isActive: true,
            isBreakMode: false,
            targetTabId: tab.id
          }, () => {
            updateUI(true, false);
            chrome.runtime.sendMessage({
              action: 'start',
              min: min,
              max: max,
              scrollMin: scrollMin,
              scrollMax: scrollMax,
              tabMin: tabMin,
              tabMax: tabMax,
              tabId: tab.id
            });
          });
        });
      }
    });
  });

  function updateUI(active, isBreakMode) {
    if (active) {
      toggleBtn.textContent = 'Stop Refresher';
      toggleBtn.classList.add('stop');
      countdownContainer.style.display = 'flex';
      
      if (isBreakMode) {
        statusText.textContent = 'Taking a Break (15m)';
        statusText.style.color = '#f59e0b';
        statusDot.style.background = '#f59e0b';
        statusDot.style.boxShadow = '0 0 12px #f59e0b';
      } else {
        statusText.textContent = 'Refresher Active';
        statusText.style.color = '';
        statusDot.style.background = '';
        statusDot.style.boxShadow = '';
      }
      statusDot.classList.add('active');
    } else {
      if (countdownInterval) clearInterval(countdownInterval);
      toggleBtn.textContent = 'Start Refresher';
      toggleBtn.classList.remove('stop');
      statusText.textContent = 'System Idle';
      statusText.style.color = '';
      statusDot.classList.remove('active');
      statusDot.style.background = '';
      statusDot.style.boxShadow = '';
      countdownContainer.style.display = 'none';
      countdownValue.textContent = '--';
    }
  }
});
