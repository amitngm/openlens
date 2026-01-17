/**
 * QA Agent Runner - Core Runner
 * 
 * Orchestrates flow execution with Playwright.
 */

const { chromium } = require('playwright');
const path = require('path');
const fs = require('fs');

const { UIExecutor } = require('./executors/ui');
const { APIExecutor } = require('./executors/api');
const { K8sExecutor } = require('./executors/k8s');
const { Logger } = require('./utils/logger');

class Runner {
  constructor(options) {
    this.runId = options.runId;
    this.flow = options.flow;
    this.env = options.env;
    this.tenant = options.tenant;
    this.project = options.project;
    this.variables = options.variables;
    this.config = options.config;
    this.artifactsPath = options.artifactsPath;
    this.headless = options.headless !== false;
    this.recordVideo = options.recordVideo || false;
    this.captureHar = options.captureHar !== false;
    
    this.logger = new Logger('runner');
    this.browser = null;
    this.context = null;
    this.page = null;
    
    this.results = {
      run_id: this.runId,
      flow_name: this.flow.name,
      environment: this.env,
      tenant: this.tenant,
      project: this.project,
      status: 'pending',
      started_at: null,
      completed_at: null,
      duration_ms: null,
      summary: {
        total: 0,
        passed: 0,
        failed: 0,
        skipped: 0
      },
      steps: [],
      error: null
    };
  }

  async execute() {
    this.results.started_at = new Date().toISOString();
    const startTime = Date.now();

    try {
      // Initialize browser
      await this.initBrowser();

      // Execute setup steps
      if (this.flow.setup && this.flow.setup.length > 0) {
        this.logger.info('Executing setup steps', { count: this.flow.setup.length });
        for (const step of this.flow.setup) {
          await this.executeStep(step, 'setup');
        }
      }

      // Execute main steps
      this.logger.info('Executing main steps', { count: this.flow.steps.length });
      for (const step of this.flow.steps) {
        const result = await this.executeStep(step, 'main');
        
        // Stop on failure unless continue_on_failure is set
        if (result.status === 'fail' && !step.continue_on_failure) {
          this.logger.error('Step failed, stopping execution', { step: step.name });
          break;
        }
      }

      // Execute teardown steps (always run)
      if (this.flow.teardown && this.flow.teardown.length > 0) {
        this.logger.info('Executing teardown steps', { count: this.flow.teardown.length });
        for (const step of this.flow.teardown) {
          await this.executeStep(step, 'teardown');
        }
      }

      // Determine final status
      this.results.status = this.results.summary.failed === 0 ? 'completed' : 'failed';

    } catch (error) {
      this.logger.error('Flow execution error', { error: error.message });
      this.results.status = 'failed';
      this.results.error = error.message;
    } finally {
      await this.cleanup();
      
      this.results.completed_at = new Date().toISOString();
      this.results.duration_ms = Date.now() - startTime;
    }

    return this.results;
  }

  async initBrowser() {
    this.logger.info('Initializing browser', { headless: this.headless });

    this.browser = await chromium.launch({
      headless: this.headless,
      args: [
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--disable-dev-shm-usage'
      ]
    });

    const contextOptions = {
      viewport: { width: 1920, height: 1080 },
      ignoreHTTPSErrors: true,
      locale: 'en-US'
    };

    // Video recording
    if (this.recordVideo) {
      contextOptions.recordVideo = {
        dir: path.join(this.artifactsPath, 'videos'),
        size: { width: 1920, height: 1080 }
      };
    }

    // HAR recording
    if (this.captureHar) {
      contextOptions.recordHar = {
        path: path.join(this.artifactsPath, 'reports', 'network.har'),
        mode: 'full'
      };
    }

    this.context = await this.browser.newContext(contextOptions);
    this.page = await this.context.newPage();

    // Set default timeout
    this.page.setDefaultTimeout(30000);

    this.logger.info('Browser initialized');
  }

  async executeStep(stepDef, phase) {
    const stepStartTime = Date.now();
    this.results.summary.total++;

    const stepResult = {
      name: stepDef.name,
      type: stepDef.type,
      phase: phase,
      status: 'pending',
      started_at: new Date().toISOString(),
      completed_at: null,
      duration_ms: null,
      message: null,
      assertions: [],
      artifacts: [],
      metadata: {}
    };

    this.logger.info('Executing step', { name: stepDef.name, type: stepDef.type });

    try {
      // Wait before step if configured
      if (stepDef.wait_before_ms > 0) {
        await this.sleep(stepDef.wait_before_ms);
      }

      // Check skip condition
      if (stepDef.skip_condition && this.evaluateCondition(stepDef.skip_condition)) {
        stepResult.status = 'skip';
        stepResult.message = `Skipped: ${stepDef.skip_condition}`;
        this.results.summary.skipped++;
        this.results.steps.push(stepResult);
        return stepResult;
      }

      // Execute based on type
      let executor;
      switch (stepDef.type) {
        case 'ui':
          executor = new UIExecutor(this.page, this.variables, this.config, this.artifactsPath);
          stepResult.metadata = await executor.execute(stepDef.ui, stepDef.name);
          break;
        
        case 'api':
          executor = new APIExecutor(this.variables, this.config);
          stepResult.metadata = await executor.execute(stepDef.api);
          break;
        
        case 'k8s':
          executor = new K8sExecutor(this.config);
          stepResult.metadata = await executor.execute(stepDef.k8s);
          break;
        
        default:
          throw new Error(`Unknown step type: ${stepDef.type}`);
      }

      // Run assertions
      if (stepDef[stepDef.type]?.assertions) {
        stepResult.assertions = await this.runAssertions(
          stepDef[stepDef.type].assertions,
          stepResult.metadata
        );
      }

      // Check for assertion failures
      const failedAssertions = stepResult.assertions.filter(a => !a.passed);
      if (failedAssertions.length > 0) {
        throw new Error(`Assertions failed: ${failedAssertions.map(a => a.message).join(', ')}`);
      }

      stepResult.status = 'pass';
      stepResult.message = 'Step completed successfully';
      this.results.summary.passed++;

      // Take screenshot on UI steps
      if (stepDef.type === 'ui' && (stepDef.ui?.screenshot || this.flow.capture_screenshots)) {
        const screenshotPath = await this.takeScreenshot(stepDef.name);
        if (screenshotPath) {
          stepResult.artifacts.push(screenshotPath);
        }
      }

    } catch (error) {
      stepResult.status = 'fail';
      stepResult.message = error.message;
      this.results.summary.failed++;

      this.logger.error('Step failed', { step: stepDef.name, error: error.message });

      // Take screenshot on failure
      if (stepDef.type === 'ui') {
        const screenshotPath = await this.takeScreenshot(`${stepDef.name}_error`);
        if (screenshotPath) {
          stepResult.artifacts.push(screenshotPath);
        }
      }

      // Retry if configured
      if (stepDef.retry_count > 0 && !stepResult.retried) {
        this.logger.info('Retrying step', { step: stepDef.name, attempts: stepDef.retry_count });
        stepDef.retry_count--;
        stepResult.retried = true;
        return this.executeStep(stepDef, phase);
      }
    } finally {
      stepResult.completed_at = new Date().toISOString();
      stepResult.duration_ms = Date.now() - stepStartTime;

      // Wait after step if configured
      if (stepDef.wait_after_ms > 0) {
        await this.sleep(stepDef.wait_after_ms);
      }
    }

    this.results.steps.push(stepResult);
    return stepResult;
  }

  async runAssertions(assertions, metadata) {
    const results = [];

    for (const assertion of assertions) {
      const result = {
        type: assertion.type,
        target: assertion.target,
        expected: assertion.expected,
        actual: null,
        passed: false,
        message: null
      };

      try {
        result.actual = this.extractValue(metadata, assertion.target);
        result.passed = this.checkAssertion(assertion, result.actual);
        result.message = result.passed 
          ? 'Assertion passed'
          : assertion.message || `Expected ${assertion.expected}, got ${result.actual}`;
      } catch (error) {
        result.passed = false;
        result.message = error.message;
      }

      results.push(result);
    }

    return results;
  }

  extractValue(data, target) {
    // Simple path extraction (e.g., "response.status" or "$.data.id")
    if (target.startsWith('$.')) {
      // JSONPath - simplified implementation
      const path = target.substring(2).split('.');
      let value = data;
      for (const key of path) {
        value = value?.[key];
      }
      return value;
    }
    
    const parts = target.split('.');
    let value = data;
    for (const part of parts) {
      value = value?.[part];
    }
    return value;
  }

  checkAssertion(assertion, actual) {
    switch (assertion.type) {
      case 'equals':
        return actual === assertion.expected;
      case 'not_equals':
        return actual !== assertion.expected;
      case 'contains':
        return String(actual).includes(assertion.expected);
      case 'not_contains':
        return !String(actual).includes(assertion.expected);
      case 'matches':
        return new RegExp(assertion.expected).test(String(actual));
      case 'greater_than':
        return Number(actual) > Number(assertion.expected);
      case 'less_than':
        return Number(actual) < Number(assertion.expected);
      case 'exists':
        return actual !== undefined && actual !== null;
      case 'not_exists':
        return actual === undefined || actual === null;
      case 'status_code':
        return actual === assertion.expected;
      default:
        return false;
    }
  }

  evaluateCondition(condition) {
    // Simple condition evaluation
    // Supports: ${variable} == value, ${variable} != value
    const match = condition.match(/\$\{(\w+)\}\s*(==|!=)\s*(.+)/);
    if (match) {
      const [, varName, operator, value] = match;
      const actual = this.variables[varName];
      const expected = value.trim().replace(/^['"]|['"]$/g, '');
      
      if (operator === '==') return actual === expected;
      if (operator === '!=') return actual !== expected;
    }
    return false;
  }

  async takeScreenshot(name) {
    try {
      const filename = `${name.replace(/[^a-z0-9]/gi, '_')}_${Date.now()}.png`;
      const filepath = path.join(this.artifactsPath, 'screenshots', filename);
      await this.page.screenshot({ path: filepath, fullPage: true });
      this.logger.info('Screenshot saved', { path: filepath });
      return filepath;
    } catch (error) {
      this.logger.warn('Failed to take screenshot', { error: error.message });
      return null;
    }
  }

  async cleanup() {
    this.logger.info('Cleaning up');

    if (this.context) {
      await this.context.close();
    }
    if (this.browser) {
      await this.browser.close();
    }
  }

  sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}

module.exports = { Runner };
