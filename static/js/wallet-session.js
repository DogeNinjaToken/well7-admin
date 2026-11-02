(()=>{'use strict';
const short=a=>a&&a.length>14?`${a.slice(0,8)}…${a.slice(-6)}`:'Connect Wallet';
let sequence=0,providerWait=null;
let state={account:'',chainId:0,provider:null};
const boundProviders=new WeakSet();
function isExplicitlyDisconnected(){try{return window.localStorage?.getItem('deepwell:disconnected')==='1'}catch{return false}}
function markConnected(){try{window.localStorage?.removeItem('deepwell:disconnected')}catch{}}
function paint(){const button=document.getElementById('connect');if(!button)return;button.textContent=state.account?short(state.account):'Connect Wallet';button.title=state.account?(state.chainId===97?'Connected to BNB Smart Chain Testnet (chain 97).':'Wallet connected; switch to BNB Smart Chain Testnet (chain 97) for Deepwell transactions.'):'Connect a wallet to continue.';button.dataset.walletState=state.account?'connected':'disconnected'}
function setState(next){const changed=next.account!==state.account||next.chainId!==state.chainId||next.provider!==state.provider;state=next;paint();if(changed)window.dispatchEvent(new CustomEvent('deepwell:wallet-session-changed',{detail:{account:state.account,chainId:state.chainId,provider:state.provider}}));return{...state}}
function hasProvider(){return !!window.ethereum&&typeof window.ethereum.request==='function'}
async function waitForProvider(){if(hasProvider())return window.ethereum;if(providerWait)return providerWait;providerWait=new Promise(resolve=>{let done=false;const finish=()=>{if(done)return;done=true;clearInterval(poll);clearTimeout(timer);window.removeEventListener?.('ethereum#initialized',finish);resolve(hasProvider()?window.ethereum:null)};const poll=setInterval(()=>{if(hasProvider())finish()},100);const timer=setTimeout(finish,1800);window.addEventListener?.('ethereum#initialized',finish,{once:true})});try{return await providerWait}finally{providerWait=null}}
function bind(provider){if(!provider||typeof provider!=='object'||boundProviders.has(provider))return;boundProviders.add(provider);provider.on?.('accountsChanged',()=>{api.ready=refresh()});provider.on?.('chainChanged',()=>{api.ready=refresh()})}
async function refresh(){const requestId=++sequence;if(isExplicitlyDisconnected())return setState({account:'',chainId:0,provider:hasProvider()?window.ethereum:null});const provider=await waitForProvider();if(requestId!==sequence)return{...state};if(isExplicitlyDisconnected())return setState({account:'',chainId:0,provider});if(!provider?.request)return setState({account:'',chainId:0,provider:null});bind(provider);try{const [accounts,chain]=await Promise.all([provider.request({method:'eth_accounts'}),provider.request({method:'eth_chainId'})]);if(requestId!==sequence)return{...state};return setState({account:accounts?.[0]||'',chainId:Number(BigInt(chain)),provider})}catch(e){if(requestId===sequence)return setState({account:'',chainId:0,provider});return{...state}}}
const api={ready:null,refresh,getState:()=>({...state}),isExplicitlyDisconnected,markConnected};window.DeepwellWalletSession=api;
window.addEventListener?.('ethereum#initialized',()=>{if(!providerWait)api.ready=refresh()});
api.ready=refresh();
const button=document.getElementById('connect');
if(button?.dataset.walletFallback==='true')button.addEventListener('click',async()=>{try{const provider=await waitForProvider();if(!provider)throw Error('Open this page in MetaMask or another EVM wallet.');await provider.request({method:'eth_requestAccounts'});markConnected();api.ready=refresh();await api.ready}catch(e){button.title=e?.message||'Wallet connection failed.';console.warn('Wallet connection',e)}});
})();
