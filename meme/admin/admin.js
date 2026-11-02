(()=>{'use strict';
const E=window.ethers,C=window.DEEPWELL_MEME,el=id=>document.getElementById(id);
let signer,factory;
const FACTORY_VERSION=6n;
const ABI=['function FACTORY_VERSION() view returns(uint256)','function feePolicy() view returns(address)','function owner() view returns(address)','function createPool(address,address,address,uint256,string,string) returns(address)','function activate(uint256)','function pauseDeposits(uint256,bool)','function listing(uint256) view returns(address,address,string,string)'];
function status(s){el('status').textContent=s;}
function clearWallet(){signer=null;factory=null;el('connect').textContent='Connect Wallet';}
async function attachWallet(address){
 const p=new E.BrowserProvider(window.ethereum);
 if(Number((await p.getNetwork()).chainId)!==97)throw Error('Switch wallet to BSC Testnet, chain 97');
 signer=await p.getSigner(address);el('connect').textContent=(await signer.getAddress()).slice(0,9)+'…';
 if(E.isAddress(C.factoryAddress)&&C.factoryAddress!==E.ZeroAddress){
  factory=new E.Contract(C.factoryAddress,ABI,signer);const version=await factory.FACTORY_VERSION();
  if(version!==FACTORY_VERSION)throw Error(`Incompatible meme factory version: expected WELL7 V${FACTORY_VERSION}`);
  const owner=await factory.owner();status('Factory '+C.factoryAddress+' · owner '+owner);
  if(owner.toLowerCase()!==(await signer.getAddress()).toLowerCase())status('READ ONLY: connected wallet is not factory owner.');
 }else{factory=null;status('No factory configured. Run the WELL7 launcher first.');}
}
async function restoreWallet(){
 if(!window.ethereum?.request)return false;
 if(window.DeepwellWalletSession?.isExplicitlyDisconnected?.()){clearWallet();return false;}
 try{
  const [accounts,chain]=await Promise.all([window.ethereum.request({method:'eth_accounts'}),window.ethereum.request({method:'eth_chainId'})]);
  if(!accounts?.length||Number(BigInt(chain))!==97){clearWallet();return false;}
  await attachWallet(accounts[0]);return true;
 }catch(e){clearWallet();console.warn('Silent wallet restore',e);return false;}
}
async function connect(){
 if(!window.ethereum)throw Error('EVM wallet not found');
 await window.ethereum.request({method:'eth_requestAccounts'});
 window.DeepwellWalletSession?.markConnected?.();
 const [accounts,chain]=await Promise.all([window.ethereum.request({method:'eth_accounts'}),window.ethereum.request({method:'eth_chainId'})]);
 if(!accounts?.length)throw Error('No wallet account was returned.');
 if(Number(BigInt(chain))!==97)throw Error('Switch wallet to BSC Testnet, chain 97');
 await attachWallet(accounts[0]);
}
el('connect').onclick=()=>connect().catch(e=>status(e.shortMessage||e.message));
el('create').onsubmit=async e=>{e.preventDefault();try{if(!factory)throw Error('Connect owner wallet and configure factory first');const o=Object.fromEntries(new FormData(e.target));for(const k of ['stake','reward','project'])if(!E.isAddress(o[k]))throw Error('Invalid '+k+' address');status('Waiting for pool creation…');await(await factory.createPool(o.stake,o.reward,o.project,Number(o.duration)*86400,o.slug,o.uri)).wait();status('Pool created. Project must fund rewards before activation.')}catch(err){status(err.shortMessage||err.message)}};
async function action(mode){try{if(!factory)throw Error('Connect owner wallet first');const id=BigInt(el('id').value);status('Confirm transaction…');const t=mode==='activate'?factory.activate(id):factory.pauseDeposits(id,mode==='pause');await(await t).wait();status('Confirmed: '+mode+' pool #'+id);}catch(e){status(e.shortMessage||e.message)}}
el('activate').onclick=()=>action('activate');el('pause').onclick=()=>action('pause');el('resume').onclick=()=>action('resume');
if(window.ethereum){window.ethereum.on?.('accountsChanged',async()=>{clearWallet();if(await restoreWallet())return;status('Connect your testnet admin wallet to begin.')});window.ethereum.on?.('chainChanged',()=>location.reload());}
Promise.resolve(window.DeepwellWalletSession?.ready).then(restoreWallet).then(connected=>{if(!connected)status('Connect your testnet admin wallet to begin.')}).catch(e=>console.warn('Silent wallet restore',e));
})();
