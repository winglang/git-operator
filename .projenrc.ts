import { typescript } from 'projen';
import { JobPermission } from 'projen/lib/github/workflows-model';
import { NodePackageManager, TypeScriptModuleResolution } from 'projen/lib/javascript';
import * as chart from './projenrc/deploy';
import { deployConfigMap, deploySecret } from './projenrc/secret';

const project = new typescript.TypeScriptAppProject({
  defaultReleaseBranch: 'main',
  name: 'git-operator',
  projenrcTs: true,
  packageManager: NodePackageManager.NPM,
  deps: ['simple-git', 'octokit', '@octokit/types', '@octokit/rest', 'openai', 'slackify-markdown', '@kubernetes/client-node'],
  devDeps: ['cdk8s-plus-30', 'cdk8s', 'constructs'],
  tsconfig: {
    compilerOptions: {
      lib: [
        'es2021',
      ],
      module: 'Node16',
      moduleResolution: TypeScriptModuleResolution.NODE16,
      target: 'ES2021',
    },
    exclude: [
      'node_modules',
    ],
  },
});

const releaseWorkflow = project.github?.addWorkflow('release');
releaseWorkflow?.on({
  push: {
    branches: ['main'],
  },
});

releaseWorkflow?.addJob('release', {
  runsOn: ['ubuntu-latest'],
  permissions: {
    contents: JobPermission.READ,
  },
  steps: [
    {
      name: 'Checkout',
      uses: 'actions/checkout@v4',
    },
    {
      name: 'Install dependencies',
      run: 'npm ci',
    },
    {
      name: 'Build',
      run: 'npx projen',
      env: {
        SLACK_API_TOKEN: '${{ secrets.SLACK_API_TOKEN }}',
        SLACK_CHANNEL: '${{ secrets.SLACK_CHANNEL }}',
        GITHUB_TOKEN: '${{ secrets.GH_TOKEN }}',
        AWS_SECRET_ACCESS_KEY: '${{ secrets.AWS_SECRET_ACCESS_KEY }}',
        AWS_ACCESS_KEY_ID: '${{ secrets.AWS_ACCESS_KEY_ID }}',
        OPENAI_API_KEY: '${{ secrets.OPENAI_API_KEY }}',
      },
    },
    {
      name: 'Login to helm registry',
      run: 'echo "${{ secrets.DOCKER_PASSWORD }}" | helm registry login registry-1.docker.io --username "${{ secrets.DOCKER_USERNAME }}" --password-stdin',
      id: 'login',
    },
    {
      name: 'Package helm chart',
      run: 'helm package dist',
    },
    {
      name: 'Push helm chart',
      run: 'helm push git-operator-*.tgz oci://registry-1.docker.io/${{ secrets.DOCKER_USERNAME }}',
    },
  ],
});

const namespace = 'git-operator';
const release = 'git-operator';

const integrations: chart.Integrations = {
  slack: {
    configMap: 'slack-config',
    channelKey: 'SLACK_CHANNEL',
    secret: 'slack-token',
    apiTokenKey: 'SLACK_API_TOKEN',
  },
  github: {
    secret: 'github-token',
    apiTokenKey: 'GITHUB_TOKEN',
  },
  aws: {
    secret: 'aws-credentials',
    secretAccessKeyKey: 'AWS_SECRET_ACCESS_KEY',
    accessKeyIdKey: 'AWS_ACCESS_KEY_ID',
  },
  openai: {
    secret: 'openai-token',
    apiTokenKey: 'OPENAI_API_KEY',
  },
};

const deployConfig = project.addTask('deploy-config');

deployConfig.spawn(deployConfigMap(project, {
  namespace,
  configMapName: integrations.slack.configMap,
  map: {
    [integrations.slack.channelKey]: 'git-operator-dev-${USER}',
  },
}));

deployConfig.spawn(deploySecret(project, {
  namespace,
  secretName: integrations.slack.secret,
  keys: [integrations.slack.apiTokenKey],
}));

deployConfig.spawn(deploySecret(project, {
  namespace,
  secretName: integrations.github.secret,
  keys: [integrations.github.apiTokenKey],
}));

deployConfig.spawn(deploySecret(project, {
  namespace,
  secretName: integrations.aws.secret,
  keys: [integrations.aws.accessKeyIdKey, integrations.aws.secretAccessKeyKey],
}));

deployConfig.spawn(deploySecret(project, {
  namespace,
  secretName: integrations.openai.secret,
  keys: [integrations.openai.apiTokenKey],
}));

const imageValue = 'image';

chart.synth({
  image: `{{ .Values.${imageValue} }}`,
  namespace: namespace,
  integrations,
});

const tagfile = '/tmp/.tag.txt';
const shafile = '/tmp/.sha.txt';
const image = 'kind-registry:5001/git-operator';

const dockerBuild = project.addTask('docker-build', { exec: `docker build -q . > ${shafile}` });
dockerBuild.exec(`echo "${image}:$(cat ${shafile} | cut -d':' -f2)" > ${tagfile}`);
dockerBuild.exec(`docker tag $(cat ${shafile}) $(cat ${tagfile})`);

const dockerPush = project.addTask('docker-push', { exec: `docker push $(cat ${tagfile})` });

const deployHelm = project.addTask('deploy-helm');
deployHelm.exec('helm dependency update');
deployHelm.exec(`helm upgrade --install --create-namespace -n ${namespace} ${release} ./dist --set ${imageValue}=$(cat ${tagfile})`);

const createNamespace = project.addTask('create-namespace', {
  exec: `kubectl create namespace ${namespace} 2>/dev/null || true`,
});

const deploy = project.addTask('deploy');
deploy.spawn(project.compileTask);
deploy.spawn(dockerBuild);
deploy.spawn(dockerPush);
deploy.spawn(createNamespace);
deploy.spawn(deployConfig);
deploy.spawn(deployHelm);

project.synth();
