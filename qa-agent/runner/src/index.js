/**
 * QA Agent Runner - Main Entry Point
 * 
 * Executes UI and API test flows using Playwright.
 */

const { program } = require('commander');
const path = require('path');
const fs = require('fs');
const yaml = require('yaml');

const { Runner } = require('./runner');
const { Logger } = require('./utils/logger');
const { loadConfig } = require('./utils/config');

const logger = new Logger('main');

program
  .name('qa-agent-runner')
  .description('Execute QA test flows')
  .version('1.0.0')
  .requiredOption('--flow <name>', 'Flow name to execute')
  .requiredOption('--run-id <id>', 'Unique run identifier')
  .option('--env <environment>', 'Target environment', 'staging')
  .option('--tenant <tenant>', 'Target tenant')
  .option('--project <project>', 'Target project')
  .option('--variables <json>', 'Variables as JSON string', '{}')
  .option('--flows-dir <path>', 'Flows directory', '/app/flows')
  .option('--artifacts-dir <path>', 'Artifacts directory', '/data/artifacts')
  .option('--headless', 'Run browser in headless mode', true)
  .option('--video', 'Record video', false)
  .option('--har', 'Capture HAR log', true);

program.parse();

const options = program.opts();

async function main() {
  logger.info('QA Agent Runner starting', {
    runId: options.runId,
    flow: options.flow,
    env: options.env
  });

  try {
    // Load configuration
    const config = loadConfig();
    
    // Parse variables
    let variables = {};
    try {
      variables = JSON.parse(options.variables);
    } catch (e) {
      logger.warn('Failed to parse variables, using empty object');
    }

    // Load flow definition
    const flowPath = path.join(options.flowsDir, `${options.flow}.yaml`);
    if (!fs.existsSync(flowPath)) {
      // Try in samples subdirectory
      const samplePath = path.join(options.flowsDir, 'samples', `${options.flow}.yaml`);
      if (!fs.existsSync(samplePath)) {
        throw new Error(`Flow not found: ${options.flow}`);
      }
      options.flowPath = samplePath;
    } else {
      options.flowPath = flowPath;
    }

    const flowContent = fs.readFileSync(options.flowPath, 'utf8');
    const flowDef = yaml.parse(flowContent);

    logger.info('Flow loaded', {
      name: flowDef.name,
      steps: flowDef.steps?.length || 0
    });

    // Create artifacts directory
    const artifactsPath = path.join(options.artifactsDir, options.runId);
    fs.mkdirSync(artifactsPath, { recursive: true });
    fs.mkdirSync(path.join(artifactsPath, 'screenshots'), { recursive: true });
    fs.mkdirSync(path.join(artifactsPath, 'videos'), { recursive: true });
    fs.mkdirSync(path.join(artifactsPath, 'reports'), { recursive: true });

    // Initialize runner
    const runner = new Runner({
      runId: options.runId,
      flow: flowDef,
      env: options.env,
      tenant: options.tenant,
      project: options.project,
      variables: {
        ...flowDef.default_variables,
        ...variables
      },
      config,
      artifactsPath,
      headless: options.headless,
      recordVideo: options.video,
      captureHar: options.har
    });

    // Execute flow
    const result = await runner.execute();

    // Save report
    const reportPath = path.join(artifactsPath, 'reports', 'report.json');
    fs.writeFileSync(reportPath, JSON.stringify(result, null, 2));

    logger.info('Flow execution completed', {
      status: result.status,
      passed: result.summary.passed,
      failed: result.summary.failed,
      duration: result.duration_ms
    });

    // Exit with appropriate code
    process.exit(result.status === 'completed' ? 0 : 1);

  } catch (error) {
    logger.error('Runner failed', { error: error.message, stack: error.stack });
    
    // Write error report
    const errorReport = {
      run_id: options.runId,
      flow_name: options.flow,
      status: 'failed',
      error: error.message,
      timestamp: new Date().toISOString()
    };
    
    const artifactsPath = path.join(options.artifactsDir, options.runId);
    fs.mkdirSync(artifactsPath, { recursive: true });
    fs.writeFileSync(
      path.join(artifactsPath, 'report.json'),
      JSON.stringify(errorReport, null, 2)
    );
    
    process.exit(1);
  }
}

main();
