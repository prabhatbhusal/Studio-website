// Run as an unprivileged service account from /srv/rcaas/app.
module.exports = {
  apps: [
    {
      name: 'rcaas-api', cwd: '/srv/rcaas/app/server', script: 'src/index.js',
      instances: 1, exec_mode: 'fork', autorestart: true, max_memory_restart: '1G',
      env: { NODE_ENV: 'production', HOST: '127.0.0.1', PORT: '4000', DATA_DIR: '/srv/rcaas/data', ASSET_DIR: '/srv/rcaas/assets' }
    },
    {
      name: 'rcaas-web', cwd: '/srv/rcaas/app', script: 'node_modules/next/dist/bin/next',
      args: 'start -H 127.0.0.1 -p 3000', instances: 1, exec_mode: 'fork', autorestart: true,
      env: { NODE_ENV: 'production' }
    }
  ]
};
