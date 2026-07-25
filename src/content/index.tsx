import { useState } from 'react';
import { createRoot, Root } from 'react-dom/client';
import '../index.css';
import { TranscriptTab } from './TranscriptTab';
import { SummaryTab } from './components/SummaryTab';

const Panel = ({ videoId }: { videoId: string }) => {
  const [isOpen, setIsOpen] = useState(true);
  const [activeTab, setActiveTab] = useState<'summary' | 'transcript'>('summary');
  
  // Try to grab title and url from the page
  const title = document.querySelector('h1.ytd-watch-metadata')?.textContent?.trim() || 'Bilinmeyen Video';
  const url = window.location.href;

  if (!isOpen) return null;

  return (
    <div className="mt-4 p-4 rounded-lg bg-gray-100 dark:bg-[#272727] text-black dark:text-white border border-gray-300 dark:border-gray-600 mb-4 shadow-sm">
      <div className="flex justify-between items-center mb-4">
        <h2 className="text-lg font-bold">AI Özet & Transkript</h2>
        <button 
          onClick={() => setIsOpen(false)}
          className="text-gray-500 hover:text-gray-800 dark:hover:text-gray-300"
        >
          Kapat
        </button>
      </div>
      <div className="flex gap-4 border-b border-gray-300 dark:border-gray-600 pb-2 mb-4 overflow-x-auto hide-scrollbar">
        <button 
          onClick={() => setActiveTab('summary')}
          className={`font-semibold pb-1 whitespace-nowrap ${activeTab === 'summary' ? 'text-blue-600 dark:text-blue-400 border-b-2 border-blue-600 dark:border-blue-400' : 'text-gray-600 dark:text-gray-400 hover:text-gray-800 dark:hover:text-gray-200'}`}
        >
          Özet
        </button>
        <button 
          onClick={() => setActiveTab('transcript')}
          className={`font-semibold pb-1 whitespace-nowrap ${activeTab === 'transcript' ? 'text-blue-600 dark:text-blue-400 border-b-2 border-blue-600 dark:border-blue-400' : 'text-gray-600 dark:text-gray-400 hover:text-gray-800 dark:hover:text-gray-200'}`}
        >
          Transkript
        </button>
        <button className="font-semibold text-gray-400 dark:text-gray-500 pb-1 cursor-not-allowed whitespace-nowrap">Ana Fikirler</button>
        <button className="font-semibold text-gray-400 dark:text-gray-500 pb-1 cursor-not-allowed whitespace-nowrap">Sor</button>
        <button className="font-semibold text-gray-400 dark:text-gray-500 pb-1 cursor-not-allowed whitespace-nowrap">Öğren</button>
      </div>
      
      {activeTab === 'summary' && <SummaryTab videoId={videoId} title={title} url={url} />}
      {activeTab === 'transcript' && <TranscriptTab videoId={videoId} />}
    </div>
  );
};

let panelRoot: Root | null = null;
let currentVideoId = '';

const injectButton = () => {
  console.log('injectButton called');
  // Try to find the actions row (like, share, download)
  const actionsRow = document.querySelector('#top-level-buttons-computed');
  console.log('actionsRow:', actionsRow);
  
  if (!actionsRow) return false;
  
  if (document.getElementById('ai-summary-btn')) {
    console.log('btn already exists');
    return true;
  }

  const btn = document.createElement('button');
  btn.id = 'ai-summary-btn';
  btn.className = 'yt-spec-button-shape-next yt-spec-button-shape-next--tonal yt-spec-button-shape-next--mono yt-spec-button-shape-next--size-m yt-spec-button-shape-next--icon-leading';
  btn.style.marginLeft = '8px';
  btn.innerHTML = `
    <div class="yt-spec-button-shape-next__icon">
      <svg height="24" viewBox="0 0 24 24" width="24" focusable="false" style="pointer-events: none; display: block; width: 100%; height: 100%;">
        <path d="M12 2L9.19 8.63L2 9.24L7.65 13.97L5.82 21L12 17.27L18.18 21L16.35 13.97L22 9.24L14.81 8.63L12 2Z" fill="currentColor"></path>
      </svg>
    </div>
    <div class="yt-spec-button-shape-next__button-text-content">AI Özet</div>
  `;
  
  btn.addEventListener('click', () => {
    // Inject panel below the player or below the title
    const secondaryInner = document.querySelector('#secondary-inner') || document.querySelector('#above-the-fold');
    
    if (secondaryInner) {
      if (!document.getElementById('ai-summary-panel-container')) {
        const container = document.createElement('div');
        container.id = 'ai-summary-panel-container';
        
        // Insert right after the title/actions area
        const titleArea = document.querySelector('#above-the-fold');
        if (titleArea && titleArea.parentNode) {
          titleArea.parentNode.insertBefore(container, titleArea.nextSibling);
        } else {
          secondaryInner.prepend(container);
        }
        
        panelRoot = createRoot(container);
      }
      
      if (panelRoot) {
        panelRoot.render(<Panel videoId={currentVideoId} />);
      }
    }
  });

  actionsRow.appendChild(btn);
  return true;
};

// Handle SPA navigation
const init = () => {
  console.log('init called, href:', window.location.href);
  const urlParams = new URLSearchParams(window.location.search);
  const videoId = urlParams.get('v') || (window.location.href.includes('localhost') ? 'dQw4w9WgXcQ' : null);
  console.log('videoId:', videoId);
  
  if (videoId && videoId !== currentVideoId) {
    currentVideoId = videoId;
    
    // Attempt to inject button, retrying if elements aren't loaded yet
    let retries = 0;
    const interval = setInterval(() => {
      if (injectButton() || retries > 10) {
        clearInterval(interval);
      }
      retries++;
    }, 1000);
  }
};

// Initial load
if (window.location.href.includes('youtube.com/watch') || window.location.href.includes('localhost:3000')) {
  init();
}

// Listen for navigation events
chrome.runtime.onMessage.addListener((message) => {
  if (message.type === 'YOUTUBE_URL_CHANGED') {
    init();
  } else if (message.type === 'OPEN_PANEL') {
    if (panelRoot) {
      const container = document.getElementById('ai-summary-panel-container');
      if (container) {
         panelRoot.unmount();
         panelRoot = createRoot(container);
         panelRoot.render(<Panel videoId={currentVideoId} />);
      }
    } else {
      const btn = document.getElementById('ai-summary-btn');
      if (btn) btn.click();
    }
  }
});

// Use MutationObserver for robust SPA changes
const observer = new MutationObserver(() => {
  if (window.location.href.includes('youtube.com/watch') || window.location.href.includes('localhost:3000')) {
    const urlParams = new URLSearchParams(window.location.search);
    const videoId = urlParams.get('v') || 'dQw4w9WgXcQ'; // Fallback for testing on localhost
    if (videoId && videoId !== currentVideoId) {
      init();
    } else if (videoId) {
      // Ensure button stays in DOM
      injectButton();
    }
  }
});

observer.observe(document.body, { childList: true, subtree: true });
