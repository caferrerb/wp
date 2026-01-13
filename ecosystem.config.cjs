module.exports = {
  apps: [
    {
      name: 'whatsapp-receiver',
      script: './dist/index.js',
      cwd: '/home/ec2-user/whatsapp-app',
      instances: 1,
      autorestart: true,
      watch: false,
      max_memory_restart: '500M',
      env: {
        NODE_ENV: 'production',
        PORT: 3000,
      },
      env_file: '/home/ec2-user/whatsapp-app/.env',
      error_file: '/home/ec2-user/whatsapp-app/logs/error.log',
      out_file: '/home/ec2-user/whatsapp-app/logs/out.log',
      log_date_format: 'YYYY-MM-DD HH:mm:ss Z',
      merge_logs: true,
    },
  ],
};
