/**
 * Configuration loader for the runner.
 */

require('dotenv').config();

function loadConfig() {
  return {
    // Environment
    ENVIRONMENT: process.env.TARGET_ENV || process.env.ENVIRONMENT || 'development',
    NAMESPACE: process.env.NAMESPACE || 'qa-agent',
    
    // Target URLs
    UI_BASE_URL: process.env.UI_BASE_URL || 'https://cmp.internal.example.com',
    API_BASE_URL: process.env.API_BASE_URL || 'https://api.internal.example.com',
    
    // Authentication (from K8s secrets)
    UI_USERNAME: process.env.UI_USERNAME,
    UI_PASSWORD: process.env.UI_PASSWORD,
    API_TOKEN: process.env.API_TOKEN,
    
    // Tenant/Project
    TENANT: process.env.TENANT,
    PROJECT: process.env.PROJECT,
    
    // Paths
    FLOWS_DIR: process.env.FLOWS_DIR || '/app/flows',
    ARTIFACTS_PATH: process.env.ARTIFACTS_PATH || '/data/artifacts',
    
    // Timeouts
    DEFAULT_TIMEOUT_MS: parseInt(process.env.DEFAULT_TIMEOUT_MS || '30000', 10),
    PAGE_LOAD_TIMEOUT_MS: parseInt(process.env.PAGE_LOAD_TIMEOUT_MS || '60000', 10),
    
    // Browser options
    HEADLESS: process.env.HEADLESS !== 'false',
    SLOW_MO: parseInt(process.env.SLOW_MO || '0', 10),
    
    // Logging
    LOG_LEVEL: process.env.LOG_LEVEL || 'info',
  };
}

module.exports = { loadConfig };
