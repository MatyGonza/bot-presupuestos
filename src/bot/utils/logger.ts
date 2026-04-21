export const log = {
  info: (tag: string, msg: string, data?: any) =>
    console.log(`[${new Date().toISOString()}] [INFO] [${tag}] ${msg}`, data ?? ""),
  warn: (tag: string, msg: string, data?: any) =>
    console.warn(`[${new Date().toISOString()}] [WARN] [${tag}] ${msg}`, data ?? ""),
  error: (tag: string, msg: string, err?: any) =>
    console.error(`[${new Date().toISOString()}] [ERROR] [${tag}] ${msg}`, err ?? ""),
};
