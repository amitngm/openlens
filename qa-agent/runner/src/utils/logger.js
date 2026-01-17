/**
 * Logger utility with secret redaction.
 */

const winston = require('winston');

// Patterns to redact
const REDACT_PATTERNS = [
  /password["']?\s*[:=]\s*["']?[^"'\s,}]+/gi,
  /token["']?\s*[:=]\s*["']?[^"'\s,}]+/gi,
  /secret["']?\s*[:=]\s*["']?[^"'\s,}]+/gi,
  /Bearer\s+[A-Za-z0-9\-_\.]+/gi,
  /Basic\s+[A-Za-z0-9\+\/=]+/gi,
  /api[_-]?key["']?\s*[:=]\s*["']?[^"'\s,}]+/gi,
];

/**
 * Redact sensitive information from a string.
 */
function redactString(str) {
  if (typeof str !== 'string') return str;
  
  let result = str;
  for (const pattern of REDACT_PATTERNS) {
    result = result.replace(pattern, '[REDACTED]');
  }
  return result;
}

/**
 * Redact sensitive information from an object.
 */
function redactObject(obj) {
  if (!obj || typeof obj !== 'object') return obj;
  
  const result = {};
  for (const [key, value] of Object.entries(obj)) {
    if (typeof value === 'string') {
      result[key] = redactString(value);
    } else if (typeof value === 'object' && value !== null) {
      result[key] = redactObject(value);
    } else {
      result[key] = value;
    }
  }
  return result;
}

/**
 * Create a custom format that redacts secrets.
 */
const redactFormat = winston.format((info) => {
  if (info.message) {
    info.message = redactString(info.message);
  }
  
  // Redact any additional properties
  for (const key of Object.keys(info)) {
    if (key !== 'level' && key !== 'message' && key !== 'timestamp') {
      if (typeof info[key] === 'string') {
        info[key] = redactString(info[key]);
      } else if (typeof info[key] === 'object') {
        info[key] = redactObject(info[key]);
      }
    }
  }
  
  return info;
});

class Logger {
  constructor(component) {
    this.component = component;
    this.logger = winston.createLogger({
      level: process.env.LOG_LEVEL || 'info',
      format: winston.format.combine(
        winston.format.timestamp(),
        redactFormat(),
        winston.format.json()
      ),
      defaultMeta: { component },
      transports: [
        new winston.transports.Console()
      ]
    });
  }

  info(message, meta = {}) {
    this.logger.info(message, meta);
  }

  warn(message, meta = {}) {
    this.logger.warn(message, meta);
  }

  error(message, meta = {}) {
    this.logger.error(message, meta);
  }

  debug(message, meta = {}) {
    this.logger.debug(message, meta);
  }
}

module.exports = { Logger, redactString, redactObject };
