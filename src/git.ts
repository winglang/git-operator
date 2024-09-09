import { accessSync, constants, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { dirname, join } from 'path';
import { simpleGit, SimpleGit } from 'simple-git';
import { exec } from './util.js';

export type ApiObject = {
  apiVersion: string;
  kind: string;
  status?: any;
  metadata: {
    name: string;
    namespace?: string;
    creationTimestamp?: string;
    generation?: number;
    resourceVersion?: string;

    uid?: string;
    annotations?: Record<string, string>;
    labels?: Record<string, string>;
    managedFields?: any[];
  };
};

export interface RuntimeHost {
  exec: typeof exec;
};

export interface GitContent extends ApiObject {
  name: string;
  owner: string;
  files: {
    path: string;
    content: string;
    readOnly?: boolean;
  }[];
}

export interface CloneResult {
  git: SimpleGit;
  dir: string;
}

export async function patchStatus(obj: ApiObject, patch: any) {
  try {
    const namespace = obj.metadata.namespace ?? 'default';
    const group = obj.apiVersion.split('/')[0];
    const type = `${obj.kind.toLowerCase()}.${group}`;
    await exec('kubectl', [
      'patch',
      type,
      obj.metadata.name,
      '-n', namespace,
      '--type', 'merge',
      '--subresource', 'status',
      '--patch', JSON.stringify({ status: patch }),
    ], { stdio: 'ignore' });
  } catch (err) {
    // just ignore errors
  }
}

const updateReadyCondition = async (obj: ApiObject, ready: boolean, message: string) => patchStatus(obj, {
  conditions: [{
    type: 'Ready',
    status: ready ? 'True' : 'False',
    lastTransitionTime: new Date().toISOString(),
    lastProbeTime: new Date().toISOString(),
    message,
  }],
});

export const reconcileFile = (file: GitContent['files'][number], cloneResult: CloneResult) => {
  console.error('reconciling file', file);
  const filePath = join(cloneResult.dir, file.path);

  try {
    accessSync(filePath, constants.F_OK);
    console.error('file exists');

    if (!file.readOnly) {
      console.error('file can be updated, skipping');
      return false;
    }

    // read the file, update it if it's different
    const fileContent = readFileSync(filePath, 'utf8');
    if (fileContent === file.content) {
      console.error('file content is the same, skipping');
      return false;
    }

    // File is different, update it
    console.error('updating file');
    writeFileSync(filePath, file.content);
    return true;
  } catch (error) {
    // File doesn't exist, create it
    console.error('creatint file');
    mkdirSync(dirname(filePath), { recursive: true });
    writeFileSync(filePath, file.content);
    return true;
  }
};

export const getOctokit = async (token: string) => {
  const { Octokit } = await import('octokit');
  return new Octokit({ auth: token });
};

export const getPR = async (owner: string, name: string, token: string) => {
  const octokit = await getOctokit(token);

  const { data: existingPRs } = await octokit.rest.pulls.list({
    owner,
    repo: name,
    state: 'open',
  });

  // check if there is a PR with head gitoperator
  if (existingPRs.find((pr) => pr.head.ref === 'gitoperator')) {
    console.error('PR already exists');
    return true;
  }

  return false;
};

export const createPR = async (owner: string, name: string, token: string) => {
  const octokit = await getOctokit(token);

  const prExists = await getPR(owner, name, token);
  if (prExists) {
    console.error('PR already exists');
    return;
  }

  // create a PR using octokit
  console.error('creating PR');
  await octokit.rest.pulls.create({
    owner,
    repo: name,
    title: `Update ${name}`,
    head: 'gitoperator',
    base: 'main',
    body: 'Update',
  });
};

export const clone = async (owner: string, name: string, token: string) => {
  const gitUrl = `https://oauth2:${token}@github.com/${owner}/${name}.git`;
  const tempDir = mkdtempSync(join(tmpdir(), `git-${owner}-${name}-`));
  const git = simpleGit(tempDir);
  await git.clone(gitUrl);
  return { git, dir: `${tempDir}/${name}` };
};

export const reconcileGitContent = async (obj: GitContent, token: string) => {
  const cloneResult = await clone(obj.owner, obj.name, token);

  // checkout the gitoperator branch if exists or create it
  try {
    console.error('checkout branch gitoperator');
    await cloneResult.git.cwd(cloneResult.dir).checkout('gitoperator');
    // merge main into gitoperator
    await cloneResult.git.cwd(cloneResult.dir).merge(['main', '-m', 'Merge main into gitoperator']);
  } catch (error) {
    console.error('create branch gitoperator');
    await cloneResult.git.cwd(cloneResult.dir).checkout('main', ['-b', 'gitoperator']);
  }

  let updated = false;
  for (const file of obj.files) {
    updated = reconcileFile(file, cloneResult) || updated;
  }

  if (updated) {
    console.error('pushing changes');
    await cloneResult.git
      .addConfig('user.name', 'Wing Cloud Bot')
      .addConfig('user.email', 'bot@wing.cloud')
      .cwd(cloneResult.dir)
      .add('.')
      .commit('update')
      .push(['-u', 'origin', 'gitoperator', '--force']);

    await createPR(obj.owner, obj.name, token);
    await updateReadyCondition(obj, true, 'In progress');
  } else {
    const prExists = await getPR(obj.owner, obj.name, token);
    if (!prExists) {
      await updateReadyCondition(obj, false, 'Synced');
    }
  }
};
