document.addEventListener('DOMContentLoaded', () => {
  const minTimeInput = document.getElementById('minTime');
  const maxTimeInput = document.getElementById('maxTime');
  const toggleBtn = document.getElementById('toggleBtn');
  const statusText = document.getElementById('statusText');
  const statusDot = document.getElementById('statusDot');
  const countdownContainer = document.getElementById('countdownContainer');
  const countdownValue = document.getElementById('countdownValue');

  let countdownInterval;

  // 1. Initial Load - Get current state
  chrome.storage.local.get(['minTime', 'maxTime', 'isActive', 'nextRefreshAt'], (result) => {
    if (result.minTime) minTimeInput.value = result.minTime;
    if (result.maxTime) maxTimeInput.value = result.maxTime;

    updateUI(result.isActive);
    if (result.isActive && result.nextRefreshAt) {
      startCountdown(Number(result.nextRefreshAt));
    }
  });

  // 2. Storage Listener - Sync with background script
  chrome.storage.onChanged.addListener((changes, areaName) => {
    if (areaName === 'local') {
      if (changes.isActive) {
        updateUI(changes.isActive.newValue);
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
    const min = parseInt(minTimeInput.value);
    const max = parseInt(maxTimeInput.value);

    if (isNaN(min) || isNaN(max) || min <= 0 || max <= 0) {
      alert('Please enter valid positive numbers.');
      return;
    }

    if (min >= max) {
      alert('Maximum time must be greater than minimum time.');
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
            isActive: true,
            targetTabId: tab.id
          }, () => {
            updateUI(true);
            chrome.runtime.sendMessage({
              action: 'start',
              min: min,
              max: max,
              tabId: tab.id
            });
          });
        });
      }
    });
  });

  function updateUI(active) {
    if (active) {
      toggleBtn.textContent = 'Stop Refresher';
      toggleBtn.classList.add('stop');
      statusText.textContent = 'Refresher Active';
      statusDot.classList.add('active');
      countdownContainer.style.display = 'flex';
    } else {
      if (countdownInterval) clearInterval(countdownInterval);
      toggleBtn.textContent = 'Start Refresher';
      toggleBtn.classList.remove('stop');
      statusText.textContent = 'System Idle';
      statusDot.classList.remove('active');
      countdownContainer.style.display = 'none';
      countdownValue.textContent = '--';
    }
  }
});
