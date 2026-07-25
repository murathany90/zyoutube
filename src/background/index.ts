import { setupMessageRouter } from './message-router';
import { GemSettingsService } from '../gem/settings';

console.log('Background service worker initialized.');

chrome.runtime.onInstalled.addListener(() => {
  console.log('ZYouTube Extension Installed.');
  GemSettingsService.migrateFromGeminiApi().then(r => {
    if (r.migrated) console.log('Migration:', r.message);
  });
});

// Tab updates for SPA navigation
chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
  if (changeInfo.url && (tab.url?.includes('youtube.com/watch') || tab.url?.includes('localhost:3000'))) {
    chrome.tabs.sendMessage(tabId, { type: 'YOUTUBE_URL_CHANGED', url: changeInfo.url }).catch(() => {});
  }
});

// Single message router for all message types
setupMessageRouter();
