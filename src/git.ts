import { accessSync, constants, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { dirname, join } from 'path';
import { simpleGit, SimpleGit } from 'simple-git';

export interface GitContent {
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

export const clone = async (owner: string, name: string, token: string) => {
  const gitUrl = `https://oauth2:${token}@github.com/${owner}/${name}.git`;
  const tempDir = mkdtempSync(join(tmpdir(), `git-${owner}-${name}-`));
  const git = simpleGit(tempDir);
  await git.clone(gitUrl);
  return { git, dir: `${tempDir}/${name}` };
};

export const reconcileGitContent = async (obj: GitContent, token: string) => {
  const cloneResult = await clone(obj.owner, obj.name, token);

  let updated = false;
  for (const file of obj.files) {
    updated = reconcileFile(file, cloneResult) || updated;
  }

  if (updated) {
    console.error('pushing changes');
    await cloneResult.git
      .cwd(cloneResult.dir)
      .addConfig('user.name', 'Wing Cloud Bot')
      .addConfig('user.email', 'bot@wing.cloud')
      .add('.')
      .commit('update')
      .push();
  }
};
