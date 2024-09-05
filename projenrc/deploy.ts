import { cpSync } from 'fs';
import * as cdk8s from 'cdk8s';
import * as k8s from 'cdk8s-plus-30';
import { Construct } from 'constructs';
import { CustomResourceDefinition } from './crd';

export interface Integrations {
  slack: {
    configMap: string;
    channelKey: string;
    secret: string;
    apiTokenKey: string;
  };

  github: {
    secret: string;
    apiTokenKey: string;
  };

  aws: {
    secret: string;
    accessKeyIdKey: string;
    secretAccessKeyKey: string;
  };

  openai: {
    secret: string;
    apiTokenKey: string;
  };
}

interface OperatorProps {
  image: string;
  namespace: string;
  integrations: Integrations;
}

class Operator extends Construct {

  constructor(scope: Construct, id: string, props: OperatorProps) {
    super(scope, id);

    const serviceAccount = new k8s.ServiceAccount(this, 'ServiceAccount', {
      metadata: {
        namespace: props.namespace,
        name: 'serviceaccount',
      },
    });

    const role = new k8s.ClusterRole(this, 'ClusterRole', {
      metadata: {
        name: `${props.namespace}-cluster-role`,
      },
      rules: [
        // allow pod to apply any manifest to any namespace
        {
          verbs: ['*'],
          endpoints: [
            k8s.ApiResource.custom({
              apiGroup: '*',
              resourceType: '*',
            }),
          ],
        },
      ],
    });

    const binding = new k8s.ClusterRoleBinding(this, 'ClusterRoleBinding', {
      metadata: {
        name: `${props.namespace}-cluster-role-binding`,
      },
      role,
    });
    binding.addSubjects(serviceAccount);

    const controller = new k8s.Deployment(this, 'Deployment', {
      metadata: {
        namespace: props.namespace,
        name: 'controller',
      },
      serviceAccount: serviceAccount,
      replicas: 1,
      automountServiceAccountToken: true,
    });

    const integ = props.integrations;;

    controller.addContainer({
      image: props.image,
      imagePullPolicy: k8s.ImagePullPolicy.ALWAYS,
      resources: {
        cpu: {
          request: k8s.Cpu.millis(100),
          limit: k8s.Cpu.units(1),
        },
      },
      securityContext: {
        readOnlyRootFilesystem: false,
        ensureNonRoot: false,
      },
      envVariables: {
        SLACK_API_TOKEN: k8s.EnvValue.fromSecretValue({ secret: k8s.Secret.fromSecretName(this, 'x1', integ.slack.secret), key: integ.slack.apiTokenKey }),
        SLACK_CHANNEL: k8s.EnvValue.fromConfigMap(k8s.ConfigMap.fromConfigMapName(this, 'x2', integ.slack.configMap), integ.slack.channelKey),
        GITHUB_TOKEN: k8s.EnvValue.fromSecretValue({ secret: k8s.Secret.fromSecretName(this, 'x3', integ.github.secret), key: integ.github.apiTokenKey }),
        AWS_ACCESS_KEY_ID: k8s.EnvValue.fromSecretValue({ secret: k8s.Secret.fromSecretName(this, 'x4', integ.aws.secret), key: integ.aws.accessKeyIdKey }),
        AWS_SECRET_ACCESS_KEY: k8s.EnvValue.fromSecretValue({ secret: k8s.Secret.fromSecretName(this, 'x5', integ.aws.secret), key: integ.aws.secretAccessKeyKey }),
        OPENAI_API_KEY: k8s.EnvValue.fromSecretValue({ secret: k8s.Secret.fromSecretName(this, 'x6', integ.openai.secret), key: integ.openai.apiTokenKey }),
      },
    });

    new CustomResourceDefinition(this, 'crd', {
      version: 'v1',
      kind: 'GitContent',
      group: 'wingcloud.com',
      plural: 'gitcontents',
      schema: {
        type: 'object',
        properties: {
          name: {
            type: 'string',
          },
          owner: {
            type: 'string',
          },
          files: {
            type: 'array',
            items: {
              type: 'object',
              properties: {
                path: {
                  type: 'string',
                },
                content: {
                  type: 'string',
                },
                readOnly: {
                  type: 'boolean',
                },
              },
              required: [
                'path',
                'content',
              ],
            },
          },
        },
        required: [
          'name',
          'owner',
          'files',
        ],
      },
    });
  }
}

export function synth(props: OperatorProps) {
  const app = new cdk8s.App({ outdir: 'dist/templates' });
  const chart = new cdk8s.Chart(app, 'git-operator', {
    labels: {
      app: props.namespace,
    },
  });

  new Operator(chart, 'Operator', props);
  app.synth();

  cpSync('./Chart.yaml', 'dist/Chart.yaml', { force: true });
}