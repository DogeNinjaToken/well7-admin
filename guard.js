(() => {
  'use strict';
  const E = window.ethers;
  if (!E) throw Error('Wallet library missing');
  const base = E.BrowserProvider.prototype.send;
  const key = 'deepwell-admin97-pending';
  const autoConfirmKey = 'deepwell-admin97-autoconfirm';
  let busy = false;

  function isProjectFundingRoute() {
    const p = location.pathname.replace(/\/+$/, '');
    return p === '/meme' && !p.startsWith('/meme/admin');
  }

  function isAllowedProjectCalldata(data) {
    const sig = String(data || '0x').slice(0, 10).toLowerCase();
    // 0x095ea7b3 = approve(address,uint256), 0xb60d4288 = fund(uint256)
    return sig === '0x095ea7b3' || sig === '0xb60d4288';
  }

  function isAutoConfirm() {
    return window.AdminGuard?.skipConfirm === true || sessionStorage.getItem(autoConfirmKey) === '1';
  }

  function setAutoConfirm(enabled) {
    if (enabled) sessionStorage.setItem(autoConfirmKey, '1');
    else sessionStorage.removeItem(autoConfirmKey);
    const btn = document.getElementById('adminAutoConfirmToggle');
    if (btn) btn.textContent = enabled ? 'Auto-Confirm: ON' : 'Auto-Confirm: OFF';
  }

  async function reconcile(p) {
    let row = JSON.parse(localStorage.getItem(key) || 'null');
    if (!row) return;
    if (!row.hash) throw Error('An interrupted wallet request needs review. Open the admin home recovery panel.');
    let r = await base.call(p, 'eth_getTransactionReceipt', [row.hash]);
    if (!r) throw Error('Transaction still pending: ' + row.hash);
    let history = JSON.parse(localStorage.getItem('deepwell-admin97-history') || '[]');
    history.unshift({ ...row, status: r.status, block: r.blockNumber });
    localStorage.setItem('deepwell-admin97-history', JSON.stringify(history.slice(0, 100)));
    localStorage.removeItem(key);
  }

  async function owner(p) {
    if (BigInt(await base.call(p, 'eth_chainId', [])) !== 97n) throw Error('Select BSC Testnet chain 97');
    let c = window.DEEPWELL_FARM;
    if (!c?.feeEngineAddress) throw Error('Deployment configuration missing');
    let x = await base.call(p, 'eth_call', [{ to: c.feeEngineAddress, data: '0x8da5cb5b' }, 'latest']);
    return E.getAddress('0x' + x.slice(-40));
  }

  E.BrowserProvider.prototype.send = async function (method, params) {
    if (method !== 'eth_sendTransaction') return base.call(this, method, params);
    if (busy) throw Error('Another admin transaction is being reviewed');
    busy = true;
    try {
      await reconcile(this);
      let t = params[0], o = await owner(this);
      const fromAddr = E.getAddress(t.from);
      if (fromAddr !== o) {
        if (!(isProjectFundingRoute() && isAllowedProjectCalldata(t.data))) {
          throw Error('Connect the fee-engine owner wallet');
        }
      }
      if (!t.to) throw Error('Contract deployment is disabled in this dashboard');
      await base.call(this, 'eth_call', [t, 'latest']);
      if (!isAutoConfirm()) {
        if (!confirm('Simulation passed on BSC Testnet.\n\nFrom: ' + t.from + '\nTo: ' + t.to + '\nValue: ' + (t.value || '0x0') + '\nFunction: ' + (t.data || '0x').slice(0, 10) + '\n\nReview the complete transaction in MetaMask. Continue?')) {
          let e = Error('Review cancelled');
          e.code = 4001;
          throw e;
        }
      }
      let nonce = await base.call(this, 'eth_getTransactionCount', [t.from, 'pending']);
      localStorage.setItem(key, JSON.stringify({ from: t.from, to: t.to, data: t.data || '0x', value: t.value || '0x0', nonce, time: new Date().toISOString() }));
      try {
        let hash = await base.call(this, method, params);
        let row = JSON.parse(localStorage.getItem(key));
        row.hash = hash;
        localStorage.setItem(key, JSON.stringify(row));
        return hash;
      } catch (e) {
        if (e.code === 4001 || e.code === 'ACTION_REJECTED') localStorage.removeItem(key);
        throw e;
      }
    } finally {
      busy = false;
    }
  };

  window.AdminGuard = { reconcile, owner, key, isAutoConfirm, setAutoConfirm, skipConfirm: false };
  const sessionKey = 'deepwell-admin97-session-v1', ttl = 8 * 60 * 60 * 1000;
  function clearSession() { sessionStorage.removeItem(sessionKey); }
  function sessionMessage(row) {
    return 'Deepwell Admin Testnet\nOrigin: ' + row.origin + '\nChain: 97\nWallet: ' + row.account + '\nFee engine: ' + row.engine + '\nNonce: ' + row.nonce + '\nIssued: ' + row.issued + '\nExpires: ' + row.expires;
  }
  function validSession(row, account, engine, now = Date.now()) {
    try {
      return row && row.origin === location.origin && row.engine.toLowerCase() === engine.toLowerCase() && row.account.toLowerCase() === account.toLowerCase() && Number.isSafeInteger(row.issued) && Number.isSafeInteger(row.expires) && row.issued <= now && row.expires > now && row.expires - row.issued === ttl && typeof row.nonce === 'string' && E.verifyMessage(sessionMessage(row), row.signature).toLowerCase() === account.toLowerCase();
    } catch { return false; }
  }
  Object.assign(window.AdminGuard, { validSession, sessionMessage, sessionKey });

  addEventListener('DOMContentLoaded', async () => {
    function mountTopControls() {
      const top = document.querySelector('.admin-top') || document.querySelector('header') || document.body;
      if (!document.getElementById('adminAutoConfirmToggle')) {
        let toggle = document.createElement('button');
        toggle.id = 'adminAutoConfirmToggle';
        toggle.type = 'button';
        toggle.textContent = isAutoConfirm() ? 'Auto-Confirm: ON' : 'Auto-Confirm: OFF';
        toggle.title = 'Skip browser confirm() dialog after eth_call simulation passes (MetaMask still confirms every tx)';
        toggle.onclick = () => setAutoConfirm(!isAutoConfirm());
        top.append(toggle);
      }
      if (!document.getElementById('adminSignOut')) {
        let out = document.createElement('button');
        out.id = 'adminSignOut';
        out.type = 'button';
        out.textContent = 'Lock admin';
        out.onclick = () => { clearSession(); location.reload(); };
        top.append(out);
      }
    }

    if (isProjectFundingRoute()) {
      mountTopControls();
      return;
    }

    let gate = document.createElement('div');
    gate.className = 'admin-gate';
    gate.innerHTML = '<section><small>DEEPWELL · TESTNET OPERATIONS</small><h1>Connect administrator</h1><p>Use the existing owner wallet on BSC Testnet. Actions affect the shared WELL7 deployment.</p><button disabled>Checking session…</button><p role="status"></p></section>';
    document.body.append(gate);
    const button = gate.querySelector('button'), status = gate.querySelector('[role=status]');
    function unlock() {
      gate.remove();
      mountTopControls();
    }
    try {
      let row = JSON.parse(sessionStorage.getItem(sessionKey) || 'null');
      if (row && window.ethereum) {
        let p = new E.BrowserProvider(window.ethereum), accounts = await p.send('eth_accounts', []);
        if (accounts.length && validSession(row, accounts[0], window.DEEPWELL_FARM.feeEngineAddress) && E.getAddress(accounts[0]) === await owner(p)) {
          unlock();
          return;
        }
        clearSession();
      }
    } catch { clearSession(); }
    button.disabled = false;
    button.textContent = 'Connect and verify wallet';
    button.onclick = async () => {
      button.disabled = true;
      try {
        if (!window.ethereum) throw Error('Open in a browser with MetaMask');
        let p = new E.BrowserProvider(window.ethereum);
        await p.send('eth_requestAccounts', []);
        let signer = await p.getSigner(), a = await signer.getAddress();
        if (a !== await owner(p)) throw Error('This wallet is not the fee-engine owner');
        let issued = Date.now(), row = { origin: location.origin, engine: window.DEEPWELL_FARM.feeEngineAddress, account: a, nonce: crypto.randomUUID(), issued, expires: issued + ttl };
        row.signature = await signer.signMessage(sessionMessage(row));
        let accounts = await p.send('eth_accounts', []);
        if (!accounts.length || !validSession(row, accounts[0], row.engine) || E.getAddress(accounts[0]) !== await owner(p)) throw Error('Wallet or network changed during sign-in');
        sessionStorage.setItem(sessionKey, JSON.stringify(row));
        window.DeepwellWalletSession?.markConnected?.();
        unlock();
      } catch (e) {
        status.textContent = e.shortMessage || e.message;
      } finally {
        button.disabled = false;
      }
    };
  });

  window.ethereum?.on?.('accountsChanged', () => { clearSession(); location.reload(); });
  window.ethereum?.on?.('chainChanged', () => { clearSession(); location.reload(); });
  window.ethereum?.on?.('disconnect', () => { clearSession(); location.reload(); });
})();