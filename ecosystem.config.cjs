module.exports = {
  apps: [{
    name: "discord-quest-auto",
    script: ".next/standalone/server.js",
    cwd: "/home/z/my-project",
    instances: 1,
    exec_mode: "fork",
    autorestart: true,
    max_restarts: 20,
    restart_delay: 1000,
    exp_backoff_restart_delay: 200,
    max_memory_restart: "1G",
    env: {
      NODE_ENV: "production",
      PORT: 3000,
      HOSTNAME: "0.0.0.0",
      DATABASE_URL: "file:/home/z/my-project/db/custom.db",
    },
    out_file: "/home/z/my-project/server.log",
    error_file: "/home/z/my-project/server.log",
    merge_logs: true,
    time: true,
  }],
};
