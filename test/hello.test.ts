import { reconcileGitContent } from '../src/git';

test('hello', async () => {
  await reconcileGitContent({
    owner: 'eladcon',
    name: 'git-operator-test',
    files: [{
      path: 'README.md',
      content: 'hello, world!',
      readOnly: false,
    }],
  }, process.env.GITHUB_TOKEN!);
});