import { Project, Task } from 'projen';

export interface DeploySecretProps {
  readonly secretName: string;
  readonly namespace: string;
  readonly keys: string[];
}

export function deploySecret(project: Project, props: DeploySecretProps): Task {
  const task = project.addTask(`deploy-secret-${props.secretName}`);

  const args: string[] = [];
  for (const key of props.keys) {
    const value = process.env[key];
    if (!value) {
      throw new Error(`missing environment variable: ${key} for secret ${props.secretName}`);
    }
    args.push(`--from-literal=${key}=\${${key}}`);
  }

  // task.exec(`kubectl delete secret ${props.secretName} -n ${props.namespace} 2>/dev/null || true`);
  task.exec(`kubectl create secret generic ${props.secretName} -n ${props.namespace} ${args.join(' ')} 2>/dev/null || true`);

  return task;
}

export interface DeployConfigMapProps {
  readonly configMapName: string;
  readonly namespace: string;
  readonly map: Record<string, string>;
}

export function deployConfigMap(project: Project, props: DeployConfigMapProps): Task {
  const task = project.addTask(`deploy-configmap-${props.configMapName}`);
  // task.exec(`kubectl delete configmap ${props.configMapName} -n ${props.namespace} 2>/dev/null || true`);

  const args: string[] = [];
  for (const [key, value] of Object.entries(props.map)) {
    args.push(`--from-literal=${key}=${value}`);
  }

  task.exec(`kubectl create configmap ${props.configMapName} -n ${props.namespace} ${args.join(' ')} 2>/dev/null || true`);

  return task;
}
