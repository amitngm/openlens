/**
 * UI Step Executor
 * 
 * Executes UI automation steps using Playwright.
 */

const path = require('path');
const { Logger } = require('../utils/logger');

class UIExecutor {
  constructor(page, variables, config, artifactsPath) {
    this.page = page;
    this.variables = variables;
    this.config = config;
    this.artifactsPath = artifactsPath;
    this.logger = new Logger('ui-executor');
  }

  async execute(step, stepName) {
    this.logger.info('Executing UI step', { action: step.action, stepName });

    const result = {
      action: step.action,
      selector: step.selector,
      value: step.value,
      url: step.url
    };

    switch (step.action) {
      case 'navigate':
        result.navigated = await this.navigate(step);
        break;
      
      case 'click':
        await this.click(step);
        break;
      
      case 'fill':
        await this.fill(step);
        break;
      
      case 'select':
        await this.select(step);
        break;
      
      case 'check':
        await this.check(step);
        break;
      
      case 'uncheck':
        await this.uncheck(step);
        break;
      
      case 'hover':
        await this.hover(step);
        break;
      
      case 'wait':
        await this.wait(step);
        break;
      
      case 'wait_for_selector':
        await this.waitForSelector(step);
        break;
      
      case 'wait_for_text':
        result.found = await this.waitForText(step);
        break;
      
      case 'screenshot':
        result.screenshot = await this.screenshot(step, stepName);
        break;
      
      case 'assert_text':
        result.textFound = await this.assertText(step);
        break;
      
      case 'assert_visible':
        result.visible = await this.assertVisible(step);
        break;
      
      case 'assert_value':
        result.value = await this.assertValue(step);
        break;
      
      case 'press':
        await this.press(step);
        break;
      
      case 'scroll':
        await this.scroll(step);
        break;
      
      default:
        throw new Error(`Unknown UI action: ${step.action}`);
    }

    // Wait for page to settle if configured
    if (step.wait_for) {
      await this.page.waitForSelector(
        this.interpolate(step.wait_for),
        { timeout: step.wait_timeout_ms || 10000 }
      );
    }

    return result;
  }

  async navigate(step) {
    const url = this.interpolate(step.url || this.config.UI_BASE_URL);
    this.logger.info('Navigating to', { url: this.redactUrl(url) });
    
    await this.page.goto(url, {
      waitUntil: 'networkidle',
      timeout: step.timeout_ms || 30000
    });
    
    return this.page.url();
  }

  async click(step) {
    const selector = this.interpolate(step.selector);
    this.logger.info('Clicking', { selector });
    
    await this.page.waitForSelector(selector, { timeout: step.timeout_ms || 30000 });
    await this.page.click(selector);
  }

  async fill(step) {
    const selector = this.interpolate(step.selector);
    const value = this.interpolate(step.value);
    this.logger.info('Filling', { selector, value: this.redactValue(value) });
    
    await this.page.waitForSelector(selector, { timeout: step.timeout_ms || 30000 });
    await this.page.fill(selector, value);
  }

  async select(step) {
    const selector = this.interpolate(step.selector);
    const value = this.interpolate(step.value);
    this.logger.info('Selecting', { selector, value });
    
    await this.page.waitForSelector(selector, { timeout: step.timeout_ms || 30000 });
    await this.page.selectOption(selector, value);
  }

  async check(step) {
    const selector = this.interpolate(step.selector);
    this.logger.info('Checking', { selector });
    
    await this.page.waitForSelector(selector, { timeout: step.timeout_ms || 30000 });
    await this.page.check(selector);
  }

  async uncheck(step) {
    const selector = this.interpolate(step.selector);
    this.logger.info('Unchecking', { selector });
    
    await this.page.waitForSelector(selector, { timeout: step.timeout_ms || 30000 });
    await this.page.uncheck(selector);
  }

  async hover(step) {
    const selector = this.interpolate(step.selector);
    this.logger.info('Hovering', { selector });
    
    await this.page.waitForSelector(selector, { timeout: step.timeout_ms || 30000 });
    await this.page.hover(selector);
  }

  async wait(step) {
    const ms = step.timeout_ms || 1000;
    this.logger.info('Waiting', { ms });
    await new Promise(resolve => setTimeout(resolve, ms));
  }

  async waitForSelector(step) {
    const selector = this.interpolate(step.selector);
    this.logger.info('Waiting for selector', { selector });
    
    await this.page.waitForSelector(selector, {
      timeout: step.timeout_ms || 30000,
      state: 'visible'
    });
  }

  async waitForText(step) {
    const text = this.interpolate(step.value);
    this.logger.info('Waiting for text', { text });
    
    try {
      await this.page.waitForFunction(
        (searchText) => document.body.innerText.includes(searchText),
        text,
        { timeout: step.timeout_ms || 30000 }
      );
      return true;
    } catch (error) {
      this.logger.warn('Text not found', { text });
      return false;
    }
  }

  async screenshot(step, stepName) {
    const filename = `${stepName.replace(/[^a-z0-9]/gi, '_')}_${Date.now()}.png`;
    const filepath = path.join(this.artifactsPath, 'screenshots', filename);
    
    await this.page.screenshot({
      path: filepath,
      fullPage: step.fullPage !== false
    });
    
    this.logger.info('Screenshot saved', { path: filepath });
    return filepath;
  }

  async assertText(step) {
    const selector = this.interpolate(step.selector);
    const expectedText = this.interpolate(step.value);
    
    await this.page.waitForSelector(selector, { timeout: step.timeout_ms || 30000 });
    const actualText = await this.page.textContent(selector);
    
    if (!actualText.includes(expectedText)) {
      throw new Error(`Expected text "${expectedText}" not found in "${actualText}"`);
    }
    
    return true;
  }

  async assertVisible(step) {
    const selector = this.interpolate(step.selector);
    
    try {
      await this.page.waitForSelector(selector, {
        timeout: step.timeout_ms || 30000,
        state: 'visible'
      });
      return true;
    } catch (error) {
      throw new Error(`Element not visible: ${selector}`);
    }
  }

  async assertValue(step) {
    const selector = this.interpolate(step.selector);
    const expectedValue = this.interpolate(step.value);
    
    await this.page.waitForSelector(selector, { timeout: step.timeout_ms || 30000 });
    const actualValue = await this.page.inputValue(selector);
    
    if (actualValue !== expectedValue) {
      throw new Error(`Expected value "${expectedValue}", got "${actualValue}"`);
    }
    
    return actualValue;
  }

  async press(step) {
    const key = step.value;
    this.logger.info('Pressing key', { key });
    
    if (step.selector) {
      await this.page.press(this.interpolate(step.selector), key);
    } else {
      await this.page.keyboard.press(key);
    }
  }

  async scroll(step) {
    if (step.selector) {
      const selector = this.interpolate(step.selector);
      await this.page.waitForSelector(selector);
      await this.page.locator(selector).scrollIntoViewIfNeeded();
    } else {
      await this.page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
    }
  }

  /**
   * Interpolate variables in a string.
   * Supports ${variable} and $ENV_VAR syntax.
   */
  interpolate(str) {
    if (!str) return str;
    
    let result = str;
    
    // Replace ${variable} patterns
    result = result.replace(/\$\{(\w+)\}/g, (match, varName) => {
      return this.variables[varName] ?? this.config[varName] ?? match;
    });
    
    // Replace $ENV_VAR patterns (for config values)
    result = result.replace(/\$(\w+)/g, (match, varName) => {
      return this.config[varName] ?? process.env[varName] ?? match;
    });
    
    return result;
  }

  /**
   * Redact sensitive values for logging.
   */
  redactValue(value) {
    const sensitivePatterns = [/password/i, /token/i, /secret/i, /key/i];
    
    for (const pattern of sensitivePatterns) {
      if (pattern.test(value)) {
        return '[REDACTED]';
      }
    }
    
    return value;
  }

  /**
   * Redact credentials from URLs for logging.
   */
  redactUrl(url) {
    try {
      const parsed = new URL(url);
      if (parsed.password) {
        parsed.password = '[REDACTED]';
      }
      return parsed.toString();
    } catch {
      return url;
    }
  }
}

module.exports = { UIExecutor };
