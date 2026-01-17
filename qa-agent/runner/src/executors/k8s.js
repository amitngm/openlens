/**
 * Kubernetes Step Executor
 * 
 * Executes Kubernetes checks (pod ready, service available, logs grep).
 */

const { execSync } = require('child_process');
const { Logger } = require('../utils/logger');

class K8sExecutor {
  constructor(config) {
    this.config = config;
    this.logger = new Logger('k8s-executor');
    this.namespace = config.NAMESPACE || 'default';
  }

  async execute(step) {
    this.logger.info('Executing K8s check', { 
      checkType: step.check_type,
      resourceType: step.resource_type,
      resourceName: step.resource_name
    });

    const namespace = step.namespace || this.namespace;
    const result = {
      check_type: step.check_type,
      namespace,
      resource_type: step.resource_type,
      resource_name: step.resource_name
    };

    switch (step.check_type) {
      case 'pod_ready':
        result.ready = await this.checkPodReady(step, namespace);
        break;
      
      case 'service_available':
        result.available = await this.checkServiceAvailable(step, namespace);
        break;
      
      case 'endpoint_ready':
        result.ready = await this.checkEndpointReady(step, namespace);
        break;
      
      case 'logs_grep':
        result.found = await this.grepLogs(step, namespace);
        break;
      
      default:
        throw new Error(`Unknown K8s check type: ${step.check_type}`);
    }

    return result;
  }

  async checkPodReady(step, namespace) {
    const selector = step.label_selector 
      ? `-l ${step.label_selector}` 
      : step.resource_name;
    
    try {
      const timeout = Math.floor((step.timeout_ms || 60000) / 1000);
      
      // Wait for pod to be ready
      const cmd = step.label_selector
        ? `kubectl wait --for=condition=ready pod -l ${step.label_selector} -n ${namespace} --timeout=${timeout}s`
        : `kubectl wait --for=condition=ready pod/${step.resource_name} -n ${namespace} --timeout=${timeout}s`;
      
      execSync(cmd, { stdio: 'pipe', timeout: step.timeout_ms || 60000 });
      this.logger.info('Pod ready', { selector, namespace });
      return true;
    } catch (error) {
      this.logger.warn('Pod not ready', { selector, error: error.message });
      return false;
    }
  }

  async checkServiceAvailable(step, namespace) {
    try {
      const cmd = `kubectl get service ${step.resource_name} -n ${namespace} -o jsonpath='{.spec.clusterIP}'`;
      const result = execSync(cmd, { stdio: 'pipe', timeout: step.timeout_ms || 30000 });
      const clusterIP = result.toString().trim().replace(/'/g, '');
      
      if (clusterIP && clusterIP !== 'None') {
        this.logger.info('Service available', { 
          service: step.resource_name, 
          clusterIP 
        });
        return true;
      }
      
      return false;
    } catch (error) {
      this.logger.warn('Service not available', { 
        service: step.resource_name, 
        error: error.message 
      });
      return false;
    }
  }

  async checkEndpointReady(step, namespace) {
    try {
      const cmd = `kubectl get endpoints ${step.resource_name} -n ${namespace} -o jsonpath='{.subsets[*].addresses[*].ip}'`;
      const result = execSync(cmd, { stdio: 'pipe', timeout: step.timeout_ms || 30000 });
      const ips = result.toString().trim().replace(/'/g, '');
      
      if (ips && ips.length > 0) {
        this.logger.info('Endpoints ready', { 
          service: step.resource_name, 
          endpoints: ips.split(' ').length 
        });
        return true;
      }
      
      return false;
    } catch (error) {
      this.logger.warn('Endpoints not ready', { 
        service: step.resource_name, 
        error: error.message 
      });
      return false;
    }
  }

  async grepLogs(step, namespace) {
    try {
      const podSelector = step.label_selector 
        ? `-l ${step.label_selector}` 
        : step.resource_name;
      
      const containerArg = step.container ? `-c ${step.container}` : '';
      
      const cmd = step.label_selector
        ? `kubectl logs -l ${step.label_selector} ${containerArg} -n ${namespace} --tail=1000`
        : `kubectl logs ${step.resource_name} ${containerArg} -n ${namespace} --tail=1000`;
      
      const logs = execSync(cmd, { 
        stdio: 'pipe', 
        timeout: step.timeout_ms || 30000,
        maxBuffer: 10 * 1024 * 1024 // 10MB
      }).toString();
      
      const pattern = new RegExp(step.log_pattern, 'i');
      const found = pattern.test(logs);
      
      if (found) {
        this.logger.info('Log pattern found', { 
          pattern: step.log_pattern, 
          podSelector 
        });
      } else {
        this.logger.warn('Log pattern not found', { 
          pattern: step.log_pattern, 
          podSelector 
        });
      }
      
      return found;
    } catch (error) {
      this.logger.error('Failed to grep logs', { error: error.message });
      return false;
    }
  }
}

module.exports = { K8sExecutor };
