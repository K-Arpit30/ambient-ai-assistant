chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message.type === 'EXTRACT_CONTENT') {
    const textContent = document.body.innerText;
    sendResponse({ content: textContent.substring(0, 10000) }); // Limit to 10k chars
  }
});
