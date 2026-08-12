#!/usr/bin/env node
/**
 * Bundle Inco + viem with esbuild (Webpack 4 cannot parse those packages).
 */
const fs = require('fs');
const path = require('path');
const esbuild = require('esbuild');

const root = path.resolve(__dirname, '..');
const outfile = path.join(root, 'static', 'inco.bundle.js');

let deploy = {};
try {
  deploy = JSON.parse(
    fs.readFileSync(path.join(root, '.inco-deploy.json'), 'utf8'),
  );
} catch (_) {
  deploy = {};
}

const address =
  process.env.INCO_ROLES_ADDRESS || deploy.contractAddress || '';
const marketFactory =
  process.env.INCO_MARKET_FACTORY || deploy.marketFactoryAddress || '';
const network = process.env.INCO_NETWORK || deploy.network || 'baseSepolia';
const enabled =
  process.env.INCO_ENABLED ||
  (deploy.enabled || address ? 'true' : '');
const impostorCount = String(
  process.env.INCO_IMPOSTOR_COUNT || deploy.impostorCount || 1,
);

const watch = process.argv.includes('--watch');
const buildId = String(Date.now());

const buildOptions = {
  banner: {
    js: `window.__INCO_BUILD__ = ${JSON.stringify(buildId)};`,
  },
  entryPoints: [path.join(root, 'src/inco/browser-entry.js')],
  bundle: true,
  format: 'iife',
  globalName: 'AmongUsInco',
  outfile,
  platform: 'browser',
  target: ['es2020'],
  sourcemap: !process.env.VERCEL,
  logLevel: 'info',
  // viem/noble touch Node's Buffer at module init — inject browser polyfill
  inject: [path.join(root, 'scripts/esbuild-shims.js')],
  define: {
    global: 'globalThis',
    'process.env.INCO_ROLES_ADDRESS': JSON.stringify(address),
    'process.env.INCO_MARKET_FACTORY': JSON.stringify(marketFactory),
    'process.env.INCO_NETWORK': JSON.stringify(network),
    'process.env.INCO_ENABLED': JSON.stringify(enabled),
    'process.env.INCO_IMPOSTOR_COUNT': JSON.stringify(impostorCount),
    'process.env.NODE_ENV': JSON.stringify(
      process.env.NODE_ENV || 'development',
    ),
  },
};

async function main() {
  fs.mkdirSync(path.dirname(outfile), { recursive: true });
  if (watch) {
    const ctx = await esbuild.context(buildOptions);
    await ctx.watch();
    console.log('[inco] watching src/inco → static/inco.bundle.js');
  } else {
    await esbuild.build(buildOptions);
    console.log(`[inco] wrote ${outfile}`);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
