(() => {
  'use strict';
  const E = window.ethers, C = window.DEEPWELL_FARM, $ = id => document.getElementById(id), Z = E.ZeroAddress;
  const RPC_URL = C.rpcUrl || window.DEEPWELL_ENV?.rpcUrl || 'https://bsc-testnet-dataseed.bnbchain.org';
  const routeTuple = '(address[] tokens,uint8[] venues,uint24[] feeTiers,uint256[] minHopOuts)';

  const ENGINE_ABI = [
    'function owner() view returns(address)',
    'function liquidityAdapter() view returns(address)',
    'function liquidityBalance(address) view returns(uint256)',
    'function growthBalance(address) view returns(uint256)',
    'function buybackBalance(address) view returns(uint256)',
    `function processGrowth(address,uint256,${routeTuple},uint256,uint256)`,
    `function processBuyback(address,uint256,${routeTuple},uint256,uint256)`,
    `function processLiquidity((address token,uint256 amount,${routeTuple} route,uint256 minWellOut,uint256 minTokenAmount,uint256 minWellAmount,uint256 minLiquidityOut,uint8 polVersion,uint24 v3FeeTier,uint256 deadline))`
  ];
  const MANAGER_ABI = [
    'function owner() view returns(address)',
    'function collectV3Fees(uint256,uint128,uint128) returns(uint256,uint256)',
    'function reinvestV3Fees(uint256,uint256,uint256,uint256,uint256,uint256,uint256) returns(uint128)',
    'function positionFeeBalances(address) view returns(uint256)'
  ];
  const REGISTRY_ABI = [
    'function assetKind(address) view returns(uint8)',
    'function isV2PoolAllowed(address,address) view returns(bool)',
    'function isV3PoolAllowed(address,address,uint24) view returns(bool)',
    'function v3FeeTierAllowed(uint24) view returns(bool)'
  ];
  const ERC_ABI = [
    'function decimals() view returns(uint8)',
    'function symbol() view returns(string)',
    'function balanceOf(address) view returns(uint256)',
    'function totalSupply() view returns(uint256)',
    'function MAX_SUPPLY() view returns(uint256)'
  ];
  const CHEF_ABI = [
    'function poolLength() view returns(uint256)',
    'function unclaimedWellRewards() view returns(uint256)',
    'function poolInfo(uint256) view returns(address stakeToken,uint256 allocPoint,uint256 lastRewardTimestamp,uint256 accWellPerShare,uint16 depositFeeBP,uint256 totalStaked,bool isStock,address rewardVault)',
    'function depositsPaused(uint256) view returns(bool)'
  ];
  const CUSTODY_ABI = [
    'function positionIds() view returns(uint256[])',
    'function containsPosition(uint256) view returns(bool)'
  ];
  const NPM_ABI = [
    'function ownerOf(uint256) view returns(address)',
    'function positions(uint256) view returns(uint96 nonce,address operator,address token0,address token1,uint24 fee,int24 tickLower,int24 tickUpper,uint128 liquidity,uint256 feeGrowthInside0LastX128,uint256 feeGrowthInside1LastX128,uint128 tokensOwed0,uint128 tokensOwed1)'
  ];
  const V3_POOL_ABI = [
    'function slot0() view returns(uint160 sqrtPriceX96,int24 tick,uint16,uint16,uint16,uint32,bool)',
    'function liquidity() view returns(uint128)'
  ];
  const STOCK_FACTORY_ABI = [
    'function vaultCount() view returns(uint256)',
    'function vaultAt(uint256) view returns(address)'
  ];
  const STOCK_VAULT_ABI = [
    'function rewardsToken() view returns(address)',
    'function periodFinish() view returns(uint256)',
    'function availableRewardBudget() view returns(uint256)',
    'function hasRewardFunding() view returns(bool)',
    'function totalSupply() view returns(uint256)'
  ];
  const MEME_FACTORY_ABI = [
    'function count() view returns(uint256)',
    'function listing(uint256) view returns(address pool,address project,string slug,string metadataURI)'
  ];
  const MEME_POOL_ABI = [
    'function active() view returns(bool)',
    'function depositsPaused() view returns(bool)',
    'function remainingSeconds() view returns(uint256)',
    'function unspentRewardFunding() view returns(uint256)',
    'function principalCoverage() view returns(bool)',
    'function totalStaked() view returns(uint256)'
  ];

  const MAX_UINT128 = (1n << 128n) - 1n;
  const Q96 = 1n << 96n;
  let prepared = null, working = false, actionQueue = [];
  const stringify = x => JSON.stringify(x, (_, v) => typeof v === 'bigint' ? v.toString() : v, 2);
  const rpc = new E.JsonRpcProvider(RPC_URL, 97, { staticNetwork: true });

  // Populate asset dropdown
  let tokens = Object.values(C.tokens || {}).filter(t => E.isAddress(t?.address));
  for (let t of tokens) {
    let o = document.createElement('option');
    o.value = t.address;
    o.textContent = t.symbol;
    $('asset')?.append(o);
  }
  if ($('asset') && C.tokens?.wbnb?.address) $('asset').value = C.tokens.wbnb.address;

  async function provider() {
    if (!window.ethereum) throw Error('MetaMask required');
    let p = new E.BrowserProvider(window.ethereum);
    if (Number((await p.getNetwork()).chainId) !== 97) throw Error('Select chain 97');
    return p;
  }

  // --- AUTOMATIC V2 + V3 MULTI-HOP ROUTE DISCOVERY ---
  async function estimateV3SwapOut(tokenIn, tokenOut, fee, amountIn) {
    const v3Factory = new E.Contract(C.dex.v3FactoryAddress, ['function getPool(address,address,uint24) view returns(address)'], rpc);
    const poolAddr = await v3Factory.getPool(tokenIn, tokenOut, fee);
    if (!poolAddr || poolAddr === Z || await rpc.getCode(poolAddr) === '0x') return 0n;
    const pool = new E.Contract(poolAddr, V3_POOL_ABI, rpc);
    const [slot, liq] = await Promise.all([pool.slot0(), pool.liquidity()]);
    if (liq <= 0n || slot.sqrtPriceX96 <= 0n) return 0n;
    const sqrtP = BigInt(slot.sqrtPriceX96);
    const feeAfter = amountIn * BigInt(1000000 - Number(fee)) / 1000000n;
    const zeroForOne = tokenIn.toLowerCase() < tokenOut.toLowerCase();
    // Exact constant-product within active full-range liquidity L:
    if (zeroForOne) {
      // dy = L * sqrtP / Q96 - L * Q96 / (Q96 * L / sqrtP + dx)
      const num = BigInt(liq) * feeAfter * sqrtP / Q96;
      const den = (BigInt(liq) * Q96 / sqrtP) + feeAfter;
      return den > 0n ? (num / den) : 0n;
    } else {
      const num = BigInt(liq) * feeAfter * Q96 / sqrtP;
      const den = (BigInt(liq) * sqrtP / Q96) + feeAfter;
      return den > 0n ? (num / den) : 0n;
    }
  }

  async function discoverBestRoute(tokenIn, tokenOut, amountIn, readProvider = rpc) {
    if (tokenIn.toLowerCase() === tokenOut.toLowerCase()) {
      return { route: { tokens: [], venues: [], feeTiers: [], minHopOuts: [] }, expectedOut: amountIn, minOut: amountIn, summary: 'Direct WELL7 transfer (no swap)' };
    }
    const reg = new E.Contract(C.routeConfigurationAddress, REGISTRY_ABI, readProvider);
    const v2Router = new E.Contract(C.dex.routerAddress, ['function getAmountsOut(uint256,address[]) view returns(uint256[])'], readProvider);
    const tiers = C.dex.v3FeeTiers || [100, 500, 2500, 10000];
    const candidates = [];

    // 1. Direct V2
    if (await reg.isV2PoolAllowed(tokenIn, tokenOut)) {
      try {
        const amounts = await v2Router.getAmountsOut(amountIn, [tokenIn, tokenOut]);
        if (amounts[1] > 0n) {
          const minOut = amounts[1] * 99n / 100n;
          if (minOut > 0n) {
            candidates.push({
              expectedOut: amounts[1],
              minOut,
              summary: 'Direct V2',
              route: { tokens: [tokenIn, tokenOut], venues: [0], feeTiers: [0], minHopOuts: [minOut] }
            });
          }
        }
      } catch {}
    }

    // 2. Direct V3 across allowlisted tiers
    for (const fee of tiers) {
      if (await reg.v3FeeTierAllowed(fee) && await reg.isV3PoolAllowed(tokenIn, tokenOut, fee)) {
        try {
          const out = await estimateV3SwapOut(tokenIn, tokenOut, fee, amountIn);
          const minOut = out * 98n / 100n;
          if (minOut > 0n) {
            candidates.push({
              expectedOut: out,
              minOut,
              summary: `Direct V3 (${fee} bps)`,
              route: { tokens: [tokenIn, tokenOut], venues: [1], feeTiers: [Number(fee)], minHopOuts: [minOut] }
            });
          }
        } catch {}
      }
    }

    // 3. Two-hop via WBNB (V2->V2, V3->V2, V2->V3)
    const wbnb = C.dex.wrappedNativeAddress;
    if (wbnb && tokenIn.toLowerCase() !== wbnb.toLowerCase() && tokenOut.toLowerCase() !== wbnb.toLowerCase()) {
      const hop1V2 = await reg.isV2PoolAllowed(tokenIn, wbnb);
      const hop2V2 = await reg.isV2PoolAllowed(wbnb, tokenOut);
      if (hop1V2 && hop2V2) {
        try {
          const amounts = await v2Router.getAmountsOut(amountIn, [tokenIn, wbnb, tokenOut]);
          const minOut = amounts[2] * 99n / 100n;
          if (minOut > 0n && amounts[1] > 0n) {
            candidates.push({
              expectedOut: amounts[2],
              minOut,
              summary: '2-Hop V2 via WBNB',
              route: { tokens: [tokenIn, wbnb, tokenOut], venues: [0, 0], feeTiers: [0, 0], minHopOuts: [1n, minOut] }
            });
          }
        } catch {}
      }
    }

    candidates.sort((a, b) => (b.expectedOut > a.expectedOut ? 1 : b.expectedOut < a.expectedOut ? -1 : 0));
    if (!candidates.length) throw Error('No allowlisted route with sufficient liquidity found for this asset.');
    return candidates[0];
  }

  async function computePolMinima(tokenAddr, amount, swapInput, expectedWellOut, polVersion, v3FeeTier, readProvider = rpc) {
    const other = amount - swapInput;
    if (polVersion === 0) {
      const factory = new E.Contract(C.dex.factoryAddress, ['function getPair(address,address) view returns(address)'], readProvider);
      const pairAddr = await factory.getPair(tokenAddr, C.tokenAddress);
      const pair = new E.Contract(pairAddr, ['function token0() view returns(address)', 'function getReserves() view returns(uint112,uint112,uint32)', 'function totalSupply() view returns(uint256)'], readProvider);
      const [res, token0, supply] = await Promise.all([pair.getReserves(), pair.token0(), pair.totalSupply()]);
      const normal = token0.toLowerCase() === tokenAddr.toLowerCase();
      const a = (normal ? res[0] : res[1]) + swapInput;
      const b = (normal ? res[1] : res[0]) - expectedWellOut;
      let used = expectedWellOut * a / b, usedWell = expectedWellOut;
      if (used > other) {
        used = other;
        usedWell = other * b / a;
      }
      const minToken = used * 98n / 100n;
      const minWell = usedWell * 98n / 100n;
      const lpA = used * supply / a, lpB = usedWell * supply / b;
      const minLp = (lpA < lpB ? lpA : lpB) * 98n / 100n;
      return { minToken: minToken > 0n ? minToken : 1n, minWell: minWell > 0n ? minWell : 1n, minLp: minLp > 0n ? minLp : 1n };
    } else {
      return { minToken: 1n, minWell: 1n, minLp: 1n };
    }
  }

  // --- SINGLE BUCKET ASSISTED QUOTE ---
  async function quote() {
    if (working) return;
    working = true;
    prepared = null;
    $('send').disabled = true;
    try {
      let p = await provider(), s = await p.getSigner(), engine = new E.Contract(C.feeEngineAddress, ENGINE_ABI, s);
      let t = $('asset').value, d = $('destination').value;
      let erc = new E.Contract(t, ERC_ABI, p), dec = Number(await erc.decimals());
      let bucket = await engine[d + 'Balance'](t);
      if (bucket <= 0n) throw Error('Selected bucket is currently empty (0 balance)');
      let rawInput = $('amount').value.trim();
      let amount = rawInput ? E.parseUnits(rawInput, dec) : bucket;
      if (amount <= 0n || amount > bucket) amount = bucket;
      let block = await p.getBlock('latest'), deadline = block.timestamp + 600;
      let r = { tokens: [], venues: [], feeTiers: [], minHopOuts: [] }, min = 0n, out = amount, minToken = 0n, minWell = 0n, minLp = 0n, routeSummary = 'Direct WELL7';

      if (t.toLowerCase() !== C.tokenAddress.toLowerCase()) {
        let input = d === 'liquidity' ? amount / 2n : amount;
        const best = await discoverBestRoute(t, C.tokenAddress, input, p);
        r = best.route;
        out = best.expectedOut;
        min = best.minOut;
        routeSummary = best.summary;
        if (d === 'liquidity') {
          const polVersion = Number($('autoPolVersion')?.value || 0);
          const minima = await computePolMinima(t, amount, input, out, polVersion, 2500, p);
          minToken = minima.minToken;
          minWell = minima.minWell;
          minLp = minima.minLp;
        }
      }

      let polVersion = Number($('autoPolVersion')?.value || 0);
      let method = d === 'growth' ? 'processGrowth' : d === 'buyback' ? 'processBuyback' : 'processLiquidity';
      let args = d === 'liquidity'
        ? [{ token: t, amount, route: r, minWellOut: min, minTokenAmount: minToken, minWellAmount: minWell, minLiquidityOut: minLp, polVersion, v3FeeTier: 2500, deadline }]
        : [t, amount, r, min, deadline];

      await engine[method].staticCall(...args);
      prepared = { engine, method, args, from: await s.getAddress(), time: Date.now() };
      $('result').textContent = stringify({
        status: 'Simulation passed; quote valid for review for 60 seconds',
        routeUsed: routeSummary,
        bucket: E.formatUnits(bucket, dec),
        amount: E.formatUnits(amount, dec),
        expectedWell: E.formatEther(out),
        method,
        parameters: args
      });
      $('send').disabled = false;
    } catch (e) {
      $('result').textContent = e.shortMessage || e.message;
    } finally {
      working = false;
    }
  }

  $('quote').onclick = quote;
  for (let id of ['asset', 'destination', 'amount']) {
    if ($(id)) $(id).oninput = () => { prepared = null; $('send').disabled = true; };
  }
  $('send').onclick = async () => {
    let q = prepared;
    if (!q || Date.now() - q.time > 60000) {
      $('result').textContent = 'Refresh the quote before signing';
      return;
    }
    working = true;
    $('send').disabled = true;
    try {
      let p = await provider();
      if (await (await p.getSigner()).getAddress() !== q.from) throw Error('Wallet changed');
      let tx = await q.engine[q.method](...q.args);
      $('result').textContent = 'Submitted ' + tx.hash;
      await tx.wait();
      await AdminGuard.reconcile(p);
      $('result').textContent = 'Confirmed ' + tx.hash;
      render();
    } catch (e) {
      $('result').textContent = e.shortMessage || e.message;
    } finally {
      prepared = null;
      working = false;
    }
  };
  setInterval(() => { if ($('monitor')?.checked && !working) quote(); }, 60000);

  // --- AUTOMATED THRESHOLD QUEUE (BUCKETS, V3 COLLECT, V3 REINVEST) ---
  async function scanAndBuildQueue() {
    if (working) return;
    working = true;
    actionQueue = [];
    $('runNextQueue').disabled = true;
    $('runAllQueue').disabled = true;
    $('queueOutput').textContent = 'Scanning fee buckets, V3 custody positions, and POL fee balances…';

    try {
      const engineRead = new E.Contract(C.feeEngineAddress, ENGINE_ABI, rpc);
      const managerRead = new E.Contract(C.polLiquidityManagerAddress, MANAGER_ABI, rpc);
      const custodyRead = new E.Contract(C.v3CustodyVaultAddress, CUSTODY_ABI, rpc);
      const npmRead = new E.Contract(C.dex.v3PositionManagerAddress, NPM_ABI, rpc);

      const threshMajor = E.parseUnits($('threshMajor')?.value.trim() || '0.001', 18);
      const threshStandard = E.parseUnits($('threshStandard')?.value.trim() || '1', 18);
      const threshV3Collect = E.parseUnits($('threshV3Collect')?.value.trim() || '0.0005', 18);
      const polVersion = Number($('autoPolVersion')?.value || 0);
      const skipped = [];

      // 1. Scan Fee Buckets across all configured tokens
      const majors = new Set(['WBNB', 'BTCB', 'ETH', 'CBBTC']);
      for (const t of tokens) {
        const [liqBal, growthBal, buybackBal] = await Promise.all([
          engineRead.liquidityBalance(t.address),
          engineRead.growthBalance(t.address),
          engineRead.buybackBalance(t.address)
        ]);
        const minThresh = majors.has(String(t.symbol).toUpperCase()) ? threshMajor : threshStandard;
        for (const [dest, bal] of [['liquidity', liqBal], ['growth', growthBal], ['buyback', buybackBal]]) {
          if (bal >= minThresh) {
            if (dest === 'liquidity' && t.address.toLowerCase() !== C.tokenAddress.toLowerCase() && bal < 2n) continue;
            try {
              const swapIn = dest === 'liquidity' ? bal / 2n : bal;
              const best = await discoverBestRoute(t.address, C.tokenAddress, swapIn, rpc);
              actionQueue.push({
                kind: 'bucket',
                label: `Process ${dest.toUpperCase()} bucket: ${E.formatUnits(bal, t.decimals || 18)} ${t.symbol} (${best.summary})`,
                token: t.address,
                symbol: t.symbol,
                destination: dest,
                amount: bal,
                polVersion,
                v3FeeTier: 2500
              });
            } catch (err) {
              skipped.push(`${t.symbol} ${dest} (${E.formatUnits(bal, t.decimals || 18)}): ${err.message}`);
            }
          }
        }
      }

      // 2. Scan V3 Custody Positions for Fee Collection & Reinvestment
      const posIds = await custodyRead.positionIds();
      for (const rawId of posIds) {
        const tokenId = BigInt(rawId);
        const pos = await npmRead.positions(tokenId);
        // Simulate collectV3Fees via staticCall to get exact collectable amount0/amount1
        try {
          const [sim0, sim1] = await managerRead.collectV3Fees.staticCall(tokenId, MAX_UINT128, MAX_UINT128, {
            from: await engineRead.owner()
          });
          if (sim0 >= threshV3Collect || sim1 >= threshV3Collect) {
            actionQueue.push({
              kind: 'v3Collect',
              label: `Collect V3 Fees on NFT #${tokenId}: ${E.formatEther(sim0)} token0 + ${E.formatEther(sim1)} token1`,
              tokenId
            });
          }
        } catch {}

        // Check if POLLiquidityManager already holds collected fees for both token0 and token1 to reinvest
        const [bal0, bal1] = await Promise.all([
          managerRead.positionFeeBalances(pos.token0),
          managerRead.positionFeeBalances(pos.token1)
        ]);
        if (bal0 > 0n && bal1 > 0n) {
          actionQueue.push({
            kind: 'v3Reinvest',
            label: `Reinvest V3 Fees on NFT #${tokenId}: ${E.formatEther(bal0)} token0 + ${E.formatEther(bal1)} token1`,
            tokenId,
            amount0: bal0,
            amount1: bal1
          });
        }
      }

      $('queueOutput').textContent = stringify({
        scannedAt: new Date().toISOString(),
        readyTasksCount: actionQueue.length,
        readyTasks: actionQueue.map((item, idx) => ({ step: idx + 1, action: item.label })),
        skippedBelowOrUnroutable: skipped
      });
      $('runNextQueue').disabled = actionQueue.length === 0;
      $('runAllQueue').disabled = actionQueue.length === 0;
    } catch (e) {
      $('queueOutput').textContent = 'Queue scan error: ' + (e.shortMessage || e.message);
    } finally {
      working = false;
    }
  }

  async function executeTask(item, p, s) {
    const engine = new E.Contract(C.feeEngineAddress, ENGINE_ABI, s);
    const manager = new E.Contract(C.polLiquidityManagerAddress, MANAGER_ABI, s);
    const block = await p.getBlock('latest');
    const deadline = BigInt(block.timestamp + 600);

    if (item.kind === 'bucket') {
      const bal = await engine[item.destination + 'Balance'](item.token);
      if (bal <= 0n) throw Error(`Bucket for ${item.symbol} is now empty.`);
      const amount = bal;
      let r = { tokens: [], venues: [], feeTiers: [], minHopOuts: [] }, minWellOut = 0n, minToken = 0n, minWell = 0n, minLp = 0n;
      if (item.token.toLowerCase() !== C.tokenAddress.toLowerCase()) {
        const swapIn = item.destination === 'liquidity' ? amount / 2n : amount;
        const best = await discoverBestRoute(item.token, C.tokenAddress, swapIn, p);
        r = best.route;
        minWellOut = best.minOut;
        if (item.destination === 'liquidity') {
          const minima = await computePolMinima(item.token, amount, swapIn, best.expectedOut, item.polVersion, item.v3FeeTier, p);
          minToken = minima.minToken;
          minWell = minima.minWell;
          minLp = minima.minLp;
        }
      }
      const method = item.destination === 'growth' ? 'processGrowth' : item.destination === 'buyback' ? 'processBuyback' : 'processLiquidity';
      const args = item.destination === 'liquidity'
        ? [{ token: item.token, amount, route: r, minWellOut, minTokenAmount: minToken, minWellAmount: minWell, minLiquidityOut: minLp, polVersion: item.polVersion, v3FeeTier: item.v3FeeTier, deadline }]
        : [item.token, amount, r, minWellOut, deadline];

      await engine[method].staticCall(...args);
      const tx = await engine[method](...args);
      await tx.wait();
      await AdminGuard.reconcile(p);
      return tx.hash;
    }

    if (item.kind === 'v3Collect') {
      await manager.collectV3Fees.staticCall(item.tokenId, MAX_UINT128, MAX_UINT128);
      const tx = await manager.collectV3Fees(item.tokenId, MAX_UINT128, MAX_UINT128);
      await tx.wait();
      await AdminGuard.reconcile(p);
      return tx.hash;
    }

    if (item.kind === 'v3Reinvest') {
      await manager.reinvestV3Fees.staticCall(item.tokenId, item.amount0, item.amount1, 0n, 0n, 1n, deadline);
      const tx = await manager.reinvestV3Fees(item.tokenId, item.amount0, item.amount1, 0n, 0n, 1n, deadline);
      await tx.wait();
      await AdminGuard.reconcile(p);
      return tx.hash;
    }
  }

  async function runQueue(all = false) {
    if (working || !actionQueue.length) return;
    working = true;
    $('runNextQueue').disabled = true;
    $('runAllQueue').disabled = true;
    const prevSkip = window.AdminGuard.skipConfirm;
    window.AdminGuard.skipConfirm = true; // Pre-verified via staticCall
    try {
      const p = await provider(), s = await p.getSigner();
      const results = [];
      while (actionQueue.length > 0) {
        const task = actionQueue.shift();
        $('queueOutput').textContent = `Executing: ${task.label}…`;
        const hash = await executeTask(task, p, s);
        results.push({ task: task.label, txHash: hash });
        render();
        if (!all) break;
      }
      $('queueOutput').textContent = stringify({ completed: results, remainingInQueue: actionQueue.length });
    } catch (e) {
      $('queueOutput').textContent = 'Queue execution stopped: ' + (e.shortMessage || e.message);
      await sendAlert('Admin Queue Execution Failed', e.shortMessage || e.message);
    } finally {
      window.AdminGuard.skipConfirm = prevSkip;
      working = false;
      $('runNextQueue').disabled = actionQueue.length === 0;
      $('runAllQueue').disabled = actionQueue.length === 0;
    }
  }

  $('scanQueue')?.addEventListener('click', scanAndBuildQueue);
  $('runNextQueue')?.addEventListener('click', () => runQueue(false));
  $('runAllQueue')?.addEventListener('click', () => runQueue(true));

  // --- CONTINUOUS HEALTH, CUSTODY & FUNDING MONITOR ---
  async function sendAlert(title, detail) {
    const url = $('alertWebhookUrl')?.value.trim();
    if (!url) return;
    try {
      await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ content: `🚨 **[DEEPWELL ALERT] ${title}**\n${detail}`, text: `🚨 [DEEPWELL ALERT] ${title}: ${detail}` })
      });
    } catch {}
  }

  async function runHealthReconciliation() {
    try {
      const well = new E.Contract(C.tokenAddress, ERC_ABI, rpc);
      const chef = new E.Contract(C.masterFactoryAddress, CHEF_ABI, rpc);
      const custody = new E.Contract(C.v3CustodyVaultAddress, CUSTODY_ABI, rpc);
      const npm = new E.Contract(C.dex.v3PositionManagerAddress, NPM_ABI, rpc);
      const stockFactory = new E.Contract(C.stockVaultFactoryAddress, STOCK_FACTORY_ABI, rpc);
      const memeFactory = new E.Contract(C.memeFactoryAddress, MEME_FACTORY_ABI, rpc);

      const [
        wellSupply,
        wellCap,
        chefWellBal,
        unclaimedWell,
        pool0,
        growthWellBal,
        posIds,
        stockVaultCount,
        memePoolCount,
        latestBlock
      ] = await Promise.all([
        well.totalSupply(),
        well.MAX_SUPPLY(),
        well.balanceOf(C.masterFactoryAddress),
        chef.unclaimedWellRewards(),
        chef.poolInfo(0),
        well.balanceOf(C.growthRewardsAddress),
        custody.positionIds(),
        stockFactory.vaultCount(),
        memeFactory.count(),
        rpc.getBlock('latest')
      ]);

      const alerts = [];
      const now = Number(latestBlock.timestamp);

      // 1. MasterFactory Principal + Unclaimed Reward Solvency
      const requiredChefWell = pool0.totalStaked + unclaimedWell;
      const chefSolvent = chefWellBal >= requiredChefWell;
      if (!chefSolvent) {
        alerts.push(`CRITICAL: MasterFactory WELL7 balance (${E.formatEther(chefWellBal)}) is below pool0 principal + unclaimed rewards (${E.formatEther(requiredChefWell)})!`);
      }

      // 2. WELL7 Supply Cap & GrowthRewards Reserve
      const remainingMintable = wellCap > wellSupply ? wellCap - wellSupply : 0n;
      if (remainingMintable < E.parseEther('5000')) {
        alerts.push(`WARN: WELL7 remaining mintable supply is low (${E.formatEther(remainingMintable)} WELL7).`);
      }
      if (growthWellBal < E.parseEther('500')) {
        alerts.push(`WARN: GrowthRewards WELL7 reserve is low (${E.formatEther(growthWellBal)} WELL7).`);
      }

      // 3. V3 NFT Custody Verification
      const custodyChecks = [];
      for (const id of posIds) {
        const [nftOwner, registered] = await Promise.all([npm.ownerOf(id), custody.containsPosition(id)]);
        const ok = nftOwner.toLowerCase() === C.v3CustodyVaultAddress.toLowerCase() && registered;
        custodyChecks.push({ tokenId: String(id), ownerOk: ok });
        if (!ok) alerts.push(`CRITICAL: V3 Position NFT #${id} custody mismatch (owner=${nftOwner})!`);
      }

      // 4. Stock Vault Funding & Completion Check
      const stockChecks = [];
      for (let i = 0; i < Number(stockVaultCount); i++) {
        const vAddr = await stockFactory.vaultAt(i);
        const v = new E.Contract(vAddr, STOCK_VAULT_ABI, rpc);
        const [periodFinish, budget, funded, staked] = await Promise.all([
          v.periodFinish(), v.availableRewardBudget(), v.hasRewardFunding(), v.totalSupply()
        ]);
        const expired = funded && Number(periodFinish) > 0 && Number(periodFinish) <= now;
        stockChecks.push({ vault: vAddr, funded, expired, periodFinish: Number(periodFinish), budget: E.formatEther(budget), staked: E.formatEther(staked) });
        if (expired && staked > 0n) {
          alerts.push(`NOTICE: StockRewardVault ${vAddr.slice(0, 10)}… reward cycle completed with active stakers; ready for renewal.`);
        }
      }

      // 5. Meme Pool Principal Coverage & Expiry
      const memeChecks = [];
      for (let i = 0; i < Number(memePoolCount); i++) {
        const l = await memeFactory.listing(i);
        const mp = new E.Contract(l.pool, MEME_POOL_ABI, rpc);
        const [active, remaining, covered, unspent] = await Promise.all([
          mp.active(), mp.remainingSeconds(), mp.principalCoverage(), mp.unspentRewardFunding()
        ]);
        memeChecks.push({ slug: l.slug, pool: l.pool, active, remainingSeconds: Number(remaining), principalCovered: covered, unspentRewards: E.formatEther(unspent) });
        if (!covered) alerts.push(`CRITICAL: MemeRewardPool ${l.slug} (${l.pool}) principal coverage failed!`);
      }

      // 6. Pending/Stuck Admin Tx Check
      const pendingTx = JSON.parse(localStorage.getItem(AdminGuard.key) || 'null');
      if (pendingTx) {
        alerts.push(`WARN: Unreconciled admin transaction in local journal (nonce ${pendingTx.nonce}, hash ${pendingTx.hash || 'missing'}).`);
      }

      const summary = {
        checkedAt: new Date().toISOString(),
        status: alerts.length === 0 ? 'HEALTHY — All balances, custody, and reward reserves verified' : `${alerts.length} ALERT(S) DETECTED`,
        alerts,
        masterFactorySolvency: {
          solvent: chefSolvent,
          wellBalance: E.formatEther(chefWellBal),
          pool0Principal: E.formatEther(pool0.totalStaked),
          unclaimedRewards: E.formatEther(unclaimedWell)
        },
        reserves: {
          growthRewardsWell: E.formatEther(growthWellBal),
          remainingMintableWell: E.formatEther(remainingMintable)
        },
        v3CustodyPositions: custodyChecks,
        stockVaults: stockChecks,
        memePools: memeChecks
      };

      if ($('healthReport')) $('healthReport').textContent = stringify(summary);
      if (alerts.length > 0) await sendAlert('Reconciliation Alert', alerts.join('\n'));
    } catch (e) {
      if ($('healthReport')) $('healthReport').textContent = 'Health check failed: ' + (e.shortMessage || e.message);
    }
  }

  $('runHealthCheck')?.addEventListener('click', runHealthReconciliation);
  runHealthReconciliation();
  setInterval(() => { if ($('autoHealthMonitor')?.checked) runHealthReconciliation(); }, 60000);

  // --- JOURNAL & RECOVERY ---
  function render() {
    $('journal').textContent = stringify({
      pending: JSON.parse(localStorage.getItem(AdminGuard.key) || 'null'),
      history: JSON.parse(localStorage.getItem('deepwell-admin97-history') || '[]')
    });
  }
  render();
  $('refresh').onclick = async () => {
    try { await AdminGuard.reconcile(await provider()); render(); } catch (e) { $('journal').textContent = e.message; }
  };
  $('export').onclick = () => {
    let a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([$ ('journal').textContent], { type: 'application/json' }));
    a.download = 'deepwell-admin-journal.json';
    a.click();
    URL.revokeObjectURL(a.href);
  };
  $('recover').onclick = async () => {
    try {
      let row = JSON.parse(localStorage.getItem(AdminGuard.key) || 'null');
      if (!row || row.hash) throw Error('No interrupted request without hash');
      let p = await provider(), tx = await p.getTransaction($('recoverHash').value.trim());
      if (!tx || tx.from.toLowerCase() !== row.from.toLowerCase() || tx.to?.toLowerCase() !== row.to.toLowerCase() || tx.data.toLowerCase() !== row.data.toLowerCase() || tx.value !== BigInt(row.value) || BigInt(tx.nonce) !== BigInt(row.nonce)) {
        throw Error('Transaction does not match stored request');
      }
      row.hash = tx.hash;
      localStorage.setItem(AdminGuard.key, stringify(row));
      await AdminGuard.reconcile(p);
      render();
    } catch (e) {
      $('journal').textContent = e.message;
    }
  };
})();