import winston = require("winston");
import { Syslog } from "winston-syslog";

export enum LogLevel {
  Emerg = "emerg",
  Alert = "alert",
  Crit = "crit",
  Error = "error",
  Warning = "warning",
  Notice = "notice",
  Info = "info",
  Debug = "debug"
}

export interface ILogger {
  emerg: (message: string, meta?: any) => void;
  alert: (message: string, meta?: any) => void;
  crit: (message: string, meta?: any) => void;
  error: (message: string, meta?: any) => void;
  warning: (message: string, meta?: any) => void;
  notice: (message: string, meta?: any) => void;
  info: (message: string, meta?: any) => void;
  debug: (message: string, meta?: any) => void;
}

export interface CreateLoggerOptions {
  program: string;
  application: string;
  level: LogLevel;
}

const defaultCreateLoggerOptions: CreateLoggerOptions = {
  program: "crystalbot",
  application: "CrystalBot",
  level: LogLevel.Notice
};

export function createLogger(options: Partial<CreateLoggerOptions>): ILogger {
  options = Object.assign({}, defaultCreateLoggerOptions, options);

  const winstonLogger = winston.createLogger({
    levels: winston.config.syslog.levels,
    level: options.level,
    transports: [
      new winston.transports.Console({
        format: winston.format.combine(
          winston.format.colorize(),
          winston.format.simple()
        )
      })
    ]
  });

  return winstonLogger;
}
