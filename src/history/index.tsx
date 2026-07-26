import { createRoot } from 'react-dom/client';
import { HistoryPage } from './HistoryPage';
import '../styles/content-panel.css'; // Reuse some typography styles

const rootEl = document.getElementById('root');
if (rootEl) {
  const root = createRoot(rootEl);
  root.render(<HistoryPage />);
}
