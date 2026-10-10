const out = document.getElementById('out');

document.getElementById('run').addEventListener('click', async () => {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  out.textContent = tab ? tab.title : 'No tab';
});
