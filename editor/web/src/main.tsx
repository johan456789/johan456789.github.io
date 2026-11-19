import { render } from 'preact';
import { App } from './App';
import { initViewport } from './viewport';
import { boot } from './sync';
import './styles.css';

initViewport();
void boot();
render(<App />, document.getElementById('app')!);

if ('serviceWorker' in navigator && import.meta.env.PROD) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/_editor/sw.js', { scope: '/_editor/' }).catch(() => {});
  });
}
