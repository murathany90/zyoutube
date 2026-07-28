interface PopupDocument {
  getElementById(id: string): HTMLElement | null;
}

export function getPopupRoot(documentLike: PopupDocument): HTMLElement {
  const root = documentLike.getElementById('root');
  if (!root) {
    throw new Error('Popup root element #root bulunamadı.');
  }
  return root;
}
