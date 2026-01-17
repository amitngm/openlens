/**
 * API Step Executor
 * 
 * Executes API calls with support for authentication, retries, and assertions.
 */

const axios = require('axios');
const { Logger } = require('../utils/logger');

class APIExecutor {
  constructor(variables, config) {
    this.variables = variables;
    this.config = config;
    this.logger = new Logger('api-executor');
    
    // Create axios instance with defaults
    this.client = axios.create({
      timeout: 30000,
      validateStatus: () => true // Don't throw on any status
    });
  }

  async execute(step) {
    const url = this.interpolate(step.url);
    const method = step.method || 'GET';
    
    this.logger.info('Executing API call', { 
      method, 
      url: this.redactUrl(url) 
    });

    // Build request config
    const requestConfig = {
      method,
      url,
      timeout: step.timeout_ms || 30000,
      headers: this.buildHeaders(step),
    };

    // Add body for POST/PUT/PATCH
    if (['POST', 'PUT', 'PATCH'].includes(method) && step.body) {
      requestConfig.data = this.interpolateObject(step.body);
    }

    // Add query params
    if (step.query_params) {
      requestConfig.params = this.interpolateObject(step.query_params);
    }

    // Execute with retries
    let response;
    let lastError;
    const retries = step.retries || 0;

    for (let attempt = 0; attempt <= retries; attempt++) {
      try {
        if (attempt > 0) {
          this.logger.info('Retrying API call', { attempt, retries });
          await this.sleep(step.retry_delay_ms || 1000);
        }

        response = await this.client.request(requestConfig);
        
        // Check expected status
        if (step.expected_status && response.status !== step.expected_status) {
          throw new Error(
            `Expected status ${step.expected_status}, got ${response.status}`
          );
        }
        
        break; // Success, exit retry loop
        
      } catch (error) {
        lastError = error;
        this.logger.warn('API call failed', { 
          attempt, 
          error: error.message 
        });
      }
    }

    if (!response) {
      throw lastError || new Error('API call failed after retries');
    }

    // Build result
    const result = {
      status: response.status,
      statusText: response.statusText,
      headers: this.redactHeaders(response.headers),
      body: response.data,
      duration_ms: null // Could add timing
    };

    // Log response if enabled
    if (step.log_response !== false) {
      this.logger.info('API response', {
        status: result.status,
        body: this.redactBody(result.body)
      });
    }

    // Extract values to variables
    if (step.extract) {
      for (const [varName, jsonPath] of Object.entries(step.extract)) {
        const value = this.extractValue(result.body, jsonPath);
        this.variables[varName] = value;
        this.logger.info('Extracted variable', { 
          varName, 
          value: this.redactValue(varName, value) 
        });
      }
    }

    return result;
  }

  buildHeaders(step) {
    const headers = {
      'Content-Type': 'application/json',
      'Accept': 'application/json',
      ...this.interpolateObject(step.headers || {})
    };

    // Add Bearer token if specified
    if (step.bearer_token) {
      const token = this.interpolate(step.bearer_token);
      headers['Authorization'] = `Bearer ${token}`;
    } else if (this.config.API_TOKEN) {
      headers['Authorization'] = `Bearer ${this.config.API_TOKEN}`;
    }

    return headers;
  }

  /**
   * Extract value from object using JSONPath-like syntax.
   */
  extractValue(obj, path) {
    if (!path || !obj) return null;

    // Remove leading $. if present
    const cleanPath = path.startsWith('$.') ? path.substring(2) : path;
    const parts = cleanPath.split('.');
    
    let value = obj;
    for (const part of parts) {
      // Handle array index
      const match = part.match(/^(\w+)\[(\d+)\]$/);
      if (match) {
        value = value?.[match[1]]?.[parseInt(match[2])];
      } else {
        value = value?.[part];
      }
    }
    
    return value;
  }

  /**
   * Interpolate variables in a string.
   */
  interpolate(str) {
    if (!str) return str;
    if (typeof str !== 'string') return str;
    
    let result = str;
    
    // Replace ${variable} patterns
    result = result.replace(/\$\{(\w+)\}/g, (match, varName) => {
      return this.variables[varName] ?? this.config[varName] ?? match;
    });
    
    // Replace $ENV_VAR patterns
    result = result.replace(/\$([A-Z_]+)/g, (match, varName) => {
      return this.config[varName] ?? process.env[varName] ?? match;
    });
    
    return result;
  }

  /**
   * Interpolate variables in an object (deep).
   */
  interpolateObject(obj) {
    if (!obj) return obj;
    
    if (typeof obj === 'string') {
      return this.interpolate(obj);
    }
    
    if (Array.isArray(obj)) {
      return obj.map(item => this.interpolateObject(item));
    }
    
    if (typeof obj === 'object') {
      const result = {};
      for (const [key, value] of Object.entries(obj)) {
        result[key] = this.interpolateObject(value);
      }
      return result;
    }
    
    return obj;
  }

  /**
   * Redact sensitive headers.
   */
  redactHeaders(headers) {
    const sensitiveHeaders = ['authorization', 'x-api-key', 'cookie'];
    const redacted = { ...headers };
    
    for (const header of sensitiveHeaders) {
      if (redacted[header]) {
        redacted[header] = '[REDACTED]';
      }
    }
    
    return redacted;
  }

  /**
   * Redact sensitive data from response body.
   */
  redactBody(body) {
    if (!body || typeof body !== 'object') return body;
    
    const sensitiveKeys = ['password', 'token', 'secret', 'key', 'credential'];
    const redacted = JSON.parse(JSON.stringify(body));
    
    const redactRecursive = (obj) => {
      for (const key of Object.keys(obj)) {
        const lowerKey = key.toLowerCase();
        if (sensitiveKeys.some(sk => lowerKey.includes(sk))) {
          obj[key] = '[REDACTED]';
        } else if (typeof obj[key] === 'object' && obj[key] !== null) {
          redactRecursive(obj[key]);
        }
      }
    };
    
    redactRecursive(redacted);
    return redacted;
  }

  /**
   * Redact URL credentials.
   */
  redactUrl(url) {
    try {
      const parsed = new URL(url);
      if (parsed.password) {
        parsed.password = '[REDACTED]';
      }
      // Redact token query params
      ['token', 'key', 'apikey', 'api_key'].forEach(param => {
        if (parsed.searchParams.has(param)) {
          parsed.searchParams.set(param, '[REDACTED]');
        }
      });
      return parsed.toString();
    } catch {
      return url;
    }
  }

  /**
   * Redact value based on variable name.
   */
  redactValue(varName, value) {
    const sensitiveNames = ['token', 'password', 'secret', 'key'];
    if (sensitiveNames.some(sn => varName.toLowerCase().includes(sn))) {
      return '[REDACTED]';
    }
    return value;
  }

  sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}

module.exports = { APIExecutor };
