import fs from 'fs';

type Context = {
  ts?: string;
  channel?: string;
};

export type Blocks = Array<{
  type: 'section';
  text: {
    type: 'mrkdwn';
    text: string;
  };
}>;

async function sendSlackMessage(channel: string, blocks: Blocks, thread_ts?: string): Promise<Context> {
  const slackToken = process.env.SLACK_API_TOKEN;
  if (!slackToken) {
    console.error('Warning: SLACK_API_TOKEN environment variable is not set - not sending message to Slack');
    return {
      channel: undefined,
      ts: undefined,
    };
  }

  const channelID = channel;

  const payload = {
    channel: channelID,
    thread_ts: thread_ts,
    blocks,
  };

  try {
    const url = 'https://slack.com/api/chat.postMessage';

    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${slackToken}`,
      },
      body: JSON.stringify(payload),
    });

    const body: any = await response.json();
    if (!body.ok) {
      throw new Error(body.error);
    }

    return {
      ts: body.ts,
      channel: body.channel,
    };
  } catch (e) {
    console.error('Failed to send message to Slack: ', e);
    console.error(JSON.stringify(payload, undefined, 2));
    return {
      ts: undefined,
      channel: undefined,
    };
  }
}

async function editSlackMessage(ctx: Context, blocks: Blocks) {
  try {
    const slackToken = process.env.SLACK_API_TOKEN;
    if (!slackToken) {
      console.error('Warning: SLACK_API_TOKEN environment variable is not set - not sending message to Slack');
      return;
    }

    const url = 'https://slack.com/api/chat.update';

    const payload = {
      channel: ctx.channel,
      ts: ctx.ts,
      blocks,
    };

    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${slackToken}`,
      },
      body: JSON.stringify(payload),
    });

    const body: any = await response.json();
    if (!body.ok) {
      throw new Error(`Failed to send message to Slack: ${body.error}`);
    }
  } catch (e) {
    console.error('Failed to send message to Slack: ', e);
    console.error({ ctx, blocks });
  }
}

const cache = '/tmp/slack-threads';
fs.mkdirSync(cache, { recursive: true });

export async function getOrCreateSlackThread(uid: string, channel: string, initialMessage: Blocks) {
  const key = `${cache}/${uid}`;

  let threadContext: Context;
  try {
    threadContext = JSON.parse(fs.readFileSync(key, 'utf-8'));
  } catch {
    threadContext = await sendSlackMessage(channel, initialMessage);
    fs.writeFileSync(key, JSON.stringify(threadContext));
  }

  return {
    update: (message: string) => editSlackMessage(threadContext, renderBlocks(message)),
    post: (message: string) => sendSlackMessage(channel, renderBlocks(message), threadContext.ts),
    postBlocks: (blocks: Blocks) => sendSlackMessage(channel, blocks, threadContext.ts),
  };
}

const renderBlocks = (message: string): Blocks => [
  {
    type: 'section',
    text: {
      type: 'mrkdwn',
      text: message,
    },
  },
];

export const newSlackThread = async (channel: string, initialMessage: string) => {

  const threadContext = await sendSlackMessage(channel, renderBlocks(initialMessage));
  if (!threadContext) {
    return {
      update: async () => {},
      post: async () => {},
      postBlocks: async () => {},
    };
  }

  const postBlocks = async (blocks: Blocks) => sendSlackMessage(channel, blocks, threadContext.ts);
  const post = async (message: string) => postBlocks(renderBlocks(message));
  const update = async (message: string) => editSlackMessage(threadContext, renderBlocks(message));

  return {
    update,
    post,
    postBlocks,
  };
};

