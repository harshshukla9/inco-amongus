/**
 * Full-screen DOM overlay so MetaMask prompts aren't "invisible" behind the Phaser canvas.
 */

import { hasProvider, request } from './provider';

let activeEl = null;

export function showMetaMaskOverlay(message) {
  hideMetaMaskOverlay();
  if (typeof document === 'undefined') return;
  const el = document.createElement('div');
  el.setAttribute('data-inco-mm', '1');
  el.style.cssText = [
    'position:fixed',
    'inset:0',
    'z-index:2147483646',
    'background:rgba(5,8,20,0.82)',
    'display:flex',
    'align-items:center',
    'justify-content:center',
    'padding:28px',
    'font-family:Arial,Helvetica,sans-serif',
    'color:#f8fafc',
    'text-align:center',
  ].join(';');
  el.innerHTML = `
    <div style="max-width:520px">
      <div style="font-size:13px;letter-spacing:.12em;color:#38bdf8;margin-bottom:10px">INCO / METAMASK</div>
      <div style="font-size:26px;font-weight:700;margin-bottom:12px">${message}</div>
      <div style="font-size:15px;color:#cbd5e1;line-height:1.45">
        Click <b>Confirm</b> in the MetaMask popup.<br/>
        If no popup: click the MetaMask fox icon in the toolbar.
      </div>
    </div>
  `;
  document.body.appendChild(el);
  activeEl = el;
  try {
    window.focus();
  } catch (_) {
    /* ignore */
  }
}

export function hideMetaMaskOverlay() {
  if (activeEl && activeEl.parentNode) activeEl.parentNode.removeChild(activeEl);
  activeEl = null;
  if (typeof document !== 'undefined') {
    document.querySelectorAll('[data-inco-mm="1"]').forEach((n) => n.remove());
  }
}

export async function withMetaMaskOverlay(message, fn) {
  showMetaMaskOverlay(message);
  try {
    return await fn();
  } finally {
    hideMetaMaskOverlay();
  }
}

/** Nudge the wallet UI open before sending a tx / signature. */
export async function wakeMetaMask() {
  if (!hasProvider()) return;
  await request({ method: 'eth_requestAccounts' });
}
